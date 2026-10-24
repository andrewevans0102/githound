export interface ReviewContext {
  prNumber: number;
  branchName: string;
  diff: string;
  commentPath?: string;
  commentBody: string;
  lineSnippet?: string;
}

export interface IssueContext {
  issueNumber: number;
  title: string;
  body: string;
  branchName: string;
  labels: string[];
}

export interface FileEdit {
  path: string;
  content: string;
  action: "create" | "update" | "delete";
}

export interface GitHoundConfig {
  owner: string;
  repo: string;
  maxRetries: number;
  testCommand: string;
  typecheckCommand?: string;
  model: string;
  botName: string;
  botEmail: string;
  baseBranch: string;
}

export interface VerificationResult {
  success: boolean;
  command: string;
  stdout: string;
  stderr: string;
  error?: string;
}
