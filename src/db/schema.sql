-- Nightwatch Database Schema
-- Stores CI failure analysis results and fix attempts

-- Track each CI failure event
CREATE TABLE IF NOT EXISTS failures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    repo TEXT NOT NULL,
    sha TEXT NOT NULL,
    branch TEXT,
    workflow_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- Analysis results
    error_type TEXT,
    file_path TEXT,
    line_number INTEGER,
    function_name TEXT,
    error_message TEXT,
    failing_test TEXT,
    confidence REAL,
    raw_log_snippet TEXT,

    -- Outcome
    status TEXT DEFAULT 'pending', -- pending, analyzing, fixing, fixed, escalated, failed
    pr_url TEXT,
    issue_url TEXT,
    error TEXT,
    completed_at DATETIME,

    UNIQUE(run_id, repo)
);

-- Track each fix attempt
CREATE TABLE IF NOT EXISTS fix_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    failure_id INTEGER NOT NULL,
    attempt_number INTEGER NOT NULL,

    -- Proposed fix
    file_path TEXT,
    original_code TEXT,
    fixed_code TEXT,
    explanation TEXT,

    -- Result
    test_result TEXT, -- pass, fail
    error_output TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (failure_id) REFERENCES failures(id)
);

-- Track generated tests
CREATE TABLE IF NOT EXISTS generated_tests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    failure_id INTEGER NOT NULL,

    test_name TEXT,
    test_code TEXT,
    target_file TEXT,
    imports_needed TEXT, -- JSON array

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (failure_id) REFERENCES failures(id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_failures_repo ON failures(repo);
CREATE INDEX IF NOT EXISTS idx_failures_status ON failures(status);
CREATE INDEX IF NOT EXISTS idx_failures_run_id ON failures(run_id);
CREATE INDEX IF NOT EXISTS idx_fix_attempts_failure ON fix_attempts(failure_id);
