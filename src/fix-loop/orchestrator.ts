import { createLogger } from '../utils/logger.js';
import { fetchWorkflowLogs, findFailingJobLog, truncateLog } from '../github/logs.js';
import { analyzeFailureLogs } from '../agents/analyzer.js';
import type { WorkflowRunPayload, HealingResult, FailureAnalysis } from '../types.js';

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

  try {
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
    const analysis = await analyzeFailureLogs(truncatedLog);
    result.analysis = analysis;

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

    // Step 3: Clone repo and reproduce failure (TODO)
    logger.info('Step 3: Reproduction (not yet implemented)');
    // TODO: Clone repo at SHA
    // TODO: Set up Docker sandbox
    // TODO: Run tests, confirm failure reproduces

    // Step 4: Generate regression test (TODO)
    logger.info('Step 4: Test generation (not yet implemented)');
    // TODO: Generate test that captures the bug

    // Step 5: Attempt fix (TODO)
    logger.info('Step 5: Fix attempts (not yet implemented)');
    // TODO: Fix loop with max 3 attempts

    // Step 6: Create PR or escalate (TODO)
    logger.info('Step 6: PR creation (not yet implemented)');
    // TODO: Create PR with fix + test
    // TODO: Or create escalation issue if fix failed

    // For now, we've completed the analysis phase
    logger.info('Processing complete (analysis phase only)', { result });

    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    result.error = errorMessage;
    logger.error('Failed to process failure', { error: errorMessage, runId });
    return result;
  }
}
