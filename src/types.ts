export interface WorkflowRunPayload {
  action: string;
  workflow_run: {
    id: number;
    name: string;
    head_sha: string;
    head_branch: string;
    conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null;
    html_url: string;
    logs_url: string;
  };
  repository: {
    id: number;
    name: string;
    full_name: string;
    clone_url: string;
    default_branch: string;
  };
  installation?: {
    id: number;
  };
}

export interface FailureAnalysis {
  error_type: 'ImportError' | 'ModuleNotFoundError' | 'TypeError' | 'AttributeError' |
              'AssertionError' | 'SyntaxError' | 'NameError' | 'ValueError' | 'KeyError' | 'Other';
  file_path: string;
  line_number: number | null;
  function_name: string | null;
  error_message: string;
  stack_trace: string[];
  failing_test: string | null;
  confidence: number;
  raw_log_snippet: string;
}

export interface GeneratedTest {
  test_code: string;
  test_name: string;
  target_file: string;
  imports_needed: string[];
}

export interface ProposedFix {
  file_path: string;
  original_code: string;
  fixed_code: string;
  explanation: string;
}

export interface FixAttempt {
  attempt_number: number;
  proposed_fix: ProposedFix;
  test_result: 'pass' | 'fail';
  error_output?: string;
}

export interface HealingResult {
  success: boolean;
  run_id: number;
  repo: string;
  sha: string;
  analysis: FailureAnalysis;
  generated_test?: GeneratedTest;
  fix_attempts: FixAttempt[];
  final_fix?: ProposedFix;
  pr_url?: string;
  issue_url?: string;
  error?: string;
}

export interface NightwatchConfig {
  language: 'python';
  test_command: string;
  ignore_patterns: string[];
  max_fix_attempts: number;
  create_pr: boolean;
}
