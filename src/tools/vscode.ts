import { ToolDefinition, JSONSchema } from '../types';

// VS Code Tool Schema Definition
export const vsCodeToolSchema: ToolDefinition = {
  name: 'vs-code',
  description:
    'Interact with VS Code to open files, edit files, generate code, and run commands',
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['open_file', 'edit_file', 'generate_code', 'run_command'],
        description: 'The VS Code operation to perform',
      },
      filePath: {
        type: 'string',
        description: 'Path to the file (required for open_file and edit_file)',
      },
      content: {
        type: 'string',
        description: 'File content (required for edit_file, optional for generate_code)',
      },
      lineStart: {
        type: 'number',
        description: 'Starting line number for edit_file (optional, 1-based)',
      },
      lineEnd: {
        type: 'number',
        description: 'Ending line number for edit_file (optional, 1-based)',
      },
      prompt: {
        type: 'string',
        description: 'Prompt for code generation (required for generate_code)',
      },
      language: {
        type: 'string',
        description: 'Programming language for code generation (optional)',
      },
      context: {
        type: 'string',
        description: 'Additional context for code generation (optional)',
      },
      command: {
        type: 'string',
        description: 'Command to run (required for run_command)',
      },
      cwd: {
        type: 'string',
        description: 'Working directory for command (optional, defaults to workspace)',
      },
      args: {
        type: 'array',
        description: 'Command arguments (optional)',
      },
    },
    required: ['operation'],
  },
};

// GitHub Tool Schema Definition
export const gitHubToolSchema: ToolDefinition = {
  name: 'github',
  description:
    'Interact with GitHub to commit changes, push code, and create pull requests',
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['commit', 'push', 'create_pull_request'],
        description: 'The GitHub operation to perform',
      },
      message: {
        type: 'string',
        description: 'Commit message (required for commit)',
      },
      files: {
        type: 'object',
        description: 'Files to commit as key-value pairs (required for commit)',
      },
      branch: {
        type: 'string',
        description: 'Branch name (required for push, optional for commit)',
      },
      force: {
        type: 'boolean',
        description: 'Force push (optional, defaults to false)',
      },
      title: {
        type: 'string',
        description: 'Pull request title (required for create_pull_request)',
      },
      description: {
        type: 'string',
        description: 'Pull request description (optional for create_pull_request)',
      },
      head: {
        type: 'string',
        description: 'Source branch for PR (required for create_pull_request)',
      },
      base: {
        type: 'string',
        description: 'Target branch for PR (optional, defaults to main)',
      },
      labels: {
        type: 'array',
        description: 'Labels for the PR (optional)',
      },
    },
    required: ['operation'],
  },
};
