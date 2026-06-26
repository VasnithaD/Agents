import { ToolDefinition } from '../types';

// GitHub Tool Schema - separate file for organization
export const gitHubToolSchema: ToolDefinition = {
  name: 'github',
  description:
    'Interact with GitHub to commit changes, push code, and create pull requests',
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['commit', 'push', 'create_pull_request', 'get_repo_info'],
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
