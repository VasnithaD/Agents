import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { MCPRequest, MCPResponse } from './types';
import { MCPServerHandler } from './handlers';
import { VSCodeHandler } from './handlers/vscode-handler';
import { GitHubHandler } from './handlers/github-handler';
import { LLMHandler } from './handlers/llm-handler';
import { AgentHandler } from './handlers/agent-handler';
import { getHPEClient } from './handlers/hpe-client';
import { initializeRAG, ragRetriever } from './rag/retriever';

// Load .env from the project root regardless of cwd
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const execAsync = promisify(exec);

const app = express();
app.use(express.json({ limit: '10mb' }));
// NOTE: express.static is registered AFTER all API routes (see bottom of file)
// to prevent it from intercepting /api/* paths and returning index.html.

// ─── Mutable workspace state ───
let workspacePath: string = process.env.VSCODE_WORKSPACE_PATH || process.cwd();

// ─── Utility: translate common Unix commands for Windows PowerShell ───
function translateCommand(command: string): { translated: string; blocked: string | null } {
  const t = command.trim();
  // Editor commands — redirect to UI
  if (/^(nano|vim|vi|emacs)\b/.test(t)) {
    const file = t.split(/\s+/)[1] || '';
    const hint = file ? ` Open '${file}' via the File Explorer panel instead.` : '';
    return { translated: '', blocked: `'${t.split(' ')[0]}' is a GUI editor — not available here.${hint}` };
  }
  // Common Unix → PowerShell translations
  let cmd = t;
  cmd = cmd.replace(/^ls(\s|$)/, 'Get-ChildItem$1');
  cmd = cmd.replace(/^ll(\s|$)/, 'Get-ChildItem -Force$1');
  cmd = cmd.replace(/^la(\s|$)/, 'Get-ChildItem -Force$1');
  cmd = cmd.replace(/^cat\s+/, 'Get-Content ');
  cmd = cmd.replace(/^grep\s+/, 'Select-String ');
  cmd = cmd.replace(/^touch\s+/, 'New-Item -ItemType File -Force -Path ');
  cmd = cmd.replace(/^rm\s+-rf\s+/, 'Remove-Item -Recurse -Force ');
  cmd = cmd.replace(/^rm\s+-r\s+/, 'Remove-Item -Recurse -Force ');
  cmd = cmd.replace(/^rm\s+/, 'Remove-Item -Force ');
  cmd = cmd.replace(/^cp\s+/, 'Copy-Item ');
  cmd = cmd.replace(/^mv\s+/, 'Move-Item ');
  cmd = cmd.replace(/^mkdir\s+-p\s+/, 'New-Item -ItemType Directory -Force -Path ');
  cmd = cmd.replace(/^mkdir\s+/, 'New-Item -ItemType Directory -Force -Path ');
  cmd = cmd.replace(/^pwd$/, '(Get-Location).Path');
  cmd = cmd.replace(/^clear$/, 'Clear-Host');
  cmd = cmd.replace(/^which\s+/, 'Get-Command ');
  cmd = cmd.replace(/^env$/, 'Get-ChildItem Env: | Format-Table -AutoSize');
  cmd = cmd.replace(/^echo\s+/, 'Write-Output ');
  cmd = cmd.replace(/^head\s+-n\s+(\d+)\s+/, 'Get-Content $2 -TotalCount $1 ');
  cmd = cmd.replace(/^tail\s+-n\s+(\d+)\s+/, '(Get-Content $2 -Tail $1) ');
  cmd = cmd.replace(/^find\s+\.\s+-name\s+/, 'Get-ChildItem -Recurse -Filter ');
  cmd = cmd.replace(/^curl\s+/, 'Invoke-WebRequest ');
  cmd = cmd.replace(/^wget\s+/, 'Invoke-WebRequest -Uri ');
  return { translated: cmd, blocked: null };
}

// Initialize handlers
const vsCodeHandler = new VSCodeHandler(workspacePath);

const gitHubHandler = new GitHubHandler(
  process.env.GITHUB_TOKEN || '',
  process.env.GITHUB_OWNER || '',
  process.env.GITHUB_REPO || '',
  workspacePath
);

const llmHandler = new LLMHandler();
const agentHandler = new AgentHandler(workspacePath);

const mcpHandler = new MCPServerHandler(vsCodeHandler, gitHubHandler, llmHandler);

// ═══════════════════════════════════════════════════
// ORIGINAL MCP ENDPOINTS
// ═══════════════════════════════════════════════════

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', server: 'MCP Server', workspace: workspacePath });
});

// ── Model picker endpoint — like GitHub Copilot's model selector ──
app.get('/api/models', (_req: Request, res: Response) => {
  res.json({
    success: true,
    default: process.env.LLM_MODEL_NAME || 'gpt-4o-mini',
    models: llmHandler.listModels(),
  });
});

// ── AST-based symbol retrieval (PRECISE, non-chunked) ──
app.post('/api/ast/symbol', (req: Request, res: Response) => {
  try {
    const { symbolName } = req.body;
    if (!symbolName || typeof symbolName !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing symbolName' });
    }

    const result = ragRetriever.retrieveSymbol(symbolName);
    if (!result) {
      return res.status(404).json({ 
        success: false, 
        error: `Symbol '${symbolName}' not found in AST index` 
      });
    }

    res.json({
      success: true,
      symbolName,
      type: result.symbol.type,
      filePath: result.symbol.filePath,
      lineStart: result.symbol.lineStart,
      lineEnd: result.symbol.lineEnd,
      content: result.context,
      size: result.context.length,
      lines: result.context.split('\n').length,
    });
  } catch (error) {
    console.error('AST symbol retrieval error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ── Retrieve all methods in a class ──
app.post('/api/ast/class/methods', (req: Request, res: Response) => {
  try {
    const { className } = req.body;
    if (!className || typeof className !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing className' });
    }

    const methods = ragRetriever.retrieveClassMethods(className);
    if (methods.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: `No methods found for class '${className}'` 
      });
    }

    res.json({
      success: true,
      className,
      methods: methods.map(m => ({
        name: m.name,
        signature: m.signature,
        lineStart: m.lineStart,
        lineEnd: m.lineEnd,
        content: m.content,
      })),
      methodCount: methods.length,
    });
  } catch (error) {
    console.error('AST class methods error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ── Reconstruct complete file ──
app.post('/api/ast/file/complete', (req: Request, res: Response) => {
  try {
    const { className } = req.body;
    if (!className || typeof className !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing className' });
    }

    const result = ragRetriever.retrieveCompleteFile(className);
    if (!result) {
      return res.status(404).json({ 
        success: false, 
        error: `Could not reconstruct file for class '${className}'` 
      });
    }

    res.json({
      success: true,
      className,
      content: result.content,
      symbolCount: result.symbols.length,
      size: result.content.length,
      lines: result.content.split('\n').length,
    });
  } catch (error) {
    console.error('AST file reconstruction error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ── Find files containing a symbol ──
app.post('/api/ast/symbol/files', (req: Request, res: Response) => {
  try {
    const { symbolName } = req.body;
    if (!symbolName || typeof symbolName !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing symbolName' });
    }

    const files = ragRetriever.retrieveFilesWithSymbol(symbolName);
    if (files.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: `No files found containing symbol '${symbolName}'` 
      });
    }

    res.json({
      success: true,
      symbolName,
      files,
      fileCount: files.length,
    });
  } catch (error) {
    console.error('AST symbol files error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// List tools endpoint
app.get('/tools', (req: Request, res: Response) => {
  try {
    const tools = mcpHandler.getTools();
    res.json({ success: true, tools });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Main MCP endpoint
app.post('/rpc', async (req: Request, res: Response) => {
  try {
    const request: MCPRequest = req.body;
    if (!request.method || !request.jsonrpc) {
      res.status(400).json({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' }, id: request.id || null });
      return;
    }
    const response: MCPResponse = await mcpHandler.handleRequest(request);
    res.json(response);
  } catch (error) {
    res.status(500).json({
      jsonrpc: '2.0',
      error: { code: -32603, message: 'Internal error', data: { details: (error as Error).message } },
      id: (req.body as any).id || null,
    });
  }
});

// Batch RPC endpoint
app.post('/batch', async (req: Request, res: Response) => {
  try {
    const requests: MCPRequest[] = Array.isArray(req.body) ? req.body : [req.body];
    const responses: MCPResponse[] = await Promise.all(requests.map(r => mcpHandler.handleRequest(r)));
    res.json(responses);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// ═══════════════════════════════════════════════════
// NEW REST API ENDPOINTS
// ═══════════════════════════════════════════════════

// ── Workspace ──
app.get('/api/workspace', (req: Request, res: Response) => {
  res.json({ success: true, path: workspacePath });
});

app.post('/api/workspace/change', (req: Request, res: Response) => {
  const { newPath } = req.body;
  if (!newPath) return res.status(400).json({ success: false, error: 'newPath required' });
  if (!fs.existsSync(newPath)) return res.status(400).json({ success: false, error: 'Path does not exist' });
  workspacePath = newPath;
  vsCodeHandler.setWorkspace(newPath);
  agentHandler.setWorkspace(newPath);
  gitHubHandler.setLocalRepoPath(newPath);
  res.json({ success: true, path: workspacePath });
});

// ── Token refresh — no restart needed ──
// POST /api/auth/token  { "token": "eyJ..." }
app.post('/api/auth/token', (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  if (!token || !token.trim()) {
    return res.status(400).json({ success: false, error: 'token required' });
  }
  try {
    getHPEClient().updateToken(token);
    res.json({ success: true, message: 'HPE Bearer token updated — no restart needed' });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ── Terminal ──
const BLOCKED_PATTERNS = ['rm -rf /', 'del /f /s /q c:', 'format c:', 'mkfs', 'dd if=/dev/zero'];

app.post('/api/terminal/exec', async (req: Request, res: Response) => {
  const { command, cwd } = req.body;
  if (!command) return res.status(400).json({ success: false, error: 'command required' });

  const execCwd = (cwd && fs.existsSync(cwd)) ? cwd : workspacePath;

  // Handle cd specially — resolve the new directory and return it
  const cdMatch = command.trim().match(/^cd\s+(.+)$/);
  if (cdMatch) {
    try {
      const target = cdMatch[1].trim().replace(/["\']/g, '');
      const newDir = path.resolve(execCwd, target);
      if (fs.existsSync(newDir) && fs.statSync(newDir).isDirectory()) {
        return res.json({ success: true, stdout: '', stderr: '', exitCode: 0, cwd: newDir });
      } else {
        return res.json({ success: false, stdout: '', stderr: `cd: no such directory: ${target}`, exitCode: 1, cwd: execCwd });
      }
    } catch (e: any) {
      return res.json({ success: false, stdout: '', stderr: e.message, exitCode: 1, cwd: execCwd });
    }
  }

  // Translate / block unsafe or unsupported commands
  const { translated, blocked } = translateCommand(command);
  if (blocked) {
    return res.json({ success: true, stdout: blocked, stderr: '', exitCode: 0, cwd: execCwd });
  }

  const lowerCmd = translated.toLowerCase();
  if (BLOCKED_PATTERNS.some(p => lowerCmd.includes(p))) {
    return res.status(403).json({ success: false, error: 'Command blocked for safety', stdout: '', stderr: 'Blocked', exitCode: 1, cwd: execCwd });
  }

  try {
    // Wrap in a subshell that also prints the final CWD as a sentinel line
    const sentinelKey = '__CWD__';
    const psCmd = `powershell.exe -ExecutionPolicy Bypass -NoProfile -Command "& { ${translated.replace(/"/g, '\\"')}; Write-Output '${sentinelKey}' + (Get-Location).Path }"`;
    const { stdout, stderr } = await execAsync(psCmd, {
      cwd: execCwd,
      timeout: 60000,
      maxBuffer: 1024 * 1024 * 10,
    });

    // Extract sentinel CWD from last line if present
    let newCwd = execCwd;
    let cleanStdout = stdout || '';
    const lines = cleanStdout.split(/\r?\n/);
    const sentinelIdx = lines.findLastIndex((l: string) => l.startsWith(sentinelKey));
    if (sentinelIdx !== -1) {
      const candidateCwd = lines[sentinelIdx].slice(sentinelKey.length).trim();
      if (candidateCwd && fs.existsSync(candidateCwd)) newCwd = candidateCwd;
      lines.splice(sentinelIdx, 1);
      cleanStdout = lines.join('\n');
    }

    res.json({ success: true, stdout: cleanStdout.trimEnd(), stderr: (stderr || '').trimEnd(), exitCode: 0, cwd: newCwd });
  } catch (error: any) {
    res.json({
      success: false,
      stdout: (error.stdout || '').trimEnd(),
      stderr: (error.stderr || error.message || '').trimEnd(),
      exitCode: error.code || 1,
      cwd: execCwd,
    });
  }
});

// ── AI Agent Orchestrator ──
app.post('/api/agent', async (req: Request, res: Response) => {
  try {
    const { prompt, contextFiles, modelId, forceOverwrite } = req.body;
    if (!prompt) return res.status(400).json({ success: false, error: 'prompt required' });

    // contextFiles: optional array of workspace-relative paths whose content
    // is injected into the prompt (e.g. a TDS JSON file).
    const result = await agentHandler.executeTask(
      prompt,
      Array.isArray(contextFiles) ? contextFiles : [],
      modelId,
      forceOverwrite === true,
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Agent failed',
      filesWritten: [],
      fileContents: {},
      error: (error as Error).message,
    });
  }
});

// ── GitHub REST endpoints ──
app.get('/api/github/status', (req: Request, res: Response) => {
  const token = process.env.GITHUB_TOKEN || '';
  const owner = process.env.GITHUB_OWNER || '';
  const repo  = process.env.GITHUB_REPO  || '';
  res.json({
    configured: !!(token && owner && repo),
    owner,
    repo,
    tokenPresent: token.length > 0,
    tokenPreview: token ? token.substring(0, 4) + '…' : '(not set)',
  });
});

app.get('/api/github/info', async (req: Request, res: Response) => {
  try {
    const request: MCPRequest = {
      jsonrpc: '2.0', id: '1', method: 'tools/call',
      params: { name: 'github', arguments: { operation: 'get_repo_info' } },
    };
    const response = await mcpHandler.handleRequest(request);
    res.json(response.result || response);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

app.get('/api/github/repos', async (req: Request, res: Response) => {
  try {
    const octokit = (gitHubHandler as any).octokit;
    const owner   = process.env.GITHUB_OWNER || '';
    if (!octokit || !owner) return res.status(400).json({ success: false, error: 'GitHub not configured' });
    const { data } = await octokit.rest.repos.listForUser({ username: owner, per_page: 50, sort: 'updated' });
    res.json({ success: true, repos: data.map((r: any) => ({ name: r.name, fullName: r.full_name, private: r.private, url: r.html_url, defaultBranch: r.default_branch })) });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.get('/api/github/branches', async (req: Request, res: Response) => {
  try {
    const octokit = (gitHubHandler as any).octokit;
    const owner   = process.env.GITHUB_OWNER || '';
    const repo    = req.query.repo as string || process.env.GITHUB_REPO || '';
    if (!octokit || !owner || !repo) return res.status(400).json({ success: false, error: 'GitHub not configured or repo missing' });
    const { data } = await octokit.rest.repos.listBranches({ owner, repo, per_page: 50 });
    res.json({ success: true, branches: data.map((b: any) => ({ name: b.name, sha: b.commit.sha.substring(0, 8) })) });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post('/api/github/branch', async (req: Request, res: Response) => {
  try {
    const { branchName, fromBranch, repo } = req.body;
    if (!branchName) return res.status(400).json({ success: false, error: 'branchName required' });
    const octokit = (gitHubHandler as any).octokit;
    const owner   = process.env.GITHUB_OWNER || '';
    const repoName = repo || process.env.GITHUB_REPO || '';
    if (!octokit || !owner || !repoName) return res.status(400).json({ success: false, error: 'GitHub not configured' });
    // Resolve source branch: use provided value, or fall back to the repo's actual default branch
    let sourceBranch = fromBranch;
    if (!sourceBranch) {
      const { data: repoInfo } = await octokit.rest.repos.get({ owner, repo: repoName });
      sourceBranch = repoInfo.default_branch;
    }
    const { data: refData } = await octokit.rest.git.getRef({ owner, repo: repoName, ref: `heads/${sourceBranch}` });
    const { data: newRef }  = await octokit.rest.git.createRef({ owner, repo: repoName, ref: `refs/heads/${branchName}`, sha: refData.object.sha });
    res.json({ success: true, branch: branchName, sha: newRef.object.sha.substring(0, 8), basedOn: sourceBranch });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ── GitHub: dynamic repo exploration & workflow ──

// GET /api/github/repo-tree?repo=X&branch=Y — full recursive file tree
app.get('/api/github/repo-tree', async (req: Request, res: Response) => {
  try {
    const repo   = req.query.repo   as string;
    const branch = req.query.branch as string;
    if (!repo || !branch) return res.status(400).json({ success: false, error: 'repo and branch required' });
    const tree = await gitHubHandler.getRepoTree(repo, branch);
    res.json({ success: true, tree });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// GET /api/github/file-content?repo=X&branch=Y&path=Z — read a file from GitHub
app.get('/api/github/file-content', async (req: Request, res: Response) => {
  try {
    const repo     = req.query.repo   as string;
    const branch   = req.query.branch as string;
    const filePath = req.query.path   as string;
    if (!repo || !branch || !filePath) {
      return res.status(400).json({ success: false, error: 'repo, branch, path required' });
    }
    const result = await gitHubHandler.getFileContent(repo, filePath, branch);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// POST /api/github/commit-file — create branch + commit file in one shot
app.post('/api/github/commit-file', async (req: Request, res: Response) => {
  try {
    const { repo, newBranch, fromBranch, filePath, content, message } = req.body;
    if (!repo || !newBranch || !fromBranch || !filePath || content === undefined || !message) {
      return res.status(400).json({ success: false, error: 'repo, newBranch, fromBranch, filePath, content, message all required' });
    }
    const result = await gitHubHandler.commitFileToNewBranch({ repo, newBranch, fromBranch, filePath, content, message });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// POST /api/github/create-pr — open a pull request
app.post('/api/github/create-pr', async (req: Request, res: Response) => {
  try {
    const { repo, head, base, title, body } = req.body;
    if (!repo || !head || !base || !title) {
      return res.status(400).json({ success: false, error: 'repo, head, base, title required' });
    }
    const owner   = process.env.GITHUB_OWNER || '';
    const octokit = (gitHubHandler as any).octokit;
    if (!octokit || !owner) return res.status(400).json({ success: false, error: 'GitHub not configured' });
    const { data: prData } = await octokit.rest.pulls.create({
      owner, repo, title, body: body || '', head, base,
    });
    res.json({
      success: true,
      pr: { number: prData.number, url: prData.html_url, title: prData.title, state: prData.state },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// GET /api/github/pulls?repo=X&state=open|closed|all — list pull requests
app.get('/api/github/pulls', async (req: Request, res: Response) => {
  try {
    const repo  = req.query.repo  as string || process.env.GITHUB_REPO || '';
    const state = (req.query.state as 'open' | 'closed' | 'all') || 'open';
    const owner = process.env.GITHUB_OWNER || '';
    const octokit = (gitHubHandler as any).octokit;
    if (!octokit || !owner || !repo) return res.status(400).json({ success: false, error: 'GitHub not configured' });
    const { data } = await octokit.rest.pulls.list({ owner, repo, state, per_page: 30 });
    res.json({
      success: true,
      pulls: data.map((p: any) => ({
        number: p.number, title: p.title, state: p.state,
        url: p.html_url, head: p.head.ref, base: p.base.ref,
        author: p.user?.login, createdAt: p.created_at,
        mergeable: p.mergeable,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// POST /api/github/merge-pr — merge a pull request
app.post('/api/github/merge-pr', async (req: Request, res: Response) => {
  try {
    const { repo, pull_number, merge_method = 'squash', commit_title } = req.body;
    if (!repo || !pull_number) return res.status(400).json({ success: false, error: 'repo, pull_number required' });
    const owner   = process.env.GITHUB_OWNER || '';
    const octokit = (gitHubHandler as any).octokit;
    if (!octokit || !owner) return res.status(400).json({ success: false, error: 'GitHub not configured' });
    const { data } = await octokit.rest.pulls.merge({
      owner, repo, pull_number: Number(pull_number),
      merge_method, commit_title: commit_title || undefined,
    });
    res.json({ success: true, merged: data.merged, sha: data.sha, message: data.message });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// GET /api/github/file-history?repo=X&branch=Y&path=Z — commit history for a file
app.get('/api/github/file-history', async (req: Request, res: Response) => {
  try {
    const repo   = req.query.repo   as string;
    const branch = req.query.branch as string;
    const path   = req.query.path   as string;
    if (!repo || !path) return res.status(400).json({ success: false, error: 'repo, path required' });
    const owner   = process.env.GITHUB_OWNER || '';
    const octokit = (gitHubHandler as any).octokit;
    if (!octokit || !owner) return res.status(400).json({ success: false, error: 'GitHub not configured' });
    const { data } = await octokit.rest.repos.listCommits({
      owner, repo, path, sha: branch || undefined, per_page: 20,
    });
    res.json({
      success: true,
      commits: data.map((c: any) => ({
        sha: c.sha.substring(0, 8), fullSha: c.sha,
        message: c.commit.message.split('\n')[0],
        author: c.commit.author?.name || c.author?.login || 'unknown',
        date: c.commit.author?.date,
        url: c.html_url,
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// DELETE /api/github/branch — delete a branch
app.delete('/api/github/branch', async (req: Request, res: Response) => {
  try {
    const { repo, branch } = req.body;
    if (!repo || !branch) return res.status(400).json({ success: false, error: 'repo, branch required' });
    const owner   = process.env.GITHUB_OWNER || '';
    const octokit = (gitHubHandler as any).octokit;
    if (!octokit || !owner) return res.status(400).json({ success: false, error: 'GitHub not configured' });
    await octokit.rest.git.deleteRef({ owner, repo, ref: `heads/${branch}` });
    res.json({ success: true, deleted: branch });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ── ZIP download: POST /api/download/zip  { files: [{name, content}], zipName } ──
app.post('/api/download/zip', (req: Request, res: Response) => {
  try {
    const { files, zipName = 'project' } = req.body as {
      files: { name: string; content: string }[];
      zipName?: string;
    };
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files provided' });
    }

    // Build a minimal ZIP in-memory (pure Node.js, no extra npm packages)
    // Uses the ZIP local-file + central-directory format (Store method, no compression)
    const encoder  = new TextEncoder();
    const localHdrs: Buffer[] = [];
    const central:  Buffer[] = [];
    let   offset = 0;

    for (const f of files) {
      const nameBuf    = Buffer.from(f.name,    'utf8');
      const contentBuf = Buffer.from(f.content, 'utf8');
      const crc        = crc32(contentBuf);
      const size       = contentBuf.length;

      // Local file header
      const local = Buffer.alloc(30 + nameBuf.length);
      local.writeUInt32LE(0x04034b50, 0);  // signature
      local.writeUInt16LE(20, 4);           // version needed
      local.writeUInt16LE(0,  6);           // flags
      local.writeUInt16LE(0,  8);           // compression: store
      local.writeUInt16LE(0,  10);          // mod time
      local.writeUInt16LE(0,  12);          // mod date
      local.writeUInt32LE(crc,  14);
      local.writeUInt32LE(size, 18);
      local.writeUInt32LE(size, 22);
      local.writeUInt16LE(nameBuf.length, 26);
      local.writeUInt16LE(0, 28);
      nameBuf.copy(local, 30);

      // Central directory entry
      const cent = Buffer.alloc(46 + nameBuf.length);
      cent.writeUInt32LE(0x02014b50, 0);   // signature
      cent.writeUInt16LE(20, 4);            // version made by
      cent.writeUInt16LE(20, 6);            // version needed
      cent.writeUInt16LE(0,  8);            // flags
      cent.writeUInt16LE(0,  10);           // compression
      cent.writeUInt16LE(0,  12);
      cent.writeUInt16LE(0,  14);
      cent.writeUInt32LE(crc,  16);
      cent.writeUInt32LE(size, 20);
      cent.writeUInt32LE(size, 24);
      cent.writeUInt16LE(nameBuf.length, 28);
      cent.writeUInt16LE(0,  30);
      cent.writeUInt16LE(0,  32);
      cent.writeUInt16LE(0,  34);
      cent.writeUInt16LE(0,  36);
      cent.writeUInt32LE(0,  38);
      cent.writeUInt32LE(offset, 42);
      nameBuf.copy(cent, 46);

      localHdrs.push(local, contentBuf);
      central.push(cent);
      offset += local.length + contentBuf.length;
    }

    const centBuf  = Buffer.concat(central);
    const eocd     = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(centBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);

    const zip = Buffer.concat([...localHdrs, centBuf, eocd]);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}.zip"`);
    res.send(zip);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/** Simple CRC-32 for ZIP integrity (no external deps) */
function crc32(buf: Buffer): number {
  let crc = 0xFFFFFFFF;
  const table = crc32Table();
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
let _crc32Table: Uint32Array | null = null;
function crc32Table(): Uint32Array {
  if (_crc32Table) return _crc32Table;
  _crc32Table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    _crc32Table[i] = c;
  }
  return _crc32Table;
}

// ── Eval endpoint: POST /api/eval  { code, keywords, tdsContent } ─────────────
app.post('/api/eval', (req: Request, res: Response) => {
  try {
    const { code = '', keywords = [], tdsContent = '' } = req.body as {
      code: string; keywords: string[]; tdsContent?: string;
    };

    const codeLower = code.toLowerCase();

    // 1. Keyword grounding score
    const found    = keywords.filter((k: string) => codeLower.includes(k.toLowerCase()));
    const missing  = keywords.filter((k: string) => !codeLower.includes(k.toLowerCase()));
    const groundingScore = keywords.length > 0
      ? Math.round((found.length / keywords.length) * 100) : 100;

    // 2. Basic code quality signals
    const lineCount     = code.split('\n').length;
    const hasErrorHandling = /try|catch|exception|error/i.test(code);
    const hasComments      = /\/\/|\/\*|\#/.test(code);
    const hasTests         = /test|spec|assert|expect/i.test(code);
    const hasTypes         = /interface|type |class |struct|def |@Service|@Controller|@Repository/i.test(code);

    // 3. TDS coverage — how many TDS sections appear in generated code
    let tdsCoverage = 0;
    if (tdsContent) {
      const tdsWords = tdsContent
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 5);
      const uniqueTdsWords = [...new Set(tdsWords)].slice(0, 100);
      const tdsFound = uniqueTdsWords.filter(w => codeLower.includes(w));
      tdsCoverage = Math.round((tdsFound.length / Math.max(uniqueTdsWords.length, 1)) * 100);
    }

    res.json({
      success: true,
      scores: {
        groundingScore,
        tdsCoverage,
        lineCount,
        hasErrorHandling,
        hasComments,
        hasTests,
        hasTypes,
      },
      found,
      missing,
      verdict: groundingScore >= 70 ? 'PASS' : groundingScore >= 40 ? 'PARTIAL' : 'FAIL',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Serve static files (public/) AFTER all API routes so /api/* is never shadowed
app.use(express.static(path.join(__dirname, '../public')));

// Catch-all: unknown routes return JSON 404 instead of HTML
app.use((req: Request, res: Response) => {
  res.status(404).json({ success: false, error: `Route not found: ${req.method} ${req.path}` });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Server error:', err);
  res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Server error', data: { details: err.message } } });
});

// ── Start server ──
const PORT = parseInt(process.env.MCP_SERVER_PORT || '3000');
const HOST = process.env.MCP_SERVER_HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`\n🚀 MCP Server running on http://127.0.0.1:${PORT}`);
  console.log(`📁 Workspace: ${workspacePath}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET  /health              - Health check`);
  console.log(`  POST /api/terminal/exec   - Execute terminal command`);
  console.log(`  POST /api/agent           - AI agent workflow`);
  console.log(`  POST /rpc                 - MCP JSON-RPC`);

  // Boot RAG index (non-blocking — runs in background)
  initializeRAG().catch(err => console.warn('[RAG] Initialization error:', err));
});

export default app;

