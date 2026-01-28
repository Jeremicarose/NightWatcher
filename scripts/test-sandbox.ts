import dotenv from 'dotenv';
import { checkDockerAvailable, ensureImage } from '../src/sandbox/docker.js';
import { reproduceFailure, cleanupWorkDir } from '../src/sandbox/runner.js';

dotenv.config();

async function testSandbox() {
  console.log('🐳 Testing Docker Sandbox\n');
  console.log('='.repeat(60));

  // Test 1: Check Docker availability
  console.log('\n📋 Test 1: Checking Docker availability...');
  const available = await checkDockerAvailable();

  if (!available) {
    console.log('❌ Docker is not available. Make sure Docker Desktop is running.');
    process.exit(1);
  }
  console.log('✅ Docker is available');

  // Test 2: Pull Python image
  console.log('\n📋 Test 2: Ensuring Python image exists...');
  try {
    await ensureImage('python:3.11-slim');
    console.log('✅ Python image ready');
  } catch (error) {
    console.log('❌ Failed to pull image:', error instanceof Error ? error.message : 'Unknown');
    process.exit(1);
  }

  // Test 3: Reproduce a real failure from a public repo
  console.log('\n📋 Test 3: Testing reproduction with a sample repo...');
  console.log('   Using: https://github.com/Jeremicarose/NightWatcher (demo-repo folder)');

  // For testing, we'll use the demo-repo in this project
  // In real usage, this would clone from GitHub
  const result = await reproduceFailure({
    repo: 'Jeremicarose/NightWatcher',
    sha: 'main', // Use main branch for testing
    cloneUrl: 'https://github.com/Jeremicarose/NightWatcher.git',
    testCommand: 'cd demo-repo && pip install -r requirements.txt && pytest tests/ -v',
  });

  console.log('\n📊 Reproduction Result:');
  console.log(`   Success: ${result.success}`);
  console.log(`   Reproduced: ${result.reproduced}`);
  console.log(`   Exit Code: ${result.exitCode}`);

  if (result.error) {
    console.log(`   Error: ${result.error}`);
  }

  if (result.stdout) {
    console.log('\n📤 STDOUT (last 500 chars):');
    console.log(result.stdout.slice(-500));
  }

  if (result.stderr) {
    console.log('\n📤 STDERR (last 500 chars):');
    console.log(result.stderr.slice(-500));
  }

  // Cleanup
  if (result.workDir) {
    console.log('\n🧹 Cleaning up work directory...');
    cleanupWorkDir(result.workDir);
    console.log('✅ Cleanup complete');
  }

  console.log('\n' + '='.repeat(60));
  console.log('🏁 Sandbox test complete\n');
}

testSandbox().catch(console.error);
