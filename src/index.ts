import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { handleWebhook } from './webhook/handler.js';
import { createLogger } from './utils/logger.js';
import {
  initDatabase,
  getRecentFailures,
  getFailure,
  getFixAttempts,
  getDatabase
} from './db/client.js';

dotenv.config();

// Initialize database
initDatabase();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createLogger('Server');
const app = express();
const port = process.env.PORT || 3000;

// Parse JSON bodies (GitHub sends JSON payloads)
app.use(express.json());

// Serve static files (dashboard)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============ API Endpoints ============

// Get recent failures
app.get('/api/failures', (_req, res) => {
  const failures = getRecentFailures(50);
  res.json({ count: failures.length, failures });
});

// Get single failure with details
app.get('/api/failures/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: 'Invalid failure ID' });
    return;
  }

  const failure = getFailure(id);
  if (!failure) {
    res.status(404).json({ error: 'Failure not found' });
    return;
  }

  const fix_attempts = getFixAttempts(id);

  // Get generated test if exists
  const db = getDatabase();
  const generated_test = db.prepare(
    'SELECT * FROM generated_tests WHERE failure_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(id);

  res.json({ failure, fix_attempts, generated_test });
});

// Get statistics
app.get('/api/stats', (_req, res) => {
  const db = getDatabase();

  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'fixed' THEN 1 ELSE 0 END) as fixed,
      SUM(CASE WHEN status IN ('pending', 'analyzing', 'reproducing', 'generating_test', 'fixing', 'creating_pr', 'fetching_logs') THEN 1 ELSE 0 END) as in_progress,
      SUM(CASE WHEN status = 'escalated' THEN 1 ELSE 0 END) as escalated,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM failures
  `).get() as { total: number; fixed: number; in_progress: number; escalated: number; failed: number };

  res.json(stats);
});

// Legacy endpoint (keep for compatibility)
app.get('/failures', (_req, res) => {
  const failures = getRecentFailures(20);
  res.json({ count: failures.length, failures });
});

// GitHub webhook endpoint
app.post('/webhook', handleWebhook);

// Serve dashboard for all other routes (SPA fallback)
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(port, () => {
  logger.info(`Nightwatch server started`, { port });
  logger.info(`Dashboard: http://localhost:${port}`);
  logger.info(`Webhook endpoint: POST /webhook`);
  logger.info(`Health check: GET /health`);

  if (!process.env.GITHUB_TOKEN && !process.env.GITHUB_APP_ID) {
    logger.warn('No GitHub authentication configured - set GITHUB_TOKEN or GITHUB_APP_ID');
  }

  if (!process.env.GEMINI_API_KEY) {
    logger.warn('No GEMINI_API_KEY configured - log analysis will fail');
  }
});
