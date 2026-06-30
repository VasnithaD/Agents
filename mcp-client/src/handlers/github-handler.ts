import {
  MCPResponse,
  GitHubCommitParams,
  GitHubPushParams,
  GitHubPullRequestParams,
  GitHubCommitResult,
  GitHubPullRequestResult,
} from '../types';
import { Octokit } from 'octokit';
import { execSync } from 'child_process';

/**
 * GitHub Tool Handler
 * Implements all GitHub operations using REST and GraphQL APIs
 */
export class GitHubHandler {
  private octokit: Octokit;
  private owner: string;
  private repo: string;
  private localRepoPath: string;

  constructor(
    token: string,
    owner: string,
    repo: string,
    localRepoPath: string = process.cwd()
  ) {
    this.octokit = new Octokit({ auth: token });
    this.owner = owner;
    this.repo = repo;
    this.localRepoPath = localRepoPath;
  }

  setLocalRepoPath(newPath: string): void {
    this.localRepoPath = newPath;
  }

  /**
   * Commit changes to a branch
   */
  async commit(params: GitHubCommitParams): Promise<MCPResponse> {
    try {
      const branch = params.branch || 'main';
      const fileUpdates = [];

      // Get current branch tip
      const { data: refData } = await this.octokit.rest.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${branch}`,
      });

      const currentCommitSha = refData.object.sha;

      // Get commit data
      const { data: commitData } = await this.octokit.rest.git.getCommit({
        owner: this.owner,
        repo: this.repo,
        commit_sha: currentCommitSha,
      });

      // Create blobs for each file
      for (const [filePath, content] of Object.entries(params.files)) {
        const { data: blobData } = await this.octokit.rest.git.createBlob({
          owner: this.owner,
          repo: this.repo,
          content: content as string,
          encoding: 'utf-8',
        });

        fileUpdates.push({
          path: filePath,
          mode: '100644' as const,
          type: 'blob' as const,
          sha: blobData.sha,
        });
      }

      // Create tree
      const { data: treeData } = await this.octokit.rest.git.createTree({
        owner: this.owner,
        repo: this.repo,
        base_tree: commitData.tree.sha,
        tree: fileUpdates,
      });

      // Create commit
      const { data: newCommitData } =
        await this.octokit.rest.git.createCommit({
          owner: this.owner,
          repo: this.repo,
          message: params.message,
          tree: treeData.sha,
          parents: [currentCommitSha],
        });

      // Update ref
      await this.octokit.rest.git.updateRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${branch}`,
        sha: newCommitData.sha,
      });

      return {
        id: this.generateId(),
        result: {
          success: true,
          message: `Committed ${Object.keys(params.files).length} file(s)`,
          commit: {
            sha: newCommitData.sha,
            url: newCommitData.url,
            message: params.message,
            author: newCommitData.author?.name || 'Unknown',
            timestamp: newCommitData.author?.date || new Date().toISOString(),
          },
        },
        jsonrpc: '2.0',
      };
    } catch (error) {
      return this.errorResponse(
        (error as Error).message,
        'GITHUB_COMMIT_ERROR'
      );
    }
  }

  /**
   * Push commits to remote branch
   */
  async push(params: GitHubPushParams): Promise<MCPResponse> {
    try {
      // Verify branch exists
      const { data: refData } = await this.octokit.rest.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${params.branch}`,
      });

      return {
        id: this.generateId(),
        result: {
          success: true,
          message: `Successfully pushed to ${params.branch}`,
          branch: params.branch,
          sha: refData.object.sha,
          url: `https://github.com/${this.owner}/${this.repo}/tree/${params.branch}`,
        },
        jsonrpc: '2.0',
      };
    } catch (error) {
      return this.errorResponse(
        (error as Error).message,
        'GITHUB_PUSH_ERROR'
      );
    }
  }

  /**
   * Create a pull request
   */
  async createPullRequest(
    params: GitHubPullRequestParams
  ): Promise<MCPResponse> {
    try {
      const baseBranch = params.base || 'main';

      // Validate that the head branch exists before creating the PR
      try {
        await this.octokit.rest.repos.getBranch({
          owner: this.owner,
          repo: this.repo,
          branch: params.head,
        });
      } catch (branchErr: any) {
        if (branchErr.status === 404) {
          // List available branches to help the user
          const { data: branches } = await this.octokit.rest.repos.listBranches({
            owner: this.owner,
            repo: this.repo,
            per_page: 20,
          });
          const names = branches.map((b: any) => b.name).join(', ') || 'none';
          return this.errorResponse(
            `Branch "${params.head}" does not exist in ${this.owner}/${this.repo}. Available branches: ${names}. Create the branch or commit files to it first using the "Commit File" feature.`,
            'GITHUB_PR_ERROR'
          );
        }
        throw branchErr;
      }

      // Create PR via REST API
      const { data: prData } =
        await this.octokit.rest.pulls.create({
          owner: this.owner,
          repo: this.repo,
          title: params.title,
          body: params.description || '',
          head: params.head,
          base: baseBranch,
        });

      // Add labels if provided
      if (params.labels && params.labels.length > 0) {
        await this.octokit.rest.issues.addLabels({
          owner: this.owner,
          repo: this.repo,
          issue_number: prData.number,
          labels: params.labels,
        });
      }

      return {
        id: this.generateId(),
        result: {
          success: true,
          message: `Pull request created successfully`,
          pullRequest: {
            number: prData.number,
            url: prData.html_url,
            state: prData.state,
            title: prData.title,
            id: prData.id.toString(),
            labels: params.labels || [],
            head: params.head,
            base: baseBranch,
          },
        },
        jsonrpc: '2.0',
      };
    } catch (error) {
      return this.errorResponse(
        (error as Error).message,
        'GITHUB_PR_ERROR'
      );
    }
  }

  /**
   * Get repository information
   */
  async getRepoInfo(): Promise<MCPResponse> {
    try {
      const { data: repoData } = await this.octokit.rest.repos.get({
        owner: this.owner,
        repo: this.repo,
      });

      return {
        id: this.generateId(),
        result: {
          success: true,
          repository: {
            name: repoData.name,
            owner: repoData.owner.login,
            url: repoData.html_url,
            description: repoData.description,
            isPrivate: repoData.private,
            defaultBranch: repoData.default_branch,
            stars: repoData.stargazers_count,
            forks: repoData.forks_count,
          },
        },
        jsonrpc: '2.0',
      };
    } catch (error) {
      return this.errorResponse(
        (error as Error).message,
        'GITHUB_REPO_INFO_ERROR'
      );
    }
  }

  /**
   * Get the full recursive file tree of a repository branch
   */
  async getRepoTree(repo: string, branch: string): Promise<any[]> {
    const owner = this.owner;
    const { data: refData } = await this.octokit.rest.git.getRef({
      owner, repo, ref: `heads/${branch}`,
    });
    const { data: treeData } = await this.octokit.rest.git.getTree({
      owner, repo, tree_sha: refData.object.sha, recursive: '1',
    });
    return this.buildNestedTree(
      treeData.tree.filter((i: any) => i.type === 'blob' || i.type === 'tree')
    );
  }

  private buildNestedTree(items: any[]): any[] {
    const map: Record<string, any> = {};
    for (const item of items) {
      const parts = item.path.split('/');
      map[item.path] = {
        name: parts[parts.length - 1],
        path: item.path,
        type: item.type === 'blob' ? 'file' : 'directory',
        children: item.type === 'tree' ? [] : undefined,
      };
    }
    const root: any[] = [];
    for (const item of items) {
      const parts = item.path.split('/');
      if (parts.length === 1) {
        root.push(map[item.path]);
      } else {
        const parentPath = parts.slice(0, -1).join('/');
        if (map[parentPath]) {
          (map[parentPath].children = map[parentPath].children || []).push(map[item.path]);
        } else {
          root.push(map[item.path]);
        }
      }
    }
    return root;
  }

  /**
   * Get the content + SHA of a single file from GitHub
   */
  async getFileContent(repo: string, filePath: string, branch: string): Promise<{ content: string; sha: string; path: string; size: number }> {
    const owner = this.owner;
    const { data } = await this.octokit.rest.repos.getContent({
      owner, repo, path: filePath, ref: branch,
    });
    if (Array.isArray(data)) throw new Error('Path is a directory');
    const fileData = data as any;
    const content = Buffer.from(fileData.content.replace(/\n/g, ''), 'base64').toString('utf-8');
    return { content, sha: fileData.sha, path: filePath, size: fileData.size };
  }

  /**
   * Create a new branch from a base branch and commit a single file to it
   */
  async commitFileToNewBranch(params: {
    repo: string;
    newBranch: string;
    fromBranch: string;
    filePath: string;
    content: string;
    message: string;
  }): Promise<{ branch: string; commitSha: string; commitUrl: string; filePath: string }> {
    const { repo, newBranch, fromBranch, filePath, content, message } = params;
    const owner = this.owner;

    // Resolve source branch SHA with fallback to repo default branch.
    let baseSha = '';
    try {
      const { data: refData } = await this.octokit.rest.git.getRef({
        owner, repo, ref: `heads/${fromBranch}`,
      });
      baseSha = refData.object.sha;
    } catch (err: any) {
      if (err?.status !== 404) throw err;
      const { data: repoInfo } = await this.octokit.rest.repos.get({ owner, repo });
      const fallback = repoInfo.default_branch;
      const { data: refData } = await this.octokit.rest.git.getRef({
        owner, repo, ref: `heads/${fallback}`,
      });
      baseSha = refData.object.sha;
    }

    // Create branch only if it does not already exist.
    try {
      await this.octokit.rest.git.getRef({ owner, repo, ref: `heads/${newBranch}` });
    } catch (err: any) {
      if (err?.status !== 404) throw err;
      await this.octokit.rest.git.createRef({
        owner, repo, ref: `refs/heads/${newBranch}`, sha: baseSha,
      });
    }

    // Check if file already exists on new branch (need SHA for updates)
    let existingSha: string | undefined;
    try {
      const { data: existing } = await this.octokit.rest.repos.getContent({
        owner, repo, path: filePath, ref: newBranch,
      });
      if (!Array.isArray(existing)) existingSha = (existing as any).sha;
    } catch (e: any) {
      if (e.status !== 404) throw e;
    }

    // Commit the file
    const commitBody: any = {
      owner, repo, path: filePath, message,
      content: Buffer.from(content).toString('base64'),
      branch: newBranch,
    };
    if (existingSha) commitBody.sha = existingSha;

    const { data: commitResult } = await this.octokit.rest.repos.createOrUpdateFileContents(commitBody);
    return {
      branch: newBranch,
      commitSha: commitResult.commit.sha ?? '',
      commitUrl: (commitResult.commit as any).html_url ?? '',
      filePath,
    };
  }

  /**
   * Handle all GitHub operations
   */
  async handle(operation: string, params: any): Promise<MCPResponse> {
    switch (operation) {
      case 'commit':
        return this.commit(params);
      case 'push':
        return this.push(params);
      case 'create_pull_request':
        return this.createPullRequest(params);
      case 'get_repo_info':
        return this.getRepoInfo();
      default:
        return this.errorResponse(`Unknown operation: ${operation}`, 'UNKNOWN_OPERATION');
    }
  }

  private errorResponse(message: string, code: string): MCPResponse {
    // Parse error message to provide better diagnostics
    let fullMessage = message;
    
    if (message.includes('404') || message.includes('Not Found')) {
      fullMessage = `GitHub Repository Not Found: ${this.owner}/${this.repo}
      
Possible causes:
      • Repository doesn't exist
      • GitHub token doesn't have access
      • Repository is private (check token permissions)
      • Repository was deleted
      
Solution: Verify in .env file:
      ✓ GITHUB_TOKEN = valid token (not expired)
      ✓ GITHUB_OWNER = ${this.owner}
      ✓ GITHUB_REPO = ${this.repo}
      
Create token at: https://github.com/settings/tokens`;
    } else if (message.includes('401') || message.includes('Unauthorized')) {
      fullMessage = `GitHub Authentication Error: Invalid or expired token.
      Please verify GITHUB_TOKEN in .env file.
      Create a new token at: https://github.com/settings/tokens`;
    }
    
    return {
      id: this.generateId(),
      error: {
        code: -1,
        message: fullMessage,
        data: { code, owner: this.owner, repo: this.repo },
      },
      jsonrpc: '2.0',
    };
  }

  private generateId(): string {
    return `github-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
