# MCP Server: VS Code + GitHub Integration

A comprehensive TypeScript scaffold for an MCP (Model Context Protocol) server that provides tools for VS Code file operations and GitHub integration.

## Features

### VS Code Tool
- **Open File**: Read file contents with metadata
- **Edit File**: Create, update, or modify files (with optional line-range editing)
- **Generate Code**: Generate code snippets based on prompts (placeholder for AI integration)
- **Run Commands**: Execute shell commands in the workspace

### GitHub Tool
- **Commit**: Create commits with multiple file changes using REST API
- **Push**: Push commits to specified branches
- **Create Pull Request**: Create PRs with labels and descriptions
- **Get Repository Info**: Fetch repository metadata

## Project Structure

```
mcp-server/
├── src/
│   ├── types.ts                    # Type definitions
│   ├── tools/
│   │   ├── vscode.ts             # VS Code tool schema
│   │   └── github.ts             # GitHub tool schema
│   ├── handlers/
│   │   ├── vscode-handler.ts      # VS Code operations
│   │   ├── github-handler.ts      # GitHub operations
│   │   └── index.ts               # Main handler router
│   ├── client/
│   │   └── client.ts              # MCP client interface
│   ├── server.ts                  # Express server setup
│   └── client.ts                  # Interactive CLI client
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## Installation

1. Clone/extract the project
2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env
   ```

   Update `.env` with:
   ```
   GITHUB_TOKEN=your_github_token
   GITHUB_OWNER=your_github_username
   GITHUB_REPO=your_repository_name
   VSCODE_WORKSPACE_PATH=/path/to/workspace
   MCP_SERVER_PORT=3000
   MCP_SERVER_HOST=localhost
   ```

## Build & Run

### Build
```bash
npm run build
```

### Start Server
```bash
npm start
```

Or with TypeScript directly:
```bash
npm run dev
```

### Run Interactive Client
```bash
npm run client
```

## API Endpoints

### Health Check
```bash
GET /health
```

### List Tools
```bash
GET /tools
```

Response:
```json
{
  "success": true,
  "tools": [
    {
      "name": "vs-code",
      "description": "...",
      "inputSchema": {...}
    },
    {
      "name": "github",
      "description": "...",
      "inputSchema": {...}
    }
  ]
}
```

### MCP RPC Endpoint
```bash
POST /rpc
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": "request-1",
  "method": "tools/call",
  "params": {
    "name": "vs-code",
    "arguments": {
      "operation": "open_file",
      "filePath": "src/index.ts"
    }
  }
}
```

### Batch Requests
```bash
POST /batch
Content-Type: application/json

[
  {
    "jsonrpc": "2.0",
    "id": "request-1",
    "method": "tools/call",
    "params": {...}
  },
  {
    "jsonrpc": "2.0",
    "id": "request-2",
    "method": "tools/call",
    "params": {...}
  }
]
```

## Tool Usage Examples

### VS Code: Open File

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "tools/call",
  "params": {
    "name": "vs-code",
    "arguments": {
      "operation": "open_file",
      "filePath": "src/server.ts"
    }
  }
}
```

**Response:**
```json
{
  "id": "1",
  "result": {
    "success": true,
    "filePath": "src/server.ts",
    "content": "import express from 'express'...",
    "lineCount": 150,
    "size": 5234
  }
}
```

### VS Code: Edit File

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": "2",
  "method": "tools/call",
  "params": {
    "name": "vs-code",
    "arguments": {
      "operation": "edit_file",
      "filePath": "src/app.ts",
      "content": "export const app = { version: '1.0.0' };",
      "lineStart": 1,
      "lineEnd": 3
    }
  }
}
```

**Response:**
```json
{
  "id": "2",
  "result": {
    "success": true,
    "filePath": "src/app.ts",
    "message": "File updated successfully",
    "size": 2048
  }
}
```

### VS Code: Generate Code

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": "3",
  "method": "tools/call",
  "params": {
    "name": "vs-code",
    "arguments": {
      "operation": "generate_code",
      "prompt": "Create a TypeScript function to validate email addresses",
      "language": "typescript",
      "context": "For user registration form"
    }
  }
}
```

### VS Code: Run Command

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": "4",
  "method": "tools/call",
  "params": {
    "name": "vs-code",
    "arguments": {
      "operation": "run_command",
      "command": "npm",
      "args": ["test"]
    }
  }
}
```

**Response:**
```json
{
  "id": "4",
  "result": {
    "success": true,
    "command": "npm",
    "args": ["test"],
    "stdout": "PASS  tests/unit.test.ts",
    "stderr": "",
    "exitCode": 0
  }
}
```

### GitHub: Commit

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": "5",
  "method": "tools/call",
  "params": {
    "name": "github",
    "arguments": {
      "operation": "commit",
      "message": "feat: Add new authentication module",
      "files": {
        "src/auth.ts": "export class Auth { ... }",
        "tests/auth.test.ts": "describe('Auth', () => { ... })"
      },
      "branch": "develop"
    }
  }
}
```

**Response:**
```json
{
  "id": "5",
  "result": {
    "success": true,
    "message": "Committed 2 file(s)",
    "commit": {
      "sha": "abc123def456",
      "url": "https://api.github.com/repos/owner/repo/git/commits/abc123def456",
      "message": "feat: Add new authentication module",
      "author": "John Doe",
      "timestamp": "2024-05-27T10:30:00Z"
    }
  }
}
```

### GitHub: Create Pull Request

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": "6",
  "method": "tools/call",
  "params": {
    "name": "github",
    "arguments": {
      "operation": "create_pull_request",
      "title": "feat: Add authentication module",
      "description": "Implements JWT-based authentication with role-based access control",
      "head": "feature/auth",
      "base": "main",
      "labels": ["feature", "backend"]
    }
  }
}
```

**Response:**
```json
{
  "id": "6",
  "result": {
    "success": true,
    "message": "Pull request created successfully",
    "pullRequest": {
      "number": 42,
      "url": "https://github.com/owner/repo/pull/42",
      "state": "open",
      "title": "feat: Add authentication module",
      "id": "PR_kwDOAbCdEQ4Abc123",
      "labels": ["feature", "backend"],
      "head": "feature/auth",
      "base": "main"
    }
  }
}
```

## Type Definitions

The project includes comprehensive TypeScript types for all MCP operations:

- `MCPRequest` / `MCPResponse` - Core MCP protocol types
- `ToolDefinition` - Tool schema definition
- `VSCodeOpenFileParams`, `VSCodeEditFileParams`, etc. - VS Code parameter types
- `GitHubCommitParams`, `GitHubPullRequestParams`, etc. - GitHub parameter types

## Error Handling

All handlers follow a consistent error response format:

```json
{
  "id": "request-id",
  "error": {
    "code": -1,
    "message": "Error description",
    "data": {
      "code": "ERROR_CODE"
    }
  },
  "jsonrpc": "2.0"
}
```

### Error Codes
- `VSCODE_OPEN_FILE_ERROR` - Failed to open file
- `VSCODE_EDIT_FILE_ERROR` - Failed to edit file
- `VSCODE_GENERATE_CODE_ERROR` - Failed to generate code
- `VSCODE_RUN_COMMAND_ERROR` - Failed to run command
- `GITHUB_COMMIT_ERROR` - Failed to create commit
- `GITHUB_PUSH_ERROR` - Failed to push
- `GITHUB_PR_ERROR` - Failed to create PR
- `UNKNOWN_OPERATION` - Unknown tool operation
- `TOOL_NOT_FOUND` - Tool not found
- `MISSING_TOOL_NAME` - Tool name missing in request

## Security Considerations

1. **Path Validation**: VS Code operations validate that file paths stay within the workspace
2. **Environment Variables**: Sensitive credentials stored in `.env` (never committed)
3. **Command Execution**: Limited to workspace directory
4. **Authentication**: GitHub operations require valid token
5. **HTTPS**: Use HTTPS in production

## Development

### Watch Mode
```bash
# Not configured by default, add to package.json:
"watch": "tsc --watch"
```

### Testing
```bash
npm test
```

## Next Steps

1. Integrate with OpenAI/Claude for code generation
2. Add WebSocket support for real-time updates
3. Implement GitHub webhooks for event handling
4. Add authentication/authorization for MCP endpoint
5. Create VS Code extension that uses this MCP server
6. Add support for more VCS systems (GitLab, Bitbucket)
7. Implement file watching and auto-sync capabilities

## License

MIT

## Contributing

Feel free to extend this scaffold with additional tools and operations!
