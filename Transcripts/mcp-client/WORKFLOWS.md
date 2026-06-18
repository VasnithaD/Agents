# MCP Server - Integrated Workflows Guide

Complete guide to orchestrating code generation, insertion, and deployment using LLM, VS Code, and GitHub tools together.

---

## Workflow Overview

The MCP server supports end-to-end workflows that:
1. **Generate** code using LLM
2. **Insert** code into VS Code
3. **Review** the code
4. **Commit** to GitHub
5. **Create PRs** for review

---

## Workflow 1: Generate → Insert → Commit → PR

### Full End-to-End Workflow

```
┌─────────────────────────────────────────────────────┐
│ 1. Generate Code with LLM                          │
│    Input: Prompt, context, language                │
│    Output: Generated code + workflow ID             │
└──────────────┬──────────────────────────────────────┘
               ↓
┌─────────────────────────────────────────────────────┐
│ 2. Insert Code into VS Code                         │
│    Input: Workflow ID, file path                    │
│    Output: File created/modified                    │
└──────────────┬──────────────────────────────────────┘
               ↓
┌─────────────────────────────────────────────────────┐
│ 3. Review Code with LLM                             │
│    Input: Generated code                            │
│    Output: Quality score + issues                   │
└──────────────┬──────────────────────────────────────┘
               ↓
┌─────────────────────────────────────────────────────┐
│ 4. Commit to GitHub                                 │
│    Input: File content, message                     │
│    Output: Commit SHA + URL                         │
└──────────────┬──────────────────────────────────────┘
               ↓
┌─────────────────────────────────────────────────────┐
│ 5. Create Pull Request                              │
│    Input: Branch, title, description                │
│    Output: PR number + URL                          │
└─────────────────────────────────────────────────────┘
```

### Step-by-Step Implementation

#### Step 1: Generate Code

```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "workflow-step-1",
    "method": "tools/call",
    "params": {
      "name": "llm",
      "arguments": {
        "operation": "generate_with_workflow",
        "prompt": "Create a user authentication service with login and signup methods",
        "language": "typescript",
        "context": "Express.js backend with JWT tokens",
        "filePath": "src/services/auth.service.ts",
        "commitMessage": "feat: Add user authentication service"
      }
    }
  }' | jq '.result.workflow.id' > workflow_id.txt
```

**Response**:
```json
{
  "success": true,
  "workflow": {
    "id": "workflow-1234567890",
    "prompt": "Create a user authentication service...",
    "generatedCode": "export class AuthService { ... }",
    "language": "typescript",
    "status": "generated"
  },
  "nextActions": [...]
}
```

#### Step 2: Insert into VS Code

```bash
WORKFLOW_ID=$(cat workflow_id.txt | tr -d '"')

curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "workflow-step-2",
    "method": "tools/call",
    "params": {
      "name": "vs-code",
      "arguments": {
        "operation": "edit_file",
        "filePath": "src/services/auth.service.ts",
        "content": "export class AuthService { ... }"
      }
    }
  }'
```

#### Step 3: Review Code (Optional)

```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "workflow-step-3",
    "method": "tools/call",
    "params": {
      "name": "llm",
      "arguments": {
        "operation": "review_code",
        "code": "export class AuthService { ... }",
        "language": "typescript",
        "focusAreas": ["security", "error handling", "type safety"]
      }
    }
  }'
```

#### Step 4: Commit to GitHub

```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "workflow-step-4",
    "method": "tools/call",
    "params": {
      "name": "github",
      "arguments": {
        "operation": "commit",
        "message": "feat: Add user authentication service",
        "files": {
          "src/services/auth.service.ts": "export class AuthService { ... }",
          "src/types/auth.types.ts": "export interface AuthPayload { ... }"
        },
        "branch": "feature/authentication"
      }
    }
  }'
```

#### Step 5: Create Pull Request

```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "workflow-step-5",
    "method": "tools/call",
    "params": {
      "name": "github",
      "arguments": {
        "operation": "create_pull_request",
        "title": "feat: Add user authentication service",
        "description": "Implements JWT-based authentication with login/signup endpoints",
        "head": "feature/authentication",
        "base": "main",
        "labels": ["feature", "backend", "authentication"]
      }
    }
  }'
```

---

## Workflow 2: Refactor Existing Code

### Code Quality Improvement Workflow

```
┌─────────────────────────────────────┐
│ 1. Review existing code             │
└────────────┬────────────────────────┘
             ↓
        Issues found?
        /          \
      YES          NO
       │            └──→ Done
       ↓
┌─────────────────────────────────────┐
│ 2. Refactor based on issues         │
└────────────┬────────────────────────┘
             ↓
┌─────────────────────────────────────┐
│ 3. Review refactored code           │
└────────────┬────────────────────────┘
             ↓
┌─────────────────────────────────────┐
│ 4. If improved, commit changes      │
└─────────────────────────────────────┘
```

### Implementation

```typescript
import MCPClient from './src/client';

const client = new MCPClient('http://localhost:3000');

async function refactorWorkflow() {
  // Step 1: Get existing code
  const fileContent = await client.vsCodeOpenFile('src/utils/helpers.ts');
  const code = (fileContent.result as any).content;

  // Step 2: Review for issues
  const review = await client.llmReviewCode(
    code,
    'typescript',
    ['performance', 'readability', 'error-handling']
  );
  
  console.log('Quality Score:', (review.result as any).review.overallQuality);
  
  if ((review.result as any).review.overallQuality < 7) {
    // Step 3: Refactor code
    const refactored = await client.llmRefactorCode(
      code,
      'typescript',
      'Improve performance and readability based on review',
      'utility functions for data processing'
    );

    const refactoredCode = (refactored.result as any).refactoredCode;

    // Step 4: Update file
    await client.vsCodeEditFile('src/utils/helpers.ts', refactoredCode);

    // Step 5: Commit changes
    await client.gitHubCommit(
      'refactor: Improve helpers.ts code quality',
      { 'src/utils/helpers.ts': refactoredCode },
      'main'
    );

    console.log('✅ Code refactored and committed');
  }
}

refactorWorkflow();
```

---

## Workflow 3: Feature Development Sprint

### Complete Feature Development

```bash
# 1. Create feature branch
git checkout -b feature/new-dashboard

# 2. Generate UI components
curl -X POST http://localhost:3000/rpc ... generate_component

# 3. Generate API endpoints
curl -X POST http://localhost:3000/rpc ... generate_api

# 4. Generate database migrations
curl -X POST http://localhost:3000/rpc ... generate_migration

# 5. Generate tests
curl -X POST http://localhost:3000/rpc ... generate_tests

# 6. Insert all files into VS Code
# 7. Review all generated code
# 8. Run tests locally
# 9. Commit all changes
# 10. Create pull request
```

---

## Workflow 4: Documentation Generation

### Auto-Generate Documentation

```typescript
async function generateDocumentation() {
  const sourceCode = await client.vsCodeOpenFile('src/api/users.ts');
  const code = (sourceCode.result as any).content;

  // Generate documentation
  const docs = await client.llmChat(
    `Generate comprehensive API documentation for this code:\n${code}`,
    'Include endpoint descriptions, parameters, responses, and examples'
  );

  // Create documentation file
  const docContent = (docs.result as any).response;
  await client.vsCodeEditFile('docs/API.md', docContent);

  // Commit
  await client.gitHubCommit(
    'docs: Auto-generate API documentation',
    { 'docs/API.md': docContent },
    'main'
  );
}

generateDocumentation();
```

---

## Workflow 5: Bug Fix Automation

### Automated Bug Fix Workflow

```
1. Report: Bug in production
   ↓
2. Generate: Fix code based on bug description
   ↓
3. Insert: Code into feature branch
   ↓
4. Review: Generated fix
   ↓
5. Test: Run unit/integration tests
   ↓
6. Commit: Push to GitHub
   ↓
7. Deploy: Create hotfix PR
```

---

## TypeScript Client Example

### Complete Workflow Implementation

```typescript
import MCPClient from './src/client';

interface WorkflowConfig {
  prompt: string;
  language: string;
  filePath: string;
  branch: string;
  commitMessage: string;
  prTitle: string;
  prDescription: string;
  prLabels: string[];
}

class CodeGenerationWorkflow {
  private client: MCPClient;

  constructor(serverUrl: string = 'http://localhost:3000') {
    this.client = new MCPClient(serverUrl);
  }

  async execute(config: WorkflowConfig): Promise<void> {
    console.log('🚀 Starting code generation workflow...\n');

    // Step 1: Generate Code
    console.log('1️⃣  Generating code...');
    const generateResponse = await this.client.llmGenerateCode(
      config.prompt,
      config.language
    );

    if (generateResponse.error) {
      throw new Error(`Generation failed: ${generateResponse.error.message}`);
    }

    const generatedCode = (generateResponse.result as any).code;
    console.log('✅ Code generated\n');

    // Step 2: Insert into VS Code
    console.log('2️⃣  Inserting code into VS Code...');
    const insertResponse = await this.client.vsCodeEditFile(
      config.filePath,
      generatedCode
    );

    if (insertResponse.error) {
      throw new Error(`Insert failed: ${insertResponse.error.message}`);
    }

    console.log('✅ Code inserted\n');

    // Step 3: Review Generated Code
    console.log('3️⃣  Reviewing generated code...');
    const reviewResponse = await this.client.llmReviewCode(
      generatedCode,
      config.language,
      ['security', 'performance', 'type-safety']
    );

    const review = (reviewResponse.result as any).review;
    console.log(`   Quality Score: ${review.overallQuality}/10`);
    console.log(`   Issues Found: ${review.issues.length}`);
    console.log('✅ Review complete\n');

    // Step 4: Commit to GitHub
    console.log('4️⃣  Committing to GitHub...');
    const commitResponse = await this.client.gitHubCommit(
      config.commitMessage,
      { [config.filePath]: generatedCode },
      config.branch
    );

    if (commitResponse.error) {
      throw new Error(`Commit failed: ${commitResponse.error.message}`);
    }

    const commitSha = (commitResponse.result as any).commit.sha;
    console.log(`   Commit: ${commitSha.substring(0, 8)}`);
    console.log('✅ Committed\n');

    // Step 5: Create Pull Request
    console.log('5️⃣  Creating Pull Request...');
    const prResponse = await this.client.gitHubCreatePullRequest(
      config.prTitle,
      config.branch,
      'main',
      config.prDescription,
      config.prLabels
    );

    if (prResponse.error) {
      throw new Error(`PR creation failed: ${prResponse.error.message}`);
    }

    const prNumber = (prResponse.result as any).pullRequest.number;
    const prUrl = (prResponse.result as any).pullRequest.url;
    console.log(`   PR #${prNumber}: ${prUrl}`);
    console.log('✅ Pull Request created\n');

    console.log('🎉 Workflow completed successfully!');
    console.log(`\nSummary:`);
    console.log(`  ✓ Generated: ${config.language} code`);
    console.log(`  ✓ Inserted: ${config.filePath}`);
    console.log(`  ✓ Quality: ${review.overallQuality}/10`);
    console.log(`  ✓ Committed: ${commitSha.substring(0, 8)}`);
    console.log(`  ✓ PR Created: #${prNumber}`);
  }
}

// Usage
async function main() {
  const workflow = new CodeGenerationWorkflow();

  await workflow.execute({
    prompt: 'Create a REST API endpoint for user management with CRUD operations',
    language: 'typescript',
    filePath: 'src/routes/users.ts',
    branch: 'feature/user-management',
    commitMessage: 'feat: Add user management API endpoints',
    prTitle: 'feat: Add user management API',
    prDescription: 'Implements complete CRUD operations for user management',
    prLabels: ['feature', 'api', 'backend'],
  });
}

main().catch(console.error);
```

---

## Error Handling in Workflows

### Resilient Workflow Implementation

```typescript
async function resilientWorkflow(config: WorkflowConfig) {
  const maxRetries = 3;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      // Execute workflow steps
      const generateResponse = await this.client.llmGenerateCode(
        config.prompt,
        config.language
      );

      if (generateResponse.error) {
        throw new Error(
          `Generation failed: ${generateResponse.error.message}`
        );
      }

      // Continue with other steps...
      return;
    } catch (error) {
      retries++;
      console.error(
        `Attempt ${retries} failed: ${(error as Error).message}`
      );

      if (retries < maxRetries) {
        // Exponential backoff
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, retries) * 1000)
        );
      }
    }
  }

  throw new Error('Workflow failed after maximum retries');
}
```

---

## Performance Monitoring

### Workflow Metrics

```typescript
interface WorkflowMetrics {
  totalDuration: number;
  stepDurations: Record<string, number>;
  tokensUsed: number;
  estimatedCost: number;
}

async function workflowWithMetrics(config: WorkflowConfig): Promise<WorkflowMetrics> {
  const metrics: WorkflowMetrics = {
    totalDuration: 0,
    stepDurations: {},
    tokensUsed: 0,
    estimatedCost: 0,
  };

  const startTime = Date.now();

  // Step 1: Generate
  const step1Start = Date.now();
  const generateResponse = await this.client.llmGenerateCode(...);
  metrics.stepDurations['generate'] = Date.now() - step1Start;
  metrics.tokensUsed += (generateResponse.result as any).usage.totalTokens;

  // ... other steps

  metrics.totalDuration = Date.now() - startTime;
  metrics.estimatedCost = metrics.tokensUsed * 0.00002; // Adjust based on pricing

  return metrics;
}
```

---

## Troubleshooting Workflows

### Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| "API Key Invalid" | Wrong credentials | Check .env file |
| "Rate Limited" | Too many requests | Add exponential backoff |
| "Generation Quality Poor" | Vague prompt | Provide more context |
| "Insert Failed" | Path invalid | Verify file path |
| "Commit Failed" | Branch doesn't exist | Create branch first |
| "PR Creation Failed" | Missing upstream | Ensure branch is tracked |

---

## Best Practices

1. **Always validate prompts**: Ensure input is specific and clear
2. **Review generated code**: Don't blindly commit AI-generated code
3. **Use appropriate temperatures**: Lower for consistency, higher for creativity
4. **Handle errors gracefully**: Implement retry logic
5. **Monitor token usage**: Track costs and optimize prompts
6. **Test locally first**: Run tests before creating PRs
7. **Add comments**: Include context about AI-generated code

---

## Advanced Workflows

### Workflow: Multi-File Generation

Generate multiple related files in one workflow.

### Workflow: Continuous Refactoring

Periodically review and refactor code automatically.

### Workflow: Quality Gates

Enforce quality standards before allowing commits.

### Workflow: Security Scanning

Generate and review code for security issues.

---

## Next Steps

1. Test basic workflows
2. Customize for your use case
3. Build automation pipelines
4. Monitor and optimize
5. Scale to team workflows

---

**Ready to automate your development? Start with a simple workflow and expand! 🚀**
