# LLM Tool Integration Guide

## Overview

The LLM (Large Language Model) tool extends your MCP server with AI-powered code generation, refactoring, and review capabilities. It supports both **OpenAI** and **Azure OpenAI** APIs.

## Features

### 1. Code Generation
Generate code from natural language prompts with context awareness.

### 2. Code Refactoring
Automatically improve existing code based on specific instructions.

### 3. Code Review
Analyze code for quality issues, best practices, and suggestions.

### 4. Interactive Chat
Multi-turn conversations with full history support.

### 5. Integrated Workflows
Generate code and automatically insert it into VS Code or commit to GitHub.

---

## Configuration

### OpenAI Setup

```bash
# .env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-your_api_key_here
OPENAI_MODEL=gpt-4
OPENAI_MAX_TOKENS=2000
LLM_TEMPERATURE=0.7
```

### Azure OpenAI Setup

```bash
# .env
LLM_PROVIDER=azure-openai
AZURE_OPENAI_API_KEY=your_key_here
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=your-deployment-name
AZURE_OPENAI_MODEL=gpt-4
```

---

## Tool Operations

### 1. Generate Code

**Description**: Generate code from a natural language prompt.

**Request**:
```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "tools/call",
  "params": {
    "name": "llm",
    "arguments": {
      "operation": "generate_code",
      "prompt": "Create a function to validate email addresses",
      "language": "typescript",
      "context": "For user registration form validation"
    }
  }
}
```

**Response**:
```json
{
  "id": "1",
  "result": {
    "success": true,
    "code": "export function validateEmail(email: string): boolean {\n  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;\n  return emailRegex.test(email);\n}",
    "language": "typescript",
    "prompt": "Create a function to validate email addresses",
    "usage": {
      "promptTokens": 25,
      "completionTokens": 45,
      "totalTokens": 70
    }
  },
  "jsonrpc": "2.0"
}
```

**Parameters**:
- `prompt` (required): What code to generate
- `language` (optional): Programming language (default: typescript)
- `context` (optional): Additional context for the LLM
- `temperature` (optional): Creativity level 0-2 (default: 0.7)
- `maxTokens` (optional): Maximum response length

**Use Cases**:
- Generate boilerplate code
- Create utility functions
- Build API endpoints
- Generate test cases
- Create UI components

---

### 2. Refactor Code

**Description**: Improve existing code based on specific instructions.

**Request**:
```json
{
  "jsonrpc": "2.0",
  "id": "2",
  "method": "tools/call",
  "params": {
    "name": "llm",
    "arguments": {
      "operation": "refactor_code",
      "code": "function add(a, b) { return a + b; }",
      "language": "typescript",
      "instructions": "Add type annotations and JSDoc comments",
      "context": "For a math utility library"
    }
  }
}
```

**Response**:
```json
{
  "id": "2",
  "result": {
    "success": true,
    "originalCode": "function add(a, b) { return a + b; }",
    "refactoredCode": "/**\n * Adds two numbers together\n * @param a - First number\n * @param b - Second number\n * @returns Sum of a and b\n */\nexport function add(a: number, b: number): number {\n  return a + b;\n}",
    "language": "typescript",
    "instructions": "Add type annotations and JSDoc comments",
    "usage": {
      "promptTokens": 30,
      "completionTokens": 50,
      "totalTokens": 80
    }
  },
  "jsonrpc": "2.0"
}
```

**Parameters**:
- `code` (required): Code to refactor
- `language` (required): Programming language
- `instructions` (required): Refactoring instructions
- `context` (optional): Additional context

**Refactoring Examples**:
- Add type annotations
- Improve performance
- Enhance readability
- Add error handling
- Apply design patterns

---

### 3. Review Code

**Description**: Analyze code for quality issues and provide suggestions.

**Request**:
```json
{
  "jsonrpc": "2.0",
  "id": "3",
  "method": "tools/call",
  "params": {
    "name": "llm",
    "arguments": {
      "operation": "review_code",
      "code": "function getData(url) { let response = fetch(url); return response.json(); }",
      "language": "typescript",
      "focusAreas": ["error handling", "type safety", "performance"]
    }
  }
}
```

**Response**:
```json
{
  "id": "3",
  "result": {
    "success": true,
    "review": {
      "issues": [
        {
          "severity": "error",
          "message": "Synchronous fetch will block",
          "suggestion": "Use async/await pattern"
        },
        {
          "severity": "warning",
          "message": "No error handling",
          "suggestion": "Add try-catch block"
        }
      ],
      "summary": "Code needs error handling and async improvements",
      "overallQuality": 3,
      "suggestions": [
        "Use async/await pattern",
        "Add try-catch error handling",
        "Add type annotations"
      ]
    },
    "language": "typescript",
    "usage": {
      "promptTokens": 35,
      "completionTokens": 60,
      "totalTokens": 95
    }
  },
  "jsonrpc": "2.0"
}
```

**Parameters**:
- `code` (required): Code to review
- `language` (required): Programming language
- `focusAreas` (optional): Specific areas to focus on

**Review Focus Areas**:
- Error handling
- Type safety
- Performance
- Security
- Best practices
- Code style
- Documentation

---

### 4. Chat

**Description**: Multi-turn conversation with history support.

**Request**:
```json
{
  "jsonrpc": "2.0",
  "id": "4",
  "method": "tools/call",
  "params": {
    "name": "llm",
    "arguments": {
      "operation": "chat",
      "message": "How do I implement JWT authentication?",
      "context": "For a Node.js Express API"
    }
  }
}
```

**Response**:
```json
{
  "id": "4",
  "result": {
    "success": true,
    "response": "Here's how to implement JWT authentication in Express...",
    "sessionId": "session-abc123xyz",
    "messageCount": 1,
    "usage": {
      "promptTokens": 40,
      "completionTokens": 150,
      "totalTokens": 190
    }
  },
  "jsonrpc": "2.0"
}
```

**Parameters**:
- `message` (required): Chat message
- `context` (optional): Conversation context
- `conversationHistory` (optional): Previous messages

---

### 5. Generate with Workflow

**Description**: Generate code and optionally insert to VS Code or commit to GitHub.

**Request**:
```json
{
  "jsonrpc": "2.0",
  "id": "5",
  "method": "tools/call",
  "params": {
    "name": "llm",
    "arguments": {
      "operation": "generate_with_workflow",
      "prompt": "Create a user authentication middleware",
      "language": "typescript",
      "filePath": "src/middleware/auth.ts",
      "commitMessage": "feat: Add authentication middleware",
      "workflowStep": "generate_and_insert"
    }
  }
}
```

**Response**:
```json
{
  "id": "5",
  "result": {
    "success": true,
    "workflow": {
      "id": "workflow-1234567890",
      "prompt": "Create a user authentication middleware",
      "generatedCode": "export const authMiddleware = ...",
      "language": "typescript",
      "status": "generated",
      "nextSteps": "insert_to_vscode"
    },
    "nextActions": [
      {
        "action": "insert_to_vscode",
        "description": "Insert generated code into VS Code",
        "params": {
          "workflowId": "workflow-1234567890",
          "filePath": "src/middleware/auth.ts"
        }
      },
      {
        "action": "commit_to_github",
        "description": "Commit generated code to GitHub",
        "params": {
          "workflowId": "workflow-1234567890",
          "message": "feat: Add authentication middleware"
        }
      }
    ]
  },
  "jsonrpc": "2.0"
}
```

**Workflow Steps**:
1. `generate_only` - Just generate code
2. `generate_and_insert` - Generate and insert into VS Code
3. `generate_and_commit` - Generate and commit to GitHub

---

## API Examples

### Using cURL

**Generate Code**:
```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "tools/call",
    "params": {
      "name": "llm",
      "arguments": {
        "operation": "generate_code",
        "prompt": "Create a React component for a button",
        "language": "typescript"
      }
    }
  }' | jq
```

**Review Code**:
```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "2",
    "method": "tools/call",
    "params": {
      "name": "llm",
      "arguments": {
        "operation": "review_code",
        "code": "function process(data) { for(let i=0; i<data.length; i++) {} }",
        "language": "typescript",
        "focusAreas": ["performance", "style"]
      }
    }
  }' | jq
```

### Using the Client

```typescript
import MCPClient from './src/client';

const client = new MCPClient('http://localhost:3000');

// Generate code
const response = await client.llmGenerateCode(
  'Create a TypeScript function to parse JSON',
  'typescript',
  'For API response handling'
);

// Refactor code
const refactored = await client.llmRefactorCode(
  'const x = 1; const y = 2; console.log(x + y);',
  'typescript',
  'Apply ESLint style guide'
);

// Review code
const review = await client.llmReviewCode(
  'function getData(url) { return fetch(url).json(); }',
  'typescript',
  ['error handling', 'async patterns']
);

// Chat
const chat = await client.llmChat(
  'How do I implement pagination in Node.js?',
  'For a REST API'
);

// Generate with workflow
const workflow = await client.llmGenerateWithWorkflow(
  'Create a database migration function',
  'typescript',
  'src/migrations/001_init.ts',
  'feat: Add initial migration'
);
```

---

## Integration Workflows

### Workflow 1: Generate → Insert → Commit

```
1. Generate code with LLM
2. Insert code into VS Code
3. Commit to GitHub
4. Create Pull Request
```

**Commands**:
```bash
# Step 1: Generate
curl -X POST http://localhost:3000/rpc ... "operation": "generate_with_workflow"

# Extract workflowId from response

# Step 2: Insert (via VS Code tool)
curl -X POST http://localhost:3000/rpc ... "operation": "edit_file"

# Step 3: Commit (via GitHub tool)
curl -X POST http://localhost:3000/rpc ... "operation": "commit"

# Step 4: Create PR (via GitHub tool)
curl -X POST http://localhost:3000/rpc ... "operation": "create_pull_request"
```

### Workflow 2: Code Review → Refactor → Validate

```
1. Review existing code
2. If issues found, refactor code
3. Review refactored code
4. Repeat until quality is acceptable
```

---

## Best Practices

### 1. Provide Context
Always include context for better results:
```json
{
  "operation": "generate_code",
  "prompt": "Create a login component",
  "language": "typescript",
  "context": "React with Tailwind CSS, authentication with Firebase"
}
```

### 2. Use Lower Temperature for Consistency
For deterministic operations like refactoring:
```json
{
  "operation": "refactor_code",
  "temperature": 0.3
}
```

### 3. Specify Focus Areas for Reviews
```json
{
  "operation": "review_code",
  "focusAreas": ["security", "performance", "type-safety"]
}
```

### 4. Use Workflows for Integrated Operations
```json
{
  "operation": "generate_with_workflow",
  "workflowStep": "generate_and_insert"
}
```

### 5. Manage Token Usage
Keep track of API costs:
```json
{
  "usage": {
    "promptTokens": 50,
    "completionTokens": 150,
    "totalTokens": 200
  }
}
```

---

## Error Handling

### Common Errors

**Invalid API Key**:
```json
{
  "error": {
    "code": -1,
    "message": "401 Unauthorized",
    "data": {"code": "LLM_GENERATE_CODE_ERROR"}
  }
}
```

**Rate Limited**:
```json
{
  "error": {
    "code": -1,
    "message": "429 Too Many Requests",
    "data": {"code": "LLM_GENERATE_CODE_ERROR"}
  }
}
```

**Invalid Input**:
```json
{
  "error": {
    "code": -1,
    "message": "Invalid language specified",
    "data": {"code": "LLM_REVIEW_CODE_ERROR"}
  }
}
```

---

## Performance Considerations

### Token Limits
- OpenAI: Up to 4,096 tokens for standard, 128,000 for turbo
- Azure: Based on deployment size

### Request Duration
- Generation: 2-10 seconds typically
- Refactoring: 3-8 seconds
- Review: 2-5 seconds

### Rate Limits
- OpenAI: 3,500 requests/minute (free tier)
- Azure: Depends on deployment

---

## Advanced Features

### Batch Processing
```json
POST /batch
[
  {
    "id": "1",
    "method": "tools/call",
    "params": {"name": "llm", "arguments": {"operation": "generate_code", ...}}
  },
  {
    "id": "2",
    "method": "tools/call",
    "params": {"name": "llm", "arguments": {"operation": "review_code", ...}}
  }
]
```

### Conversation History
Store and manage multi-turn conversations:
```typescript
const conversation = [];

const response1 = await client.llmChat("What is TypeScript?");
conversation.push({role: 'user', content: 'What is TypeScript?'});
conversation.push({role: 'assistant', content: response1});

const response2 = await client.llmChat(
  "How do I use it in Node.js?",
  'TypeScript for backend development',
  conversation
);
```

---

## Supported Languages

- TypeScript / JavaScript
- Python
- Java
- C#
- Go
- Rust
- Swift
- Kotlin
- PHP
- SQL
- HTML / CSS
- And more!

---

## Troubleshooting

### Issue: "API Key Invalid"
- Verify OPENAI_API_KEY or AZURE_OPENAI_API_KEY
- Check key hasn't expired
- Ensure correct provider set

### Issue: "Rate Limited"
- Implement exponential backoff
- Reduce request frequency
- Consider caching responses

### Issue: "Quality of Generated Code"
- Provide more context in prompt
- Use lower temperature for consistency
- Specify language and framework

### Issue: "Server Errors"
- Check logs: `npm run dev`
- Verify internet connection
- Ensure LLM provider is accessible

---

## Future Enhancements

✅ Multi-language model selection  
✅ Custom system prompts  
✅ Response caching  
✅ Cost tracking and reporting  
✅ Fine-tuning support  
✅ Streaming responses  

---

## Contributing

To add new LLM operations:

1. Add operation to `src/tools/llm.ts` schema
2. Implement handler in `src/handlers/llm-handler.ts`
3. Add types in `src/types.ts`
4. Add client method in `src/client.ts`
5. Update documentation

---

## License

MIT

---

**Start generating! 🚀**
