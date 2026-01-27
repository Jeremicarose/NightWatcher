import { getOctokit, parseRepoFullName } from './client.js';
import { createLogger } from '../utils/logger.js';
import AdmZip from 'adm-zip';

const logger = createLogger('LogFetcher');

export interface FetchedLogs {
  jobName: string;
  content: string;
}

/**
 * Fetches workflow run logs from GitHub Actions.
 * GitHub returns logs as a zip file containing one file per job.
 */
export async function fetchWorkflowLogs(
  repoFullName: string,
  runId: number,
  installationId?: number
): Promise<FetchedLogs[]> {
  const octokit = getOctokit(installationId);
  const { owner, repo } = parseRepoFullName(repoFullName);

  logger.info('Fetching workflow logs', { owner, repo, runId });

  try {
    // Get the logs download URL
    const { url } = await octokit.rest.actions.downloadWorkflowRunLogs({
      owner,
      repo,
      run_id: runId,
    });

    logger.debug('Got logs URL, downloading...', { url: url.substring(0, 50) + '...' });

    // Download the zip file
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download logs: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Extract logs from zip
    const logs = extractLogsFromZip(buffer);

    logger.info('Successfully fetched logs', {
      jobCount: logs.length,
      totalSize: logs.reduce((acc, l) => acc + l.content.length, 0)
    });

    return logs;
  } catch (error) {
    // Handle case where logs aren't available yet or have expired
    if (error instanceof Error && error.message.includes('410')) {
      logger.warn('Logs have expired or are unavailable');
      return [];
    }
    throw error;
  }
}

/**
 * Extracts log files from the GitHub Actions logs zip archive.
 */
function extractLogsFromZip(buffer: Buffer): FetchedLogs[] {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const logs: FetchedLogs[] = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    // Job logs are named like "job-name/1_step-name.txt"
    // We want the full job log, not individual steps
    const content = entry.getData().toString('utf-8');
    const jobName = entry.entryName.split('/')[0] || entry.entryName;

    // Aggregate all steps for a job into one log
    const existingJob = logs.find(l => l.jobName === jobName);
    if (existingJob) {
      existingJob.content += '\n' + content;
    } else {
      logs.push({ jobName, content });
    }
  }

  return logs;
}

/**
 * Finds the most relevant log content for analysis.
 * Prioritizes jobs that contain error keywords.
 */
export function findFailingJobLog(logs: FetchedLogs[]): string | null {
  if (logs.length === 0) return null;

  // Error indicators to look for
  const errorPatterns = [
    /error:/i,
    /failed/i,
    /exception/i,
    /traceback/i,
    /FAILED/,
    /AssertionError/,
    /TypeError/,
    /ImportError/,
    /ModuleNotFoundError/,
  ];

  // Score each log by error density
  const scored = logs.map(log => {
    let score = 0;
    for (const pattern of errorPatterns) {
      const matches = log.content.match(new RegExp(pattern, 'g'));
      if (matches) score += matches.length;
    }
    return { log, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Return the log with most errors, or first if none found
  const best = scored[0];

  if (best.score > 0) {
    logger.debug('Found failing job', { jobName: best.log.jobName, errorScore: best.score });
    return best.log.content;
  }

  // Fallback to all logs concatenated
  logger.debug('No clear failing job, using all logs');
  return logs.map(l => `=== ${l.jobName} ===\n${l.content}`).join('\n\n');
}

/**
 * Truncates log content to fit within context limits.
 * Keeps the most relevant portions (errors, stack traces).
 */
export function truncateLog(content: string, maxLength: number = 50000): string {
  if (content.length <= maxLength) return content;

  logger.debug('Truncating log', { original: content.length, target: maxLength });

  // Split into lines
  const lines = content.split('\n');

  // Find lines with errors/tracebacks - these are most important
  const importantIndices: number[] = [];
  const importantPatterns = [
    /error/i, /exception/i, /traceback/i, /failed/i,
    /assert/i, /file ".*", line \d+/i
  ];

  lines.forEach((line, idx) => {
    if (importantPatterns.some(p => p.test(line))) {
      // Include context around important lines
      for (let i = Math.max(0, idx - 5); i <= Math.min(lines.length - 1, idx + 10); i++) {
        if (!importantIndices.includes(i)) importantIndices.push(i);
      }
    }
  });

  importantIndices.sort((a, b) => a - b);

  // Build truncated output
  const importantContent = importantIndices.map(i => lines[i]).join('\n');

  if (importantContent.length <= maxLength) {
    return `[Log truncated - showing error-relevant sections]\n\n${importantContent}`;
  }

  // If still too long, just take the last portion (where errors usually are)
  const tail = content.slice(-maxLength);
  return `[Log truncated - showing last ${maxLength} chars]\n\n${tail}`;
}
