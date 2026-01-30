import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger.js';
import type { FailureAnalysis, GeneratedTest } from '../types.js';

const logger = createLogger('TestGenerator');

const TEST_GEN_PROMPT = `You are a senior Python engineer writing a regression test.

Your task is to write a MINIMAL pytest test function that captures a specific bug.

Rules:
1. Write ONLY the test function code - no imports, no class definitions
2. The test should be minimal - test ONE thing only
3. Use a clear name: test_<function>_handles_<edge_case>
4. Include a brief docstring explaining what it tests
5. The test MUST fail before the fix and pass after
6. Do NOT use mocking unless absolutely necessary
7. Output valid Python code only - no markdown, no explanation

Example output format:
def test_send_notification_handles_none_user():
    """Verify send_notification returns False when user is None."""
    result = send_notification(None, "Hello")
    assert result is False
`;

export interface TestGenContext {
  analysis: FailureAnalysis;
  sourceCode: string;
  existingTests?: string;
  filePath: string;
}

/**
 * Generate a regression test that captures the bug.
 */
export async function generateRegressionTest(context: TestGenContext): Promise<GeneratedTest> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  logger.info('Generating regression test', {
    errorType: context.analysis.error_type,
    filePath: context.analysis.file_path,
  });

  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
    }
  });

  const prompt = buildPrompt(context);

  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    logger.debug('Gemini response received', { length: text.length });

    const generatedTest = parseTestResponse(text, context);

    logger.info('Test generated', {
      testName: generatedTest.test_name,
      targetFile: generatedTest.target_file,
    });

    return generatedTest;
  } catch (error) {
    logger.error('Failed to generate test', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * Build the prompt for test generation.
 */
function buildPrompt(context: TestGenContext): string {
  const { analysis, sourceCode, existingTests } = context;

  let prompt = TEST_GEN_PROMPT + '\n\n';

  prompt += '## Bug Information\n';
  prompt += `- Error Type: ${analysis.error_type}\n`;
  prompt += `- File: ${analysis.file_path}\n`;
  prompt += `- Line: ${analysis.line_number || 'unknown'}\n`;
  prompt += `- Function: ${analysis.function_name || 'unknown'}\n`;
  prompt += `- Error Message: ${analysis.error_message}\n`;
  prompt += `- Failing Test: ${analysis.failing_test || 'none'}\n\n`;

  prompt += '## Source Code\n';
  prompt += '```python\n';
  prompt += sourceCode;
  prompt += '\n```\n\n';

  if (existingTests) {
    prompt += '## Existing Tests (for style reference)\n';
    prompt += '```python\n';
    prompt += existingTests.substring(0, 2000); // Limit size
    prompt += '\n```\n\n';
  }

  prompt += '## Task\n';
  prompt += 'Write a single pytest test function that:\n';
  prompt += '1. Reproduces this exact bug\n';
  prompt += '2. Will FAIL with the current code\n';
  prompt += '3. Will PASS once the bug is fixed\n\n';
  prompt += 'Output ONLY the test function code:';

  return prompt;
}

/**
 * Parse the Gemini response into a GeneratedTest object.
 */
function parseTestResponse(text: string, context: TestGenContext): GeneratedTest {
  // Clean up the response
  let testCode = text.trim();

  // Remove markdown code blocks if present
  if (testCode.startsWith('```python')) {
    testCode = testCode.slice(9);
  } else if (testCode.startsWith('```')) {
    testCode = testCode.slice(3);
  }
  if (testCode.endsWith('```')) {
    testCode = testCode.slice(0, -3);
  }
  testCode = testCode.trim();

  // Extract test function name
  const nameMatch = testCode.match(/def (test_\w+)\s*\(/);
  const testName = nameMatch ? nameMatch[1] : 'test_regression_bug';

  // Determine imports needed based on the source file
  const functionNames = extractFunctionNames(context.sourceCode);

  // Build imports
  const imports: string[] = [];
  for (const funcName of functionNames) {
    if (testCode.includes(funcName)) {
      imports.push(funcName);
    }
  }

  // Determine target test file
  const targetFile = determineTargetTestFile(context.analysis.file_path);

  return {
    test_name: testName,
    test_code: testCode,
    target_file: targetFile,
    imports_needed: imports,
  };
}

/**
 * Extract function names from Python source code.
 */
function extractFunctionNames(sourceCode: string): string[] {
  const functionPattern = /def (\w+)\s*\(/g;
  const names: string[] = [];
  let match;

  while ((match = functionPattern.exec(sourceCode)) !== null) {
    names.push(match[1]);
  }

  return names;
}

/**
 * Determine the target test file path based on source file.
 */
function determineTargetTestFile(sourceFilePath: string): string {
  // Convert src/user_service.py -> tests/test_user_service.py
  const fileName = path.basename(sourceFilePath, '.py');
  const dirName = path.dirname(sourceFilePath);

  // Try to map src -> tests
  let testDir = dirName.replace(/\bsrc\b/, 'tests');
  if (testDir === dirName) {
    testDir = 'tests';
  }

  return path.join(testDir, `test_${fileName}.py`);
}

/**
 * Read source code from the work directory.
 */
export function readSourceFile(workDir: string, filePath: string): string {
  const fullPath = path.join(workDir, filePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Source file not found: ${filePath}`);
  }

  return fs.readFileSync(fullPath, 'utf-8');
}

/**
 * Read existing test file if it exists.
 */
export function readExistingTests(workDir: string, testFilePath: string): string | undefined {
  const fullPath = path.join(workDir, testFilePath);

  if (fs.existsSync(fullPath)) {
    return fs.readFileSync(fullPath, 'utf-8');
  }

  return undefined;
}

/**
 * Insert a generated test into an existing test file.
 */
export function insertTestIntoFile(
  workDir: string,
  testFilePath: string,
  generatedTest: GeneratedTest
): void {
  const fullPath = path.join(workDir, testFilePath);

  let content: string;

  if (fs.existsSync(fullPath)) {
    // Append to existing file
    content = fs.readFileSync(fullPath, 'utf-8');

    // Add imports if needed
    const importsToAdd = generatedTest.imports_needed.filter(
      imp => !content.includes(`import ${imp}`) && !content.includes(`from .* import.*${imp}`)
    );

    if (importsToAdd.length > 0) {
      // Find the last import line and add after it
      const lines = content.split('\n');
      let lastImportIndex = -1;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('import ') || lines[i].startsWith('from ')) {
          lastImportIndex = i;
        }
      }

      if (lastImportIndex >= 0) {
        // Add to existing imports - this is a simplified approach
        // In practice, you'd want to merge into existing from...import statements
      }
    }

    // Append the test function
    content = content.trimEnd() + '\n\n\n' + generatedTest.test_code + '\n';
  } else {
    // Create new test file
    const sourceModule = path.basename(generatedTest.target_file, '.py').replace('test_', '');

    content = `"""Auto-generated regression tests."""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))

from ${sourceModule} import ${generatedTest.imports_needed.join(', ')}


${generatedTest.test_code}
`;
  }

  // Ensure directory exists
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(fullPath, content, 'utf-8');

  logger.info('Test inserted into file', { testFilePath, testName: generatedTest.test_name });
}
