import path from 'path';
import fs from 'fs';
import os from 'os';
import { simpleGit, SimpleGit } from 'simple-git';
import { createLogger } from '../utils/logger.js';
import {
  checkDockerAvailable,
  ensureImage,
  createContainer,
  execInContainer,
  removeContainer,
  ExecResult
} from './docker.js';

const logger = createLogger('SandboxRunner');

// Python image to use for testing
const PYTHON_IMAGE = 'python:3.11-slim';

export interface ReproductionConfig {
  repo: string;          // e.g., "owner/repo"
  sha: string;           // Commit SHA to checkout
  cloneUrl: string;      // Git clone URL
  testCommand?: string;  // Custom test command (defaults to pytest)
  timeout?: number;      // Test timeout in ms (defaults to 5 minutes)
}

export interface ReproductionResult {
  success: boolean;
  reproduced: boolean;   // Did the failure reproduce?
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: string;
  workDir?: string;      // Path to cloned repo (for further operations)
  containerId?: string;
}

/**
 * Clone a repository to a temporary directory at a specific SHA.
 */
export async function cloneRepo(
  cloneUrl: string,
  sha: string,
  targetDir: string
): Promise<void> {
  logger.info('Cloning repository', { cloneUrl, sha: sha.substring(0, 7), targetDir });

  // Ensure target directory exists
  fs.mkdirSync(targetDir, { recursive: true });

  const git: SimpleGit = simpleGit();

  // Clone with depth 1 for speed, then fetch the specific SHA
  await git.clone(cloneUrl, targetDir, ['--depth', '50']);

  // Checkout the specific SHA
  const repoGit = simpleGit(targetDir);
  await repoGit.checkout(sha);

  logger.debug('Repository cloned and checked out', { sha: sha.substring(0, 7) });
}

/**
 * Detect the test configuration for a Python project.
 */
export function detectTestConfig(repoDir: string): {
  hasRequirements: boolean;
  hasPyproject: boolean;
  hasSetupPy: boolean;
  testCommand: string;
} {
  const hasRequirements = fs.existsSync(path.join(repoDir, 'requirements.txt'));
  const hasPyproject = fs.existsSync(path.join(repoDir, 'pyproject.toml'));
  const hasSetupPy = fs.existsSync(path.join(repoDir, 'setup.py'));

  // Default test command
  let testCommand = 'pytest tests/ -v --tb=short';

  // Check for pytest.ini or pyproject.toml pytest config
  if (hasPyproject) {
    const content = fs.readFileSync(path.join(repoDir, 'pyproject.toml'), 'utf8');
    if (content.includes('[tool.pytest')) {
      testCommand = 'pytest -v --tb=short';
    }
  }

  return {
    hasRequirements,
    hasPyproject,
    hasSetupPy,
    testCommand,
  };
}

/**
 * Create a unique working directory for this reproduction attempt.
 */
export function createWorkDir(runId: number): string {
  const baseDir = path.join(os.tmpdir(), 'nightwatch');
  const workDir = path.join(baseDir, `run-${runId}-${Date.now()}`);
  fs.mkdirSync(workDir, { recursive: true });
  return workDir;
}

/**
 * Clean up a working directory.
 */
export function cleanupWorkDir(workDir: string): void {
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
    logger.debug('Cleaned up work directory', { workDir });
  } catch (error) {
    logger.warn('Failed to cleanup work directory', {
      workDir,
      error: error instanceof Error ? error.message : 'Unknown'
    });
  }
}

/**
 * Reproduce a CI failure in a Docker sandbox.
 *
 * Steps:
 * 1. Clone repo at specific SHA
 * 2. Create Docker container
 * 3. Install dependencies
 * 4. Run tests
 * 5. Check if failure reproduces
 */
export async function reproduceFailure(config: ReproductionConfig): Promise<ReproductionResult> {
  const { repo, sha, cloneUrl, timeout = 300000 } = config;

  logger.info('Starting failure reproduction', { repo, sha: sha.substring(0, 7) });

  // Check Docker availability
  const dockerAvailable = await checkDockerAvailable();
  if (!dockerAvailable) {
    return {
      success: false,
      reproduced: false,
      exitCode: 1,
      stdout: '',
      stderr: '',
      error: 'Docker is not available',
    };
  }

  // Create work directory
  const runId = Date.now();
  const workDir = createWorkDir(runId);
  const repoDir = path.join(workDir, 'repo');

  let container: Awaited<ReturnType<typeof createContainer>> | null = null;

  try {
    // Step 1: Clone repository
    await cloneRepo(cloneUrl, sha, repoDir);

    // Step 2: Detect test configuration
    const testConfig = detectTestConfig(repoDir);
    const testCommand = config.testCommand || testConfig.testCommand;

    logger.debug('Test configuration detected', testConfig);

    // Step 3: Ensure Python image is available
    await ensureImage(PYTHON_IMAGE);

    // Step 4: Create container
    container = await createContainer({
      image: PYTHON_IMAGE,
      workDir: '/app',
      hostDir: repoDir,
    });

    // Step 5: Install dependencies
    logger.info('Installing dependencies');

    // Upgrade pip first
    const pipUpgrade = await execInContainer(
      container,
      ['pip', 'install', '--upgrade', 'pip'],
      60000
    );

    if (pipUpgrade.exitCode !== 0) {
      logger.warn('pip upgrade failed', { stderr: pipUpgrade.stderr });
    }

    // Install pytest if not in requirements
    await execInContainer(
      container,
      ['pip', 'install', 'pytest'],
      60000
    );

    // Install requirements.txt if present
    if (testConfig.hasRequirements) {
      const installResult = await execInContainer(
        container,
        ['pip', 'install', '-r', 'requirements.txt'],
        180000 // 3 minutes for dependency install
      );

      if (installResult.exitCode !== 0) {
        logger.warn('Dependency installation failed', {
          exitCode: installResult.exitCode,
          stderr: installResult.stderr.substring(0, 500),
        });
      }
    }

    // Install package if setup.py exists
    if (testConfig.hasSetupPy) {
      await execInContainer(
        container,
        ['pip', 'install', '-e', '.'],
        120000
      );
    }

    // Step 6: Run tests
    logger.info('Running tests', { command: testCommand });

    const testResult = await execInContainer(
      container,
      ['sh', '-c', testCommand],
      timeout
    );

    logger.info('Test execution complete', {
      exitCode: testResult.exitCode,
      timedOut: testResult.timedOut,
    });

    // Failure reproduced if tests failed (exit code != 0)
    const reproduced = testResult.exitCode !== 0;

    return {
      success: true,
      reproduced,
      exitCode: testResult.exitCode,
      stdout: testResult.stdout,
      stderr: testResult.stderr,
      workDir: repoDir,
      containerId: container.id,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Reproduction failed', { error: errorMessage });

    return {
      success: false,
      reproduced: false,
      exitCode: 1,
      stdout: '',
      stderr: '',
      error: errorMessage,
    };

  } finally {
    // Cleanup container (but keep workDir for potential fix attempts)
    if (container) {
      await removeContainer(container);
    }
  }
}

/**
 * Run tests in an existing work directory.
 * Used after applying a fix to verify it works.
 */
export async function runTestsInWorkDir(
  repoDir: string,
  testCommand?: string,
  timeout: number = 300000
): Promise<ExecResult & { containerId?: string }> {
  logger.info('Running tests in work directory', { repoDir });

  const dockerAvailable = await checkDockerAvailable();
  if (!dockerAvailable) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'Docker is not available',
      timedOut: false,
    };
  }

  const testConfig = detectTestConfig(repoDir);
  const command = testCommand || testConfig.testCommand;

  let container: Awaited<ReturnType<typeof createContainer>> | null = null;

  try {
    await ensureImage(PYTHON_IMAGE);

    container = await createContainer({
      image: PYTHON_IMAGE,
      workDir: '/app',
      hostDir: repoDir,
    });

    // Install dependencies
    if (testConfig.hasRequirements) {
      await execInContainer(
        container,
        ['pip', 'install', '-r', 'requirements.txt'],
        180000
      );
    }

    await execInContainer(container, ['pip', 'install', 'pytest'], 60000);

    if (testConfig.hasSetupPy) {
      await execInContainer(container, ['pip', 'install', '-e', '.'], 120000);
    }

    // Run tests
    const result = await execInContainer(
      container,
      ['sh', '-c', command],
      timeout
    );

    return {
      ...result,
      containerId: container.id,
    };

  } finally {
    if (container) {
      await removeContainer(container);
    }
  }
}
