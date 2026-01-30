import { createLogger } from '../utils/logger.js';
import { fetchWorkflowLogs, findFailingJobLog, truncateLog } from '../github/logs.js';
import { analyzeFailureLogs } from '../agents/analyzer.js';
import { reproduceFailure, runTestsInWorkDir, cleanupWorkDir } from '../sandbox/runner.js';
import {
  generateRegressionTest,
  readSourceFile,
  readExistingTests,
  insertTestIntoFile
} from '../agents/test-generator.js';
import { generateFix, applyFix, revertFix, readSourceCode } from '../agents/fixer.js';
import {
  createFailure,
  updateFailureAnalysis,
  updateFailureStatus,
  saveHealingResult
} from '../db/client.js';
import type { WorkflowRunPayload, HealingResult, FailureAnalysis, FixAttempt } from '../types.js';

const MAX_FIX_ATTEMPTS = 3;

const logger = createLogger('Orchestrator');

/**
 * Main entry point for processing a CI failure.
 * This orchestrates the full healing pipeline:
 * 1. Fetch logs
 * 2. Analyze failure
 * 3. Reproduce in sandbox (TODO)
 * 4. Generate test (TODO)
 * 5. Attempt fix (TODO)
 * 6. Create PR or escalate (TODO)
 */
export async function processFailure(payload: WorkflowRunPayload): Promise<HealingResult> {
  const { repository, workflow_run } = payload;
  const runId = workflow_run.id;
  const sha = workflow_run.head_sha;
  const repo = repository.full_name;

  logger.info('Starting failure processing', { repo, runId, sha });

  const result: HealingResult = {
    success: false,
    run_id: runId,
    repo,
    sha,
    analysis: {} as FailureAnalysis,
    fix_attempts: [],
  };

  // Create database record for this failure
  const failureId = createFailure(
    runId,
    repo,
    sha,
    workflow_run.head_branch,
    workflow_run.name
  );
  logger.debug('Created failure record', { failureId });

  try {
    updateFailureStatus(failureId, 'fetching_logs');

    // Step 1: Fetch CI logs
    logger.info('Step 1: Fetching CI logs...');
    const logs = await fetchWorkflowLogs(
      repo,
      runId,
      payload.installation?.id
    );

    if (logs.length === 0) {
      result.error = 'No logs available for this workflow run';
      logger.warn('No logs found, cannot proceed');
      return result;
    }

    // Find the most relevant (failing) job log
    const failingLog = findFailingJobLog(logs);
    if (!failingLog) {
      result.error = 'Could not identify failing job in logs';
      logger.warn('No failing job identified');
      return result;
    }

    // Truncate if needed for context limits
    const truncatedLog = truncateLog(failingLog);

    // Step 2: Analyze the failure
    logger.info('Step 2: Analyzing failure with Gemini...');
    updateFailureStatus(failureId, 'analyzing');
    const analysis = await analyzeFailureLogs(truncatedLog);
    result.analysis = analysis;

    // Save analysis to database
    updateFailureAnalysis(failureId, analysis);

    logger.info('Analysis complete', {
      error_type: analysis.error_type,
      file_path: analysis.file_path,
      line_number: analysis.line_number,
      confidence: analysis.confidence,
    });

    // Low confidence = escalate immediately
    if (analysis.confidence < 0.3) {
      result.error = 'Low confidence analysis - escalating to human';
      logger.warn('Analysis confidence too low, will escalate', { confidence: analysis.confidence });
      // TODO: Create escalation issue
      return result;
    }

    // Step 3: Clone repo and reproduce failure
    logger.info('Step 3: Reproducing failure in sandbox...');
    updateFailureStatus(failureId, 'reproducing');

    const reproResult = await reproduceFailure({
      repo,
      sha,
      cloneUrl: repository.clone_url,
    });

    if (!reproResult.success) {
      result.error = `Reproduction failed: ${reproResult.error}`;
      logger.error('Failed to reproduce failure', { error: reproResult.error });
      updateFailureStatus(failureId, 'failed', result.error);
      return result;
    }

    if (!reproResult.reproduced) {
      result.error = 'Failure did not reproduce - tests passed in sandbox';
      logger.warn('Failure did not reproduce', { exitCode: reproResult.exitCode });
      updateFailureStatus(failureId, 'not_reproduced');
      // Cleanup work directory since we can't proceed
      if (reproResult.workDir) {
        cleanupWorkDir(reproResult.workDir);
      }
      return result;
    }

    logger.info('Failure reproduced successfully', {
      exitCode: reproResult.exitCode,
      workDir: reproResult.workDir,
    });

    // Store workDir for later steps
    const workDir = reproResult.workDir!;

    // Step 4: Generate regression test
    logger.info('Step 4: Generating regression test...');
    updateFailureStatus(failureId, 'generating_test');

    const sourceCode = readSourceFile(workDir, analysis.file_path);
    const testFilePath = `tests/test_${analysis.file_path.split('/').pop()?.replace('.py', '')}.py`;
    const existingTests = readExistingTests(workDir, testFilePath);

    const generatedTest = await generateRegressionTest({
      analysis,
      sourceCode,
      existingTests,
      filePath: analysis.file_path,
    });

    result.generated_test = generatedTest;
    logger.info('Test generated', { testName: generatedTest.test_name });

    // Insert test into file (optional - we can verify it works first)
    // insertTestIntoFile(workDir, generatedTest.target_file, generatedTest);

    // Step 5: Attempt fix (up to MAX_FIX_ATTEMPTS)
    logger.info('Step 5: Attempting fixes...');
    updateFailureStatus(failureId, 'fixing');

    const fixAttempts: FixAttempt[] = [];
    let fixSucceeded = false;

    for (let attempt = 1; attempt <= MAX_FIX_ATTEMPTS; attempt++) {
      logger.info(`Fix attempt ${attempt}/${MAX_FIX_ATTEMPTS}`);

      try {
        // Generate a fix
        const fix = await generateFix({
          analysis,
          sourceCode: readSourceCode(workDir, analysis.file_path),
          filePath: analysis.file_path,
          previousAttempts: fixAttempts,
          testOutput: reproResult.stderr,
        });

        // Apply the fix
        const applied = applyFix(workDir, fix);

        if (!applied) {
          logger.warn('Failed to apply fix', { attempt });
          fixAttempts.push({
            attempt_number: attempt,
            proposed_fix: fix,
            test_result: 'fail',
            error_output: 'Failed to apply fix - original code not found',
          });
          continue;
        }

        // Run tests to verify the fix
        logger.info('Running tests to verify fix...');
        const testResult = await runTestsInWorkDir(workDir);

        const fixAttempt: FixAttempt = {
          attempt_number: attempt,
          proposed_fix: fix,
          test_result: testResult.exitCode === 0 ? 'pass' : 'fail',
          error_output: testResult.exitCode !== 0 ? testResult.stderr : undefined,
        };
        fixAttempts.push(fixAttempt);

        if (testResult.exitCode === 0) {
          logger.info('Fix verified - all tests pass!', { attempt });
          fixSucceeded = true;
          break;
        } else {
          logger.warn('Fix did not resolve all failures', {
            attempt,
            exitCode: testResult.exitCode,
          });
          // Revert the fix before trying again
          revertFix(workDir, fix);
        }
      } catch (error) {
        logger.error('Error during fix attempt', {
          attempt,
          error: error instanceof Error ? error.message : 'Unknown',
        });
        fixAttempts.push({
          attempt_number: attempt,
          proposed_fix: {
            file_path: analysis.file_path,
            original_code: '',
            fixed_code: '',
            explanation: `Error: ${error instanceof Error ? error.message : 'Unknown'}`,
          },
          test_result: 'fail',
          error_output: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    result.fix_attempts = fixAttempts;

    // Step 6: Create PR or escalate
    if (fixSucceeded) {
      logger.info('Step 6: Creating PR...');
      updateFailureStatus(failureId, 'creating_pr');
      // TODO: Create PR with fix + test
      // For now, just mark as successful
      result.success = true;
      updateFailureStatus(failureId, 'fixed');
      logger.info('Fix successful! PR creation not yet implemented.');
    } else {
      logger.info('Step 6: Escalating - fix attempts exhausted');
      updateFailureStatus(failureId, 'escalated');
      // TODO: Create escalation issue
      result.error = `Failed to fix after ${MAX_FIX_ATTEMPTS} attempts`;
      logger.warn('Escalating to human', { attempts: fixAttempts.length });
    }

    // Cleanup work directory
    cleanupWorkDir(workDir);

    logger.info('Processing complete', { success: result.success });

    // Save final result to database
    saveHealingResult(result);

    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    result.error = errorMessage;
    logger.error('Failed to process failure', { error: errorMessage, runId });

    // Record the failure in database
    updateFailureStatus(failureId, 'failed', errorMessage);

    return result;
  }
}
