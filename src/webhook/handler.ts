import type { Request, Response } from 'express';
import { validateGitHubWebhook, getWebhookEvent, getDeliveryId } from './validator.js';
import { createLogger } from '../utils/logger.js';
import type { WorkflowRunPayload } from '../types.js';
import { processFailure } from '../fix-loop/orchestrator.js';

const logger = createLogger('WebhookHandler');

export async function handleWebhook(req: Request, res: Response): Promise<void> {
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

  // Validate webhook signature (skip in dev if no secret)
  if (webhookSecret && !validateGitHubWebhook(req, webhookSecret)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  const event = getWebhookEvent(req);
  const deliveryId = getDeliveryId(req);

  logger.info(`Received webhook`, { event, deliveryId });

  if (event !== 'workflow_run') {
    res.status(200).json({ message: 'Event ignored', event });
    return;
  }

  const payload = req.body as WorkflowRunPayload;

  // Only process completed, failed workflow runs
  if (payload.action !== 'completed') {
    logger.debug('Ignoring non-completed workflow run', { action: payload.action });
    res.status(200).json({ message: 'Action ignored', action: payload.action });
    return;
  }

  if (payload.workflow_run.conclusion !== 'failure') {
    logger.debug('Ignoring non-failure workflow run', {
      conclusion: payload.workflow_run.conclusion
    });
    res.status(200).json({
      message: 'Conclusion ignored',
      conclusion: payload.workflow_run.conclusion
    });
    return;
  }

  logger.info('🚨 CI failure detected!', {
    repo: payload.repository.full_name,
    run_id: payload.workflow_run.id,
    sha: payload.workflow_run.head_sha,
    branch: payload.workflow_run.head_branch,
  });

  // Acknowledge webhook immediately
  res.status(202).json({
    message: 'Processing failure',
    run_id: payload.workflow_run.id,
  });

  // Process failure asynchronously
  try {
    await processFailure(payload);
  } catch (error) {
    logger.error('Failed to process failure', {
      error: error instanceof Error ? error.message : 'Unknown error',
      run_id: payload.workflow_run.id,
    });
  }
}
