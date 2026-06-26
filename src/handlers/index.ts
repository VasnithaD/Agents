import {
  MCPRequest,
  MCPResponse,
  ToolDefinition,
} from '../types';
import { VSCodeHandler } from './vscode-handler';
import { GitHubHandler } from './github-handler';
import { LLMHandler } from './llm-handler';
import { vsCodeToolSchema } from '../tools/vscode';
import { gitHubToolSchema } from '../tools/github';
import { llmToolSchema } from '../tools/llm';

/**
 * MCP Server Handler
 * Routes requests to appropriate tool handlers
 */
export class MCPServerHandler {
  private vsCodeHandler: VSCodeHandler;
  private gitHubHandler: GitHubHandler;
  private llmHandler: LLMHandler;
  private tools: Map<string, ToolDefinition>;

  constructor(
    vsCodeHandler: VSCodeHandler,
    gitHubHandler: GitHubHandler,
    llmHandler: LLMHandler
  ) {
    this.vsCodeHandler = vsCodeHandler;
    this.gitHubHandler = gitHubHandler;
    this.llmHandler = llmHandler;
    this.tools = new Map([
      [vsCodeToolSchema.name, vsCodeToolSchema],
      [gitHubToolSchema.name, gitHubToolSchema],
      [llmToolSchema.name, llmToolSchema],
    ]);
  }

  /**
   * Get list of available tools
   */
  getTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Handle MCP request and route to appropriate tool handler
   */
  async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    const { method, params } = request;

    switch (method) {
      case 'tools/list':
        return this.handleListTools(request);
      case 'tools/call':
        return this.handleCallTool(request);
      default:
        return this.errorResponse(request.id, `Unknown method: ${method}`, 'UNKNOWN_METHOD');
    }
  }

  /**
   * List available tools
   */
  private handleListTools(request: MCPRequest): MCPResponse {
    return {
      id: request.id,
      result: {
        tools: this.getTools(),
      },
      jsonrpc: '2.0',
    };
  }

  /**
   * Call a specific tool
   */
  private async handleCallTool(request: MCPRequest): Promise<MCPResponse> {
    const { name, arguments: toolArgs } = request.params as any;

    if (!name) {
      return this.errorResponse(request.id, 'Tool name is required', 'MISSING_TOOL_NAME');
    }

    const tool = this.tools.get(name);
    if (!tool) {
      return this.errorResponse(request.id, `Tool not found: ${name}`, 'TOOL_NOT_FOUND');
    }

    try {
      let result: MCPResponse;

      if (name === 'vs-code') {
        result = await this.vsCodeHandler.handle(
          toolArgs.operation,
          toolArgs
        );
      } else if (name === 'github') {
        result = await this.gitHubHandler.handle(
          toolArgs.operation,
          toolArgs
        );
      } else if (name === 'llm') {
        result = await this.llmHandler.handle(
          toolArgs.operation,
          toolArgs
        );
      } else {
        return this.errorResponse(request.id, `Tool handler not found: ${name}`, 'HANDLER_NOT_FOUND');
      }

      return {
        ...result,
        id: request.id,
      };
    } catch (error) {
      return this.errorResponse(
        request.id,
        (error as Error).message,
        'TOOL_EXECUTION_ERROR'
      );
    }
  }

  private errorResponse(
    id: string,
    message: string,
    code: string
  ): MCPResponse {
    return {
      id,
      error: {
        code: -1,
        message,
        data: { code },
      },
      jsonrpc: '2.0',
    };
  }
}
