import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { analyzeFailureLogs } from '../src/agents/analyzer.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_LOGS_DIR = path.join(__dirname, '..', 'test-logs');

async function testAnalyzer() {
  console.log('🧪 Testing Gemini Log Analyzer\n');
  console.log('='.repeat(60));

  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY not set in .env');
    process.exit(1);
  }

  const logFiles = fs.readdirSync(TEST_LOGS_DIR).filter(f => f.endsWith('.txt'));

  for (const file of logFiles) {
    console.log(`\n📄 Testing: ${file}`);
    console.log('-'.repeat(60));

    const logContent = fs.readFileSync(path.join(TEST_LOGS_DIR, file), 'utf-8');

    try {
      const analysis = await analyzeFailureLogs(logContent);

      console.log(`  Error Type:    ${analysis.error_type}`);
      console.log(`  File:          ${analysis.file_path || 'N/A'}`);
      console.log(`  Line:          ${analysis.line_number || 'N/A'}`);
      console.log(`  Function:      ${analysis.function_name || 'N/A'}`);
      console.log(`  Failing Test:  ${analysis.failing_test || 'N/A'}`);
      console.log(`  Message:       ${analysis.error_message?.substring(0, 80)}...`);
      console.log(`  Confidence:    ${(analysis.confidence * 100).toFixed(0)}%`);
      console.log(`  ✅ Analysis complete`);
    } catch (error) {
      console.log(`  ❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('🏁 Test complete\n');
}

testAnalyzer();
