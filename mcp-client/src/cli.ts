#!/usr/bin/env node

/**
 * MCP Server Interactive CLI Client
 * Menu-driven interface for all 3 tools:
 * 1. LLM Tool (Generate, Refactor, Review, Chat)
 * 2. VS Code Tool (Open, Edit, Run Command)
 * 3. GitHub Tool (Commit, Push, Create PR, Get Repo Info)
 */

import axios, { AxiosError } from 'axios';
import * as readline from 'readline';

const API_URL = process.env.MCP_SERVER_URL || 'http://localhost:3000';

interface MCPRequest {
  jsonrpc: string;
  id: string;
  method: string;
  params: {
    name: string;
    arguments: Record<string, any>;
  };
}

interface MCPResponse {
  jsonrpc: string;
  id: string;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

class MCPCLIClient {
  private rl: readline.Interface;
  private requestId: number = 0;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  private async callMCP(
    toolName: string,
    operation: string,
    args: Record<string, any>
  ): Promise<MCPResponse> {
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: `cli-${++this.requestId}`,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: {
          operation,
          ...args,
        },
      },
    };

    try {
      const response = await axios.post<MCPResponse>(API_URL + '/rpc', request, {
        headers: { 'Content-Type': 'application/json' },
      });
      return response.data;
    } catch (error) {
      const axiosError = error as AxiosError;
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -1,
          message: axiosError.message || 'Request failed',
        },
      };
    }
  }

  private prompt(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, resolve);
    });
  }

  private printSection(title: string): void {
    console.log('\n' + '='.repeat(60));
    console.log(`  ${title}`);
    console.log('='.repeat(60) + '\n');
  }

  private printResult(result: any): void {
    console.log('\n📋 Response:');
    console.log(JSON.stringify(result, null, 2));
  }

  private printError(message: string): void {
    console.log('\n❌ Error: ' + message);
  }

  // ═════════════════════════════════════════════════════════════
  // LLM TOOL OPERATIONS
  // ═════════════════════════════════════════════════════════════

  private async llmMenu(): Promise<void> {
    let running = true;
    while (running) {
      this.printSection('🤖 LLM TOOL');
      console.log('1. Generate Code');
      console.log('2. Refactor Code');
      console.log('3. Review Code');
      console.log('4. Chat');
      console.log('5. Generate with Workflow');
      console.log('0. Back to Main Menu\n');

      const choice = await this.prompt('Choose operation (0-5): ');

      switch (choice) {
        case '1':
          await this.llmGenerateCode();
          break;
        case '2':
          await this.llmRefactorCode();
          break;
        case '3':
          await this.llmReviewCode();
          break;
        case '4':
          await this.llmChat();
          break;
        case '5':
          await this.llmGenerateWithWorkflow();
          break;
        case '0':
          running = false;
          break;
        default:
          this.printError('Invalid choice');
      }

      if (running && choice !== '0') {
        await this.prompt('\nPress Enter to continue...');
      }
    }
  }

  private async llmGenerateCode(): Promise<void> {
    this.printSection('Generate Code');
    const prompt = await this.prompt('Enter prompt: ');
    const language = await this.prompt(
      'Language (typescript/python/javascript) [default: typescript]: '
    ) || 'typescript';
    const context = await this.prompt('Context (optional): ');

    const response = await this.callMCP('llm', 'generate_code', {
      prompt,
      language,
      context: context || undefined,
    });

    if (response.result) {
      console.log('\n✅ Code Generated:\n');
      console.log(response.result.code);
      this.printResult(response.result);
    } else {
      this.printError(response.error?.message || 'Generation failed');
    }
  }

  private async llmRefactorCode(): Promise<void> {
    this.printSection('Refactor Code');
    const code = await this.prompt('Paste code to refactor: ');
    const language = await this.prompt('Language (default: typescript): ') || 'typescript';
    const instructions = await this.prompt('Refactoring instructions: ');

    const response = await this.callMCP('llm', 'refactor_code', {
      code,
      language,
      instructions,
    });

    if (response.result) {
      console.log('\n✅ Refactored Code:\n');
      console.log(response.result.refactoredCode);
      this.printResult(response.result);
    } else {
      this.printError(response.error?.message || 'Refactoring failed');
    }
  }

  private async llmReviewCode(): Promise<void> {
    this.printSection('Review Code');
    const code = await this.prompt('Paste code to review: ');
    const language = await this.prompt('Language (default: typescript): ') || 'typescript';
    const focusAreas = await this.prompt(
      'Focus areas (comma-separated, e.g., security,performance): '
    );

    const response = await this.callMCP('llm', 'review_code', {
      code,
      language,
      focusAreas: focusAreas
        ? focusAreas.split(',').map((a) => a.trim())
        : undefined,
    });

    if (response.result) {
      const review = response.result.review;
      console.log(`\n✅ Code Review Results:`);
      console.log(`Quality Score: ${review.overallQuality}/10`);
      console.log(`Issues Found: ${review.issues.length}`);
      console.log(`\nSummary: ${review.summary}`);
      if (review.suggestions.length > 0) {
        console.log('\nSuggestions:');
        review.suggestions.forEach((s: string, i: number) => {
          console.log(`  ${i + 1}. ${s}`);
        });
      }
      this.printResult(response.result);
    } else {
      this.printError(response.error?.message || 'Review failed');
    }
  }

  private async llmChat(): Promise<void> {
    this.printSection('Chat with AI');
    const message = await this.prompt('Your question: ');
    const context = await this.prompt('Context (optional): ');

    const response = await this.callMCP('llm', 'chat', {
      message,
      context: context || undefined,
    });

    if (response.result) {
      console.log(`\n💬 AI Response:\n${response.result.response}`);
      this.printResult(response.result);
    } else {
      this.printError(response.error?.message || 'Chat failed');
    }
  }

  private async llmGenerateWithWorkflow(): Promise<void> {
    this.printSection('Generate Code with Workflow');
    const prompt = await this.prompt('Enter code generation prompt: ');
    const language = await this.prompt('Language (default: typescript): ') || 'typescript';
    const filePath = await this.prompt('File path (e.g., src/app.ts): ');
    const commitMessage = await this.prompt('Commit message: ');

    const response = await this.callMCP('llm', 'generate_with_workflow', {
      prompt,
      language,
      filePath,
      commitMessage,
    });

    if (response.result) {
      console.log('\n✅ Workflow Created!');
      console.log(`Workflow ID: ${response.result.workflow.id}`);
      console.log(`Status: ${response.result.workflow.status}`);
      this.printResult(response.result);
    } else {
      this.printError(response.error?.message || 'Workflow creation failed');
    }
  }

  // ═════════════════════════════════════════════════════════════
  // VS CODE TOOL OPERATIONS
  // ═════════════════════════════════════════════════════════════

  private async vsCodeMenu(): Promise<void> {
    let running = true;
    while (running) {
      this.printSection('📝 VS CODE TOOL');
      console.log('1. Open File');
      console.log('2. Edit/Create File');
      console.log('3. Run Command');
      console.log('0. Back to Main Menu\n');

      const choice = await this.prompt('Choose operation (0-3): ');

      switch (choice) {
        case '1':
          await this.vsCodeOpenFile();
          break;
        case '2':
          await this.vsCodeEditFile();
          break;
        case '3':
          await this.vsCodeRunCommand();
          break;
        case '0':
          running = false;
          break;
        default:
          this.printError('Invalid choice');
      }

      if (running && choice !== '0') {
        await this.prompt('\nPress Enter to continue...');
      }
    }
  }

  private async vsCodeOpenFile(): Promise<void> {
    this.printSection('Open File');
    const filePath = await this.prompt('File path (relative to workspace): ');

    const response = await this.callMCP('vs-code', 'open_file', { filePath });

    if (response.result) {
      console.log('\n✅ File Contents:\n');
      console.log(response.result.content);
      this.printResult(response.result);
    } else {
      this.printError(response.error?.message || 'Failed to open file');
    }
  }

  private async vsCodeEditFile(): Promise<void> {
    this.printSection('Edit/Create File');
    const filePath = await this.prompt('File path: ');
    console.log('Paste file content (press Ctrl+D when done):');
    let content = '';
    for await (const line of this.rl) {
      content += line + '\n';
    }

    const response = await this.callMCP('vs-code', 'edit_file', {
      filePath,
      content,
    });

    if (response.result) {
      console.log('\n✅ File updated!');
      this.printResult(response.result);
    } else {
      this.printError(response.error?.message || 'Failed to edit file');
    }
  }

  private async vsCodeRunCommand(): Promise<void> {
    this.printSection('Run Command');
    const command = await this.prompt('Command: ');
    const argsStr = await this.prompt('Arguments (comma-separated, optional): ');
    const args = argsStr ? argsStr.split(',').map((a) => a.trim()) : undefined;

    const response = await this.callMCP('vs-code', 'run_command', {
      command,
      args,
    });

    if (response.result) {
      console.log('\n✅ Command Output:\n');
      console.log(response.result.stdout);
      this.printResult(response.result);
    } else {
      this.printError(response.error?.message || 'Command failed');
    }
  }

  // ═════════════════════════════════════════════════════════════
  // GITHUB TOOL OPERATIONS
  // ═════════════════════════════════════════════════════════════

  private async gitHubMenu(): Promise<void> {
    let running = true;
    while (running) {
      this.printSection('🐙 GITHUB TOOL');
      console.log('1. Get Repository Info');
      console.log('2. Commit Changes');
      console.log('3. Push to Remote');
      console.log('4. Create Pull Request');
      console.log('0. Back to Main Menu\n');

      const choice = await this.prompt('Choose operation (0-4): ');

      switch (choice) {
        case '1':
          await this.gitHubGetRepoInfo();
          break;
        case '2':
          await this.gitHubCommit();
          break;
        case '3':
          await this.gitHubPush();
          break;
        case '4':
          await this.gitHubCreatePR();
          break;
        case '0':
          running = false;
          break;
        default:
          this.printError('Invalid choice');
      }

      if (running && choice !== '0') {
        await this.prompt('\nPress Enter to continue...');
      }
    }
  }

  private async gitHubGetRepoInfo(): Promise<void> {
    this.printSection('Get Repository Info');

    const response = await this.callMCP('github', 'get_repo_info', {});

    if (response.result) {
      const info = response.result.repo;
      console.log('\n✅ Repository Information:');
      console.log(`Name: ${info.name}`);
      console.log(`URL: ${info.url}`);
      console.log(`Branch: ${info.defaultBranch}`);
      console.log(`Stars: ${info.stars}`);
      this.printResult(response.result);
    } else {
      this.printError(response.error?.message || 'Failed to get repo info');
    }
  }

  private async gitHubCommit(): Promise<void> {
    this.printSection('Commit Changes');
    const message = await this.prompt('Commit message: ');
    const branch = await this.prompt('Branch (default: main): ') || 'main';

    console.log('Enter files to commit (one per line, format: path:content)');
    console.log('Press Ctrl+D when done:\n');

    const files: Record<string, string> = {};
    // For simplicity, ask for single file
    const filePath = await this.prompt('File path: ');
    const content = await this.prompt('File content: ');
    files[filePath] = content;

    const response = await this.callMCP('github', 'commit', {
      message,
      files,
      branch,
    });

    if (response.result) {
      console.log('\n✅ Commit successful!');
      console.log(`SHA: ${response.result.commit.sha}`);
      this.printResult(response.result);
    } else {
      this.printError(response.error?.message || 'Commit failed');
    }
  }

  private async gitHubPush(): Promise<void> {
    this.printSection('Push to Remote');
    const branch = await this.prompt('Branch name: ');

    const response = await this.callMCP('github', 'push', { branch });

    if (response.result) {
      console.log('\n✅ Push successful!');
      this.printResult(response.result);
    } else {
      this.printError(response.error?.message || 'Push failed');
    }
  }

  private async gitHubCreatePR(): Promise<void> {
    this.printSection('Create Pull Request');
    const title = await this.prompt('PR title: ');
    const head = await this.prompt('Head branch (feature branch): ');
    const base = await this.prompt('Base branch (default: main): ') || 'main';
    const description = await this.prompt('Description (optional): ');
    const labelsStr = await this.prompt(
      'Labels (comma-separated, optional): '
    );
    const labels = labelsStr ? labelsStr.split(',').map((l) => l.trim()) : [];

    const response = await this.callMCP('github', 'create_pull_request', {
      title,
      head,
      base,
      description: description || undefined,
      labels: labels.length > 0 ? labels : undefined,
    });

    if (response.result) {
      console.log('\n✅ Pull Request created!');
      console.log(`PR #${response.result.pullRequest.number}`);
      console.log(`URL: ${response.result.pullRequest.url}`);
      this.printResult(response.result);
    } else {
      this.printError(response.error?.message || 'PR creation failed');
    }
  }

  // ═════════════════════════════════════════════════════════════
  // MAIN MENU
  // ═════════════════════════════════════════════════════════════

  public async start(): Promise<void> {
    console.clear();
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║         🚀 MCP Server - Interactive CLI Client            ║
║                                                           ║
║    Connect to MCP Server at: ${API_URL}            ║
╚═══════════════════════════════════════════════════════════╝
    `);

    let running = true;
    while (running) {
      this.printSection('MAIN MENU - Choose a Tool');
      console.log('1. 🤖 LLM Tool (Generate, Refactor, Review, Chat)');
      console.log('2. 📝 VS Code Tool (Open, Edit, Run Commands)');
      console.log('3. 🐙 GitHub Tool (Commit, Push, Create PR)');
      console.log('4. ℹ️  Server Info');
      console.log('0. Exit\n');

      const choice = await this.prompt('Choose tool (0-4): ');

      switch (choice) {
        case '1':
          await this.llmMenu();
          break;
        case '2':
          await this.vsCodeMenu();
          break;
        case '3':
          await this.gitHubMenu();
          break;
        case '4':
          await this.serverInfo();
          break;
        case '0':
          running = false;
          console.log('\n👋 Goodbye!');
          break;
        default:
          this.printError('Invalid choice');
      }
    }

    this.rl.close();
    process.exit(0);
  }

  private async serverInfo(): Promise<void> {
    this.printSection('Server Information');

    try {
      const response = await axios.get(`${API_URL}/tools`);
      console.log('✅ Server Status: Connected\n');
      console.log('Available Tools:');
      response.data.tools.forEach((tool: any) => {
        console.log(`\n  📌 ${tool.name}`);
        console.log(`     Description: ${tool.description}`);
        if (tool.inputSchema?.properties) {
          const ops = Object.keys(tool.inputSchema.properties);
          console.log(`     Operations: ${ops.join(', ')}`);
        }
      });
      this.printResult(response.data);
    } catch (error) {
      this.printError('Cannot connect to MCP Server. Is it running?');
    }

    await this.prompt('\nPress Enter to continue...');
  }
}

// ═════════════════════════════════════════════════════════════
// RUN CLI
// ═════════════════════════════════════════════════════════════

const client = new MCPCLIClient();
client.start().catch(console.error);
