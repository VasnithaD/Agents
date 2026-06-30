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
import { Orchestrator } from './orchestrator';

// Load .env from the project root regardless of cwd
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const execAsync = promisify(exec);

const app = express();
app.use(express.json({ limit: '10mb' }));
// NOTE: express.static is registered AFTER all API routes (see bottom of file)
// to prevent it from intercepting /api/* paths and returning index.html.

// ─── Mutable workspace state ───
let workspacePath: string = process.env.VSCODE_WORKSPACE_PATH || 'C:\\Users\\abhishe6\\Downloads\\cpq-ngqc-app\\cpq-ngqc-app';
const BUILTIN_WORKSPACES = [
  { name: 'CPQ NGQC App', path: 'C:\\Users\\abhishe6\\Downloads\\cpq-ngqc-app\\cpq-ngqc-app' },
  { name: 'OCL Base', path: 'C:\\Users\\abhishe6\\Downloads\\ocl-base' },
];

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
const orchestrator = new Orchestrator(vsCodeHandler, gitHubHandler, agentHandler, workspacePath);

const mcpHandler = new MCPServerHandler(vsCodeHandler, gitHubHandler, llmHandler);

// ═══════════════════════════════════════════════════
// ORIGINAL MCP ENDPOINTS
// ═══════════════════════════════════════════════════

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', server: 'MCP Server', workspace: workspacePath });
});

// ── LLM / HPE connectivity diagnostic ──
app.get('/api/health/llm', async (_req: Request, res: Response) => {
  try {
    const diag = await getHPEClient().diagnose();
    res.json({
      success: diag.ok,
      provider: process.env.LLM_PROVIDER || 'hpe',
      endpoint: process.env.HPE_API_ENDPOINT || process.env.HPE_ENDPOINT || 'https://api.chathpe.it.hpe.com/v2.8',
      tokenExpiresInSeconds: diag.tokenExpiresIn,
      tokenStatus: diag.tokenExpiresIn !== undefined
        ? (diag.tokenExpiresIn > 0 ? `valid (${Math.round(diag.tokenExpiresIn / 60)} min left)` : 'EXPIRED')
        : 'unknown',
      sessionId: (process.env.sessionId || process.env.SESSION_ID || '').substring(0, 8) + '…',
      error: diag.error,
      httpStatus: diag.status,
      responseBody: diag.body,
      hasFallback: !!(process.env.OPENAI_API_KEY || process.env.AZURE_OPENAI_API_KEY),
      fix: !diag.ok ? [
        diag.tokenExpiresIn !== undefined && diag.tokenExpiresIn <= 0
          ? 'Token EXPIRED — refresh via POST /api/auth/token or update AUTHENTICATION_TOKEN in .env'
          : 'Token appears valid — likely VPN/network/session/quota issue',
        'If not on HPE VPN: add OPENAI_API_KEY=sk-... to .env as fallback',
        'If on VPN but failing: refresh sessionId + USER_ID from the Python Transcripts app',
      ] : [],
    });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
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

app.get('/api/workspaces/list', (_req: Request, res: Response) => {
  const normalizedActive = path.resolve(workspacePath).toLowerCase();
  const seen = new Set<string>();
  const rows: Array<{ name: string; path: string; exists: boolean; active: boolean }> = [];

  for (const ws of BUILTIN_WORKSPACES) {
    const p = path.resolve(ws.path);
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      name: ws.name,
      path: p,
      exists: fs.existsSync(p),
      active: key === normalizedActive,
    });
  }

  if (!seen.has(normalizedActive)) {
    rows.unshift({
      name: 'Active Workspace',
      path: workspacePath,
      exists: fs.existsSync(workspacePath),
      active: true,
    });
  }

  res.json({ success: true, workspaces: rows, activeWorkspace: workspacePath });
});

app.post('/api/workspace/change', async (req: Request, res: Response) => {
  const { newPath } = req.body;
  if (!newPath) return res.status(400).json({ success: false, error: 'newPath required' });
  if (!fs.existsSync(newPath)) return res.status(400).json({ success: false, error: 'Path does not exist' });

  const previousWorkspacePath = workspacePath;

  try {
    workspacePath = newPath;
    vsCodeHandler.setWorkspace(newPath);
    agentHandler.setWorkspace(newPath);
    gitHubHandler.setLocalRepoPath(newPath);
    orchestrator.setWorkspace(newPath);
    await ragRetriever.setWorkspace(newPath);
  } catch (error) {
    workspacePath = previousWorkspacePath;
    vsCodeHandler.setWorkspace(previousWorkspacePath);
    agentHandler.setWorkspace(previousWorkspacePath);
    gitHubHandler.setLocalRepoPath(previousWorkspacePath);
    orchestrator.setWorkspace(previousWorkspacePath);
    return res.status(500).json({ success: false, error: (error as Error).message });
  }

  res.json({ success: true, path: workspacePath, rag: ragRetriever.getStatus() });
});

app.get('/api/rag/status', (_req: Request, res: Response) => {
  res.json({ success: true, rag: ragRetriever.getStatus(), workspace: workspacePath });
});

// ── Workspace file helpers (used by UI save/read actions) ──
function resolveWorkspaceFilePath(inputPath: string): string | null {
  const candidate = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(workspacePath, inputPath);
  const ws = path.resolve(workspacePath).toLowerCase();
  const cand = path.resolve(candidate).toLowerCase();
  if (cand === ws || cand.startsWith(ws + path.sep.toLowerCase())) return candidate;
  return null;
}

// ── List directory contents (one level) ──
app.get('/api/files/list', (req: Request, res: Response) => {
  try {
    const dirPath = (req.query.path as string) || '';
    const abs = dirPath
      ? resolveWorkspaceFilePath(dirPath)
      : path.resolve(workspacePath);

    if (!abs) return res.status(400).json({ success: false, error: 'Path must be inside workspace' });
    if (!fs.existsSync(abs)) return res.status(404).json({ success: false, error: `Directory not found: ${abs}` });
    if (!fs.statSync(abs).isDirectory()) return res.status(400).json({ success: false, error: `Not a directory: ${abs}` });

    const entries = fs.readdirSync(abs, { withFileTypes: true })
      .sort((a, b) => {
        // directories first, then files, both alphabetically
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' : 'file',
        path: path.relative(workspacePath, path.join(abs, e.name)).replace(/\\/g, '/'),
      }));

    res.json({ success: true, path: path.relative(workspacePath, abs).replace(/\\/g, '/') || '.', entries });
  } catch (error) {
    console.error('[/api/files/list] Error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// ── Build recursive file+folder index for fast sidebar search ──
app.get('/api/files/search-index', (req: Request, res: Response) => {
  try {
    const rootAbs = path.resolve(workspacePath);
    if (!fs.existsSync(rootAbs) || !fs.statSync(rootAbs).isDirectory()) {
      return res.status(404).json({ success: false, error: `Workspace directory not found: ${rootAbs}` });
    }

    const entries: { name: string; type: 'dir' | 'file'; path: string }[] = [];
    const stack: string[] = [rootAbs];

    while (stack.length > 0) {
      const current = stack.pop()!;
      let dirents: fs.Dirent[] = [];
      try {
        dirents = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        // Skip unreadable directories and continue indexing.
        continue;
      }

      for (const d of dirents) {
        const abs = path.join(current, d.name);
        const rel = path.relative(rootAbs, abs).replace(/\\/g, '/');
        if (!rel) continue;

        if (d.isDirectory()) {
          entries.push({ name: d.name, type: 'dir', path: rel });
          stack.push(abs);
        } else if (d.isFile()) {
          entries.push({ name: d.name, type: 'file', path: rel });
        }
      }
    }

    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.path.localeCompare(b.path);
    });

    res.json({
      success: true,
      workspace: rootAbs,
      count: entries.length,
      entries,
    });
  } catch (error) {
    console.error('[/api/files/search-index] Error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.get('/api/files/read', (req: Request, res: Response) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ success: false, error: 'path required' });
    const abs = resolveWorkspaceFilePath(filePath);
    if (!abs) return res.status(400).json({ success: false, error: 'Path must be inside workspace' });
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }
    const content = fs.readFileSync(abs, 'utf8');
    res.json({ success: true, path: path.relative(workspacePath, abs).replace(/\\/g, '/'), content });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post('/api/files/write', (req: Request, res: Response) => {
  try {
    const { filePath, content } = req.body as { filePath?: string; content?: string };
    if (!filePath) return res.status(400).json({ success: false, error: 'filePath required' });
    if (typeof content !== 'string') return res.status(400).json({ success: false, error: 'content must be a string' });

    const abs = resolveWorkspaceFilePath(filePath);
    if (!abs) return res.status(400).json({ success: false, error: 'Path must be inside workspace' });

    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    res.json({ success: true, path: path.relative(workspacePath, abs).replace(/\\/g, '/') });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post('/api/files/delete', (req: Request, res: Response) => {
  try {
    const { filePath } = req.body as { filePath?: string };
    if (!filePath) return res.status(400).json({ success: false, error: 'filePath required' });

    const abs = resolveWorkspaceFilePath(filePath);
    if (!abs) return res.status(400).json({ success: false, error: 'Path must be inside workspace' });
    if (!fs.existsSync(abs)) return res.json({ success: true, path: filePath, deleted: false });
    if (!fs.statSync(abs).isFile()) return res.status(400).json({ success: false, error: 'Path is not a file' });

    fs.unlinkSync(abs);
    res.json({ success: true, path: path.relative(workspacePath, abs).replace(/\\/g, '/'), deleted: true });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
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

// ── AI Agent + Orchestrator ──

// Smart Mode: Unified orchestration endpoint
// Combines workspace, GitHub, and RAG context intelligently
app.post('/api/orchestrate', async (req: Request, res: Response) => {
  try {
    const result = await orchestrator.execute(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Orchestration failed',
      error: (error as Error).message,
      sources: { workspace: [], rag: [] },
    });
  }
});

// Smart MCP endpoint: normalized JSON contract for multi-service orchestration
app.post('/api/smart/mcp', async (req: Request, res: Response) => {
  const startedAt = new Date().toISOString();
  const {
    task = '',
    mode = 'auto',
    includeWorkspace = true,
    includeGitHub = true,
    includeRAG = true,
    github = {},
    vector = {},
    modelId,
  } = req.body || {};

  const tool_calls: any[] = [];
  const tool_results: any[] = [];
  const errors: any[] = [];
  const lowerTask = String(task || '').toLowerCase();

  const respond = (status: 'success' | 'partial' | 'failed', combined_result: any, next_actions: string[] = []) => {
    const completedAt = new Date().toISOString();
    const totalMs = Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime());
    return res.json({
      status,
      request: {
        task,
        mode,
        includeWorkspace,
        includeGitHub,
        includeRAG,
      },
      tool_plan: tool_calls.map((c: any) => ({ id: c.id, tool: c.tool, operation: c.operation })),
      tool_calls,
      tool_results,
      combined_result,
      errors,
      next_actions,
      meta: { startedAt, completedAt, totalMs },
    });
  };

  try {
    const wantsPR =
      mode === 'create_pr' ||
      /\b(create|open|raise)\b.*\b(pr|pull request)\b|\b(pr|pull request)\b.*\b(create|open|raise)\b/.test(lowerTask);

    const wantsIssuePlusVector =
      mode === 'issues_plus_vector' ||
      ((/\b(issue|issues|bug|bugs|ticket|tickets)\b/.test(lowerTask)) &&
       (/\b(similar|semantic|related|vector|knowledge|doc|docs|document|documents)\b/.test(lowerTask)));

    // Flow 1: Direct PR creation (GitHub service)
    if (wantsPR) {
      const callId = '1';
      const owner = process.env.GITHUB_OWNER || '';
      const repo = github.repo || process.env.GITHUB_REPO || '';
      const head = github.head || github.branch || '';
      const base = github.base || 'main';
      const branchMode = github.branchMode === 'create_new_branch' ? 'create_new_branch' : 'existing_branch';
      const filePath = String(github.filePath || '').trim();
      const content = typeof github.content === 'string' ? github.content : '';
      const commitMessage = String(github.commitMessage || (filePath ? `Smart Mode: update ${filePath}` : 'Smart Mode commit')).trim();
      const shouldCommitCode = !!filePath && !!content.trim();
      const shouldOpenPR = github.openPR !== false;
      const title = github.title || `AI Smart PR - ${new Date().toLocaleDateString()}`;
      const body = github.body || `Created via Smart MCP workflow at ${new Date().toISOString()}`;

      tool_calls.push({
        id: callId,
        tool: 'github',
        operation: 'create_pull_request',
        input: { owner, repo, head, base, title },
        depends_on: [],
      });

      if (!includeGitHub) {
        const msg = 'GitHub service is disabled. Enable Include GitHub to create PRs.';
        errors.push({ code: 'GITHUB_DISABLED', message: msg });
        tool_results.push({ id: callId, ok: false, data: null, error: { message: msg } });
        return respond('failed', { pr: null }, ['Enable Include GitHub and retry']);
      }

      if (!owner || !repo || !head) {
        const msg = 'Missing owner/repo/head for PR creation.';
        errors.push({ code: 'INVALID_INPUT', message: msg });
        tool_results.push({ id: callId, ok: false, data: null, error: { message: msg } });
        return respond('failed', { pr: null }, ['Provide repo, head branch, and title']);
      }

      const octokit = (gitHubHandler as any).octokit;
      if (!octokit) {
        const msg = 'GitHub client not configured.';
        errors.push({ code: 'GITHUB_NOT_CONFIGURED', message: msg });
        tool_results.push({ id: callId, ok: false, data: null, error: { message: msg } });
        return respond('failed', { pr: null }, ['Set GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO']);
      }

      let commitData: any = null;
      if (shouldCommitCode) {
        const commitCallId = '1.1';
        tool_calls.push({
          id: commitCallId,
          tool: 'github',
          operation: branchMode === 'create_new_branch' ? 'create_branch_and_commit_file' : 'commit_file_to_existing_branch',
          input: { owner, repo, branchMode, head, base, filePath, commitMessage },
          depends_on: [callId],
        });

        let targetBranch = head;
        if (branchMode === 'create_new_branch') {
          try {
            const { data: baseRef } = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${base}` });
            try {
              await octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${head}`, sha: baseRef.object.sha });
            } catch (refErr: any) {
              if (refErr.status !== 422) throw refErr;
            }
          } catch (branchError) {
            const msg = `Failed to create/find branch ${head} from ${base}: ${(branchError as Error).message}`;
            errors.push({ code: 'GITHUB_BRANCH_CREATE_FAILED', message: msg });
            tool_results.push({ id: commitCallId, ok: false, data: null, error: { message: msg } });
            return respond('failed', { pr: null }, ['Verify base/head branch names and permissions']);
          }
        } else {
          try {
            await octokit.rest.repos.getBranch({ owner, repo, branch: head });
          } catch (branchError) {
            const msg = `Head branch ${head} not found: ${(branchError as Error).message}`;
            errors.push({ code: 'GITHUB_BRANCH_NOT_FOUND', message: msg });
            tool_results.push({ id: commitCallId, ok: false, data: null, error: { message: msg } });
            return respond('failed', { pr: null }, ['Use an existing branch or switch to Create New Branch + Push']);
          }
        }

        let existingSha: string | undefined;
        try {
          const { data: existing } = await octokit.rest.repos.getContent({ owner, repo, path: filePath, ref: targetBranch });
          if (!Array.isArray(existing)) existingSha = (existing as any).sha;
        } catch (existingErr: any) {
          if (existingErr.status !== 404) {
            const msg = `Unable to inspect file ${filePath}: ${existingErr.message}`;
            errors.push({ code: 'GITHUB_FILE_CHECK_FAILED', message: msg });
            tool_results.push({ id: commitCallId, ok: false, data: null, error: { message: msg } });
            return respond('failed', { pr: null }, ['Check repository path and permissions']);
          }
        }

        const commitBody: any = {
          owner,
          repo,
          path: filePath,
          message: commitMessage,
          content: Buffer.from(content).toString('base64'),
          branch: targetBranch,
        };
        if (existingSha) commitBody.sha = existingSha;

        try {
          const { data: commitRes } = await octokit.rest.repos.createOrUpdateFileContents(commitBody);
          commitData = {
            branch: targetBranch,
            filePath,
            commitSha: commitRes.commit.sha,
            commitUrl: (commitRes.commit as any).html_url,
          };
          tool_results.push({ id: commitCallId, ok: true, data: commitData, error: null });
        } catch (commitError) {
          const msg = `Failed to commit ${filePath}: ${(commitError as Error).message}`;
          errors.push({ code: 'GITHUB_COMMIT_FAILED', message: msg });
          tool_results.push({ id: commitCallId, ok: false, data: null, error: { message: msg } });
          return respond('failed', { pr: null }, ['Fix file path/content and retry commit']);
        }
      }

      if (!shouldOpenPR) {
        return respond('success', { pr: null, commit: commitData }, ['Code pushed successfully. Open PR later from GitHub or rerun with PR enabled.']);
      }

      const { data: prData } = await octokit.rest.pulls.create({ owner, repo, head, base, title, body });
      const pr = {
        number: prData.number,
        url: prData.html_url,
        title: prData.title,
        state: prData.state,
        head: prData.head.ref,
        base: prData.base.ref,
      };
      tool_results.push({ id: callId, ok: true, data: { pr, commit: commitData }, error: null });
      return respond('success', { pr, commit: commitData }, ['Share PR URL for review', 'Add reviewers and labels']);
    }

    // Flow 2: GitHub issues + VectorBase-style semantic document retrieval
    if (wantsIssuePlusVector) {
      const owner = process.env.GITHUB_OWNER || '';
      const repo = github.repo || process.env.GITHUB_REPO || '';
      const query = String(github.query || task || '').trim();
      const issueState = github.state || 'open';
      const vectorQuery = String(vector.query || query).trim();
      const topK = Number(vector.topK || 6);

      const ghCallId = '1';
      const vecCallId = '2';

      tool_calls.push({
        id: ghCallId,
        tool: 'github',
        operation: 'search_issues',
        input: { owner, repo, query, state: issueState },
        depends_on: [],
      });
      tool_calls.push({
        id: vecCallId,
        tool: 'vectorbase',
        operation: 'semantic_search',
        input: { query: vectorQuery, topK },
        depends_on: [],
      });

      let issues: any[] = [];
      let documents: any[] = [];

      if (includeGitHub && owner && repo) {
        try {
          const octokit = (gitHubHandler as any).octokit;
          if (!octokit) throw new Error('GitHub client not configured');
          const q = `repo:${owner}/${repo} is:issue state:${issueState} ${query}`;
          const { data } = await octokit.rest.search.issuesAndPullRequests({ q, per_page: 20 });
          issues = (data.items || []).map((i: any) => ({
            number: i.number,
            title: i.title,
            state: i.state,
            url: i.html_url,
            labels: (i.labels || []).map((l: any) => (typeof l === 'string' ? l : l.name)),
            updatedAt: i.updated_at,
          }));
          tool_results.push({ id: ghCallId, ok: true, data: { total: data.total_count, issues }, error: null });
        } catch (error) {
          const msg = (error as Error).message;
          errors.push({ code: 'GITHUB_SEARCH_FAILED', message: msg });
          tool_results.push({ id: ghCallId, ok: false, data: null, error: { message: msg } });
        }
      } else {
        const msg = 'GitHub disabled or not configured.';
        errors.push({ code: 'GITHUB_UNAVAILABLE', message: msg });
        tool_results.push({ id: ghCallId, ok: false, data: null, error: { message: msg } });
      }

      if (includeRAG) {
        try {
          const rag = await ragRetriever.retrieveMultiWithSources([vectorQuery], topK);
          documents = (rag.sources || []).slice(0, topK).map((s: any) => ({
            file: s.file,
            path: s.path,
            chunks: s.chunks,
            linesRead: s.linesRead,
            score: s.linesRead,
          }));
          tool_results.push({ id: vecCallId, ok: true, data: { total: documents.length, documents }, error: null });
        } catch (error) {
          const msg = (error as Error).message;
          errors.push({ code: 'VECTOR_SEARCH_FAILED', message: msg });
          tool_results.push({ id: vecCallId, ok: false, data: null, error: { message: msg } });
        }
      } else {
        const msg = 'Knowledge Base service disabled.';
        errors.push({ code: 'VECTOR_DISABLED', message: msg });
        tool_results.push({ id: vecCallId, ok: false, data: null, error: { message: msg } });
      }

      const status = errors.length === 0 ? 'success' : (issues.length > 0 || documents.length > 0 ? 'partial' : 'failed');
      return respond(status as 'success' | 'partial' | 'failed', {
        issues,
        documents,
        cross_links: issues.slice(0, 10).map((issue: any) => ({
          issueNumber: issue.number,
          issueTitle: issue.title,
          relatedDocuments: documents.slice(0, 3).map((d: any) => ({ file: d.file, path: d.path })),
        })),
      }, ['Refine query for narrower results', 'Open an issue-to-doc triage report']);
    }

    // Flow 3: Default orchestration path (workspace + GitHub + RAG)
    const orchCallId = '1';
    tool_calls.push({
      id: orchCallId,
      tool: 'orchestrator',
      operation: 'execute',
      input: { intent: task, includeWorkspace, includeGitHub, includeRAG, modelId },
      depends_on: [],
    });

    const orch = await orchestrator.execute({
      intent: task,
      includeWorkspace,
      includeGitHub,
      includeRAG,
      modelId,
      contextFiles: [],
    });

    if (!orch.success) {
      tool_results.push({ id: orchCallId, ok: false, data: null, error: { message: orch.error || orch.message } });
      errors.push({ code: 'ORCHESTRATION_FAILED', message: orch.error || orch.message });
      return respond('failed', { orchestration: null }, ['Check model connectivity and token status']);
    }

    tool_results.push({
      id: orchCallId,
      ok: true,
      data: {
        filesWritten: orch.result?.filesWritten || [],
        tips: orch.result?.tips || [],
        sourceCounts: {
          workspace: orch.sources.workspace.length,
          rag: orch.sources.rag.length,
        },
      },
      error: null,
    });

    return respond('success', {
      orchestration: {
        message: orch.message,
        agentMessage: orch.result?.code || '',
        filesWritten: orch.result?.filesWritten || [],
        fileContents: orch.result?.fileContents || {},
        tips: orch.result?.tips || [],
        sources: orch.sources,
      },
    }, ['Review generated output', 'Send approved changes to GitHub']);
  } catch (error) {
    errors.push({ code: 'SMART_MCP_ERROR', message: (error as Error).message });
    return respond('failed', {}, ['Retry with refined input', 'Verify GitHub and LLM configuration']);
  }
});

// Legacy: AI Agent (independent)
app.post('/api/agent', async (req: Request, res: Response) => {
  try {
    const {
      prompt,
      contextFiles,
      modelId,
      forceOverwrite,
      saveToWorkspace,
      reactMode,
      humanFeedback,
      includeWorkspace,
      includeRAG,
    } = req.body;
    if (!prompt) return res.status(400).json({ success: false, error: 'prompt required' });

    // contextFiles: optional array of workspace-relative paths whose content
    // is injected into the prompt (e.g. a TDS JSON file).
    const result = await agentHandler.executeTask(
      prompt,
      Array.isArray(contextFiles) ? contextFiles : [],
      modelId,
      forceOverwrite === true,
      saveToWorkspace === true,
      {
        reactMode: reactMode === true,
        humanFeedback: typeof humanFeedback === 'string' ? humanFeedback : '',
        includeWorkspace: includeWorkspace !== false,
        includeRAG: includeRAG !== false,
      },
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

function startServer(port: number): void {
  const server = app.listen(port, HOST, () => {
    console.log(`\n🚀 MCP Server running on http://127.0.0.1:${port}`);
    console.log(`📁 Workspace: ${workspacePath}`);
    console.log(`\nEndpoints:`);
    console.log(`  GET  /health              - Health check`);
    console.log(`  POST /api/terminal/exec   - Execute terminal command`);
    console.log(`  POST /api/orchestrate     - Smart mode: unified context coordination`);
    console.log(`  POST /api/agent           - AI agent workflow (independent)`);
    console.log(`  POST /rpc                 - MCP JSON-RPC`);

    // Boot RAG index (non-blocking — runs in background)
    initializeRAG(workspacePath).catch(err => console.warn('[RAG] Initialization error:', err));
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      const nextPort = port + 1;
      console.warn(`[Server] Port ${port} is in use. Retrying on ${nextPort}...`);
      startServer(nextPort);
      return;
    }

    console.error('[Server] Failed to start:', err);
    process.exit(1);
  });
}

startServer(PORT);

export default app;

