import { VSCodeHandler } from './handlers/vscode-handler';
import { GitHubHandler } from './handlers/github-handler';
import { AgentHandler } from './handlers/agent-handler';
import { ragRetriever, RagSource } from './rag/retriever';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export interface OrchestratorRequest {
  intent: string;
  contextFiles?: string[];
  modelId?: string;
  includeWorkspace?: boolean;
  includeGitHub?: boolean;
  includeRAG?: boolean;
}

export interface OrchestratorResponse {
  success: boolean;
  message: string;
  result?: {
    code: string;
    executionMode?: 'qa' | 'generic-code' | 'project-codegen';
    filesWritten: string[];
    fileContents: Record<string, string>;
    ragSources: RagSource[];
    workspaceContext: {
      filesRead: string[];
      relevantSymbols: string[];
    };
    githubContext?: {
      repoInfo: string;
      currentBranch: string;
    };
    tips: string[];
  };
  error?: string;
  sources: {
    workspace: string[];
    github?: string;
    rag: RagSource[];
  };
}

interface GitHubDataQueryResult {
  handled: boolean;
  response?: OrchestratorResponse;
}

/**
 * Orchestrator: Coordinates multiple services to provide unified context-aware responses
 * 
 * Flow:
 * 1. Parse intent and determine service needs
 * 2. Fetch workspace context (files, symbols)
 * 3. Optionally fetch GitHub repo state
 * 4. Run RAG retrieval for semantic context
 * 5. Call Agent handler with combined context
 * 6. Return integrated result with source attribution
 */
export class Orchestrator {
  constructor(
    private vsCodeHandler: VSCodeHandler,
    private gitHubHandler: GitHubHandler,
    private agentHandler: AgentHandler,
    private workspacePath: string,
  ) {}

  async execute(req: OrchestratorRequest): Promise<OrchestratorResponse> {
    const {
      intent,
      contextFiles = [],
      modelId,
      includeWorkspace = true,
      includeGitHub = false,
      includeRAG = true,
    } = req;

    try {
      console.log(`[Orchestrator] Intent: ${intent}`);

      // Handle deterministic GitHub actions (create PR) directly for reliability.
      const gitHubActionResult = await this.tryHandleGitHubActionIntent(intent, includeGitHub);
      if (gitHubActionResult.handled && gitHubActionResult.response) {
        return gitHubActionResult.response;
      }

      // Handle factual GitHub questions directly (repos/latest PR) instead of LLM generation.
      const gitHubDataResult = await this.tryHandleGitHubDataQuery(intent, includeGitHub);
      if (gitHubDataResult.handled && gitHubDataResult.response) {
        return gitHubDataResult.response;
      }
      
      let workspaceContext: { filesRead: string[]; relevantSymbols: string[] } = {
        filesRead: [],
        relevantSymbols: [],
      };
      let githubContext: { repoInfo: string; currentBranch: string } | undefined;
      let ragSources: RagSource[] = [];

      // ── Step 1: Fetch Workspace Context ──
      if (includeWorkspace) {
        console.log('[Orchestrator] Fetching workspace context...');
        workspaceContext = this.extractWorkspaceContext(intent, contextFiles);
      }

      // ── Step 2: Fetch GitHub Context (if enabled) ──
      if (includeGitHub) {
        console.log('[Orchestrator] Fetching GitHub context...');
        try {
          githubContext = await this.extractGitHubContext();
        } catch (e) {
          console.warn('[Orchestrator] GitHub fetch failed:', (e as Error).message);
        }
      }

      // ── Step 3: Run RAG Retrieval ──
      if (includeRAG) {
        console.log('[Orchestrator] Running RAG retrieval...');
        ragSources = await this.retrieveRAGContext(intent);
        console.log(`[Orchestrator] Retrieved ${ragSources.length} RAG sources`);
      }

      // ── Step 4: Build Enhanced Prompt ──
      const enhancedPrompt = this.buildEnhancedPrompt(
        intent,
        workspaceContext,
        githubContext,
        ragSources,
      );

      // ── Step 5: Call Agent with Combined Context ──
      console.log('[Orchestrator] Calling Agent with combined context...');
      const agentResult = await this.agentHandler.executeTask(
        enhancedPrompt,
        contextFiles,
        modelId,
        false,
        false,
      );

      if (!agentResult.success) {
        return {
          success: false,
          message: 'Orchestration failed at agent step',
          error: agentResult.error || 'Unknown agent error',
          sources: {
            workspace: workspaceContext.filesRead,
            rag: ragSources,
          },
        };
      }

      // ── Step 6: Return Integrated Result ──
      return {
        success: true,
        message: 'Orchestration completed successfully',
        result: {
          code: agentResult.message,
          executionMode: agentResult.executionMode,
          filesWritten: agentResult.filesWritten || [],
          fileContents: agentResult.fileContents || {},
          ragSources,
          workspaceContext,
          githubContext,
          tips: agentResult.tips || [],
        },
        sources: {
          workspace: workspaceContext.filesRead,
          github: githubContext?.repoInfo,
          rag: ragSources,
        },
      };
    } catch (error) {
      console.error('[Orchestrator] Error:', error);
      return {
        success: false,
        message: 'Orchestration failed',
        error: (error as Error).message,
        sources: {
          workspace: [],
          rag: [],
        },
      };
    }
  }

  private async tryHandleGitHubDataQuery(intent: string, includeGitHub: boolean): Promise<GitHubDataQueryResult> {
    const lower = intent.toLowerCase();
    const asksRepos = /\b(repos?|repositories|list\s+repos?)\b/.test(lower);
    const asksLatestPR = /\b(latest|recent|newest)\b.*\bpr\b|\bpr\b.*\b(latest|recent|newest)\b|\bpull\s*request\b/.test(lower);
    const asksGitHub = /\bgithub|repo|repository|pull\s*request|\bpr\b\b/.test(lower);

    if (!asksGitHub || (!asksRepos && !asksLatestPR)) {
      return { handled: false };
    }

    if (!includeGitHub) {
      return {
        handled: true,
        response: {
          success: false,
          message: 'GitHub context is disabled for this Smart Mode request',
          error: 'Enable "Include GitHub (optional)" to answer repository/PR questions.',
          sources: { workspace: [], rag: [] },
        },
      };
    }

    try {
      const octokit = (this.gitHubHandler as any).octokit;
      const owner = process.env.GITHUB_OWNER || '';
      const defaultRepo = process.env.GITHUB_REPO || '';

      if (!octokit || !owner) {
        return {
          handled: true,
          response: {
            success: false,
            message: 'GitHub is not configured',
            error: 'Missing GitHub token/owner configuration.',
            sources: { workspace: [], rag: [] },
          },
        };
      }

      let repos: any[] = [];
      if (asksRepos) {
        const reposRes = await octokit.rest.repos.listForUser({ username: owner, per_page: 50, sort: 'updated' });
        repos = reposRes.data.map((r: any) => ({
          name: r.name,
          fullName: r.full_name,
          private: r.private,
          defaultBranch: r.default_branch,
          updatedAt: r.updated_at,
          url: r.html_url,
        }));
      }

      let latestPr: any = null;
      if (asksLatestPR) {
        const targetRepo = this.extractRepoFromIntent(intent) || defaultRepo || (repos[0]?.name || '');
        if (targetRepo) {
          const pullsRes = await octokit.rest.pulls.list({ owner, repo: targetRepo, state: 'all', per_page: 1, sort: 'updated', direction: 'desc' });
          if (pullsRes.data.length > 0) {
            const p = pullsRes.data[0];
            latestPr = {
              repo: targetRepo,
              number: p.number,
              title: p.title,
              state: p.state,
              head: p.head.ref,
              base: p.base.ref,
              author: p.user?.login,
              updatedAt: p.updated_at,
              url: p.html_url,
            };
          }
        }
      }

      const lines: string[] = [];
      if (asksRepos) {
        lines.push(`Repositories for ${owner}: ${repos.length}`);
        for (const r of repos.slice(0, 10)) {
          lines.push(`- ${r.fullName} (${r.private ? 'private' : 'public'}) [default: ${r.defaultBranch}]`);
        }
        if (repos.length > 10) lines.push(`- ...and ${repos.length - 10} more`);
      }
      if (asksLatestPR) {
        if (latestPr) {
          lines.push('');
          lines.push(`Latest PR (${latestPr.repo}): #${latestPr.number} ${latestPr.title}`);
          lines.push(`- state: ${latestPr.state}`);
          lines.push(`- branch: ${latestPr.head} -> ${latestPr.base}`);
          lines.push(`- author: ${latestPr.author || 'unknown'}`);
          lines.push(`- updated: ${latestPr.updatedAt}`);
          lines.push(`- url: ${latestPr.url}`);
        } else {
          lines.push('');
          lines.push('No PR found for the target repository.');
        }
      }

      return {
        handled: true,
        response: {
          success: true,
          message: 'GitHub data query completed',
          result: {
            code: lines.join('\n'),
            filesWritten: [],
            fileContents: {},
            ragSources: [],
            workspaceContext: { filesRead: [], relevantSymbols: [] },
            githubContext: {
              repoInfo: defaultRepo ? `${owner}/${defaultRepo}` : owner,
              currentBranch: latestPr?.base || 'n/a',
            },
            tips: ['Use the GitHub tab to inspect full repo/PR details and perform branch/PR actions.'],
          },
          sources: {
            workspace: [],
            github: defaultRepo ? `${owner}/${defaultRepo}` : owner,
            rag: [],
          },
        },
      };
    } catch (error) {
      return {
        handled: true,
        response: {
          success: false,
          message: 'GitHub data query failed',
          error: (error as Error).message,
          sources: { workspace: [], rag: [] },
        },
      };
    }
  }

  private async tryHandleGitHubActionIntent(intent: string, includeGitHub: boolean): Promise<GitHubDataQueryResult> {
    const lower = intent.toLowerCase();
    const wantsCreatePr = /(create|open|raise|make|submit)\b[\s\S]{0,80}\b(pr|pull\s*request)\b|\b(pr|pull\s*request)\b[\s\S]{0,80}\b(create|open|raise|make|submit)\b/.test(lower);

    if (!wantsCreatePr) {
      return { handled: false };
    }

    if (!includeGitHub) {
      return {
        handled: true,
        response: {
          success: false,
          message: 'GitHub context is disabled for this Smart Mode request',
          error: 'Enable "Include GitHub (optional)" to create pull requests from Smart Mode.',
          sources: { workspace: [], rag: [] },
        },
      };
    }

    try {
      const octokit = (this.gitHubHandler as any).octokit;
      const owner = process.env.GITHUB_OWNER || '';
      const defaultRepo = process.env.GITHUB_REPO || '';

      if (!octokit || !owner) {
        return {
          handled: true,
          response: {
            success: false,
            message: 'GitHub is not configured',
            error: 'Missing GitHub token/owner configuration.',
            sources: { workspace: [], rag: [] },
          },
        };
      }

      const repo = this.extractRepoFromIntent(intent) || defaultRepo;
      if (!repo) {
        return {
          handled: true,
          response: {
            success: false,
            message: 'Repository is not specified',
            error: 'Set GITHUB_REPO in environment or specify "repo <name>" in Smart prompt.',
            sources: { workspace: [], rag: [] },
          },
        };
      }

      const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
      const base = this.extractBaseFromIntent(intent) || repoData.default_branch;

      let head = this.extractHeadBranchFromIntent(intent);
      if (!head && /\b(this|current)\s+branch\b/i.test(intent)) {
        head = this.getLocalCurrentBranch();
      }

      if (!head) {
        return {
          handled: true,
          response: {
            success: false,
            message: 'Source branch is missing',
            error: 'Specify source branch in prompt, e.g. "create PR from branch feature/auth to main" or "from this branch".',
            sources: { workspace: [], rag: [] },
          },
        };
      }

      // Ensure source branch exists remotely.
      try {
        await octokit.rest.repos.getBranch({ owner, repo, branch: head });
      } catch (branchErr: any) {
        if (branchErr?.status === 404) {
          return {
            handled: true,
            response: {
              success: false,
              message: 'Source branch not found on remote',
              error: `Branch "${head}" does not exist in ${owner}/${repo}. Push it first, then retry.`,
              sources: { workspace: [], github: `${owner}/${repo}`, rag: [] },
            },
          };
        }
        throw branchErr;
      }

      // Prevent duplicate PRs for same head/base pair.
      const existing = await octokit.rest.pulls.list({
        owner,
        repo,
        state: 'open',
        head: `${owner}:${head}`,
        base,
        per_page: 1,
      });

      if (existing.data.length > 0) {
        const pr = existing.data[0];
        return {
          handled: true,
          response: {
            success: true,
            message: 'Existing PR found',
            result: {
              code: [
                `An open PR already exists for ${head} -> ${base}.`,
                `PR #${pr.number}: ${pr.title}`,
                `URL: ${pr.html_url}`,
              ].join('\n'),
              filesWritten: [],
              fileContents: {},
              ragSources: [],
              workspaceContext: { filesRead: [], relevantSymbols: [] },
              githubContext: { repoInfo: `${owner}/${repo}`, currentBranch: base },
              tips: [
                `Open PR #${pr.number}: ${pr.html_url}`,
                'Use Smart Mode command "list latest PR" for quick status checks.',
              ],
            },
            sources: { workspace: [], github: `${owner}/${repo}`, rag: [] },
          },
        };
      }

      const title = this.extractPrTitleFromIntent(intent) || `AI Smart PR: ${head} -> ${base}`;
      const body = this.extractPrBodyFromIntent(intent) || `Created by Smart Mode orchestration.\n\nSource branch: ${head}\nTarget branch: ${base}`;

      const { data: prData } = await octokit.rest.pulls.create({
        owner,
        repo,
        title,
        body,
        head,
        base,
      });

      return {
        handled: true,
        response: {
          success: true,
          message: 'Pull request created successfully',
          result: {
            code: [
              `PR created successfully in ${owner}/${repo}.`,
              `PR #${prData.number}: ${prData.title}`,
              `Branch flow: ${head} -> ${base}`,
              `URL: ${prData.html_url}`,
            ].join('\n'),
            filesWritten: [],
            fileContents: {},
            ragSources: [],
            workspaceContext: { filesRead: [], relevantSymbols: [] },
            githubContext: { repoInfo: `${owner}/${repo}`, currentBranch: base },
            tips: [
              `Review PR: ${prData.html_url}`,
              'You can now request Smart Mode to summarize risks or generate release notes from this PR.',
            ],
          },
          sources: { workspace: [], github: `${owner}/${repo}`, rag: [] },
        },
      };
    } catch (error) {
      return {
        handled: true,
        response: {
          success: false,
          message: 'GitHub PR action failed',
          error: (error as Error).message,
          sources: { workspace: [], rag: [] },
        },
      };
    }
  }

  private extractRepoFromIntent(intent: string): string | null {
    const m = intent.match(/\brepo(?:sitory)?\s+([a-zA-Z0-9._-]+)/i);
    return m ? m[1] : null;
  }

  private extractHeadBranchFromIntent(intent: string): string | null {
    const patterns = [
      /\bfrom\s+branch\s+([a-zA-Z0-9._\/-]+)/i,
      /\bhead\s+([a-zA-Z0-9._\/-]+)/i,
      /\bbranch\s+([a-zA-Z0-9._\/-]+)/i,
      /\bfrom\s+([a-zA-Z0-9._\/-]+)/i,
    ];

    for (const pattern of patterns) {
      const m = intent.match(pattern);
      if (m?.[1]) {
        const candidate = m[1].trim();
        if (!/^(main|master|develop|dev|production)$/i.test(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  }

  private extractBaseFromIntent(intent: string): string | null {
    const patterns = [
      /\bto\s+branch\s+([a-zA-Z0-9._\/-]+)/i,
      /\binto\s+([a-zA-Z0-9._\/-]+)/i,
      /\btarget\s+([a-zA-Z0-9._\/-]+)/i,
      /\bbase\s+([a-zA-Z0-9._\/-]+)/i,
    ];
    for (const pattern of patterns) {
      const m = intent.match(pattern);
      if (m?.[1]) return m[1].trim();
    }
    return null;
  }

  private extractPrTitleFromIntent(intent: string): string | null {
    const m = intent.match(/\btitle\s*[:=]\s*"([^"]+)"|\btitle\s*[:=]\s*'([^']+)'/i);
    return m ? (m[1] || m[2] || '').trim() : null;
  }

  private extractPrBodyFromIntent(intent: string): string | null {
    const m = intent.match(/\b(description|body)\s*[:=]\s*"([\s\S]+)"|\b(description|body)\s*[:=]\s*'([\s\S]+)'/i);
    if (!m) return null;
    return (m[2] || m[4] || '').trim() || null;
  }

  private getLocalCurrentBranch(): string | null {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.workspacePath,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
      return branch || null;
    } catch {
      return null;
    }
  }

  /**
   * Extract workspace context: list files and find relevant symbols
   */
  private extractWorkspaceContext(
    intent: string,
    contextFiles: string[],
  ): { filesRead: string[]; relevantSymbols: string[] } {
    let filesRead: string[] = [...contextFiles];
    const relevantSymbols: string[] = [];

    // Extract potential class/method names from intent
    // e.g., "Update QuoteService" → search for QuoteService
    const matches = intent.match(/\b([A-Z][a-zA-Z0-9]*(?:Service|Controller|Handler|Manager|Repository|Util|Helper))\b/g);
    if (matches) {
      for (const symbol of matches) {
        try {
          const found = ragRetriever.retrieveSymbol(symbol);
          if (found) {
            relevantSymbols.push(symbol);
            filesRead.push(found.symbol.filePath);
          }
        } catch (_) {
          // Symbol not found, continue
        }
      }
    }

    // Remove duplicates
    filesRead = [...new Set(filesRead)];

    return { filesRead, relevantSymbols };
  }

  /**
   * Extract GitHub context: repo info, current branch
   */
  private async extractGitHubContext(): Promise<{
    repoInfo: string;
    currentBranch: string;
  }> {
    try {
      const owner = process.env.GITHUB_OWNER || '';
      const repo = process.env.GITHUB_REPO || '';
      const octokit = (this.gitHubHandler as any).octokit;

      if (!octokit || !owner || !repo) {
        throw new Error('GitHub not configured');
      }

      const { data: repoData } = await octokit.rest.repos.get({
        owner,
        repo,
      });

      return {
        repoInfo: `${owner}/${repo}`,
        currentBranch: repoData.default_branch,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Run RAG retrieval with multi-query strategy
   */
  private async retrieveRAGContext(intent: string): Promise<RagSource[]> {
    try {
      const queries = [intent, intent.split(' ').slice(0, 5).join(' ')];
      const retrieved = await ragRetriever.retrieveMultiWithSources(queries, 10);
      const results = retrieved.sources || [];

      // Deduplicate by path
      const seen = new Set<string>();
      const deduped: RagSource[] = [];
      for (const source of results) {
        if (!seen.has(source.path)) {
          seen.add(source.path);
          deduped.push(source);
        }
      }

      return deduped;
    } catch (error) {
      console.warn('[Orchestrator] RAG retrieval failed:', error);
      return [];
    }
  }

  /**
   * Build enhanced prompt with context from all services
   */
  private buildEnhancedPrompt(
    intent: string,
    workspaceContext: { filesRead: string[]; relevantSymbols: string[] },
    githubContext: { repoInfo: string; currentBranch: string } | undefined,
    ragSources: RagSource[],
  ): string {
    let prompt = intent;

    // Add workspace context
    if (workspaceContext.filesRead.length > 0) {
      prompt += `\n\n── Workspace Context ──\nRelevant files identified: ${workspaceContext.filesRead.join(', ')}`;
    }

    if (workspaceContext.relevantSymbols.length > 0) {
      prompt += `\nRelevant symbols: ${workspaceContext.relevantSymbols.join(', ')}`;
    }

    // Add GitHub context
    if (githubContext) {
      prompt += `\n\n── GitHub Context ──\nRepository: ${githubContext.repoInfo}\nDefault branch: ${githubContext.currentBranch}`;
    }

    // Add RAG context
    if (ragSources.length > 0) {
      prompt += `\n\n── Knowledge Base Context (RAG) ──\n`;
      prompt += `Retrieved ${ragSources.length} relevant document(s):\n`;
      for (const source of ragSources.slice(0, 5)) {
        prompt += `• ${source.file}: ${source.linesRead} lines, ${source.chunks} chunk(s)\n`;
      }
    }

    prompt += `\n\nUse all provided context to generate accurate, workspace-aware code. Reference specific class names, methods, and patterns from the context.`;

    return prompt;
  }
}
