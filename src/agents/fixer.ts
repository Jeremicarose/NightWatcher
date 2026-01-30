import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../utils/logger.js';
import type { FailureAnalysis, ProposedFix, FixAttempt } from '../types.js';

const logger = createLogger('FixAgent');

const FIX_PROMPT = `You are a senior Python engineer fixing a bug.

Your task is to propose a MINIMAL code fix. Change as few lines as possible.

Rules:
1. Fix ONLY the specific bug - do NOT refactor unrelated code
2. Do NOT add features or improve code style
3. Preserve existing code style and formatting
4. Output a JSON object with the fix details

Output format (JSON only, no markdown):
{
  "file_path": "path/to/file.py",
  "original_code": "exact lines to replace (copy verbatim from source)",
  "fixed_code": "replacement lines",
  "explanation": "one sentence explaining the fix"
}

IMPORTANT:
- original_code must be an EXACT match of the code in the source file
- Include enough context in original_code to make it unique
- Keep the fix minimal - usually just a few lines
`;

export interface FixContext {
  analysis: FailureAnalysis;
  sourceCode: string;
  filePath: string;
  previousAttempts?: FixAttempt[];
  testOutput?: string;
}

/**
 * Generate a fix proposal for the bug.
 */
export async function generateFix(context: FixContext): Promise<ProposedFix> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  logger.info('Generating fix', {
    errorType: context.analysis.error_type,
    filePath: context.filePath,
    previousAttempts: context.previousAttempts?.length || 0,
  });

  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 2048,
    }
  });

  const prompt = buildFixPrompt(context);

  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    logger.debug('Gemini response received', { length: text.length });

    const fix = parseFixResponse(text, context.filePath);

    logger.info('Fix generated', {
      filePath: fix.file_path,
      explanationPreview: fix.explanation.substring(0, 50),
    });

    return fix;
  } catch (error) {
    logger.error('Failed to generate fix', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * Build the prompt for fix generation.
 */
function buildFixPrompt(context: FixContext): string {
  const { analysis, sourceCode, filePath, previousAttempts, testOutput } = context;

  let prompt = FIX_PROMPT + '\n\n';

  prompt += '## Bug Information\n';
  prompt += `- Error Type: ${analysis.error_type}\n`;
  prompt += `- File: ${analysis.file_path}\n`;
  prompt += `- Line: ${analysis.line_number || 'unknown'}\n`;
  prompt += `- Function: ${analysis.function_name || 'unknown'}\n`;
  prompt += `- Error Message: ${analysis.error_message}\n\n`;

  prompt += '## Source Code\n';
  prompt += `File: ${filePath}\n`;
  prompt += '```python\n';
  prompt += sourceCode;
  prompt += '\n```\n\n';

  if (previousAttempts && previousAttempts.length > 0) {
    prompt += '## Previous Fix Attempts (FAILED - try something different)\n';
    for (const attempt of previousAttempts) {
      prompt += `\nAttempt ${attempt.attempt_number}:\n`;
      prompt += `- Fix tried: ${attempt.proposed_fix.explanation}\n`;
      prompt += `- Result: ${attempt.test_result}\n`;
      if (attempt.error_output) {
        prompt += `- Error: ${attempt.error_output.substring(0, 500)}\n`;
      }
    }
    prompt += '\n';
  }

  if (testOutput) {
    prompt += '## Test Output\n';
    prompt += '```\n';
    prompt += testOutput.substring(0, 2000);
    prompt += '\n```\n\n';
  }

  prompt += '## Task\n';
  prompt += 'Propose a minimal fix for this bug. Output JSON only:';

  return prompt;
}

/**
 * Parse the Gemini response into a ProposedFix object.
 */
function parseFixResponse(text: string, defaultFilePath: string): ProposedFix {
  // Clean up the response
  let jsonText = text.trim();

  // Remove markdown code blocks if present
  if (jsonText.startsWith('```json')) {
    jsonText = jsonText.slice(7);
  } else if (jsonText.startsWith('```')) {
    jsonText = jsonText.slice(3);
  }
  if (jsonText.endsWith('```')) {
    jsonText = jsonText.slice(0, -3);
  }
  jsonText = jsonText.trim();

  try {
    const parsed = JSON.parse(jsonText);

    return {
      file_path: parsed.file_path || defaultFilePath,
      original_code: parsed.original_code || '',
      fixed_code: parsed.fixed_code || '',
      explanation: parsed.explanation || 'No explanation provided',
    };
  } catch (error) {
    logger.error('Failed to parse fix response as JSON', {
      text: text.substring(0, 500),
      error: error instanceof Error ? error.message : 'Unknown'
    });

    throw new Error('Failed to parse fix response');
  }
}

/**
 * Apply a fix to the source file.
 * Returns true if the fix was applied successfully.
 */
export function applyFix(workDir: string, fix: ProposedFix): boolean {
  const fullPath = path.join(workDir, fix.file_path);

  if (!fs.existsSync(fullPath)) {
    logger.error('Source file not found', { filePath: fix.file_path });
    return false;
  }

  const content = fs.readFileSync(fullPath, 'utf-8');

  // Check if original_code exists in the file
  if (!content.includes(fix.original_code)) {
    logger.error('Original code not found in file', {
      filePath: fix.file_path,
      originalCodePreview: fix.original_code.substring(0, 100),
    });
    return false;
  }

  // Apply the fix
  const newContent = content.replace(fix.original_code, fix.fixed_code);

  // Verify the replacement happened
  if (newContent === content) {
    logger.error('Fix did not change the file');
    return false;
  }

  // Write the fixed content
  fs.writeFileSync(fullPath, newContent, 'utf-8');

  logger.info('Fix applied', {
    filePath: fix.file_path,
    explanation: fix.explanation,
  });

  return true;
}

/**
 * Revert a fix by restoring the original code.
 */
export function revertFix(workDir: string, fix: ProposedFix): boolean {
  const fullPath = path.join(workDir, fix.file_path);

  if (!fs.existsSync(fullPath)) {
    logger.error('Source file not found for revert', { filePath: fix.file_path });
    return false;
  }

  const content = fs.readFileSync(fullPath, 'utf-8');

  // Replace fixed code with original
  if (!content.includes(fix.fixed_code)) {
    logger.warn('Fixed code not found in file - may already be reverted');
    return false;
  }

  const newContent = content.replace(fix.fixed_code, fix.original_code);
  fs.writeFileSync(fullPath, newContent, 'utf-8');

  logger.info('Fix reverted', { filePath: fix.file_path });

  return true;
}

/**
 * Read the source file content.
 */
export function readSourceCode(workDir: string, filePath: string): string {
  const fullPath = path.join(workDir, filePath);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Source file not found: ${filePath}`);
  }

  return fs.readFileSync(fullPath, 'utf-8');
}
