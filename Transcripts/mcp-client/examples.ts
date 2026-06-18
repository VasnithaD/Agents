/**
 * MCP Server - Example Usage
 * 
 * This file demonstrates how to use the MCP client to interact with
 * the VS Code and GitHub tools.
 */

import MCPClient from './src/client';

async function examples() {
  const client = new MCPClient('http://localhost:3000');

  console.log('🚀 MCP Client Examples\n');

  try {
    // 1. List available tools
    console.log('1️⃣  Listing available tools...');
    const tools = await client.listTools();
    console.log('Tools:', JSON.stringify(tools, null, 2));
    console.log('\n' + '='.repeat(50) + '\n');

    // 2. VS Code - Open file
    console.log('2️⃣  Opening a file...');
    let response = await client.vsCodeOpenFile('package.json');
    console.log('Response:', JSON.stringify(response, null, 2));
    console.log('\n' + '='.repeat(50) + '\n');

    // 3. VS Code - Edit file
    console.log('3️⃣  Creating/Editing a file...');
    response = await client.vsCodeEditFile(
      'example.ts',
      'export const greeting = "Hello from MCP!";'
    );
    console.log('Response:', JSON.stringify(response, null, 2));
    console.log('\n' + '='.repeat(50) + '\n');

    // 4. VS Code - Generate code
    console.log('4️⃣  Generating code...');
    response = await client.vsCodeGenerateCode(
      'Create a function to calculate factorial in TypeScript',
      'typescript',
      'Educational purpose'
    );
    console.log('Response:', JSON.stringify(response, null, 2));
    console.log('\n' + '='.repeat(50) + '\n');

    // 5. VS Code - Run command
    console.log('5️⃣  Running a command...');
    response = await client.vsCodeRunCommand('echo', undefined, ['Hello from MCP']);
    console.log('Response:', JSON.stringify(response, null, 2));
    console.log('\n' + '='.repeat(50) + '\n');

    // 6. GitHub - Get repo info (requires valid credentials)
    console.log('6️⃣  Getting GitHub repository info...');
    response = await client.gitHubGetRepoInfo();
    console.log('Response:', JSON.stringify(response, null, 2));
    console.log('\n' + '='.repeat(50) + '\n');

    // 7. GitHub - Commit (example structure)
    console.log('7️⃣  Creating a GitHub commit...');
    response = await client.gitHubCommit(
      'docs: Update README with examples',
      {
        'README.md': '# Updated README\n\nThis is an example commit from MCP.',
        'example.ts': 'export const example = true;',
      },
      'main'
    );
    console.log('Response:', JSON.stringify(response, null, 2));
    console.log('\n' + '='.repeat(50) + '\n');

    // 8. GitHub - Create Pull Request
    console.log('8️⃣  Creating a GitHub pull request...');
    response = await client.gitHubCreatePullRequest(
      'feat: Add MCP integration',
      'feature/mcp-integration',
      'main',
      'This PR integrates MCP for VS Code and GitHub operations',
      ['feature', 'mcp']
    );
    console.log('Response:', JSON.stringify(response, null, 2));
    console.log('\n' + '='.repeat(50) + '\n');

    console.log('✅ All examples completed!');
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  examples().catch(console.error);
}

export { examples };
