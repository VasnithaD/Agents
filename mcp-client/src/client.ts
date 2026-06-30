import axios, { AxiosInstance } from 'axios';
import { MCPRequest, MCPResponse } from './types';
import * as readline from 'readline';

/**
 * MCP Client
 * Sends MCP requests to the server and displays results
 */
export class MCPClient {
  private client: AxiosInstance;
  private baseURL: string;

  constructor(baseURL: string = 'http://localhost:3000') {
    this.baseURL = baseURL;
    this.client = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Send a request to the server
   */
  async sendRequest(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<MCPResponse> {
    const request: MCPRequest = {
      id: this.generateId(),
      method,
      params,
      jsonrpc: '2.0',
    };

    try {
      const response = await this.client.post('/rpc', request);
      return response.data;
    } catch (error: any) {
      return {
        id: request.id,
        error: {
          code: -1,
          message: error.message || 'Request failed',
          data: { originalError: error },
        },
        jsonrpc: '2.0',
      };
    }
  }

  /**
   * List available tools
   */
  async listTools(): Promise<any> {
    try {
      const response = await this.client.get('/tools');
      return response.data;
    } catch (error) {
      console.error('Failed to list tools:', error);
      return null;
    }
  }

  /**
   * VS Code: Open file
   */
  async vsCodeOpenFile(filePath: string): Promise<MCPResponse> {
    return this.sendRequest('tools/call', {
      name: 'vs-code',
      arguments: {
        operation: 'open_file',
        filePath,
      },
    });
  }

  /**
   * VS Code: Edit file
   */
  async vsCodeEditFile(
    filePath: string,
    content: string,
    lineStart?: number,
    lineEnd?: number
  ): Promise<MCPResponse> {
    return this.sendRequest('tools/call', {
      name: 'vs-code',
      arguments: {
        operation: 'edit_file',
        filePath,
        content,
        lineStart,
        lineEnd,
      },
    });
  }

  /**
   * VS Code: Generate code
   */
  async vsCodeGenerateCode(
    prompt: string,
    language?: string,
    context?: string
  ): Promise<MCPResponse> {
    return this.sendRequest('tools/call', {
      name: 'vs-code',
      arguments: {
        operation: 'generate_code',
        prompt,
        language,
        context,
      },
    });
  }

  /**
   * VS Code: Run command
   */
  async vsCodeRunCommand(
    command: string,
    cwd?: string,
    args?: string[]
  ): Promise<MCPResponse> {
    return this.sendRequest('tools/call', {
      name: 'vs-code',
      arguments: {
        operation: 'run_command',
        command,
        cwd,
        args,
      },
    });
  }

  /**
   * GitHub: Commit
   */
  async gitHubCommit(
    message: string,
    files: Record<string, string>,
    branch?: string
  ): Promise<MCPResponse> {
    return this.sendRequest('tools/call', {
      name: 'github',
      arguments: {
        operation: 'commit',
        message,
        files,
        branch,
      },
    });
  }

  /**
   * GitHub: Push
   */
  async gitHubPush(branch: string, force: boolean = false): Promise<MCPResponse> {
    return this.sendRequest('tools/call', {
      name: 'github',
      arguments: {
        operation: 'push',
        branch,
        force,
      },
    });
  }

  /**
   * GitHub: Create Pull Request
   */
  async gitHubCreatePullRequest(
    title: string,
    head: string,
    base?: string,
    description?: string,
    labels?: string[]
  ): Promise<MCPResponse> {
    return this.sendRequest('tools/call', {
      name: 'github',
      arguments: {
        operation: 'create_pull_request',
        title,
        description,
        head,
        base,
        labels,
      },
    });
  }

  /**
   * GitHub: Get repository info
   */
  async gitHubGetRepoInfo(): Promise<MCPResponse> {
    return this.sendRequest('tools/call', {
      name: 'github',
      arguments: {
        operation: 'get_repo_info',
      },
    });
  }

  /**
   * LLM: Generate code from prompt
   */
  async llmGenerateCode(
    prompt: string,
    language?: string,
    context?: string
  ): Promise<MCPResponse> {
    return this.sendRequest('tools/call', {
      name: 'llm',
      arguments: {
        operation: 'generate_code',
        prompt,
        language,
        context,
      },
    });
  }

  /**
   * LLM: Refactor code
   */
  async llmRefactorCode(
    code: string,
    language: string,
    instructions: string,
    context?: string
  ): Promise<MCPResponse> {
    return this.sendRequest('tools/call', {
      name: 'llm',
      arguments: {
        operation: 'refactor_code',
        code,
        language,
        instructions,
        context,
      },
    });
  }

  /**
   * LLM: Review code
   */
  async llmReviewCode(
    code: string,
    language: string,
    focusAreas?: string[]
  ): Promise<MCPResponse> {
    return this.sendRequest('tools/call', {
      name: 'llm',
      arguments: {
        operation: 'review_code',
        code,
        language,
        focusAreas,
      },
    });
  }

  /**
   * LLM: Chat with context
   */
  async llmChat(message: string, context?: string): Promise<MCPResponse> {
    return this.sendRequest('tools/call', {
      name: 'llm',
      arguments: {
        operation: 'chat',
        message,
        context,
      },
    });
  }

  /**
   * LLM: Generate code with workflow options
   */
  async llmGenerateWithWorkflow(
    prompt: string,
    language?: string,
    filePath?: string,
    commitMessage?: string,
    workflowStep?: string
  ): Promise<MCPResponse> {
    return this.sendRequest('tools/call', {
      name: 'llm',
      arguments: {
        operation: 'generate_with_workflow',
        prompt,
        language,
        filePath,
        commitMessage,
        workflowStep,
      },
    });
  }

  /**
   * LLM: Get workflow status
   */
  async llmGetWorkflowStatus(workflowId: string): Promise<MCPResponse> {
    return this.sendRequest('tools/call', {
      name: 'llm',
      arguments: {
        operation: 'get_workflow_status',
        workflowId,
      },
    });
  }

  private generateId(): string {
    return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Interactive CLI Client
 */
async function runInteractiveCLI() {
  const client = new MCPClient();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve);
    });
  };

  console.log('\n🚀 MCP Client - Interactive Mode');
  console.log('================================\n');

  try {
    // Check server health
    const tools = await client.listTools();
    if (!tools) {
      console.error('❌ Cannot connect to MCP server. Make sure it\'s running on http://localhost:3000');
      rl.close();
      return;
    }

    console.log('✅ Connected to MCP server\n');

    while (true) {
      console.log('\nAvailable commands:');
      console.log('1. vscode-open <filePath>');
      console.log('2. vscode-edit <filePath> <content>');
      console.log('3. vscode-generate <prompt> [language]');
      console.log('4. vscode-run <command>');
      console.log('5. github-repo-info');
      console.log('6. github-commit <message>');
      console.log('7. github-push <branch>');
      console.log('8. github-pr <title> <head>');
      console.log('9. llm-generate <prompt> [language]');
      console.log('10. llm-refactor <language> <instructions>');
      console.log('11. llm-review <language>');
      console.log('12. llm-chat <message>');
      console.log('13. llm-workflow <prompt> [language]');
      console.log('14. tools-list');
      console.log('15. exit\n');

      const input = await question('Enter command: ');
      const [cmd, ...args] = input.trim().split(' ');

      try {
        let response: MCPResponse;

        switch (cmd) {
          case 'vscode-open':
            response = await client.vsCodeOpenFile(args[0]);
            break;
          case 'vscode-edit':
            response = await client.vsCodeEditFile(
              args[0],
              args.slice(1).join(' ')
            );
            break;
          case 'vscode-generate':
            response = await client.vsCodeGenerateCode(
              args.join(' '),
              args[1]
            );
            break;
          case 'vscode-run':
            response = await client.vsCodeRunCommand(args[0]);
            break;
          case 'github-repo-info':
            response = await client.gitHubGetRepoInfo();
            break;
          case 'github-commit':
            response = await client.gitHubCommit(
              args.join(' '),
              { 'example.txt': 'example content' },
              'main'
            );
            break;
          case 'github-push':
            response = await client.gitHubPush(args[0] || 'main');
            break;
          case 'github-pr':
            response = await client.gitHubCreatePullRequest(
              args[0],
              args[1],
              'main'
            );
            break;
          case 'llm-generate':
            response = await client.llmGenerateCode(
              args.join(' '),
              args[1]
            );
            break;
          case 'llm-refactor':
            response = await client.llmRefactorCode(
              'sample code here',
              args[0],
              args.slice(1).join(' ')
            );
            break;
          case 'llm-review':
            response = await client.llmReviewCode(
              'sample code here',
              args[0]
            );
            break;
          case 'llm-chat':
            response = await client.llmChat(args.join(' '));
            break;
          case 'llm-workflow':
            response = await client.llmGenerateWithWorkflow(
              args.join(' '),
              args[1],
              undefined,
              undefined,
              'generate_and_insert'
            );
            break;
          case 'tools-list':
            const toolsData = await client.listTools();
            response = {
              id: 'cli',
              result: toolsData,
              jsonrpc: '2.0',
            };
            break;
          case 'exit':
            console.log('\n👋 Goodbye!');
            rl.close();
            return;
          default:
            console.log('❌ Unknown command');
            continue;
        }

        console.log('\n📮 Response:');
        console.log(JSON.stringify(response, null, 2));
      } catch (error) {
        console.error('❌ Error:', (error as Error).message);
      }
    }
  } finally {
    rl.close();
  }
}

// Run interactive CLI if called directly
if (require.main === module) {
  runInteractiveCLI().catch(console.error);
}

export default MCPClient;
