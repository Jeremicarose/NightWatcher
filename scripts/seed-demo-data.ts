/**
 * Seed demo data for dashboard demonstration
 */

import { initDatabase, getDatabase } from '../src/db/client.js';

initDatabase();
const db = getDatabase();

// Clear existing data
db.exec('DELETE FROM fix_attempts');
db.exec('DELETE FROM generated_tests');
db.exec('DELETE FROM failures');

console.log('🌱 Seeding demo data...\n');

// Demo failures
const demoFailures = [
  {
    run_id: 1001,
    repo: 'acme/payment-service',
    sha: 'a1b2c3d4e5f6789',
    branch: 'main',
    workflow_name: 'CI',
    error_type: 'TypeError',
    file_path: 'src/payment/processor.py',
    line_number: 42,
    function_name: 'process_payment',
    error_message: "'NoneType' object has no attribute 'amount'",
    failing_test: 'test_process_payment_with_null_order',
    confidence: 0.92,
    status: 'fixed',
    pr_url: 'https://github.com/acme/payment-service/pull/123',
  },
  {
    run_id: 1002,
    repo: 'acme/user-auth',
    sha: 'b2c3d4e5f6a7890',
    branch: 'feature/oauth',
    workflow_name: 'Test Suite',
    error_type: 'KeyError',
    file_path: 'src/auth/oauth.py',
    line_number: 87,
    function_name: 'validate_token',
    error_message: "KeyError: 'expires_at'",
    failing_test: 'test_validate_expired_token',
    confidence: 0.85,
    status: 'fixed',
    pr_url: 'https://github.com/acme/user-auth/pull/456',
  },
  {
    run_id: 1003,
    repo: 'acme/api-gateway',
    sha: 'c3d4e5f6a7b8901',
    branch: 'main',
    workflow_name: 'Integration Tests',
    error_type: 'ConnectionError',
    file_path: 'src/gateway/router.py',
    line_number: 156,
    function_name: 'forward_request',
    error_message: 'Connection refused: upstream service unavailable',
    failing_test: 'test_forward_to_unavailable_service',
    confidence: 0.45,
    status: 'escalated',
    issue_url: 'https://github.com/acme/api-gateway/issues/789',
  },
  {
    run_id: 1004,
    repo: 'acme/notification-service',
    sha: 'd4e5f6a7b8c9012',
    branch: 'develop',
    workflow_name: 'CI/CD',
    error_type: 'ValueError',
    file_path: 'src/notifications/email.py',
    line_number: 23,
    function_name: 'send_email',
    error_message: "Invalid email format: 'user@'",
    failing_test: 'test_send_email_invalid_format',
    confidence: 0.88,
    status: 'fixing',
  },
  {
    run_id: 1005,
    repo: 'acme/data-pipeline',
    sha: 'e5f6a7b8c9d0123',
    branch: 'main',
    workflow_name: 'Pipeline Tests',
    error_type: 'IndexError',
    file_path: 'src/pipeline/transform.py',
    line_number: 78,
    function_name: 'transform_batch',
    error_message: 'list index out of range',
    failing_test: 'test_transform_empty_batch',
    confidence: 0.91,
    status: 'analyzing',
  },
];

// Insert failures
const insertFailure = db.prepare(`
  INSERT INTO failures (
    run_id, repo, sha, branch, workflow_name,
    error_type, file_path, line_number, function_name,
    error_message, failing_test, confidence, status, pr_url, issue_url,
    created_at, completed_at
  ) VALUES (
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    datetime('now', '-' || ? || ' minutes'),
    CASE WHEN ? IN ('fixed', 'escalated') THEN datetime('now', '-' || ? || ' minutes') ELSE NULL END
  )
`);

demoFailures.forEach((f, index) => {
  const minutesAgo = (index + 1) * 15; // Stagger times
  insertFailure.run(
    f.run_id, f.repo, f.sha, f.branch, f.workflow_name,
    f.error_type, f.file_path, f.line_number, f.function_name,
    f.error_message, f.failing_test, f.confidence, f.status, f.pr_url || null, f.issue_url || null,
    minutesAgo, f.status, minutesAgo - 5
  );
  console.log(`✅ Added: ${f.repo} (${f.status})`);
});

// Add fix attempts for the fixed failures
const insertFixAttempt = db.prepare(`
  INSERT INTO fix_attempts (failure_id, attempt_number, file_path, original_code, fixed_code, explanation, test_result, error_output)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

// Fix attempts for payment-service (success on attempt 1)
insertFixAttempt.run(
  1, 1,
  'src/payment/processor.py',
  'amount = order.amount',
  'if order is None:\n    raise ValueError("Order cannot be None")\namount = order.amount',
  'Added null check for order parameter before accessing amount attribute',
  'pass',
  null
);

// Fix attempts for user-auth (success on attempt 2)
insertFixAttempt.run(
  2, 1,
  'src/auth/oauth.py',
  'expires = token["expires_at"]',
  'expires = token["expires_at"]',
  'Attempted to add default expiration value',
  'fail',
  'KeyError still occurring - token structure different than expected'
);
insertFixAttempt.run(
  2, 2,
  'src/auth/oauth.py',
  'expires = token["expires_at"]',
  'expires = token.get("expires_at", datetime.now() + timedelta(hours=1))',
  'Used dict.get() with default value for missing expires_at key',
  'pass',
  null
);

// Fix attempts for api-gateway (all failed - escalated)
insertFixAttempt.run(
  3, 1,
  'src/gateway/router.py',
  'response = requests.post(upstream_url, json=data)',
  'try:\n    response = requests.post(upstream_url, json=data, timeout=5)\nexcept ConnectionError:\n    return fallback_response()',
  'Added connection error handling with fallback',
  'fail',
  'Test requires specific upstream behavior that cannot be mocked easily'
);
insertFixAttempt.run(
  3, 2,
  'src/gateway/router.py',
  'response = requests.post(upstream_url, json=data)',
  'response = circuit_breaker.call(requests.post, upstream_url, json=data)',
  'Implemented circuit breaker pattern',
  'fail',
  'Circuit breaker not configured in test environment'
);
insertFixAttempt.run(
  3, 3,
  'src/gateway/router.py',
  'response = requests.post(upstream_url, json=data)',
  'if not health_check(upstream_url):\n    raise ServiceUnavailableError()\nresponse = requests.post(upstream_url, json=data)',
  'Added health check before forwarding',
  'fail',
  'Infrastructure issue - not a code problem'
);

console.log('\n✅ Added fix attempts');

// Add generated tests
const insertTest = db.prepare(`
  INSERT INTO generated_tests (failure_id, test_name, test_code, target_file, imports_needed)
  VALUES (?, ?, ?, ?, ?)
`);

insertTest.run(
  1,
  'test_process_payment_handles_none_order',
  `def test_process_payment_handles_none_order():
    """Verify process_payment raises ValueError when order is None."""
    with pytest.raises(ValueError, match="Order cannot be None"):
        process_payment(None)`,
  'tests/test_processor.py',
  JSON.stringify(['process_payment', 'pytest'])
);

insertTest.run(
  2,
  'test_validate_token_missing_expires_at',
  `def test_validate_token_missing_expires_at():
    """Verify validate_token handles tokens without expires_at field."""
    token = {"access_token": "abc123", "token_type": "bearer"}
    result = validate_token(token)
    assert result.expires_at is not None`,
  'tests/test_oauth.py',
  JSON.stringify(['validate_token', 'pytest'])
);

console.log('✅ Added generated tests');

console.log('\n🎉 Demo data seeded successfully!');
console.log('   Open http://localhost:3000 to see the dashboard');
