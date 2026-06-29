# MCP Server Architecture & Setup Guide

## Architecture Overview

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    MCP Server (Express.js)                  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         HTTP Endpoints (REST API)                    │   │
│  ├──────────────────────────────────────────────────────┤   │
│  │ GET  /health       - Server health check             │   │
│  │ GET  /tools        - List available tools            │   │
│  │ POST /rpc          - Single MCP RPC request          │   │
│  │ POST /batch        - Batch MCP RPC requests          │   │
│  └──────────────────────────────────────────────────────┘   │
│                          ↓                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │     MCPServerHandler - Request Router & Dispatcher   │   │
│  └──────────────────────────────────────────────────────┘   │
│           ↙                              ↘                   │
│  ┌──────────────────────┐       ┌──────────────────────┐   │
│  │  VSCodeHandler       │       │  GitHubHandler       │   │
│  ├──────────────────────┤       ├──────────────────────┤   │
│  │ • openFile()         │       │ • commit()           │   │
│  │ • editFile()         │       │ • push()             │   │
│  │ • generateCode()     │       │ • createPullRequest()│   │
│  │ • runCommand()       │       │ • getRepoInfo()      │   │
│  └──────────────────────┘       └──────────────────────┘   │
│           ↓                              ↓                   │
│  ┌──────────────────────┐       ┌──────────────────────┐   │
│  │ File System API      │       │ Octokit/GitHub API   │   │
│  │ • fs.readFile()      │       │ • REST API v3        │   │
│  │ • fs.writeFile()     │       │ • GraphQL API        │   │
│  │ • execSync()         │       │ • Authentication     │   │
│  └──────────────────────┘       └──────────────────────┘   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
        ↑                                           ↑
        │              MCP Protocol                │
        │              (JSON-RPC 2.0)              │
        │                                           │
        └───────────────────────┬───────────────────┘
                                ↓
                    ┌──────────────────────┐
                    │   MCP Clients        │
                    ├──────────────────────┤
                    │ • CLI Client         │
                    │ • Web Dashboards     │
                    │ • IDE Plugins        │
                    │ • Automation Tools   │
                    └──────────────────────┘
```

## Data Flow

### 1. Request Handling Flow

```
Client Request
     ↓
Express Router
     ↓
Request Validation
     ↓
MCPServerHandler.handleRequest()
     ↓
Route by method:
  • "tools/list" → handleListTools()
  • "tools/call" → handleCallTool()
     ↓
Tool Handler Dispatch:
  • "vs-code" → VSCodeHandler
  • "github" → GitHubHandler
     ↓
Operation Handler:
  • VS Code: operation → switch(operation) → handler
  • GitHub: operation → switch(operation) → handler
     ↓
External API Call or File Operation
     ↓
Response Generation
     ↓
MCP Response (JSON-RPC 2.0 format)
```

### 2. VS Code Tool Flow

```
User Request (open_file)
     ↓
VSCodeHandler.openFile(params)
     ↓
Path Validation (workspace boundary check)
     ↓
File Existence Check
     ↓
Read File Content
     ↓
Calculate Metadata (lineCount, size)
     ↓
Return Success Response
     │
     └─→ Or catch error → Error Response
```

### 3. GitHub Tool Flow

```
User Request (commit)
     ↓
GitHubHandler.commit(params)
     ↓
Get Current Branch Tip (Git Ref)
     ↓
Create Blobs for Each File
     ↓
Create Tree Object
     ↓
Create Commit Object
     ↓
Update Reference
     ↓
Return Commit Result
     │
     └─→ Or catch error → Error Response
```

## TypeScript Type System

### Core Types Hierarchy

```
MCPRequest (from client)
  ├─ id: string
  ├─ method: string
  ├─ params: Record<string, unknown>
  └─ jsonrpc: "2.0"

MCPResponse (to client)
  ├─ id: string
  ├─ result?: unknown
  ├─ error?: MCPError
  └─ jsonrpc: "2.0"

ToolDefinition
  ├─ name: string
  ├─ description: string
  └─ inputSchema: JSONSchema

Tool Params
  ├─ VSCodeOpenFileParams
  ├─ VSCodeEditFileParams
  ├─ VSCodeGenerateCodeParams
  ├─ VSCodeRunCommandParams
  ├─ GitHubCommitParams
  ├─ GitHubPushParams
  └─ GitHubPullRequestParams
```

## File Organization

```
src/
├── types.ts                          # All TypeScript interfaces
│   ├─ MCPRequest, MCPResponse
│   ├─ ToolDefinition, JSONSchema
│   ├─ VS Code parameter types
│   └─ GitHub parameter types
│
├── tools/
│   ├── vscode.ts                     # VS Code tool schema
│   │   └─ vsCodeToolSchema definition
│   │
│   └── github.ts                     # GitHub tool schema
│       └─ gitHubToolSchema definition
│
├── handlers/
│   ├── vscode-handler.ts             # VS Code operations
│   │   ├─ VSCodeHandler class
│   │   ├─ openFile()
│   │   ├─ editFile()
│   │   ├─ generateCode()
│   │   └─ runCommand()
│   │
│   ├── github-handler.ts             # GitHub operations
│   │   ├─ GitHubHandler class
│   │   ├─ commit()
│   │   ├─ push()
│   │   ├─ createPullRequest()
│   │   └─ getRepoInfo()
│   │
│   └── index.ts                      # Main server handler
│       ├─ MCPServerHandler class
│       ├─ Tool registry
│       └─ Request routing
│
└── server.ts                         # Express server setup
    ├─ HTTP endpoints
    ├─ Error handling
    └─ Server initialization
```

## MCP Protocol Details

### Request Format (JSON-RPC 2.0)

```json
{
  "jsonrpc": "2.0",
  "id": "unique-request-id",
  "method": "tools/call",
  "params": {
    "name": "vs-code|github",
    "arguments": {
      "operation": "...",
      "...": "..."
    }
  }
}
```

### Response Format

**Success:**
```json
{
  "jsonrpc": "2.0",
  "id": "unique-request-id",
  "result": {
    "success": true,
    "...": "..."
  }
}
```

**Error:**
```json
{
  "jsonrpc": "2.0",
  "id": "unique-request-id",
  "error": {
    "code": -1,
    "message": "Error description",
    "data": {
      "code": "ERROR_CODE"
    }
  }
}
```

## Security Architecture

### 1. Path Validation (VS Code Operations)

```typescript
function validatePath(filePath: string, workspacePath: string) {
  const fullPath = path.resolve(workspacePath, filePath);
  if (!fullPath.startsWith(workspacePath)) {
    throw new Error('Access denied: path outside workspace');
  }
}
```

- Prevents directory traversal attacks
- Ensures all operations stay within workspace
- Resolves symbolic links to prevent bypasses

### 2. Environment Variable Security

```
.env (not committed)
├─ GITHUB_TOKEN (secret)
├─ VSCODE_WORKSPACE_PATH (trusted path)
└─ Other sensitive data

.env.example (committed)
├─ Template only
└─ No actual secrets
```

### 3. GitHub Authentication

- Uses OAuth token via Octokit
- Token in environment variable
- HTTPS for all API calls
- No credentials in requests/responses

### 4. Command Execution Sandboxing

```typescript
execSync(command, {
  cwd: validatedPath,           // Validated working directory
  encoding: 'utf-8',
  maxBuffer: 10 * 1024 * 1024,  // Prevent memory exhaustion
  timeout: 30000                // Prevent hung processes
});
```

## Performance Considerations

### 1. Large File Handling

- Buffer limit: 10MB for command output
- Streaming for large file operations (future)
- Pagination for GitHub API responses

### 2. Concurrent Operations

- Express handles concurrent requests
- Each handler is stateless
- GitHub API rate limiting: 60 requests/minute (unauthenticated), 5000 (authenticated)

### 3. Memory Management

- No caching of file contents
- Stream-based operations where possible
- Cleanup after each operation

## Deployment Options

### 1. Local Development

```bash
npm install
npm run dev
```

### 2. Production Node.js

```bash
npm install
npm run build
npm start
```

### 3. Docker Container

```bash
docker build -t mcp-server .
docker run -p 3000:3000 -e GITHUB_TOKEN=xxx mcp-server
```

### 4. Docker Compose

```bash
docker-compose up -d
```

## Integration Points

### 1. With VS Code Extension

```typescript
// Extension would send requests like:
const response = await fetch('http://localhost:3000/rpc', {
  method: 'POST',
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: '1',
    method: 'tools/call',
    params: { name: 'vs-code', arguments: {...} }
  })
});
```

### 2. With CI/CD Pipelines

```yaml
# GitHub Actions example
- name: Use MCP Server
  run: |
    curl -X POST http://localhost:3000/rpc \
      -H "Content-Type: application/json" \
      -d '{...}'
```

### 3. With IDE Plugins

- Plugins send requests to `http://localhost:3000`
- Receive MCP responses for IDE integration
- Display results in IDE UI

## Testing Strategy

### 1. Unit Tests (Future)
- Handler methods
- Type validation
- Error cases

### 2. Integration Tests (Future)
- Full request/response cycle
- Multiple tools interaction
- Error handling

### 3. Manual Testing
- Use CURL commands (see CURL-EXAMPLES.md)
- Use interactive CLI client
- Use test-api.sh script

## Error Handling Strategy

### Error Categories

```
Path/File Errors
├─ File not found
├─ Access denied
└─ Invalid path

Command Errors
├─ Command not found
├─ Execution failed
└─ Timeout

GitHub Errors
├─ Authentication failed
├─ API rate limit
├─ Invalid parameters
└─ Network errors
```

### Error Response

```json
{
  "id": "request-id",
  "error": {
    "code": -1,
    "message": "Human-readable error message",
    "data": {
      "code": "MACHINE_READABLE_CODE",
      "details": "Additional context"
    }
  },
  "jsonrpc": "2.0"
}
```

## Future Enhancements

### 1. WebSocket Support
- Real-time bidirectional communication
- Server-initiated notifications
- Live file watching

### 2. Authentication Layer
- JWT token-based auth
- Role-based access control
- Audit logging

### 3. Extended Tools
- GitLab/Bitbucket support
- Additional VCS operations
- Code review integration

### 4. AI Integration
- OpenAI/Claude code generation
- Intelligent code suggestions
- Automated refactoring

### 5. Caching Layer
- Redis for session data
- Cached API responses
- Workspace state persistence

## Monitoring & Logging

### Current Implementation
- Console logging for key events
- Error stack traces in development
- Request/response logging available

### Future Enhancements
- Structured logging (Winston/Pino)
- Log aggregation (ELK Stack)
- Performance monitoring
- Request tracing (OpenTelemetry)

---

**Last Updated**: 2024
**Author**: MCP Server Team
**License**: MIT
