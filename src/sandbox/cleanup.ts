import fs from 'fs';
import path from 'path';
import os from 'os';
import { createLogger } from '../utils/logger.js';
import { getDocker } from './docker.js';

const logger = createLogger('Cleanup');

const NIGHTWATCH_PREFIX = 'nightwatch';
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Clean up old Nightwatch containers.
 */
export async function cleanupOldContainers(): Promise<number> {
  let cleaned = 0;

  try {
    const docker = getDocker();
    const containers = await docker.listContainers({ all: true });

    const cutoffTime = Date.now() - MAX_AGE_MS;

    for (const containerInfo of containers) {
      // Check if this is a Nightwatch container (by checking mounted volumes)
      const mounts = containerInfo.Mounts || [];
      const isNightwatch = mounts.some(m =>
        m.Source?.includes(NIGHTWATCH_PREFIX) || m.Source?.includes('run-')
      );

      if (!isNightwatch) continue;

      // Check age
      const created = containerInfo.Created * 1000;
      if (created > cutoffTime) continue;

      // Remove container
      try {
        const container = docker.getContainer(containerInfo.Id);
        await container.stop({ t: 5 }).catch(() => {});
        await container.remove({ force: true });
        cleaned++;
        logger.debug('Removed old container', { id: containerInfo.Id.substring(0, 12) });
      } catch (error) {
        logger.warn('Failed to remove container', {
          id: containerInfo.Id.substring(0, 12),
          error: error instanceof Error ? error.message : 'Unknown'
        });
      }
    }
  } catch (error) {
    logger.error('Failed to cleanup containers', {
      error: error instanceof Error ? error.message : 'Unknown'
    });
  }

  if (cleaned > 0) {
    logger.info('Cleaned up old containers', { count: cleaned });
  }

  return cleaned;
}

/**
 * Clean up old work directories.
 */
export function cleanupOldWorkDirs(): number {
  let cleaned = 0;
  const baseDir = path.join(os.tmpdir(), NIGHTWATCH_PREFIX);

  if (!fs.existsSync(baseDir)) {
    return 0;
  }

  try {
    const cutoffTime = Date.now() - MAX_AGE_MS;
    const entries = fs.readdirSync(baseDir);

    for (const entry of entries) {
      const entryPath = path.join(baseDir, entry);
      const stat = fs.statSync(entryPath);

      if (!stat.isDirectory()) continue;

      // Check age
      if (stat.mtimeMs > cutoffTime) continue;

      // Remove directory
      try {
        fs.rmSync(entryPath, { recursive: true, force: true });
        cleaned++;
        logger.debug('Removed old work directory', { path: entry });
      } catch (error) {
        logger.warn('Failed to remove work directory', {
          path: entry,
          error: error instanceof Error ? error.message : 'Unknown'
        });
      }
    }
  } catch (error) {
    logger.error('Failed to cleanup work directories', {
      error: error instanceof Error ? error.message : 'Unknown'
    });
  }

  if (cleaned > 0) {
    logger.info('Cleaned up old work directories', { count: cleaned });
  }

  return cleaned;
}

/**
 * Run all cleanup tasks.
 */
export async function runCleanup(): Promise<{ containers: number; workDirs: number }> {
  logger.info('Running cleanup tasks');

  const containers = await cleanupOldContainers();
  const workDirs = cleanupOldWorkDirs();

  return { containers, workDirs };
}

/**
 * Clean up a specific work directory and any associated container.
 */
export async function cleanupRun(workDir: string, containerId?: string): Promise<void> {
  // Remove container if provided
  if (containerId) {
    try {
      const docker = getDocker();
      const container = docker.getContainer(containerId);
      await container.stop({ t: 5 }).catch(() => {});
      await container.remove({ force: true });
      logger.debug('Removed container', { id: containerId.substring(0, 12) });
    } catch (error) {
      logger.warn('Failed to remove container during cleanup', {
        id: containerId.substring(0, 12),
        error: error instanceof Error ? error.message : 'Unknown'
      });
    }
  }

  // Remove work directory
  if (workDir && fs.existsSync(workDir)) {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
      logger.debug('Removed work directory', { workDir });
    } catch (error) {
      logger.warn('Failed to remove work directory during cleanup', {
        workDir,
        error: error instanceof Error ? error.message : 'Unknown'
      });
    }
  }
}

