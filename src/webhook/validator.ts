import crypto from 'crypto';
import type { Request } from 'express';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('WebhookValidator');

export function validateGitHubWebhook(req: Request, secret: string): boolean {
  const signature = req.headers['x-hub-signature-256'] as string;

  if (!signature) {
    logger.warn('No signature header present');
    return false;
  }

  const body = JSON.stringify(req.body);
  const hmac = crypto.createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(body).digest('hex');

  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(digest)
  );

  if (!isValid) {
    logger.warn('Invalid webhook signature');
  }

  return isValid;
}

export function getWebhookEvent(req: Request): string | undefined {
  return req.headers['x-github-event'] as string | undefined;
}

export function getDeliveryId(req: Request): string | undefined {
  return req.headers['x-github-delivery'] as string | undefined;
}
