# MCP Server - File Guide & Index

## 📖 Documentation Files

| File | Purpose | Read When |
|------|---------|-----------|
| [README.md](README.md) | Main documentation, API reference, tool usage examples | Starting to use the project |
| [QUICKSTART.md](QUICKSTART.md) | Fast setup guide, common operations, troubleshooting | Getting started quickly |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, data flow, security, deployment options | Understanding how it works |
| [CURL-EXAMPLES.md](CURL-EXAMPLES.md) | HTTP/cURL request examples | Testing the API |

## 🏗️ Project Structure

### Configuration Files

```
mcp-server/
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── .env.example          # Environment variables template
├── .gitignore           # Git ignore rules
├── Dockerfile           # Docker container definition
├── docker-compose.yml   # Docker Compose setup
└── test-api.sh          # Bash script for API testing
```

### Source Code (`src/`)

```
src/
├── types.ts
│   └─ All TypeScript interfaces and types
│   └─ MCP protocol types, tool parameter types
│   └─ GitHub and VS Code specific types
│
├── tools/
│   ├── vscode.ts
│   │   └─ VS Code tool schema definition
│   │   └─ Tool capabilities documented as JSONSchema
│   │
│   └── github.ts
│       └─ GitHub tool schema definition
│       └─ GitHub operations documented as JSONSchema
│
├── handlers/
│   ├── vscode-handler.ts
│   │   └─ VSCodeHandler class
│   │   └─ open_file, edit_file, generate_code, run_command operations
│   │   └─ File system operations with security checks
│   │
│   ├── github-handler.ts
│   │   └─ GitHubHandler class
│   │   └─ commit, push, create_pull_request, get_repo_info operations
│   │   └─ Octokit integration for GitHub REST/GraphQL APIs
│   │
│   └── index.ts
│       └─ MCPServerHandler main dispatcher
│       └─ Routes requests to appropriate tool handlers
│       └─ Maintains tool registry
│
├── server.ts
│   └─ Express server setup and HTTP endpoints
│   └─ /health, /tools, /rpc, /batch endpoints
│   └─ Request validation and error handling
│
└── client.ts
    └─ MCPClient class for programmatic API access
    └─ Interactive CLI interface
    └─ Convenience methods for all tool operations
```

## 🎯 Quick Navigation by Task

### I want to...

#### Get Started
1. Read: [QUICKSTART.md](QUICKSTART.md)
2. Run: `npm install && npm run dev`
3. Test: `curl http://localhost:3000/health`

#### Understand the Architecture
1. Read: [ARCHITECTURE.md](ARCHITECTURE.md)
2. Focus on: System Components, Data Flow, Type System sections
3. Reference: Project structure diagram

#### Use the API
1. Read: [README.md](README.md) - Tool Usage Examples section
2. Reference: [CURL-EXAMPLES.md](CURL-EXAMPLES.md)
3. Test: `bash test-api.sh` or `npm run client`

#### Deploy with Docker
1. Read: [QUICKSTART.md](QUICKSTART.md) - Docker Deployment section
2. Run: `docker-compose up -d`
3. Access: `http://localhost:3000`

#### Extend the Project
1. Read: [ARCHITECTURE.md](ARCHITECTURE.md) - Integration Points section
2. Study: Handler implementations in `src/handlers/`
3. Add: New tool handler following existing patterns

#### Debug Issues
1. Check: [QUICKSTART.md](QUICKSTART.md) - Troubleshooting section
2. Review: Console output from `npm run dev`
3. Test: `curl http://localhost:3000/health`

## 📚 File Details

### Configuration Files

**package.json**
- Node.js project configuration
- Dependencies: axios, dotenv, express, octokit, typescript
- Scripts: build, start, dev, client, test, lint

**tsconfig.json**
- TypeScript compiler configuration
- Target: ES2020, Module: commonjs
- Strict type checking enabled

**.env.example**
- Template for environment variables
- GitHub credentials and repository info
- VS Code workspace path
- Server configuration

**Dockerfile**
- Multi-stage Docker build
- Node.js 20 Alpine base image
- Port 3000 exposed

**docker-compose.yml**
- Orchestrates MCP server container
- Volume mount for workspace
- Environment variable management

### Source Code Files

**types.ts** (300+ lines)
- MCPRequest / MCPResponse interfaces
- ToolDefinition and JSONSchema types
- VS Code parameter types:
  - VSCodeOpenFileParams
  - VSCodeEditFileParams
  - VSCodeGenerateCodeParams
  - VSCodeRunCommandParams
- GitHub parameter types:
  - GitHubCommitParams
  - GitHubPushParams
  - GitHubPullRequestParams

**vscode.ts** (80+ lines)
- vsCodeToolSchema constant
- Defines all VS Code operations:
  - open_file
  - edit_file
  - generate_code
  - run_command
- InputSchema with all parameters documented

**github.ts** (80+ lines)
- gitHubToolSchema constant
- Defines all GitHub operations:
  - commit
  - push
  - create_pull_request
  - get_repo_info
- InputSchema with all parameters documented

**vscode-handler.ts** (280+ lines)
- VSCodeHandler class with:
  - openFile() - Read file contents
  - editFile() - Create/modify files
  - generateCode() - Generate code snippets
  - runCommand() - Execute shell commands
  - handle() - Main operation dispatcher
- Path validation for security
- Error handling with specific error codes

**github-handler.ts** (320+ lines)
- GitHubHandler class with:
  - commit() - Create commits via GitHub API
  - push() - Push to branches
  - createPullRequest() - Create PRs
  - getRepoInfo() - Fetch repo metadata
  - handle() - Main operation dispatcher
- Octokit integration
- REST and GraphQL API usage
- Error handling with specific error codes

**index.ts** (120+ lines)
- MCPServerHandler main dispatcher
- getTools() - List available tools
- handleRequest() - Route to appropriate handler
- handleListTools() - Return tool list
- handleCallTool() - Dispatch tool operations
- Error response generation

**server.ts** (160+ lines)
- Express.js setup
- HTTP endpoints:
  - GET /health - Health check
  - GET /tools - List tools
  - POST /rpc - Single RPC request
  - POST /batch - Batch requests
- Handler initialization
- Error handling middleware
- Server startup with logging

**client.ts** (280+ lines)
- MCPClient class for API access
- Convenience methods:
  - listTools()
  - vsCodeOpenFile()
  - vsCodeEditFile()
  - vsCodeGenerateCode()
  - vsCodeRunCommand()
  - gitHubCommit()
  - gitHubPush()
  - gitHubCreatePullRequest()
  - gitHubGetRepoInfo()
- Interactive CLI mode with readline
- Request formatting and response handling

### Documentation Files

**README.md** (500+ lines)
- Feature overview
- Installation instructions
- API endpoint documentation
- Detailed tool usage examples
- Type definitions reference
- Error handling guide
- Security considerations
- Next steps and contributing

**QUICKSTART.md** (300+ lines)
- 5-minute setup guide
- Common operations with examples
- Docker deployment
- Troubleshooting guide
- Workflows
- Pro tips

**ARCHITECTURE.md** (400+ lines)
- System architecture diagram
- Data flow diagrams
- Type system hierarchy
- File organization
- MCP protocol details
- Security architecture
- Performance considerations
- Deployment options
- Integration points
- Testing strategy

**CURL-EXAMPLES.md** (200+ lines)
- HTTP/cURL examples for all operations
- Batch request examples
- jq usage for pretty output
- Postman/Insomnia setup
- Common response codes

**examples.ts** (100+ lines)
- Runnable example usage
- Demonstrates all operations
- Exports functions for testing
- Can be run as CLI script

## 🔄 Development Workflow

```
1. Read QUICKSTART.md
        ↓
2. npm install & npm run dev
        ↓
3. Open another terminal: npm run client
        ↓
4. Test operations interactively
        ↓
5. Reference README.md for detailed API docs
        ↓
6. Study ARCHITECTURE.md for system design
        ↓
7. Modify code in src/ to add features
        ↓
8. npm run build
        ↓
9. npm start (production)
```

## 📦 Dependencies

### Production
- **express**: ^4.18.2 - Web server
- **axios**: ^1.6.0 - HTTP client
- **octokit**: ^3.1.0 - GitHub API SDK
- **dotenv**: ^16.3.1 - Environment variables
- **typescript**: ^5.2.2 - Language

### Development
- **@types/node**, **@types/express**: Type definitions
- **ts-node**: Run TypeScript directly
- **jest**: Testing framework (configured but not used yet)
- **eslint**: Linting

## 🚀 Deployment Checklist

- [ ] Installed Node.js 18+
- [ ] Copied .env.example to .env
- [ ] Configured GitHub token
- [ ] Set workspace path
- [ ] Ran `npm install`
- [ ] Ran `npm run build`
- [ ] Started server with `npm start`
- [ ] Verified `/health` endpoint works
- [ ] Tested a sample operation
- [ ] (Optional) Built Docker image
- [ ] (Optional) Started with Docker Compose

## 📞 Support Resources

| Question | Resource |
|----------|----------|
| How do I get started? | [QUICKSTART.md](QUICKSTART.md) |
| How does it work? | [ARCHITECTURE.md](ARCHITECTURE.md) |
| How do I use it? | [README.md](README.md) |
| How do I call the API? | [CURL-EXAMPLES.md](CURL-EXAMPLES.md) |
| What errors can occur? | [README.md](README.md#error-handling) |
| How do I fix X? | [QUICKSTART.md](QUICKSTART.md#-troubleshooting) |

---

**Happy coding! 🎉**

Start with [QUICKSTART.md](QUICKSTART.md) for a fast setup, then explore [README.md](README.md) for comprehensive documentation.
