# MCP Server - Four Tools Integration Guide

Complete reference for integrating **VS Code**, **GitHub**, **LLM**, and using them together in powerful workflows.

---

## Quick Reference: Four Tools

### 1. VS Code Tool
**Manage files and run commands**
- `open_file` - Read file contents
- `edit_file` - Create/modify files
- `generate_code` - Generate code (local, placeholder)
- `run_command` - Execute shell commands

### 2. GitHub Tool
**Manage repositories**
- `commit` - Create commits with files
- `push` - Push to branches
- `create_pull_request` - Create PRs with labels
- `get_repo_info` - Fetch repository metadata

### 3. LLM Tool
**AI-powered code operations**
- `generate_code` - Generate code from prompts
- `refactor_code` - Improve existing code
- `review_code` - Analyze code quality
- `chat` - Multi-turn conversations
- `generate_with_workflow` - Integrated workflows

### 4. New: Integrated Workflows
**Combine all tools for automation**

---

## Tool Comparison Matrix

| Feature | VS Code | GitHub | LLM |
|---------|---------|--------|-----|
| File Operations | ✅ | ❌ | ❌ |
| Git Operations | ❌ | ✅ | ❌ |
| Code Generation | ❌ | ❌ | ✅ |
| Code Review | ❌ | ❌ | ✅ |
| Chat/Conversation | ❌ | ❌ | ✅ |
| Local Execution | ✅ | ✅ | ❌ |
| API Calls | ❌ | ✅ | ✅ |

---

## Integration Patterns

### Pattern 1: Sequential Workflow
Generate → Insert → Commit → PR

```
LLM Tool (Generate)
    ↓
VS Code Tool (Insert)
    ↓
GitHub Tool (Commit)
    ↓
GitHub Tool (Create PR)
```

### Pattern 2: Review & Improve
Generate → Review → Refactor → Commit

```
LLM Tool (Generate)
    ↓
LLM Tool (Review)
    ↓
LLM Tool (Refactor)
    ↓
GitHub Tool (Commit)
```

### Pattern 3: Local Development
Edit → Test → Review → Commit

```
VS Code Tool (Edit)
    ↓
VS Code Tool (Run Tests)
    ↓
LLM Tool (Review)
    ↓
GitHub Tool (Commit)
```

### Pattern 4: Code Quality Loop
Review → Analyze → Improve → Verify

```
LLM Tool (Review)
    ↓
LLM Tool (Chat for Analysis)
    ↓
LLM Tool (Refactor)
    ↓
LLM Tool (Review Again)
```

---

## Real-World Use Cases

### Use Case 1: Feature Development
**Goal**: Develop a complete feature from scratch

**Workflow**:
```
1. LLM: Generate API endpoints
2. VS Code: Insert into project
3. LLM: Review for quality
4. VS Code: Run tests
5. GitHub: Commit changes
6. GitHub: Create PR
```

**Example**:
```bash
# Generate feature code
curl -X POST http://localhost:3000/rpc ... {
  "name": "llm",
  "operation": "generate_code",
  "prompt": "Create user management API with CRUD endpoints"
}

# Result: Generated code, file path, and workflow ID

# Insert into project
curl -X POST http://localhost:3000/rpc ... {
  "name": "vs-code",
  "operation": "edit_file",
  "filePath": "src/routes/users.ts",
  "content": "[generated code]"
}

# Continue with commit and PR...
```

### Use Case 2: Code Refactoring Sprint
**Goal**: Improve code quality across the project

**Workflow**:
```
1. VS Code: Open existing file
2. LLM: Review code quality
3. If score < 7:
   a. LLM: Refactor
   b. VS Code: Update file
   c. GitHub: Commit changes
4. Repeat for all files
```

### Use Case 3: Bug Fix Process
**Goal**: Fix production bugs quickly

**Workflow**:
```
1. Chat: Analyze bug description
2. LLM: Generate fix
3. VS Code: Insert fix
4. VS Code: Run tests
5. LLM: Review fix quality
6. GitHub: Commit to hotfix branch
7. GitHub: Create emergency PR
```

### Use Case 4: Documentation Generation
**Goal**: Auto-generate API documentation

**Workflow**:
```
1. VS Code: Read source code
2. LLM: Chat for documentation generation
3. VS Code: Create docs file
4. GitHub: Commit documentation
```

---

## Complete End-to-End Example

### Scenario: Build Login Component

```typescript
import MCPClient from './src/client';

async function buildLoginComponent() {
  const client = new MCPClient('http://localhost:3000');

  console.log('🚀 Building Login Component Workflow\n');

  try {
    // Step 1: Generate React component
    console.log('1. Generating React login component...');
    const generateResp = await client.llmGenerateCode(
      'Create a React login component with email/password form',
      'typescript',
      'React with TypeScript, Tailwind CSS, form validation'
    );

    const component = (generateResp.result as any).code;
    console.log('✅ Generated\n');

    // Step 2: Insert into project
    console.log('2. Inserting into VS Code...');
    await client.vsCodeEditFile(
      'src/components/LoginForm.tsx',
      component
    );
    console.log('✅ Inserted\n');

    // Step 3: Generate tests
    console.log('3. Generating unit tests...');
    const testsResp = await client.llmGenerateCode(
      'Create Jest tests for React login component',
      'typescript',
      'Testing library, mocking, form testing'
    );

    const tests = (testsResp.result as any).code;
    await client.vsCodeEditFile(
      'src/components/LoginForm.test.tsx',
      tests
    );
    console.log('✅ Tests generated\n');

    // Step 4: Review component quality
    console.log('4. Reviewing component quality...');
    const reviewResp = await client.llmReviewCode(
      component,
      'typescript',
      ['accessibility', 'type-safety', 'performance']
    );

    const review = (reviewResp.result as any).review;
    console.log(`Quality Score: ${review.overallQuality}/10`);
    console.log(`Issues: ${review.issues.length}\n`);

    // Step 5: Run tests locally
    console.log('5. Running tests...');
    const testResp = await client.vsCodeRunCommand('npm', undefined, ['test', '--testNamePattern=LoginForm']);
    const testOutput = (testResp.result as any).stdout;
    console.log('✅ Tests passed\n');

    // Step 6: Commit to feature branch
    console.log('6. Committing to GitHub...');
    const commitResp = await client.gitHubCommit(
      'feat: Add login component with tests',
      {
        'src/components/LoginForm.tsx': component,
        'src/components/LoginForm.test.tsx': tests,
      },
      'feature/login-component'
    );

    const commit = (commitResp.result as any).commit;
    console.log(`Commit: ${commit.sha.substring(0, 8)}\n`);

    // Step 7: Create pull request
    console.log('7. Creating pull request...');
    const prResp = await client.gitHubCreatePullRequest(
      'feat: Add login component',
      'feature/login-component',
      'main',
      'Implements React login component with TypeScript types and comprehensive tests',
      ['feature', 'frontend', 'component']
    );

    const pr = (prResp.result as any).pullRequest;
    console.log(`PR #${pr.number}: ${pr.url}\n`);

    console.log('🎉 Workflow Complete!');
    console.log('\nSummary:');
    console.log(`  ✓ Generated component and tests`);
    console.log(`  ✓ Quality score: ${review.overallQuality}/10`);
    console.log(`  ✓ Committed to: feature/login-component`);
    console.log(`  ✓ Pull request: #${pr.number}`);
  } catch (error) {
    console.error('❌ Workflow failed:', (error as Error).message);
  }
}

buildLoginComponent();
```

---

## Tool Interactions

### Direct Tool Calls
```
User → Tools → External Services
  ↓       ↓
LLM  VS Code  GitHub
  ↓       ↓
OpenAI  File System  GitHub API
```

### Chained Operations
```
Step 1        Step 2        Step 3
LLM Generate → VS Code Insert → GitHub Commit

Step 4
GitHub PR
```

### Branching Logic
```
LLM Generate
    ↓
LLM Review
    ↓
Quality >= 8?
  ↓      ↓
 YES    NO
  ↓      ↓
GitHub  LLM Refactor
Commit      ↓
           VS Code Update
               ↓
           GitHub Commit
```

---

## API Request Examples

### Example 1: Generate with Automatic Workflow

```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "tools/call",
  "params": {
    "name": "llm",
    "arguments": {
      "operation": "generate_with_workflow",
      "prompt": "Create authentication service",
      "language": "typescript",
      "filePath": "src/services/auth.ts",
      "commitMessage": "feat: Add auth service",
      "workflowStep": "generate_and_insert"
    }
  }
}
```

### Example 2: Batch Multi-Tool Request

```json
{
  "jsonrpc": "2.0",
  "id": "batch-1",
  "method": "tools/call",
  "params": {
    "name": "llm",
    "arguments": {
      "operation": "generate_code",
      "prompt": "Create API handler"
    }
  }
}
```

Followed by:

```json
{
  "jsonrpc": "2.0",
  "id": "batch-2",
  "method": "tools/call",
  "params": {
    "name": "vs-code",
    "arguments": {
      "operation": "edit_file",
      "filePath": "src/handlers/api.ts",
      "content": "[from previous response]"
    }
  }
}
```

---

## Error Handling Across Tools

### Tool Error Chain

```
LLM Error
  ↓ (catch)
Retry or fallback
  ↓ (success)
VS Code Operation
  ↓ (error)
Rollback LLM result
  ↓
Return error to user
```

### Implementation Example

```typescript
async function safeWorkflow() {
  try {
    // Step 1: LLM Generate
    const gen = await llmGenerate(...);
    if (gen.error) throw new Error('Generation failed');

    // Step 2: VS Code Insert
    const ins = await vsCodeInsert(gen.result);
    if (ins.error) {
      // Rollback: Don't commit failed insert
      throw new Error('Insert failed, workflow aborted');
    }

    // Step 3: GitHub Commit
    const com = await githubCommit(...);
    if (com.error) throw new Error('Commit failed');

    return { success: true };
  } catch (error) {
    // Handle errors at each step
    console.error('Workflow failed:', error);
    return { success: false, error };
  }
}
```

---

## Performance Optimization

### Parallel Execution
```
Generate 3 components simultaneously
    ↓
Insert all in parallel
    ↓
Review all in parallel
    ↓
Commit together
```

### Sequential Optimization
```
Generate + Review (can be parallelized)
    ↓
Only commit if quality >= threshold
    ↓
Create single PR for all changes
```

---

## Configuration Summary

### .env for All Tools

```bash
# VS Code
VSCODE_WORKSPACE_PATH=/path/to/workspace

# GitHub
GITHUB_TOKEN=xxx
GITHUB_OWNER=xxx
GITHUB_REPO=xxx

# LLM - OpenAI
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=gpt-4

# LLM - Azure (alternative)
AZURE_OPENAI_API_KEY=xxx
AZURE_OPENAI_ENDPOINT=https://xxx

# Server
MCP_SERVER_PORT=3000
```

---

## Quick Start Commands

```bash
# Development
npm install
npm run dev

# Client CLI
npm run client

# Build
npm run build

# Production
npm start

# Docker
docker-compose up -d

# Examples
npm run build && node dist/llm-examples.js
```

---

## Troubleshooting Multi-Tool Workflows

| Issue | Tools Affected | Solution |
|-------|---|---|
| Generate fails | LLM | Check API key and model |
| Insert fails | VS Code | Check file path and permissions |
| Commit fails | GitHub | Check branch and credentials |
| Workflow stops | All | Check error response, retry with backoff |

---

## Next Steps

1. ✅ **Setup**: Configure all tools (.env)
2. ✅ **Test**: Try individual tool operations
3. ✅ **Integrate**: Combine tools in workflows
4. ✅ **Automate**: Build custom automation
5. ✅ **Scale**: Deploy to team/production

---

## Resources

- [LLM_GUIDE.md](LLM_GUIDE.md) - LLM tool details
- [WORKFLOWS.md](WORKFLOWS.md) - Workflow patterns
- [README.md](README.md) - Main documentation
- [QUICKSTART.md](QUICKSTART.md) - Getting started
- [llm-examples.ts](llm-examples.ts) - Code examples

---

**Ready to build powerful automation? Combine the tools and create magic! 🚀**
