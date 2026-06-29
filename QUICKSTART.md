# Quick Start Guide

## ⚡ Get Started in 5 Minutes

### Step 1: Install Dependencies

```bash
cd mcp-server
npm install
```

### Step 2: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your settings:
```bash
# GitHub Configuration
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB_OWNER=your-username
GITHUB_REPO=your-repo

# VS Code Configuration
VSCODE_WORKSPACE_PATH=/path/to/your/workspace

# Server Configuration
MCP_SERVER_PORT=3000
MCP_SERVER_HOST=localhost
```

### Step 3: Build & Start Server

**Development Mode:**
```bash
npm run dev
```

**Production Mode:**
```bash
npm run build
npm start
```

You should see:
```
🚀 MCP Server running on http://localhost:3000
📁 Workspace: /path/to/workspace

Available endpoints:
  GET  /health     - Health check
  GET  /tools      - List available tools
  POST /rpc        - MCP RPC endpoint
  POST /batch      - Batch RPC endpoint

Tools available:
  - vs-code: Interact with VS Code...
  - github: Interact with GitHub...
```

### Step 4: Test the Server

**Option A: Health Check**
```bash
curl http://localhost:3000/health
```

**Option B: List Tools**
```bash
curl http://localhost:3000/tools
```

**Option C: Interactive CLI**

In another terminal:
```bash
npm run client
```

Then follow the interactive prompts to test various operations.

**Option D: Run Examples**
```bash
npm run build
node dist/examples.js
```

## 🛠️ Common Operations

### VS Code: Open a File

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
        "filePath": "package.json"
      }
    }
  }'
```

### VS Code: Create/Edit a File

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
        "filePath": "hello.ts",
        "content": "console.log(\"Hello from MCP\");"
      }
    }
  }'
```

### VS Code: Run a Command

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
        "operation": "run_command",
        "command": "npm",
        "args": ["test"]
      }
    }
  }'
```

### GitHub: Get Repository Info

```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "4",
    "method": "tools/call",
    "params": {
      "name": "github",
      "arguments": {
        "operation": "get_repo_info"
      }
    }
  }'
```

### GitHub: Create a Commit

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
        "operation": "commit",
        "message": "docs: Add README",
        "files": {
          "README.md": "# My Project"
        },
        "branch": "main"
      }
    }
  }'
```

### GitHub: Create a Pull Request

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
        "operation": "create_pull_request",
        "title": "feat: Add new feature",
        "description": "This PR adds support for X",
        "head": "feature/new-feature",
        "base": "main",
        "labels": ["feature"]
      }
    }
  }'
```

## 📦 Docker Deployment

### Build & Run with Docker

```bash
docker build -t mcp-server .
docker run -p 3000:3000 \
  -e GITHUB_TOKEN=your_token \
  -e GITHUB_OWNER=your_username \
  -e GITHUB_REPO=your_repo \
  -v /path/to/workspace:/workspace \
  mcp-server
```

### Using Docker Compose

```bash
docker-compose up -d
```

Access the server at: `http://localhost:3000`

## 🔧 Troubleshooting

### Issue: "Cannot connect to server"

1. Make sure server is running: `npm run dev`
2. Check port: `netstat -an | grep 3000` (or `netstat -ano | findstr :3000` on Windows)
3. Try health check: `curl http://localhost:3000/health`

### Issue: "GitHub authentication failed"

1. Verify GITHUB_TOKEN is set: `echo $GITHUB_TOKEN`
2. Check token is valid: https://github.com/settings/tokens
3. Ensure token has necessary scopes (repo, write:repo_hook)

### Issue: "File not found" errors

1. Verify VSCODE_WORKSPACE_PATH is correct
2. Check file paths are relative to workspace
3. Ensure read/write permissions on workspace directory

### Issue: "Cannot run command"

1. Verify command exists in system PATH
2. Check working directory permissions
3. Ensure workspace path is accessible

## 📚 Next Steps

1. **Read the README**: For detailed API documentation
2. **Check ARCHITECTURE.md**: For system design details
3. **Review CURL-EXAMPLES.md**: For more API examples
4. **Explore test-api.sh**: For batch testing

## 🎯 Common Workflows

### Workflow 1: Edit Code & Commit

```bash
# 1. Open file
curl -X POST http://localhost:3000/rpc ... "operation": "open_file"

# 2. Edit file
curl -X POST http://localhost:3000/rpc ... "operation": "edit_file"

# 3. Run tests
curl -X POST http://localhost:3000/rpc ... "operation": "run_command"

# 4. Commit changes
curl -X POST http://localhost:3000/rpc ... "operation": "commit"

# 5. Create PR
curl -X POST http://localhost:3000/rpc ... "operation": "create_pull_request"
```

### Workflow 2: Generate Code & Push

```bash
# 1. Generate code
curl -X POST http://localhost:3000/rpc ... "operation": "generate_code"

# 2. Create file
curl -X POST http://localhost:3000/rpc ... "operation": "edit_file"

# 3. Commit
curl -X POST http://localhost:3000/rpc ... "operation": "commit"

# 4. Push
curl -X POST http://localhost:3000/rpc ... "operation": "push"
```

## 💡 Pro Tips

1. **Use batch requests** for multiple operations:
   ```bash
   POST /batch with array of requests
   ```

2. **Install jq** for pretty JSON output:
   ```bash
   curl http://localhost:3000/tools | jq
   ```

3. **Use the interactive CLI** for development:
   ```bash
   npm run client
   ```

4. **Check logs** for debugging:
   ```bash
   # Look at console output from npm run dev
   ```

5. **Use environment variables** to avoid hardcoding:
   ```bash
   export GITHUB_TOKEN=xxx
   export GITHUB_OWNER=yyy
   ```

## 🚀 Ready to Build?

- Extend with more tools
- Integrate with your IDE
- Build automation workflows
- Create your own MCP clients

See [ARCHITECTURE.md](ARCHITECTURE.md) for advanced topics!

---

**Need Help?**
- Check README.md for complete documentation
- Review CURL-EXAMPLES.md for API examples
- Open an issue on GitHub

**Happy building! 🎉**
