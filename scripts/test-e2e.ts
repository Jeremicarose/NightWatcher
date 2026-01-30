/**
 * End-to-End Test for Nightwatch
 *
 * This script tests the full pipeline:
 * 1. Analyze a failure log
 * 2. Reproduce the failure in Docker
 * 3. Generate a regression test
 * 4. Attempt to fix the bug
 * 5. Verify the fix works
 *
 * Uses the demo-repo with an intentional bug.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment
dotenv.config();

// Import modules
import { analyzeFailureLogs } from '../src/agents/analyzer.js';
import { reproduceFailure, runTestsInWorkDir, cleanupWorkDir } from '../src/sandbox/runner.js';
import { generateRegressionTest, readSourceFile, readExistingTests } from '../src/agents/test-generator.js';
import { generateFix, applyFix, revertFix, readSourceCode } from '../src/agents/fixer.js';
import { checkDockerAvailable } from '../src/sandbox/docker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Sample CI failure log (simulates what GitHub Actions would produce)
const SAMPLE_FAILURE_LOG = `
============================= test session starts ==============================
platform linux -- Python 3.11.4, pytest-7.4.0, pluggy-1.2.0
rootdir: /app
collected 5 items

tests/test_user_service.py::test_get_user_exists PASSED                  [ 20%]
tests/test_user_service.py::test_get_user_not_exists PASSED              [ 40%]
tests/test_user_service.py::test_send_notification_valid_user PASSED     [ 60%]
tests/test_user_service.py::test_send_notification_none_user FAILED      [ 80%]
tests/test_user_service.py::test_notify_user_not_exists FAILED           [100%]

=================================== FAILURES ===================================
_______________________ test_send_notification_none_user _______________________

    def test_send_notification_none_user():
        """This test exposes the bug - send_notification doesn't handle None."""
>       result = send_notification(None, "Hello!")

tests/test_user_service.py:31:
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _

user = None, message = 'Hello!'

    def send_notification(user: dict, message: str) -> bool:
        """
        Send a notification to a user.

        BUG: No null check - will raise TypeError if user is None
        """
>       email = user["email"]  # BUG: This fails if user is None
E       TypeError: 'NoneType' object is not subscriptable

src/user_service.py:19: TypeError
_________________________ test_notify_user_not_exists __________________________

    def test_notify_user_not_exists():
        """This test exposes the bug - notify_user fails for non-existent users."""
>       result = notify_user(999, "Hello?")

tests/test_user_service.py:37:
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _
src/user_service.py:27: in notify_user
    return send_notification(user, message)
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _

user = None, message = 'Hello?'

    def send_notification(user: dict, message: str) -> bool:
>       email = user["email"]
E       TypeError: 'NoneType' object is not subscriptable

src/user_service.py:19: TypeError
=========================== short test summary info ============================
FAILED tests/test_user_service.py::test_send_notification_none_user - TypeError
FAILED tests/test_user_service.py::test_notify_user_not_exists - TypeError
========================= 2 failed, 3 passed in 0.07s =========================
`;

async function runE2ETest() {
  console.log('🧪 Nightwatch End-to-End Test\n');
  console.log('='.repeat(60));

  const results = {
    analyze: false,
    reproduce: false,
    testGen: false,
    fix: false,
    verify: false,
  };

  // Check prerequisites
  console.log('\n📋 Checking prerequisites...');

  if (!process.env.GEMINI_API_KEY) {
    console.log('❌ GEMINI_API_KEY not set');
    process.exit(1);
  }
  console.log('✅ Gemini API key configured');

  const dockerAvailable = await checkDockerAvailable();
  if (!dockerAvailable) {
    console.log('❌ Docker not available - start Docker Desktop');
    process.exit(1);
  }
  console.log('✅ Docker is running');

  // Step 1: Analyze the failure
  console.log('\n' + '='.repeat(60));
  console.log('📊 STEP 1: Analyzing failure log with Gemini...');
  console.log('='.repeat(60));

  let analysis;
  try {
    analysis = await analyzeFailureLogs(SAMPLE_FAILURE_LOG);
    console.log(`   Error Type:    ${analysis.error_type}`);
    console.log(`   File:          ${analysis.file_path}`);
    console.log(`   Line:          ${analysis.line_number}`);
    console.log(`   Function:      ${analysis.function_name || 'N/A'}`);
    console.log(`   Failing Test:  ${analysis.failing_test || 'N/A'}`);
    console.log(`   Confidence:    ${(analysis.confidence * 100).toFixed(0)}%`);
    console.log('✅ Analysis complete');
    results.analyze = true;
  } catch (error) {
    console.log(`❌ Analysis failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    return results;
  }

  // Step 2: Reproduce the failure
  console.log('\n' + '='.repeat(60));
  console.log('🐳 STEP 2: Reproducing failure in Docker sandbox...');
  console.log('='.repeat(60));

  let reproResult;
  let workDir: string;
  try {
    // Copy local demo-repo to temp directory for testing
    const demoRepoPath = path.join(__dirname, '..', 'demo-repo');

    if (!fs.existsSync(demoRepoPath)) {
      console.log('❌ demo-repo not found at', demoRepoPath);
      return results;
    }

    // Create temp work directory
    const tempDir = path.join('/tmp', 'nightwatch-e2e-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    workDir = path.join(tempDir, 'repo');

    // Copy demo-repo to work directory
    fs.cpSync(demoRepoPath, workDir, { recursive: true });
    console.log(`   Copied demo-repo to: ${workDir}`);

    // Run tests in Docker to reproduce failure
    reproResult = await runTestsInWorkDir(workDir, 'pip install pytest && pytest tests/ -v');

    console.log(`   Exit Code:  ${reproResult.exitCode}`);
    console.log(`   Timed Out:  ${reproResult.timedOut}`);

    // Exit code != 0 means tests failed = failure reproduced
    if (reproResult.exitCode !== 0) {
      console.log('✅ Failure reproduced successfully (tests failed as expected)');
      results.reproduce = true;
    } else {
      console.log('❌ Tests passed - no failure to reproduce');
      cleanupWorkDir(workDir);
      return results;
    }
  } catch (error) {
    console.log(`❌ Reproduction failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    return results;
  }

  // Step 3: Generate regression test
  console.log('\n' + '='.repeat(60));
  console.log('🧪 STEP 3: Generating regression test...');
  console.log('='.repeat(60));

  let generatedTest;
  try {
    const sourceCode = readSourceFile(workDir, analysis.file_path);
    const existingTests = readExistingTests(workDir, 'tests/test_user_service.py');

    generatedTest = await generateRegressionTest({
      analysis,
      sourceCode,
      existingTests,
      filePath: analysis.file_path,
    });

    console.log(`   Test Name:   ${generatedTest.test_name}`);
    console.log(`   Target File: ${generatedTest.target_file}`);
    console.log('   Test Code:');
    console.log('   ' + '-'.repeat(40));
    generatedTest.test_code.split('\n').forEach(line => {
      console.log('   ' + line);
    });
    console.log('   ' + '-'.repeat(40));
    console.log('✅ Test generated');
    results.testGen = true;
  } catch (error) {
    console.log(`❌ Test generation failed: ${error instanceof Error ? error.message : 'Unknown'}`);
  }

  // Step 4: Generate and apply fix
  console.log('\n' + '='.repeat(60));
  console.log('🔧 STEP 4: Generating fix...');
  console.log('='.repeat(60));

  let fix;
  try {
    const sourceCode = readSourceCode(workDir, analysis.file_path);

    fix = await generateFix({
      analysis,
      sourceCode,
      filePath: analysis.file_path,
      testOutput: reproResult.stderr,
    });

    console.log(`   File:        ${fix.file_path}`);
    console.log(`   Explanation: ${fix.explanation}`);
    console.log('   Original:');
    fix.original_code.split('\n').forEach(line => {
      console.log('   - ' + line);
    });
    console.log('   Fixed:');
    fix.fixed_code.split('\n').forEach(line => {
      console.log('   + ' + line);
    });

    // Apply the fix
    const applied = applyFix(workDir, fix);
    if (applied) {
      console.log('✅ Fix applied');
      results.fix = true;
    } else {
      console.log('❌ Failed to apply fix');
    }
  } catch (error) {
    console.log(`❌ Fix generation failed: ${error instanceof Error ? error.message : 'Unknown'}`);
  }

  // Step 5: Verify the fix
  if (results.fix) {
    console.log('\n' + '='.repeat(60));
    console.log('✅ STEP 5: Verifying fix...');
    console.log('='.repeat(60));

    try {
      const verifyResult = await runTestsInWorkDir(workDir, 'pip install pytest && pytest tests/ -v');

      console.log(`   Exit Code: ${verifyResult.exitCode}`);

      if (verifyResult.exitCode === 0) {
        console.log('✅ All tests pass! Fix verified.');
        results.verify = true;
      } else {
        console.log('❌ Tests still failing after fix');
        console.log('   STDERR (last 500 chars):');
        console.log(verifyResult.stderr.slice(-500));

        // Revert the fix
        if (fix) {
          revertFix(workDir, fix);
          console.log('   (Fix reverted)');
        }
      }
    } catch (error) {
      console.log(`❌ Verification failed: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  // Cleanup
  console.log('\n🧹 Cleaning up...');
  cleanupWorkDir(workDir);
  console.log('✅ Cleanup complete');

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST RESULTS');
  console.log('='.repeat(60));
  console.log(`   1. Analyze:    ${results.analyze ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   2. Reproduce:  ${results.reproduce ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   3. Test Gen:   ${results.testGen ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   4. Fix:        ${results.fix ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   5. Verify:     ${results.verify ? '✅ PASS' : '❌ FAIL'}`);
  console.log('='.repeat(60));

  const allPassed = Object.values(results).every(r => r);
  if (allPassed) {
    console.log('\n🎉 ALL TESTS PASSED! Nightwatch is working correctly.\n');
  } else {
    console.log('\n⚠️  Some tests failed. Check the output above.\n');
  }

  return results;
}

// Run the test
runE2ETest().catch(console.error);
