import { ToolDefinition } from '../types';
import { AVAILABLE_MODEL_IDS } from '../models/registry';

// LLM Tool Schema Definition
export const llmToolSchema: ToolDefinition = {
  name: 'llm',
  description:
    'Connect to HPE ChatHPE gateway to generate, refactor, and review code. Supports multiple models: GPT-4o, Claude 3.5 Sonnet, Grok 2, Llama 3.1, Mistral Large and more — all via the HPE API.',
  inputSchema: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['generate_code', 'refactor_code', 'review_code', 'chat', 'generate_with_workflow'],
        description: 'The LLM operation to perform',
      },
      model: {
        type: 'string',
        enum: AVAILABLE_MODEL_IDS,
        description: 'Model to use. Defaults to LLM_MODEL_NAME in .env. GET /api/models to see all options with descriptions.',
      },
      prompt: {
        type: 'string',
        description: 'User prompt for code generation (required for generate_code, generate_with_workflow)',
      },
      language: {
        type: 'string',
        description: 'Programming language (typescript, python, javascript, java, etc.)',
      },
      context: {
        type: 'string',
        description: 'Additional context for the LLM (optional)',
      },
      temperature: {
        type: 'number',
        description: 'Temperature for generation (0-2, default 0.7) (optional)',
      },
      maxTokens: {
        type: 'number',
        description: 'Maximum tokens to generate (optional)',
      },
      code: {
        type: 'string',
        description: 'Code to refactor or review (required for refactor_code, review_code)',
      },
      instructions: {
        type: 'string',
        description: 'Refactoring instructions (required for refactor_code)',
      },
      focusAreas: {
        type: 'array',
        description: 'Areas to focus on for code review (optional for review_code)',
      },
      message: {
        type: 'string',
        description: 'Chat message (required for chat)',
      },
      conversationHistory: {
        type: 'array',
        description: 'Previous messages in conversation (optional for chat)',
      },
      filePath: {
        type: 'string',
        description: 'File path to insert code into (for generate_with_workflow)',
      },
      commitMessage: {
        type: 'string',
        description: 'Commit message (for generate_with_workflow)',
      },
      workflowStep: {
        type: 'string',
        enum: ['generate_only', 'generate_and_insert', 'generate_and_commit'],
        description: 'Workflow step after generation (for generate_with_workflow)',
      },
    },
    required: ['operation'],
  },
};
