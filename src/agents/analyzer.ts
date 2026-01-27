import { GoogleGenerativeAI } from '@google/generative-ai';
import { createLogger } from '../utils/logger.js';
import type { FailureAnalysis } from '../types.js';

const logger = createLogger('LogAnalyzer');

const ANALYZER_PROMPT = `You are a CI log analyzer. Extract structured failure information from build logs.

Output JSON only. No explanation. No markdown code blocks.

Schema:
{
  "error_type": "ImportError" | "ModuleNotFoundError" | "TypeError" | "AttributeError" | "AssertionError" | "SyntaxError" | "NameError" | "ValueError" | "KeyError" | "Other",
  "file_path": string (relative to repo root),
  "line_number": number | null,
  "function_name": string | null,
  "error_message": string (the actual error message),
  "stack_trace": string[] (array of "file:line in function" strings),
  "failing_test": string | null (test function name if this is a test failure),
  "confidence": number (0-1, how confident you are in this analysis),
  "raw_log_snippet": string (the relevant portion of the log showing the error)
}

Rules:
- Extract the ROOT cause, not cascading errors
- file_path should be relative to repo root (e.g., "src/user_service.py" not "/home/runner/work/repo/src/user_service.py")
- stack_trace should be the call stack leading to the error
- failing_test is the test function name if this is a test failure (e.g., "test_user_login")
- raw_log_snippet should be 10-30 lines showing the actual error
- If you cannot determine a field with confidence, use null
- confidence should reflect how certain you are about the root cause`;

/**
 * Analyzes CI logs using Gemini to extract structured failure information.
 */
export async function analyzeFailureLogs(logContent: string): Promise<FailureAnalysis> {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  logger.info('Analyzing failure logs', { logLength: logContent.length });

  const genAI = new GoogleGenerativeAI(apiKey);

  // Use Gemini 2.5 Flash for log analysis
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      temperature: 0.1, // Low temperature for consistent structured output
      maxOutputTokens: 4096,
    }
  });

  const prompt = `${ANALYZER_PROMPT}

<ci_log>
${logContent}
</ci_log>`;

  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    logger.debug('Gemini response received', { length: text.length });

    // Parse the JSON response
    const analysis = parseAnalysisResponse(text);

    logger.info('Analysis complete', {
      error_type: analysis.error_type,
      file_path: analysis.file_path,
      confidence: analysis.confidence,
    });

    return analysis;
  } catch (error) {
    logger.error('Failed to analyze logs', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * Parses the Gemini response into a FailureAnalysis object.
 * Handles various response formats and validates the output.
 */
function parseAnalysisResponse(text: string): FailureAnalysis {
  // Remove markdown code blocks if present
  let jsonText = text.trim();
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

    // Validate and provide defaults
    const analysis: FailureAnalysis = {
      error_type: validateErrorType(parsed.error_type),
      file_path: parsed.file_path || 'unknown',
      line_number: typeof parsed.line_number === 'number' ? parsed.line_number : null,
      function_name: parsed.function_name || null,
      error_message: parsed.error_message || 'Unknown error',
      stack_trace: Array.isArray(parsed.stack_trace) ? parsed.stack_trace : [],
      failing_test: parsed.failing_test || null,
      confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
      raw_log_snippet: parsed.raw_log_snippet || '',
    };

    return analysis;
  } catch (parseError) {
    logger.error('Failed to parse Gemini response as JSON', {
      text: text.substring(0, 500),
      error: parseError instanceof Error ? parseError.message : 'Unknown'
    });

    // Return a minimal analysis indicating parsing failed
    return {
      error_type: 'Other',
      file_path: 'unknown',
      line_number: null,
      function_name: null,
      error_message: 'Failed to parse CI logs',
      stack_trace: [],
      failing_test: null,
      confidence: 0,
      raw_log_snippet: text.substring(0, 1000),
    };
  }
}

/**
 * Validates that the error type is one of the expected values.
 */
function validateErrorType(type: string): FailureAnalysis['error_type'] {
  const validTypes: FailureAnalysis['error_type'][] = [
    'ImportError', 'ModuleNotFoundError', 'TypeError', 'AttributeError',
    'AssertionError', 'SyntaxError', 'NameError', 'ValueError', 'KeyError', 'Other'
  ];

  if (validTypes.includes(type as FailureAnalysis['error_type'])) {
    return type as FailureAnalysis['error_type'];
  }

  return 'Other';
}
