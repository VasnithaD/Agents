/**
 * LLM Tool Examples
 * Comprehensive examples of LLM tool usage with all operations
 */

import MCPClient from '../src/client';

const client = new MCPClient('http://localhost:3000');

// ============================================================================
// 1. CODE GENERATION EXAMPLES
// ============================================================================

async function example_generateSimpleFunction() {
  console.log('📝 Example: Generate Simple Function\n');

  const response = await client.llmGenerateCode(
    'Create a function to calculate the factorial of a number',
    'typescript',
    'For a math utility library'
  );

  console.log(JSON.stringify(response, null, 2));
}

async function example_generateReactComponent() {
  console.log('📝 Example: Generate React Component\n');

  const response = await client.llmGenerateCode(
    'Create a reusable Button component with loading state and onClick handler',
    'typescript',
    'React with TypeScript, styled-components for styling'
  );

  console.log(JSON.stringify(response, null, 2));
}

async function example_generateRESTEndpoint() {
  console.log('📝 Example: Generate REST API Endpoint\n');

  const response = await client.llmGenerateCode(
    'Create Express.js endpoints for user CRUD operations (Create, Read, Update, Delete)',
    'typescript',
    'Express.js backend with MongoDB, JWT authentication, error handling'
  );

  console.log(JSON.stringify(response, null, 2));
}

async function example_generatePythonCode() {
  console.log('📝 Example: Generate Python Code\n');

  const response = await client.llmGenerateCode(
    'Create a class to handle database migrations with rollback support',
    'python',
    'Using SQLAlchemy ORM with PostgreSQL'
  );

  console.log(JSON.stringify(response, null, 2));
}

// ============================================================================
// 2. CODE REFACTORING EXAMPLES
// ============================================================================

async function example_refactorWithTypeAnnotations() {
  console.log('📝 Example: Refactor with Type Annotations\n');

  const messyCode = `
function getUserData(userId) {
  const data = fetch('/api/users/' + userId);
  return data;
}
  `;

  const response = await client.llmRefactorCode(
    messyCode,
    'typescript',
    'Add TypeScript type annotations and improve error handling',
    'For a production API'
  );

  console.log(JSON.stringify(response, null, 2));
}

async function example_refactorForPerformance() {
  console.log('📝 Example: Refactor for Performance\n');

  const code = `
function findDuplicates(arr) {
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[i] === arr[j]) {
        result.push(arr[i]);
      }
    }
  }
  return result;
}
  `;

  const response = await client.llmRefactorCode(
    code,
    'typescript',
    'Optimize for performance using Set or Map instead of nested loops',
    'Large arrays up to 100,000 elements'
  );

  console.log(JSON.stringify(response, null, 2));
}

async function example_refactorForReadability() {
  console.log('📝 Example: Refactor for Readability\n');

  const code = `
const calc = (x, y, o) => {
  return o === '+' ? x + y : o === '-' ? x - y : o === '*' ? x * y : x / y;
};
  `;

  const response = await client.llmRefactorCode(
    code,
    'typescript',
    'Improve readability and add JSDoc comments',
    'For a math calculator application'
  );

  console.log(JSON.stringify(response, null, 2));
}

// ============================================================================
// 3. CODE REVIEW EXAMPLES
// ============================================================================

async function example_reviewForSecurity() {
  console.log('📝 Example: Review for Security Issues\n');

  const code = `
function authenticateUser(username, password) {
  const user = db.query("SELECT * FROM users WHERE username = '" + username + "'");
  return user.password === password;
}
  `;

  const response = await client.llmReviewCode(
    code,
    'typescript',
    ['security', 'injection attacks', 'password handling']
  );

  console.log(JSON.stringify(response, null, 2));
}

async function example_reviewForBestPractices() {
  console.log('📝 Example: Review for Best Practices\n');

  const code = `
function getData() {
  try {
    let response = fetch('/api/data');
    let data = response.json();
    return data;
  } catch (e) {
    console.log(e);
  }
}
  `;

  const response = await client.llmReviewCode(
    code,
    'typescript',
    ['error handling', 'async patterns', 'best practices']
  );

  console.log(JSON.stringify(response, null, 2));
}

async function example_comprehensiveReview() {
  console.log('📝 Example: Comprehensive Code Review\n');

  const code = `
class DataManager {
  constructor() {
    this.data = [];
  }

  add(item) {
    this.data.push(item);
  }

  getAll() {
    return this.data;
  }
}
  `;

  const response = await client.llmReviewCode(
    code,
    'typescript',
    ['design patterns', 'encapsulation', 'type safety', 'documentation']
  );

  console.log(JSON.stringify(response, null, 2));
}

// ============================================================================
// 4. CHAT EXAMPLES
// ============================================================================

async function example_chatBasicQuestion() {
  console.log('📝 Example: Chat - Basic Question\n');

  const response = await client.llmChat(
    'What is the difference between async/await and promises?',
    'TypeScript development'
  );

  console.log(JSON.stringify(response, null, 2));
}

async function example_chatDatabaseDesign() {
  console.log('📝 Example: Chat - Database Design\n');

  const response = await client.llmChat(
    'How should I design a database schema for an e-commerce platform?',
    'PostgreSQL, user accounts, products, orders, payments'
  );

  console.log(JSON.stringify(response, null, 2));
}

async function example_chatArchitectureDecision() {
  console.log('📝 Example: Chat - Architecture Decision\n');

  const response = await client.llmChat(
    'Should I use a monolithic or microservices architecture for my startup?',
    'Early-stage startup, small team, 10k users expected'
  );

  console.log(JSON.stringify(response, null, 2));
}

// ============================================================================
// 5. WORKFLOW EXAMPLES
// ============================================================================

async function example_workflowGenerateInsert() {
  console.log('📝 Example: Workflow - Generate & Insert\n');

  const response = await client.llmGenerateWithWorkflow(
    'Create a middleware function to validate JWT tokens',
    'typescript',
    'src/middleware/auth.ts',
    'feat: Add JWT authentication middleware'
  );

  console.log(JSON.stringify(response, null, 2));
}

async function example_workflowGenerateAndCommit() {
  console.log('📝 Example: Workflow - Generate & Commit\n');

  const response = await client.llmGenerateWithWorkflow(
    'Create a database migration for adding user profiles',
    'typescript',
    'src/migrations/001_add_profiles.ts',
    'feat: Add user profiles table'
  );

  console.log(JSON.stringify(response, null, 2));
}

// ============================================================================
// 6. BATCH OPERATIONS
// ============================================================================

async function example_batchMultipleOperations() {
  console.log('📝 Example: Batch Multiple Operations\n');

  // Generate multiple types of code
  const results = await Promise.all([
    client.llmGenerateCode('Create a utility function', 'typescript'),
    client.llmGenerateCode('Create a React hook', 'typescript'),
    client.llmGenerateCode('Create a Python class', 'python'),
  ]);

  console.log('Generated', results.length, 'pieces of code');
  results.forEach((result, index) => {
    console.log(`Result ${index + 1}:`, JSON.stringify(result, null, 2));
  });
}

// ============================================================================
// 7. REAL-WORLD WORKFLOWS
// ============================================================================

/**
 * Complete workflow: Generate -> Insert -> Review -> Commit -> PR
 */
async function example_fullWorkflow() {
  console.log('🚀 Example: Complete Development Workflow\n');

  try {
    // Step 1: Generate code
    console.log('Step 1: Generating code...');
    const generateResponse = await client.llmGenerateCode(
      'Create a user authentication service with login and registration',
      'typescript',
      'Express.js, JWT, bcrypt for password hashing'
    );

    if (generateResponse.error) {
      throw new Error(`Generation failed: ${generateResponse.error.message}`);
    }

    const generatedCode = (generateResponse.result as any).code;
    console.log('✅ Code generated\n');

    // Step 2: Insert into file
    console.log('Step 2: Inserting code into VS Code...');
    const insertResponse = await client.vsCodeEditFile(
      'src/services/auth.service.ts',
      generatedCode
    );

    if (insertResponse.error) {
      console.error('Insert failed:', insertResponse.error);
    } else {
      console.log('✅ Code inserted\n');
    }

    // Step 3: Review the code
    console.log('Step 3: Reviewing code quality...');
    const reviewResponse = await client.llmReviewCode(
      generatedCode,
      'typescript',
      ['security', 'error-handling', 'type-safety']
    );

    const review = (reviewResponse.result as any).review;
    console.log(`Quality Score: ${review.overallQuality}/10`);
    console.log(`Issues: ${review.issues.length}\n`);

    // Step 4: Display workflow completion
    console.log('✅ Workflow Complete!');
    console.log('\nNext steps:');
    console.log('1. Review the inserted code in VS Code');
    console.log('2. Run unit tests locally');
    console.log('3. Commit changes to GitHub');
    console.log('4. Create a pull request for review');
  } catch (error) {
    console.error('❌ Workflow failed:', (error as Error).message);
  }
}

/**
 * Real-world: Code refactoring and quality improvement
 */
async function example_refactoringWorkflow() {
  console.log('🔄 Example: Code Refactoring Workflow\n');

  const existingCode = `
function process(data) {
  let result = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i].active) {
      result.push(data[i]);
    }
  }
  return result;
}
  `;

  // Step 1: Review for improvements
  console.log('Step 1: Reviewing existing code...');
  const reviewResponse = await client.llmReviewCode(
    existingCode,
    'typescript',
    ['readability', 'performance', 'modern-patterns']
  );

  const review = (reviewResponse.result as any).review;
  console.log(`Quality Score: ${review.overallQuality}/10\n`);

  // Step 2: Refactor based on suggestions
  if (review.overallQuality < 8) {
    console.log('Step 2: Refactoring code...');
    const refactorResponse = await client.llmRefactorCode(
      existingCode,
      'typescript',
      'Use modern JavaScript patterns like filter and arrow functions',
      'Data processing utility'
    );

    const refactoredCode = (refactorResponse.result as any).refactoredCode;
    console.log('Refactored code:', refactoredCode);
    console.log('\n✅ Code improved and ready to commit');
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function runAllExamples() {
  const examples = [
    // Generation examples
    example_generateSimpleFunction,
    example_generateReactComponent,
    example_generateRESTEndpoint,
    example_generatePythonCode,

    // Refactoring examples
    example_refactorWithTypeAnnotations,
    example_refactorForPerformance,
    example_refactorForReadability,

    // Review examples
    example_reviewForSecurity,
    example_reviewForBestPractices,
    example_comprehensiveReview,

    // Chat examples
    example_chatBasicQuestion,
    example_chatDatabaseDesign,
    example_chatArchitectureDecision,

    // Workflow examples
    example_workflowGenerateInsert,
    example_workflowGenerateAndCommit,

    // Batch operations
    example_batchMultipleOperations,

    // Real-world workflows
    example_fullWorkflow,
    example_refactoringWorkflow,
  ];

  console.log('🎯 LLM Tool Examples\n');
  console.log('===================================\n');

  for (const example of examples) {
    try {
      await example();
      console.log('\n' + '='.repeat(50) + '\n');
    } catch (error) {
      console.error('Example failed:', (error as Error).message);
      console.log('\n' + '='.repeat(50) + '\n');
    }
  }

  console.log('✅ All examples completed!');
}

// Run specific example or all examples
const exampleToRun = process.argv[2];

if (exampleToRun === 'all') {
  runAllExamples().catch(console.error);
} else if (exampleToRun === 'workflow') {
  example_fullWorkflow().catch(console.error);
} else if (exampleToRun === 'refactor') {
  example_refactoringWorkflow().catch(console.error);
} else {
  // Run all by default
  runAllExamples().catch(console.error);
}

export {
  example_generateSimpleFunction,
  example_generateReactComponent,
  example_refactorWithTypeAnnotations,
  example_reviewForSecurity,
  example_chatBasicQuestion,
  example_workflowGenerateInsert,
  example_fullWorkflow,
  example_refactoringWorkflow,
};
