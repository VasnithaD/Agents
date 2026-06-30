import {
  MCPResponse,
  MCPError,
  VSCodeOpenFileParams,
  VSCodeEditFileParams,
  VSCodeGenerateCodeParams,
  VSCodeRunCommandParams,
  VSCodeCommandResult,
} from '../types';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * VS Code Tool Handler
 * Implements all VS Code operations
 */
export class VSCodeHandler {
  private workspacePath: string;

  constructor(workspacePath: string = process.cwd()) {
    this.workspacePath = workspacePath;
  }

  setWorkspace(newPath: string): void {
    this.workspacePath = newPath;
  }

  getWorkspace(): string {
    return this.workspacePath;
  }

  /**
   * Open a file and return its content
   */
  async openFile(params: VSCodeOpenFileParams): Promise<MCPResponse> {
    try {
      const filePath = path.resolve(this.workspacePath, params.filePath);

      // Security check: ensure path is within workspace
      if (!filePath.startsWith(this.workspacePath)) {
        throw new Error('Access denied: path outside workspace');
      }

      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${params.filePath}`);
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const lineCount = content.split('\n').length;

      return {
        id: this.generateId(),
        result: {
          success: true,
          filePath: params.filePath,
          content,
          lineCount,
          size: Buffer.byteLength(content, 'utf-8'),
        },
        jsonrpc: '2.0',
      };
    } catch (error) {
      return this.errorResponse(
        (error as Error).message,
        'VSCODE_OPEN_FILE_ERROR'
      );
    }
  }

  /**
   * Edit a file (create if not exists, update if exists)
   */
  async editFile(params: VSCodeEditFileParams): Promise<MCPResponse> {
    try {
      const filePath = path.resolve(this.workspacePath, params.filePath);

      // Security check
      if (!filePath.startsWith(this.workspacePath)) {
        throw new Error('Access denied: path outside workspace');
      }

      // Create directory if it doesn't exist
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      let finalContent = params.content;

      // If lineStart and lineEnd are provided, replace only those lines
      if (params.lineStart !== undefined && params.lineEnd !== undefined) {
        if (fs.existsSync(filePath)) {
          const existingContent = fs.readFileSync(filePath, 'utf-8');
          const lines = existingContent.split('\n');
          const beforeLines = lines.slice(0, params.lineStart - 1);
          const afterLines = lines.slice(params.lineEnd);
          finalContent = [
            ...beforeLines,
            params.content,
            ...afterLines,
          ].join('\n');
        }
      }

      fs.writeFileSync(filePath, finalContent, 'utf-8');

      return {
        id: this.generateId(),
        result: {
          success: true,
          filePath: params.filePath,
          message: `File ${fs.existsSync(filePath) ? 'updated' : 'created'} successfully`,
          size: Buffer.byteLength(finalContent, 'utf-8'),
        },
        jsonrpc: '2.0',
      };
    } catch (error) {
      return this.errorResponse(
        (error as Error).message,
        'VSCODE_EDIT_FILE_ERROR'
      );
    }
  }

  /**
   * Generate code using AI (placeholder for actual integration)
   */
  async generateCode(params: VSCodeGenerateCodeParams): Promise<MCPResponse> {
    try {
      // This is a placeholder. In production, integrate with an AI service
      const generatedCode = `
// Generated code for: ${params.prompt}
// Language: ${params.language || 'typescript'}
// Context: ${params.context || 'None'}

/**
 * This is auto-generated code based on the prompt:
 * "${params.prompt}"
 * 
 * Please review and customize as needed.
 */

export function generated_function() {
  // TODO: Implement generated function
  console.log("Generated function placeholder");
}
`;

      return {
        id: this.generateId(),
        result: {
          success: true,
          prompt: params.prompt,
          language: params.language || 'typescript',
          generatedCode: generatedCode.trim(),
          message:
            'Code generated successfully. Note: This is a placeholder. Integrate with OpenAI/Claude for actual AI code generation.',
        },
        jsonrpc: '2.0',
      };
    } catch (error) {
      return this.errorResponse(
        (error as Error).message,
        'VSCODE_GENERATE_CODE_ERROR'
      );
    }
  }

  /**
   * Run a command in the workspace
   */
  async runCommand(params: VSCodeRunCommandParams): Promise<MCPResponse> {
    try {
      const cwd = params.cwd
        ? path.resolve(this.workspacePath, params.cwd)
        : this.workspacePath;

      // Security check for cwd
      if (!cwd.startsWith(this.workspacePath)) {
        throw new Error('Access denied: working directory outside workspace');
      }

      const command =
        params.args && params.args.length > 0
          ? `${params.command} ${params.args.join(' ')}`
          : params.command;

      const result = execSync(command, {
        cwd,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer
      });

      return {
        id: this.generateId(),
        result: {
          success: true,
          command: params.command,
          args: params.args || [],
          cwd,
          stdout: result,
          stderr: '',
          exitCode: 0,
        },
        jsonrpc: '2.0',
      };
    } catch (error) {
      const execError = error as any;
      return {
        id: this.generateId(),
        result: {
          success: false,
          command: params.command,
          args: params.args || [],
          cwd: params.cwd || this.workspacePath,
          stdout: execError.stdout?.toString() || '',
          stderr: execError.stderr?.toString() || execError.message || '',
          exitCode: execError.status || 1,
        },
        jsonrpc: '2.0',
      };
    }
  }

  /**
   * Handle all VS Code operations
   */
  async handle(operation: string, params: any): Promise<MCPResponse> {
    try {
      switch (operation) {
        case 'open_file':
          return await this.openFile(params);
        case 'edit_file':
          return await this.editFile(params);
        case 'generate_code':
          return await this.generateCode(params);
        case 'run_command':
          return await this.runCommand(params);
        default:
          return this.errorResponse(`Unknown operation: ${operation}`, 'UNKNOWN_OPERATION');
      }
    } catch (error) {
      return this.errorResponse((error as Error).message, 'VS_CODE_HANDLER_ERROR');
    }
  }

  private errorResponse(message: string, code: string): MCPResponse {
    return {
      id: this.generateId(),
      error: {
        code: -1,
        message,
        data: { code },
      },
      jsonrpc: '2.0',
    };
  }

  private generateId(): string {
    return `vscode-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
