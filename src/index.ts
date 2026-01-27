import express from 'express';
import dotenv from 'dotenv';
import { handleWebhook } from './webhook/handler.js';
import { createLogger } from './utils/logger.js';
import { initDatabase, getRecentFailures } from './db/client.js';

dotenv.config();

// Initialize database
initDatabase();

const logger = createLogger('Server');
const app = express();
const port = process.env.PORT || 3000;

// Parse JSON bodies (GitHub sends JSON payloads)
app.use(express.json());

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// View recent failures (for debugging/monitoring)
app.get('/failures', (_req, res) => {
  const failures = getRecentFailures(20);
  res.json({ count: failures.length, failures });
});

// GitHub webhook endpoint
app.post('/webhook', handleWebhook);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(port, () => {
  logger.info(`Nightwatch server started`, { port });
  logger.info(`Webhook endpoint: POST /webhook`);
  logger.info(`Health check: GET /health`);

  if (!process.env.GITHUB_TOKEN && !process.env.GITHUB_APP_ID) {
    logger.warn('No GitHub authentication configured - set GITHUB_TOKEN or GITHUB_APP_ID');
  }

  if (!process.env.GEMINI_API_KEY) {
    logger.warn('No GEMINI_API_KEY configured - log analysis will fail');
  }
});
