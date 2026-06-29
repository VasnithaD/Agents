# API Testing Examples - cURL Commands

## Health Check
```bash
curl -X GET http://localhost:3000/health
```

## List Tools
```bash
curl -X GET http://localhost:3000/tools
```

## VS Code: Open File
```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
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
  }'
```

## VS Code: Edit File
```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "2",
    "method": "tools/call",
    "params": {
      "name": "vs-code",
      "arguments": {
        "operation": "edit_file",
        "filePath": "test-file.ts",
        "content": "export const example = \"Hello from MCP\";"
      }
    }
  }'
```

## VS Code: Generate Code
```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "3",
    "method": "tools/call",
    "params": {
      "name": "vs-code",
      "arguments": {
        "operation": "generate_code",
        "prompt": "Create a TypeScript function to validate email",
        "language": "typescript"
      }
    }
  }'
```

## VS Code: Run Command
```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "4",
    "method": "tools/call",
    "params": {
      "name": "vs-code",
      "arguments": {
        "operation": "run_command",
        "command": "npm",
        "args": ["--version"]
      }
    }
  }'
```

## GitHub: Get Repository Info
```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "5",
    "method": "tools/call",
    "params": {
      "name": "github",
      "arguments": {
        "operation": "get_repo_info"
      }
    }
  }'
```

## GitHub: Commit
```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "6",
    "method": "tools/call",
    "params": {
      "name": "github",
      "arguments": {
        "operation": "commit",
        "message": "docs: Update documentation",
        "files": {
          "README.md": "# Updated README",
          "CHANGELOG.md": "## Version 1.1.0\n- Added MCP support"
        },
        "branch": "main"
      }
    }
  }'
```

## GitHub: Create Pull Request
```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "7",
    "method": "tools/call",
    "params": {
      "name": "github",
      "arguments": {
        "operation": "create_pull_request",
        "title": "feat: Add new feature",
        "description": "This PR adds support for X, Y, and Z",
        "head": "feature/new-feature",
        "base": "main",
        "labels": ["feature", "enhancement"]
      }
    }
  }'
```

## GitHub: Push
```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "8",
    "method": "tools/call",
    "params": {
      "name": "github",
      "arguments": {
        "operation": "push",
        "branch": "main",
        "force": false
      }
    }
  }'
```

## Batch Request (Multiple Tools at Once)
```bash
curl -X POST http://localhost:3000/batch \
  -H "Content-Type: application/json" \
  -d '[
    {
      "jsonrpc": "2.0",
      "id": "batch-1",
      "method": "tools/call",
      "params": {
        "name": "vs-code",
        "arguments": {
          "operation": "open_file",
          "filePath": "package.json"
        }
      }
    },
    {
      "jsonrpc": "2.0",
      "id": "batch-2",
      "method": "tools/call",
      "params": {
        "name": "github",
        "arguments": {
          "operation": "get_repo_info"
        }
      }
    }
  ]'
```

## Using jq for Pretty Output
All commands can be piped to `jq` for better formatting:

```bash
curl -X GET http://localhost:3000/health | jq .
curl -X POST http://localhost:3000/rpc ... | jq '.result'
```

## Using with Postman/Insomnia

1. Create a new POST request
2. Set URL to `http://localhost:3000/rpc`
3. Set header: `Content-Type: application/json`
4. Copy-paste any of the JSON bodies above into the request body
5. Send request

## Common Response Codes

- `200 OK` - Request successful
- `400 Bad Request` - Invalid request format
- `500 Internal Server Error` - Server error, check logs
