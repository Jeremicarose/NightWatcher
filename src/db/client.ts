import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../utils/logger.js';
import type { FailureAnalysis, GeneratedTest, ProposedFix, HealingResult } from '../types.js';

const logger = createLogger('Database');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db: Database.Database | null = null;

/**
 * Initialize the database connection and create tables if needed.
 */
export function initDatabase(dbPath?: string): Database.Database {
  if (db) return db;

  const finalPath = dbPath || path.join(process.cwd(), 'nightwatch.db');
  logger.info('Initializing database', { path: finalPath });

  db = new Database(finalPath);
  db.pragma('journal_mode = WAL');

  // Run schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  logger.info('Database initialized');
  return db;
}

/**
 * Get the database instance (must call initDatabase first).
 */
export function getDatabase(): Database.Database {
  if (!db) {
    return initDatabase();
  }
  return db;
}

/**
 * Close the database connection.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('Database closed');
  }
}

// ============ Failure Records ============

export interface FailureRecord {
  id: number;
  run_id: number;
  repo: string;
  sha: string;
  branch?: string;
  workflow_name?: string;
  created_at: string;
  error_type?: string;
  file_path?: string;
  line_number?: number;
  function_name?: string;
  error_message?: string;
  failing_test?: string;
  confidence?: number;
  raw_log_snippet?: string;
  status: string;
  pr_url?: string;
  issue_url?: string;
  error?: string;
  completed_at?: string;
}

/**
 * Create a new failure record when CI failure is detected.
 */
export function createFailure(
  runId: number,
  repo: string,
  sha: string,
  branch?: string,
  workflowName?: string
): number {
  const db = getDatabase();

  const stmt = db.prepare(`
    INSERT INTO failures (run_id, repo, sha, branch, workflow_name, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
    ON CONFLICT(run_id, repo) DO UPDATE SET
      sha = excluded.sha,
      branch = excluded.branch,
      workflow_name = excluded.workflow_name,
      status = 'pending',
      created_at = CURRENT_TIMESTAMP
  `);

  const result = stmt.run(runId, repo, sha, branch, workflowName);
  const id = result.lastInsertRowid as number;

  logger.debug('Created failure record', { id, runId, repo });
  return id;
}

/**
 * Update a failure record with analysis results.
 */
export function updateFailureAnalysis(
  failureId: number,
  analysis: FailureAnalysis
): void {
  const db = getDatabase();

  const stmt = db.prepare(`
    UPDATE failures SET
      error_type = ?,
      file_path = ?,
      line_number = ?,
      function_name = ?,
      error_message = ?,
      failing_test = ?,
      confidence = ?,
      raw_log_snippet = ?,
      status = 'analyzing'
    WHERE id = ?
  `);

  stmt.run(
    analysis.error_type,
    analysis.file_path,
    analysis.line_number,
    analysis.function_name,
    analysis.error_message,
    analysis.failing_test,
    analysis.confidence,
    analysis.raw_log_snippet,
    failureId
  );

  logger.debug('Updated failure analysis', { failureId, errorType: analysis.error_type });
}

/**
 * Update failure status.
 */
export function updateFailureStatus(
  failureId: number,
  status: string,
  error?: string
): void {
  const db = getDatabase();

  const stmt = db.prepare(`
    UPDATE failures SET
      status = ?,
      error = ?,
      completed_at = CASE WHEN ? IN ('fixed', 'escalated', 'failed') THEN CURRENT_TIMESTAMP ELSE completed_at END
    WHERE id = ?
  `);

  stmt.run(status, error, status, failureId);
  logger.debug('Updated failure status', { failureId, status });
}

/**
 * Update failure with PR or issue URL.
 */
export function updateFailureOutcome(
  failureId: number,
  prUrl?: string,
  issueUrl?: string
): void {
  const db = getDatabase();

  const stmt = db.prepare(`
    UPDATE failures SET
      pr_url = COALESCE(?, pr_url),
      issue_url = COALESCE(?, issue_url),
      status = CASE
        WHEN ? IS NOT NULL THEN 'fixed'
        WHEN ? IS NOT NULL THEN 'escalated'
        ELSE status
      END,
      completed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  stmt.run(prUrl, issueUrl, prUrl, issueUrl, failureId);
  logger.debug('Updated failure outcome', { failureId, prUrl, issueUrl });
}

/**
 * Get a failure record by ID.
 */
export function getFailure(failureId: number): FailureRecord | undefined {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM failures WHERE id = ?');
  return stmt.get(failureId) as FailureRecord | undefined;
}

/**
 * Get a failure record by run ID and repo.
 */
export function getFailureByRun(runId: number, repo: string): FailureRecord | undefined {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM failures WHERE run_id = ? AND repo = ?');
  return stmt.get(runId, repo) as FailureRecord | undefined;
}

/**
 * Get recent failures.
 */
export function getRecentFailures(limit: number = 20): FailureRecord[] {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM failures ORDER BY created_at DESC LIMIT ?');
  return stmt.all(limit) as FailureRecord[];
}

// ============ Fix Attempts ============

export interface FixAttemptRecord {
  id: number;
  failure_id: number;
  attempt_number: number;
  file_path?: string;
  original_code?: string;
  fixed_code?: string;
  explanation?: string;
  test_result?: string;
  error_output?: string;
  created_at: string;
}

/**
 * Record a fix attempt.
 */
export function createFixAttempt(
  failureId: number,
  attemptNumber: number,
  fix: ProposedFix,
  testResult: 'pass' | 'fail',
  errorOutput?: string
): number {
  const db = getDatabase();

  const stmt = db.prepare(`
    INSERT INTO fix_attempts (failure_id, attempt_number, file_path, original_code, fixed_code, explanation, test_result, error_output)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    failureId,
    attemptNumber,
    fix.file_path,
    fix.original_code,
    fix.fixed_code,
    fix.explanation,
    testResult,
    errorOutput
  );

  logger.debug('Created fix attempt', { failureId, attemptNumber, testResult });
  return result.lastInsertRowid as number;
}

/**
 * Get all fix attempts for a failure.
 */
export function getFixAttempts(failureId: number): FixAttemptRecord[] {
  const db = getDatabase();
  const stmt = db.prepare('SELECT * FROM fix_attempts WHERE failure_id = ? ORDER BY attempt_number');
  return stmt.all(failureId) as FixAttemptRecord[];
}

// ============ Generated Tests ============

/**
 * Record a generated test.
 */
export function createGeneratedTest(
  failureId: number,
  test: GeneratedTest
): number {
  const db = getDatabase();

  const stmt = db.prepare(`
    INSERT INTO generated_tests (failure_id, test_name, test_code, target_file, imports_needed)
    VALUES (?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    failureId,
    test.test_name,
    test.test_code,
    test.target_file,
    JSON.stringify(test.imports_needed)
  );

  logger.debug('Created generated test', { failureId, testName: test.test_name });
  return result.lastInsertRowid as number;
}

// ============ Utility ============

/**
 * Save a complete healing result to the database.
 */
export function saveHealingResult(result: HealingResult): number {
  // Create or get failure record
  let failure = getFailureByRun(result.run_id, result.repo);
  let failureId: number;

  if (!failure) {
    failureId = createFailure(result.run_id, result.repo, result.sha);
  } else {
    failureId = failure.id;
  }

  // Save analysis
  if (result.analysis && result.analysis.error_type) {
    updateFailureAnalysis(failureId, result.analysis);
  }

  // Save fix attempts
  for (const attempt of result.fix_attempts) {
    createFixAttempt(
      failureId,
      attempt.attempt_number,
      attempt.proposed_fix,
      attempt.test_result,
      attempt.error_output
    );
  }

  // Save generated test
  if (result.generated_test) {
    createGeneratedTest(failureId, result.generated_test);
  }

  // Update outcome
  if (result.pr_url || result.issue_url) {
    updateFailureOutcome(failureId, result.pr_url, result.issue_url);
  } else if (result.error) {
    updateFailureStatus(failureId, 'failed', result.error);
  }

  return failureId;
}
