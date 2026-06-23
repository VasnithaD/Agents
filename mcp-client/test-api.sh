#!/bin/bash
# MCP Server API Testing Examples
# Run these commands to test the MCP server endpoints

SERVER_URL="http://localhost:3000"

echo "🧪 MCP Server API Tests"
echo "======================"
echo ""

# 1. Health check
echo "1️⃣  Health Check"
curl -X GET "$SERVER_URL/health" | jq .
echo -e "\n"

# 2. List tools
echo "2️⃣  List Tools"
curl -X GET "$SERVER_URL/tools" | jq .
echo -e "\n"

# 3. VS Code - Open file
echo "3️⃣  VS Code: Open File"
curl -X POST "$SERVER_URL/rpc" \
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
  }' | jq .
echo -e "\n"

# 4. VS Code - Edit file
echo "4️⃣  VS Code: Edit File"
curl -X POST "$SERVER_URL/rpc" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "2",
    "method": "tools/call",
    "params": {
      "name": "vs-code",
      "arguments": {
        "operation": "edit_file",
        "filePath": "test.ts",
        "content": "export const test = true;"
      }
    }
  }' | jq .
echo -e "\n"

# 5. VS Code - Run command
echo "5️⃣  VS Code: Run Command"
curl -X POST "$SERVER_URL/rpc" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": "3",
    "method": "tools/call",
    "params": {
      "name": "vs-code",
      "arguments": {
        "operation": "run_command",
        "command": "echo",
        "args": ["Hello from MCP"]
      }
    }
  }' | jq .
echo -e "\n"

# 6. GitHub - Get repo info (requires GitHub token)
echo "6️⃣  GitHub: Get Repository Info"
curl -X POST "$SERVER_URL/rpc" \
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
  }' | jq .
echo -e "\n"

echo "✅ Tests completed!"
