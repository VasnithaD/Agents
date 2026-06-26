// MCP Request/Response Types
export interface MCPRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
  jsonrpc: string;
}

export interface MCPResponse {
  id: string;
  result?: unknown;
  error?: MCPError;
  jsonrpc: string;
}

export interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
  description?: string;
}

export interface JSONSchemaProperty {
  type: string;
  description?: string;
  items?: JSONSchemaProperty;
  enum?: unknown[];
  default?: unknown;
}

// VS Code Tool Types
export interface VSCodeFile {
  path: string;
  content: string;
}

export interface VSCodeOpenFileParams {
  filePath: string;
}

export interface VSCodeEditFileParams {
  filePath: string;
  content: string;
  lineStart?: number;
  lineEnd?: number;
}

export interface VSCodeGenerateCodeParams {
  prompt: string;
  language?: string;
  context?: string;
}

export interface VSCodeRunCommandParams {
  command: string;
  cwd?: string;
  args?: string[];
}

export interface VSCodeCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
}

// GitHub Tool Types
export interface GitHubCommitParams {
  message: string;
  files: Record<string, string>;
  branch?: string;
}

export interface GitHubPushParams {
  branch: string;
  force?: boolean;
}

export interface GitHubPullRequestParams {
  title: string;
  description?: string;
  head: string;
  base?: string;
  labels?: string[];
}

export interface GitHubPullRequestResult {
  number: number;
  url: string;
  state: string;
  title: string;
  id: string;
}

export interface GitHubCommitResult {
  sha: string;
  url: string;
  message: string;
  author: string;
  timestamp: string;
}

// LLM Tool Types
export interface LLMGenerateCodeParams {
  prompt: string;
  language?: string;
  context?: string;
  temperature?: number;
  maxTokens?: number;
  reactMode?: boolean;
  humanFeedback?: string;
}

export interface LLMCodeGenerationResult {
  code: string;
  language: string;
  prompt: string;
  explanation?: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMRefactorCodeParams {
  code: string;
  language: string;
  instructions: string;
  context?: string;
  reactMode?: boolean;
  humanFeedback?: string;
}

export interface LLMCodeReviewParams {
  code: string;
  language: string;
  focusAreas?: string[];
}

export interface LLMCodeReviewResult {
  issues: CodeIssue[];
  summary: string;
  overallQuality: number; // 1-10
  suggestions: string[];
}

export interface CodeIssue {
  line?: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
}

export interface LLMChatParams {
  message: string;
  conversationHistory?: ChatMessage[];
  context?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMChatResult {
  response: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMProvider {
  type: 'openai' | 'azure-openai';
  model: string;
  apiKey: string;
  endpoint?: string; // For Azure
  deployment?: string; // For Azure
}

export interface CodeGenerationWorkflow {
  id: string;
  prompt: string;
  generatedCode: string;
  language: string;
  status: 'generated' | 'inserted' | 'committed' | 'pushed' | 'pr_created';
  nextSteps?: 'insert_to_vscode' | 'commit_to_github' | 'create_pr' | 'none';
  metadata?: Record<string, unknown>;
}
