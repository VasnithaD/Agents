import { getHPEClient, HPEClient } from './hpe-client';
import { ragRetriever, RagSource } from '../rag/retriever';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// ── System prompt for GENERAL Q&A / analysis / explanation tasks ─────────────
const QA_SYSTEM_PROMPT = `You are an expert software engineer and technical consultant.
You have deep knowledge across: Java, Spring Boot, Python, TypeScript/Node.js, Angular, React,
microservices, REST APIs, databases, DevOps, cloud, and software architecture patterns.

You have access to a PROJECT KNOWLEDGE BASE retrieved via similarity search from indexed project docs.
Use this context to give grounded, accurate, project-specific answers.
If the question is not covered by the project context, answer from your broad engineering expertise.

═══ SAFETY RULE ═══
NEVER modify, delete, overwrite, rename, or move any existing file without EXPLICIT confirmation from the user.
If a task involves changing an existing file, describe what you WOULD change and ask:
"Do you want me to apply these changes to [filename]? (yes / no)"
Wait for confirmation before proceeding. Only CREATE new files freely.
═══════════════

Respond in well-structured markdown:
- Use headings (##, ###) to separate sections
- Use bullet points for lists
- Use fenced code blocks with language tag for every code snippet
- Be thorough and accurate — never give vague or generic answers
- Reference specific class names, method names, and file paths from the project context when relevant`;

// ── System prompt for CODE GENERATION tasks ───────────────────────────────────
const CODE_GEN_SYSTEM_PROMPT = `You are a senior software engineer generating PRODUCTION-READY, COMPLETE, IMMEDIATELY RUNNABLE code.
You have two sources of truth — use BOTH exhaustively:
  1. PROJECT KNOWLEDGE BASE — indexed project docs retrieved via similarity search.
  2. ATTACHED SPECIFICATION — TDS/FDS/BRD/context files explicitly provided (PRIMARY SOURCE).

════════════════════════════════════════════════════════════════
UPDATING EXISTING LARGE FILES FROM RAG KNOWLEDGE BASE
════════════════════════════════════════════════════════════════

If the task is to "add features to", "update", or "enhance" an EXISTING file from the knowledge base:

1. RECONSTRUCT THE COMPLETE FILE: You will receive chunks of the original file via the knowledge base context.
   These chunks are pieces of the complete file (split at 1800-char boundaries for search efficiency).
   
2. YOUR JOB:
   - Read ALL the chunks provided in the TARGETED KNOWLEDGE BASE section
   - Mentally reconstruct the COMPLETE original file by stitching chunks together
   - Understand the FULL structure: all existing methods, fields, classes, imports, dependencies
   - Identify where NEW code should be inserted (based on the specification)
   - Apply modifications WITHOUT removing or breaking existing code
   
3. RETURN THE COMPLETE UPDATED FILE:
   - Output EVERY line from the original file PLUS the new code
   - Do NOT return just the new snippets or modified sections
   - Do NOT write "... rest of file ..." or "// omitted for brevity"
   - Return the EXACT FULL FILE that would be saved to disk

4. PRESERVATION RULES:
   - Keep ALL existing imports, class declarations, method signatures
   - Keep ALL existing fields, constants, enums
   - Keep ALL existing business logic — modify only what the spec requires
   - Add new methods/fields in logical positions (near related code)
   - Update method implementations only if specified

If you cannot locate a chunk that you think exists (because it wasn't in the top results), 
ESTIMATE the likely content based on patterns in the provided chunks and project conventions.
This ensures the returned file is COMPLETE and functional.

════════════════════════════════════════════════════════════════
PROJECTION COMPLETENESS — the generated project MUST be runnable with zero manual edits
════════════════════════════════════════════════════════════════

For a Spring Boot / Java project, you MUST generate EVERY file required to run 'mvn package && java -jar target/*.jar':
  ✔ pom.xml — parent + all module POMs with every dependency and plugin declared
  ✔ src/main/resources/application.yml (or .properties) — full datasource, port, logging, actuator config
  ✔ src/main/java/…/Application.java — @SpringBootApplication with @EnableAsync, @EnableScheduling if needed
  ✔ Every @Entity with Flyway/Liquibase migration SQL under db/migration/
  ✔ Every @Repository, @Service, @RestController, @ControllerAdvice, @Configuration
  ✔ Every DTO, request/response class, custom exception class
  ✔ SecurityConfig if auth is mentioned, SwaggerConfig / OpenAPI config
  ✔ Dockerfile + docker-compose.yml
  ✔ src/test/… — integration tests using @SpringBootTest for every service and controller
  ✔ README.md — how to build, run, run tests, environment variables

For a Node.js / TypeScript project:
  ✔ package.json with all dependencies + scripts
  ✔ tsconfig.json
  ✔ src/index.ts — server entry point
  ✔ All routes, controllers, services, middleware, models
  ✔ .env.example
  ✔ Dockerfile + docker-compose.yml
  ✔ test/ — unit + integration tests

For a Python / FastAPI / Flask project:
  ✔ requirements.txt (pinned versions)
  ✔ app/__init__.py, main.py or run.py — full entry point
  ✔ All routes, models, services, schemas
  ✔ alembic/ or SQL migrations
  ✔ .env.example
  ✔ Dockerfile + docker-compose.yml
  ✔ tests/ — pytest tests

════════════════════════════════════════════════════════════════
PRODUCTION CODE RULES — non-negotiable per file
════════════════════════════════════════════════════════════════

FILE COMPLETENESS
- Every file must be 100% complete and immediately compilable/runnable.
- NEVER truncate. NEVER write "// ...", "// rest of implementation", "// TODO", "...", or any placeholder.
- A production @Service has 150-400+ lines. A @RestController has 80-200+ lines. An @Entity has 50-150+ lines.
  A pom.xml for a real project has 80-200+ lines of real dependencies. An application.yml has 50-120+ lines.
  If your file is shorter, you have omitted required content — go back and complete it.
- Every method body: full working implementation, not a stub.

CODE QUALITY (Java/Spring Boot)
- Explicit imports only — no wildcards.
- Constructor injection everywhere — no @Autowired field injection.
- Every public @Service method: @Transactional or @Transactional(readOnly=true).
- @RestController methods: ResponseEntity<T>, correct HTTP codes, @Valid on request bodies.
- SLF4J + MDC structured logging in every method (entry, exit, errors with correlation IDs).
- Input validation: @Valid + bean-validation annotations on all DTOs.
- @ControllerAdvice with @ExceptionHandler for all custom exceptions.
- No raw Exception catches — catch specific exception types.
- No hardcoded strings — use constants or @Value/@ConfigurationProperties.

PROJECT ALIGNMENT
- Use exact class names, field names, endpoint paths, error codes from the spec/context.
- If a pseudocode/algorithm section exists — implement it line-by-line, not as a summary.
- If an ERD/data model exists — generate the exact JPA @Entity graph with @Column constraints, indexes, FK relations.
- External integrations: typed interface + @Component implementation with retry, timeout, circuit-breaker.
- Every constant, enum, error code from the spec must be in a dedicated constants/enums package.

RESPONSE FORMAT — pure JSON ONLY, no markdown fences, no text outside the JSON
{
  "message": "Summary naming key classes, modules, and requirement IDs implemented",
  "files": [
    { "path": "relative/path/File.java", "content": "<full file — never truncated>" }
  ]
}

═══ SAFETY RULE ═══
NEVER overwrite, delete, or destructively modify an existing file unless the user has
explicitly confirmed the change in this session. Always create new files freely,
but for any existing file: include it in 'files' with the updated content ONLY when
the user prompt contains explicit permission words such as 'update', 'modify',
'overwrite', 'replace', 'change', or 'fix' referencing that specific file.
If permission is unclear, state in 'message' which files you are writing and why.
═══════════════`;

// ── Lightweight prompt for generic coding tasks (algorithms, snippets, dry-runs) ──
const GENERIC_CODE_GEN_SYSTEM_PROMPT = `You are a senior software engineer solving generic coding tasks.

Rules for generic requests:
- Do NOT scaffold enterprise project structures.
- Do NOT generate unrelated files like pom.xml, Dockerfile, README unless explicitly asked.
- Prefer a single self-contained source file when possible.
- If user asks for explanation or dry run, include it in message concisely.

Response format — JSON ONLY:
{
  "message": "Brief explanation and dry-run summary (if requested)",
  "files": [
    { "path": "UnionFind.java", "content": "<complete code>" }
  ]
}`;

interface AgentFile {
  path: string;
  content: string;
}

interface AgentLLMResponse {
  message: string;
  files: AgentFile[];
}

interface ChangeBackup {
  path: string;
  existed: boolean;
  previousContent?: string;
}

interface ChangeSet {
  id: string;
  createdAt: string;
  files: ChangeBackup[];
}

export interface AgentResult {
  success: boolean;
  message: string;
  executionMode?: 'qa' | 'generic-code' | 'project-codegen';
  filesWritten: string[];
  fileContents: { [path: string]: string };
  updatedExistingFiles?: string[];
  createdNewFiles?: string[];
  tips?: string[];
  ragSources?: RagSource[];        // files read from the knowledge base
  confirmationRequired?: boolean;  // true when existing files would be overwritten
  filesToOverwrite?: string[];     // list of existing files that would be replaced
  timings?: {
    startedAt: string;
    completedAt: string;
    totalMs: number;
    ragMs: number;
    executionMs: number;
    filesGenerated: number;
    avgMsPerFile: number;
  };
  undoAvailable?: boolean;
  changeSetId?: string;
  error?: string;
  rawResponse?: string;
}

export interface AgentExecutionOptions {
  reactMode?: boolean;
  humanFeedback?: string;
  includeWorkspace?: boolean;
  includeRAG?: boolean;
}

export class AgentHandler {
  private hpe: HPEClient;
  private workspacePath: string;
  private changeSets: Map<string, ChangeSet>;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.hpe = getHPEClient();
    this.changeSets = new Map<string, ChangeSet>();
    console.log('✓ Agent handler ready (HPE ChatHPE API)');
  }

  private createChangeSet(backups: ChangeBackup[]): string | undefined {
    if (!backups.length) return undefined;
    const id = `chg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.changeSets.set(id, {
      id,
      createdAt: new Date().toISOString(),
      files: backups,
    });

    // Keep memory bounded: newest 30 change sets.
    if (this.changeSets.size > 30) {
      const oldest = this.changeSets.keys().next().value;
      if (oldest) this.changeSets.delete(oldest);
    }
    return id;
  }

  /**
   * Undo a previously-applied change set.
   */
  undoChangeSet(changeSetId: string): { success: boolean; message: string; restoredFiles: string[] } {
    const entry = this.changeSets.get(changeSetId);
    if (!entry) {
      return { success: false, message: `Change set not found: ${changeSetId}`, restoredFiles: [] };
    }

    const restored: string[] = [];
    for (const f of entry.files) {
      const abs = path.resolve(this.workspacePath, f.path);
      if (!abs.startsWith(this.workspacePath)) continue;
      try {
        if (f.existed) {
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, f.previousContent || '', 'utf-8');
        } else if (fs.existsSync(abs)) {
          fs.unlinkSync(abs);
        }
        restored.push(f.path);
      } catch (err) {
        console.warn(`[Agent] Undo failed for ${f.path}:`, (err as Error).message);
      }
    }

    this.changeSets.delete(changeSetId);
    return {
      success: true,
      message: `Undo applied for ${restored.length} file(s)`,
      restoredFiles: restored,
    };
  }

  setWorkspace(newPath: string): void { this.workspacePath = newPath; }
  getWorkspace(): string { return this.workspacePath; }

  async executeTask(
    prompt: string,
    contextFiles: string[] = [],
    modelId?: string,
    forceOverwrite = false,
    saveToWorkspace = false,
    options: AgentExecutionOptions = {},
  ): Promise<AgentResult> {
    const startedAtDate = new Date();
    const startedAt = startedAtDate.toISOString();
    const t0 = Date.now();
    const includeWorkspace = options.includeWorkspace !== false;
    const includeRAG = options.includeRAG !== false;
    const ragStart = Date.now();
    const workspaceContext = includeWorkspace ? this.getWorkspaceContext() : '(workspace context disabled)';
    const injectedContext  = this.readContextFiles(contextFiles);
    const useProjectContext = (includeWorkspace || includeRAG) && this.shouldUseProjectContext(prompt, contextFiles);
    console.log(`[Agent] Project-context mode: ${useProjectContext ? 'ON' : 'OFF (generic request)'}`);

    // ── AST ENRICHMENT: Check if prompt mentions specific classes/methods ────
    // If user is updating an existing file, fetch it completely via AST
    const astEnrichedContext = useProjectContext && includeRAG ? this.enrichPromptWithAST(prompt) : '';
    const enrichedPrompt = astEnrichedContext ? `${prompt}\n\n[ENRICHED WITH COMPLETE CODE FROM AST]\n${astEnrichedContext}` : prompt;

    // ── RAG: similarity search on prompt + first 600 chars of attached spec ──
    const attachedSummary = injectedContext.substring(0, 600);
    // Use multi-query retrieval for initial context (task-level)
    const ragData = useProjectContext && includeRAG
      ? await ragRetriever.retrieveMultiWithSources(
          [enrichedPrompt, attachedSummary.substring(0, 300)].filter(Boolean),
          10  // topK per query
        )
      : { context: '', sources: [] as RagSource[] };

    const ragContext = ragData.context;
    const ragSources = ragData.sources;
    const ragMs = Date.now() - ragStart;

    const ragSection = ragContext
      ? `\n\n── PROJECT KNOWLEDGE BASE (retrieved via similarity search — use for context, patterns, domain terms) ──\n${ragContext}\n── END PROJECT KNOWLEDGE BASE ──`
      : '';

    const contextSection = injectedContext.length > 0
      ? `\n\n── ATTACHED SPECIFICATION (primary source — implement everything in here exactly) ──\n${injectedContext}\n── END ATTACHED SPECIFICATION ──`
      : '';

    // ── Route: Q&A vs code generation ───────────────────────────────────────
    const intent = this.detectIntent(enrichedPrompt);
    const finalPrompt = this.applyCodingAgentDirectives(
      enrichedPrompt,
      intent,
      options.reactMode === true,
      (options.humanFeedback || '').trim(),
    );
    const updateExistingMode = this.isExistingFileUpdateRequest(enrichedPrompt, contextFiles);
    const genericCodeMode = intent === 'codegen' && this.shouldUseGenericCodeMode(prompt, contextFiles, useProjectContext);
    const inferredTargetFiles = updateExistingMode
      ? await this.inferRelatedWorkspaceFiles(enrichedPrompt, includeRAG)
      : [];
    console.log(`[Agent] Intent: ${intent}`);
    console.log(`[Agent] Existing-file update mode: ${updateExistingMode}`);
    console.log(`[Agent] Generic-code mode: ${genericCodeMode ? 'ON' : 'OFF'}`);
    if (updateExistingMode) {
      console.log(`[Agent] Inferred related file scope: ${inferredTargetFiles.length > 0 ? inferredTargetFiles.join(', ') : '(none inferred)'}`);
    }

    const withTimings = (result: AgentResult): AgentResult => {
      const completedAt = new Date().toISOString();
      const totalMs = Date.now() - t0;
      const executionMs = Math.max(0, totalMs - ragMs);
      const filesGenerated = (result.filesWritten || []).length;
      const avgMsPerFile = filesGenerated > 0 ? Math.round(executionMs / filesGenerated) : 0;
      return {
        ...result,
        timings: {
          startedAt,
          completedAt,
          totalMs,
          ragMs,
          executionMs,
          filesGenerated,
          avgMsPerFile,
        },
      };
    };

    if (intent === 'qa') {
      const result = await this.executeQA(finalPrompt, ragSection, contextSection, ragSources, includeRAG, modelId);
      return withTimings({ ...result, executionMode: 'qa' });
    }

    // Code generation — use batched approach
    const result = genericCodeMode
      ? await this.executeGenericCodeGen(finalPrompt, modelId)
      : await this.executeBatchedCodeGen(
          finalPrompt, ragSection, contextSection, workspaceContext, ragSources, forceOverwrite, saveToWorkspace, updateExistingMode, includeRAG, modelId, inferredTargetFiles
        );
    return withTimings({
      ...result,
      executionMode: genericCodeMode ? 'generic-code' : 'project-codegen',
    });
  }

  private shouldUseGenericCodeMode(prompt: string, contextFiles: string[], useProjectContext: boolean): boolean {
    if (useProjectContext) return false;
    if (contextFiles.length > 0) return false;
    const p = prompt.toLowerCase();

    // If prompt references project-ish paths/modules, stay on enterprise path.
    if (/aoe_|src\/main\/java|checklistservice|prepareomuiquote|deal_vrsn|qids|s4 addison|dqm/.test(p)) {
      return false;
    }

    // Generic algorithm / coding exercise signals.
    return /\b(union[ -]?find|disjoint set|dry run|example input|leetcode|algorithm|data structure|coding problem|dfs|bfs|dp|graph)\b/.test(p);
  }

  private async executeGenericCodeGen(prompt: string, modelId?: string): Promise<AgentResult> {
    const fullPrompt = this.capPrompt(`${GENERIC_CODE_GEN_SYSTEM_PROMPT}\n\nTask:\n${prompt}`);
    try {
      const raw = await this.hpe.askWithRetry(fullPrompt, modelId);
      const parsed = this.parseAgentResponse(raw);
      if (!parsed) {
        return {
          success: false,
          message: 'LLM response was not valid JSON',
          filesWritten: [],
          fileContents: {},
          rawResponse: raw.substring(0, 800),
        };
      }

      const filesWritten: string[] = [];
      const fileContents: { [p: string]: string } = {};
      for (const file of parsed.files || []) {
        if (!file.path || file.content === undefined) continue;
        const cleanPath = path.basename(file.path);
        filesWritten.push(cleanPath);
        fileContents[cleanPath] = file.content;
      }

      return {
        success: true,
        message: parsed.message || 'Generated solution',
        filesWritten,
        fileContents,
        tips: ['Generic coding mode used: no enterprise project scaffolding generated.'],
      };
    } catch (err: any) {
      return {
        success: false,
        message: 'LLM call failed',
        filesWritten: [],
        fileContents: {},
        error: err.message,
      };
    }
  }

  private applyCodingAgentDirectives(
    prompt: string,
    intent: 'qa' | 'codegen',
    reactMode: boolean,
    humanFeedback: string,
  ): string {
    if (intent !== 'codegen' && !humanFeedback) return prompt;

    let directives = '\n\n── CODING AGENT EXECUTION DIRECTIVES ──\n';
    if (intent === 'codegen' && reactMode) {
      directives +=
        'Use ReAct-style execution internally for coding tasks:\n' +
        '1) REASON: identify requirements, constraints, and target files before writing.\n' +
        '2) ACT: generate files in the safest order (manifest -> implementation -> checks).\n' +
        '3) VERIFY: self-check completeness, imports, and compile readiness before final JSON.\n' +
        'Do not expose chain-of-thought; return concise implementation summary plus files JSON only.\n';
    }

    if (humanFeedback) {
      directives +=
        'Human feedback from previous iteration (highest priority):\n' +
        `${humanFeedback}\n` +
        'Apply this feedback directly in your generated output.\n';
    }

    directives += '── END CODING AGENT EXECUTION DIRECTIVES ──';
    return `${prompt}${directives}`;
  }

  /**
   * Enrich prompt with complete code from AST if it mentions specific classes/methods
   * Example: If user says "add feature to QuoteService", fetch complete QuoteService from AST
   */
  private enrichPromptWithAST(prompt: string): string {
    // Look for Java/TS class-like names (e.g., PrepareOMUIQuote, QuoteService)
    const classNamePattern = /\b([A-Z][A-Za-z0-9]{2,})\b/g;
    const matches = prompt.match(classNamePattern) || [];
    
    // Deduplicate and limit to 3 classes to avoid overwhelming context
    const uniqueClasses = Array.from(new Set(matches)).slice(0, 3);
    
    let astContext = '';
    
    for (const className of uniqueClasses) {
      try {
        const symbol = ragRetriever.retrieveSymbol(className);
        if (symbol) {
          astContext += `\n\n【 COMPLETE ${className} FROM AST 】\n${symbol.context}\n【 END ${className} 】`;
          console.log(`[Agent] AST enrichment: Found complete ${className} (${symbol.context.length} chars)`);
        }
      } catch (err) {
        console.warn(`[Agent] AST enrichment failed for ${className}:`, (err as Error).message);
      }
    }
    
    return astContext;
  }

  /**
   * True when the user asks to add/change behavior in EXISTING code from a spec/TDS.
   * This prevents the agent from scaffolding a brand-new project tree.
   */
  private isExistingFileUpdateRequest(prompt: string, contextFiles: string[]): boolean {
    const p = prompt.toLowerCase();
    const hasSpec = /\b(tds|fds|brd|spec|requirement)\b/.test(p) ||
      contextFiles.some(f => /tds|fds|brd|spec/i.test(path.basename(f)));
    const asksUpdate = /\b(update|modify|change|enhance|extend|add feature|existing file|existing code|into existing|in existing)\b/.test(p);
    const asksRevise = /\b(revise|revision|fix this|fix that|handle exception|adjust|tweak|correct)\b/.test(p);
    const asksGreenfield = /\b(create new project|from scratch|scaffold|boilerplate|generate full project)\b/.test(p);
    const mentionsProjectCode = /\b(src\/|pom\.xml|application\.yml|java|spring|service|controller|impl|commonutil|checklist|quote)\b/.test(p);
    return !asksGreenfield && ((hasSpec && asksUpdate) || ((asksUpdate || asksRevise) && mentionsProjectCode));
  }

  /**
   * Infer likely target files for revise/fix prompts that do not name explicit file paths.
   * This keeps updates surgical by narrowing generation to existing files only.
   */
  private async inferRelatedWorkspaceFiles(prompt: string, includeRAG: boolean): Promise<string[]> {
    const found = new Set<string>();

    // 1) Symbol-based lookup from class-like names in prompt.
    const classNamePattern = /\b([A-Z][A-Za-z0-9]{2,})\b/g;
    const classNames = Array.from(new Set(prompt.match(classNamePattern) || [])).slice(0, 6);
    for (const className of classNames) {
      try {
        const paths = ragRetriever.retrieveFilesWithSymbol(className) || [];
        for (const filePath of paths) {
          const normalized = filePath.replace(/\\/g, '/');
          const rel = path.relative(this.workspacePath, normalized).replace(/\\/g, '/');
          if (!rel.startsWith('..') && fs.existsSync(path.resolve(this.workspacePath, rel))) {
            found.add(rel);
          }
        }
      } catch {
        // best-effort inference; ignore symbol lookup failures
      }
    }

    // 2) Retrieval source fallback when symbol lookup did not find enough files.
    if (includeRAG && found.size < 2) {
      try {
        const { sources } = await ragRetriever.retrieveMultiWithSources(
          [prompt, prompt.split(' ').slice(0, 10).join(' ')].filter(Boolean),
          8,
        );
        for (const s of sources) {
          const normalized = s.path.replace(/\\/g, '/');
          const rel = path.relative(this.workspacePath, normalized).replace(/\\/g, '/');
          if (!rel.startsWith('..') && fs.existsSync(path.resolve(this.workspacePath, rel))) {
            found.add(rel);
          }
        }
      } catch {
        // best-effort inference; ignore retrieval failures
      }
    }

    return Array.from(found).slice(0, 8);
  }

  /**
   * Decide whether CPQ/NGQC project context should be injected.
   * For generic prompts (e.g., "build a ticket booking system"), keep context OFF.
   */
  private shouldUseProjectContext(prompt: string, contextFiles: string[]): boolean {
    if (contextFiles.length > 0) return true;

    const p = prompt.toLowerCase();
    const projectSignals = [
      'cpq', 'ngqc', 'dqm', 'qids', 's4', 'deal reference', 'ucid',
      'prepareomuiquote', 'quote load', 'r&r', 'hp quote', 'aoe_base'
    ];
    const genericBuildSignals = [
      'from scratch', 'entire production ready code', 'build an entire',
      'ticket booking', 'ecommerce', 'chat app', 'todo app', 'social media app'
    ];

    const hasProjectSignal = projectSignals.some(k => p.includes(k));
    const hasGenericSignal = genericBuildSignals.some(k => p.includes(k));

    if (hasProjectSignal) return true;
    if (hasGenericSignal) return false;

    // Default to NOT using project context for ambiguous/generic requests.
    // Only use it when the prompt explicitly references project-specific terms.
    return false;
  }

  /**
   * Classify the prompt as a Q&A/analysis task vs a code generation task.
   * Code gen = any prompt that asks to create, generate, implement, build files.
   */
  private detectIntent(prompt: string): 'qa' | 'codegen' {
    const p = prompt.toLowerCase();
    const codeGenPatterns = [
      /\bgenerat(e|ing)\b.*\b(code|class|file|service|controller|entity|repo|test|impl|api|endpoint|rest|spring|java|ts|tsx|js|jsx|py|sql|xml|yaml|yml|json)\b/,
      /\bimplement\b/,
      /\badd\b.*\b(feature|validation|logic|check|method|endpoint|service|controller|rule|integration)\b/,
      /\b(update|modify|change|extend|enhance|refactor|fix)\b.*\b(code|service|controller|class|method|file|logic|validation|rule)\b/,
      /\bcreat(e|ing)\b.*\b(class|service|controller|entity|repo|api|endpoint|module)\b/,
      /\bwrit(e|ing)\b.*\b(code|class|file|service|controller)\b/,
      /\bproduction.?ready\b/,
      /\bend.?to.?end\b.*\b(code|app|impl)\b/,
      /\bspring boot\b.*\b(creat|generat|impl|build)\b/,
      /\b(tds|fds|brd)\b.*\b(code|impl|generat|creat)\b/,
      /\bfrom\b.*\b(tds|fds|brd|spec)\b.*\b(generat|impl|creat|build)\b/,
      /\bgenerat.*\bfiles?\b/,
      /\bwrite.*\bjava\b/,
      /\bcode\s+for\b/,
      /\bbuild\b.*\b(app|application|service|api)\b/,
    ];

    const actionWords = /\b(add|implement|create|write|generate|update|modify|change|extend|enhance|refactor|fix|patch)\b/;
    const technicalTargets = /\b(validation|logic|method|class|service|controller|endpoint|api|file|code|rule|flow|integration|quote|deal|version)\b/;

    if (codeGenPatterns.some(re => re.test(p))) return 'codegen';
    // Fallback heuristic: if a prompt asks to change behavior in technical terms,
    // treat it as code generation even when phrasing doesn't match strict regexes.
    if (actionWords.test(p) && technicalTargets.test(p)) return 'codegen';
    return 'qa';
  }

  /** Handle general Q&A, analysis, and explanation — plain text response */
  private async executeQA(
    prompt: string,
    ragSection: string,
    contextSection: string,
    initialSources: RagSource[],
    includeRAG: boolean,
    modelId?: string,
  ): Promise<AgentResult> {
    // For Q&A, retrieve MORE chunks with higher topK to get deeper coverage
    const { context: deepContext, sources: deepSources } = includeRAG
      ? await ragRetriever.retrieveMultiWithSources(
          [prompt, prompt.split(' ').slice(0, 8).join(' ')],
          15  // topK per query — gives up to 30 unique chunks of 1800 chars each
        )
      : { context: '', sources: [] as RagSource[] };
    // merge sources, deduplicate by path
    const sourceMap = new Map<string, RagSource>();
    for (const s of [...initialSources, ...deepSources]) {
      const ex = sourceMap.get(s.path);
      if (ex) { ex.chunks += s.chunks; ex.linesRead += s.linesRead; }
      else sourceMap.set(s.path, { ...s });
    }
    const allSources = Array.from(sourceMap.values()).sort((a, b) => b.linesRead - a.linesRead);

    const deepSection = deepContext
      ? `\n\n── PROJECT KNOWLEDGE BASE (deep retrieval — quote verbatim passages in your answer) ──\n${deepContext}\n── END KNOWLEDGE BASE ──`
      : ragSection;   // fallback to task-level retrieval

    const qaPrompt = `${QA_SYSTEM_PROMPT}${deepSection}${contextSection}

IMPORTANT ANSWERING RULES:
- Quote EXACT text, class names, field names, method signatures, and values directly from the context above.
- If the user asks for code from the project, return it verbatim from the retrieved passages — do NOT rewrite it.
- If the retrieved context contains a full class/file relevant to the question, reproduce ALL of it in a fenced code block.
- If the context does not fully answer the question, clearly say "The indexed docs do not contain this information" and answer from general knowledge.
- Do NOT hallucinate field names, class names, or business rules.

Question / Task:
${prompt}`;

    const fullPrompt = this.capPrompt(qaPrompt);
    try {
      const raw = await this.hpe.askWithRetry(fullPrompt, modelId);
      return {
        success: true,
        message: raw.trim(),
        filesWritten: [],
        fileContents: {},
        ragSources: allSources,
        rawResponse: raw,
      };
    } catch (err: any) {
      return { success: false, message: 'LLM call failed', filesWritten: [], fileContents: {}, ragSources: allSources, error: err.message };
    }
  }

  /**
   * Batched code generation:
   *   Step 1 — Manifest call: get the list of files (path + purpose), NO content.
   *   Step 2 — ONE file per LLM call: generate each file completely, no token budget sharing.
   *
   * Generating one file per call means the full output budget is dedicated to that
   * single file — no more thin, template-quality output from distributing tokens across
   * many files simultaneously.
   */
  private async executeBatchedCodeGen(
    prompt: string,
    ragSection: string,
    contextSection: string,
    workspaceContext: string,
    initialSources: RagSource[],
    forceOverwrite: boolean,
    saveToWorkspace: boolean,
    updateExistingMode: boolean,
    includeRAG: boolean,
    modelId?: string,
    targetFilesHint: string[] = [],
  ): Promise<AgentResult> {

    const sharedCtx = `${CODE_GEN_SYSTEM_PROMPT}${ragSection}${contextSection}`;
    const allFilesWritten: string[] = [];
    const allFileContents: { [p: string]: string } = {};
    const changeBackups = new Map<string, ChangeBackup>();
    const updatedExistingFiles: string[] = [];
    const createdNewFiles: string[] = [];
    // accumulate all RAG sources across every per-file call
    const sourceMap = new Map<string, RagSource>();
    for (const s of initialSources) sourceMap.set(s.path, { ...s });

    // ── Step 1: Manifest ─────────────────────────────────────────────────────
    console.log('[Agent] Step 1 — requesting file manifest');

    const manifestPrompt = this.capPrompt(
      `${sharedCtx}\n\nTask: ${prompt}\n\nExisting workspace:\n${workspaceContext}\n\n` +
      `STEP 1 — FILE MANIFEST ONLY. Do NOT write any file content yet.\n\n` +
      (updateExistingMode
        ?
        `MODE: EXISTING-CODE UPDATE (NOT GREENFIELD SCAFFOLDING).\n` +
        `Your goal is to implement the requested TDS/spec feature by modifying EXISTING files first.\n` +
        `Do NOT generate a brand-new project structure, controllers, repositories, pom.xml, Docker files, or README unless explicitly required by the spec.\n` +
        `Prioritize files that already exist in the workspace or are clearly present in the knowledge base context.\n` +
        `Only include new files when strictly necessary for the feature; keep them minimal and directly related.\n` +
        `For revise/fix requests without explicit file paths, include ONLY the minimum impacted files (normally 1-3).\n` +
        (targetFilesHint.length > 0
          ? `TARGET FILE HINTS (highest priority):\n${targetFilesHint.map(f => `  - ${f}`).join('\n')}\n\n`
          : '\n')
        :
        `Produce the COMPLETE list of every file needed so the project is immediately buildable and runnable \n` +
        `with zero manual edits. This means:\n` +
        `  • ALL source files (entities, repos, services, controllers, DTOs, exceptions, config, constants, enums)\n` +
        `  • ALL resource files (application.yml, application-dev.yml, logback-spring.xml)\n` +
        `  • ALL build files (pom.xml for every Maven module, package.json, tsconfig.json, requirements.txt)\n` +
        `  • ALL database migration files (Flyway V1__init.sql, V2__...sql, etc.)\n` +
        `  • ALL Docker files (Dockerfile, docker-compose.yml, .dockerignore)\n` +
        `  • ALL test files (unit tests + integration tests, minimum 1 per service and controller)\n` +
        `  • A README.md with build/run/test instructions\n\n`
      ) +
      `For each file give:\n` +
      `  - path: relative path from project root (e.g. src/main/java/com/example/service/QuoteService.java)\n` +
      `  - purpose: one sentence describing the file\n` +
      `  - lines: realistic estimate of lines needed for a production-quality file\n\n` +
      `Respond with ONLY this JSON (no markdown, no extra text):\n` +
      `{ "message": "one sentence summary of what will be built", "files": [ { "path": "...", "purpose": "...", "lines": 200 } ] }`
    );

    let manifest: { message: string; files: { path: string; purpose: string; lines?: number }[] } | null = null;
    try {
      const raw = await this.hpe.askWithRetry(manifestPrompt, modelId);
      manifest = this.parseManifest(raw);
    } catch (e: any) {
      return { success: false, message: 'Manifest call failed', filesWritten: [], fileContents: {}, error: e.message };
    }

    if (!manifest?.files?.length) {
      console.warn('[Agent] Manifest failed — falling back to single call');
      const result = await this.executeSingleCall(prompt, sharedCtx, workspaceContext, saveToWorkspace, modelId);
      result.ragSources = Array.from(sourceMap.values());
      return result;
    }

    // In existing-update mode, reduce drift by preferring files that already exist on disk.
    if (updateExistingMode) {
      if (targetFilesHint.length > 0) {
        const hintSet = new Set(targetFilesHint.map(h => h.replace(/\\/g, '/').toLowerCase()));
        const narrowedByHint = manifest.files.filter(f => {
          const normalized = f.path.replace(/\\/g, '/').toLowerCase();
          return hintSet.has(normalized) || hintSet.has(path.basename(normalized));
        });
        if (narrowedByHint.length > 0) {
          console.log(`[Agent] Existing-update mode: narrowed manifest by inferred hints from ${manifest.files.length} to ${narrowedByHint.length} file(s)`);
          manifest.files = narrowedByHint;
        } else {
          console.log('[Agent] Existing-update mode: manifest missed inferred target files; using inferred targets directly');
          manifest.files = targetFilesHint.map(filePath => ({
            path: filePath,
            purpose: 'Targeted existing-file revision inferred from prompt/context',
            lines: 120,
          }));
        }
      }

      const existingOnly = manifest.files.filter(f => {
        const absPath = path.resolve(this.workspacePath, f.path);
        return absPath.startsWith(this.workspacePath) && fs.existsSync(absPath);
      });
      if (existingOnly.length > 0) {
        console.log(`[Agent] Existing-update mode: narrowed manifest from ${manifest.files.length} to ${existingOnly.length} existing file(s)`);
        manifest.files = existingOnly;
      }
    }

    console.log(`[Agent] Manifest: ${manifest.files.length} file(s) planned`);

    // ── Pre-flight: check which planned files already exist on disk ───────────
    const existingFiles: string[] = [];
    const existingSet = new Set<string>();
    for (const entry of manifest.files) {
      const absPath = path.resolve(this.workspacePath, entry.path);
      // security: must stay inside workspace
      if (!absPath.startsWith(this.workspacePath)) continue;
      if (fs.existsSync(absPath)) {
        existingFiles.push(entry.path);
        existingSet.add(entry.path);
      }
    }

    if (saveToWorkspace && existingFiles.length > 0 && !forceOverwrite) {
      console.warn(`[Agent] ⛔ ${existingFiles.length} existing file(s) would be overwritten — halting for confirmation`);
      return {
        success: false,
        confirmationRequired: true,
        filesToOverwrite: existingFiles,
        message: `${existingFiles.length} file(s) already exist in your workspace and would be overwritten. Confirm to proceed.`,
        filesWritten: [],
        fileContents: {},
        ragSources: Array.from(sourceMap.values()),
      };
    }

    if (saveToWorkspace && existingFiles.length > 0) {
      console.log(`[Agent] forceOverwrite=true — overwriting ${existingFiles.length} existing file(s)`);
    }

    // ── Step 2: One file per call ─────────────────────────────────────────────
    for (let i = 0; i < manifest.files.length; i++) {
      const entry = manifest.files[i];
      const estimatedLines = entry.lines || 200;
      const entryAbsPath = path.resolve(this.workspacePath, entry.path);

      console.log(`[Agent] File ${i + 1}/${manifest.files.length} — ${entry.path} (~${estimatedLines} lines)`);

      // Read the current file first in update mode to reduce accidental regressions.
      let existingFileSection = '';
      if (updateExistingMode && entryAbsPath.startsWith(this.workspacePath) && fs.existsSync(entryAbsPath)) {
        try {
          const existingContent = fs.readFileSync(entryAbsPath, 'utf-8');
          const MAX_EXISTING_CHARS = 25_000;
          const trimmed = existingContent.length > MAX_EXISTING_CHARS
            ? existingContent.slice(0, MAX_EXISTING_CHARS) + `\n\n[...existing file truncated at ${MAX_EXISTING_CHARS} chars]`
            : existingContent;
          existingFileSection = `\n\n── CURRENT FILE CONTENT (${entry.path}) ──\n${trimmed}\n── END CURRENT FILE CONTENT ──`;
          console.log(`[Agent] Read existing file before generation: ${entry.path}`);
        } catch (err: any) {
          console.warn(`[Agent] Could not read existing file ${entry.path}: ${err.message}`);
        }
      }

      // ── Targeted RAG retrieval for THIS specific file ────────────────────
      const fileName = path.basename(entry.path, path.extname(entry.path));
      const fileExt = path.extname(entry.path);
      
      // For large files (>150 lines), use DEEP retrieval with more queries + higher topK
      // This reconstructs the complete file from RAG chunks
      const isLargeFile = estimatedLines > 150;
      const topKForFile = isLargeFile ? 15 : 8;  // More chunks for large files
      
      const fileRagQueries = [
        `${fileName} ${entry.purpose}`,
        `${fileName} implementation business rules methods`,
        `${fileName} complete file class definition all methods fields`,
        prompt.substring(0, 200),
      ];
      
      // Add file-type specific queries for better reconstruction
      if (fileExt === '.java') {
        fileRagQueries.push(`${fileName} public private protected class interface extends implements`);
        fileRagQueries.push(`${fileName} constructor initialization methods services`);
      } else if (fileExt === '.py') {
        fileRagQueries.push(`${fileName} def __init__ class function methods`);
        fileRagQueries.push(`${fileName} imports dependencies entire module`);
      } else if (['.ts', '.js'].includes(fileExt)) {
        fileRagQueries.push(`${fileName} export import interface class function`);
        fileRagQueries.push(`${fileName} async await methods properties types`);
      }
      
      const { context: fileRagContext, sources: fileSources } = includeRAG
        ? await ragRetriever.retrieveMultiWithSources(fileRagQueries, topKForFile)
        : { context: '', sources: [] as RagSource[] };
      // merge per-file sources into the global map
      for (const s of fileSources) {
        const ex = sourceMap.get(s.path);
        if (ex) { ex.chunks += s.chunks; ex.linesRead += s.linesRead; }
        else sourceMap.set(s.path, { ...s });
      }
      const fileRagSection = fileRagContext
        ? `\n\n── TARGETED KNOWLEDGE BASE for ${entry.path} ──\n${fileRagContext}\n── END TARGETED KNOWLEDGE BASE ──`
        : ragSection;  // fallback to task-level context

      // Per-file type quality rules
      const fileTypeRules = this.getFileTypeRules(entry.path, estimatedLines);

      const filePrompt = this.capPrompt(
        `${CODE_GEN_SYSTEM_PROMPT}${fileRagSection}${contextSection}${existingFileSection}\n\nOverall task: ${prompt}\n\n` +
        `FILE ${i + 1} of ${manifest.files.length}: ${entry.path}\n` +
        `Purpose: ${entry.purpose}\n` +
        `Expected size: ~${estimatedLines} lines\n\n` +
        `Generate THIS FILE ONLY — complete, production-ready, every line of real implementation.\n` +
        `All planned files in this task:\n${manifest.files.map(f => `  • ${f.path}`).join('\n')}\n\n` +
        `CRITICAL QUALITY REQUIREMENTS:\n${fileTypeRules}\n\n` +
        `Respond with ONLY this JSON (no markdown fences):\n` +
        `{ "message": "...", "files": [ { "path": "${entry.path}", "content": "<full file>" } ] }`
      );

      let generated = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const raw = attempt === 1
            ? await this.hpe.askWithRetry(filePrompt, modelId)
            : await this.hpe.askWithRetry(
                this.capPrompt(
                  `${CODE_GEN_SYSTEM_PROMPT}${fileRagSection}${contextSection}\n\n` +
                  `YOUR PREVIOUS ATTEMPT for ${entry.path} was REJECTED because it was too short (under ${Math.floor(estimatedLines * 0.5)} lines).\n` +
                  `You MUST generate the COMPLETE file with NO truncation. Every method, field, import, and annotation must be present.\n` +
                  `Expected: ~${estimatedLines} lines. Purpose: ${entry.purpose}\n\n` +
                  `CRITICAL: do NOT write any placeholder, comment like "// ...", "// rest of code", or "// TODO".\n` +
                  `Respond with ONLY this JSON: { "message": "...", "files": [ { "path": "${entry.path}", "content": "<full file>" } ] }`
                ),
                modelId
              );
          const parsed = this.parseAgentResponse(raw);

          if (parsed?.files?.length) {
            for (const file of parsed.files) {
              if (!file.path || file.content === undefined) continue;
              const absPath = path.resolve(this.workspacePath, file.path);
              if (!absPath.startsWith(this.workspacePath)) {
                console.warn('[Agent] Rejected path outside workspace:', file.path);
                continue;
              }
              const lineCount = file.content.split('\n').length;
              const minLines  = Math.max(30, Math.floor(estimatedLines * 0.4));

              if (lineCount < minLines && attempt < 2) {
                console.warn(`[Agent]   ⚠ ${file.path} too short (${lineCount} < ${minLines} min) — retrying…`);
                break;  // exit inner for-loop to trigger retry
              }

              allFilesWritten.push(file.path);
              allFileContents[file.path] = file.content;
              if (saveToWorkspace) {
                if (!changeBackups.has(file.path)) {
                  const existed = fs.existsSync(absPath);
                  changeBackups.set(file.path, {
                    path: file.path,
                    existed,
                    previousContent: existed ? fs.readFileSync(absPath, 'utf-8') : undefined,
                  });
                }
                fs.mkdirSync(path.dirname(absPath), { recursive: true });
                fs.writeFileSync(absPath, file.content, 'utf-8');
                if (existingSet.has(file.path)) updatedExistingFiles.push(file.path);
                else createdNewFiles.push(file.path);
              }
              console.log(`[Agent]   ✓ ${file.path} (${lineCount} lines)${lineCount < minLines ? ' [short — wrote anyway]' : ''}${saveToWorkspace ? '' : ' [not saved]'}`);
              generated = true;
            }
            if (generated) break;
          } else {
            console.warn(`[Agent]   ✗ No parseable file for ${entry.path} (attempt ${attempt})`);
          }
        } catch (e: any) {
          console.error(`[Agent]   ✗ Error generating ${entry.path} (attempt ${attempt}): ${e.message}`);
        }
      }

      // Brief pause between calls to avoid rate limiting
      if (i < manifest.files.length - 1) {
        await new Promise(r => setTimeout(r, 400));
      }
    }

    const generatedCount = allFilesWritten.length;
    const changeSetId = saveToWorkspace && generatedCount > 0
      ? this.createChangeSet(Array.from(changeBackups.values()))
      : undefined;
    return {
      success: generatedCount > 0,
      message: generatedCount > 0
        ? `${manifest.message} — ${generatedCount}/${manifest.files.length} files generated${saveToWorkspace ? ' and written' : ' (not saved to workspace)'}`
        : 'No files were successfully generated',
      filesWritten: allFilesWritten,
      fileContents: allFileContents,
      updatedExistingFiles: saveToWorkspace ? Array.from(new Set(updatedExistingFiles)) : [],
      createdNewFiles: saveToWorkspace ? Array.from(new Set(createdNewFiles)) : [],
      tips: saveToWorkspace
        ? this.buildUpdateTips(updateExistingMode, updatedExistingFiles, createdNewFiles)
        : ['Auto-save is disabled. Review the generated files and save only the ones you want.'],
      ragSources: Array.from(sourceMap.values()).sort((a, b) => b.linesRead - a.linesRead),
      undoAvailable: !!changeSetId,
      changeSetId,
    };
  }

  private buildUpdateTips(updateExistingMode: boolean, updatedExistingFiles: string[], createdNewFiles: string[]): string[] {
    const tips: string[] = [];
    const uniqueUpdated = Array.from(new Set(updatedExistingFiles));
    const uniqueCreated = Array.from(new Set(createdNewFiles));

    if (uniqueUpdated.length > 0) {
      tips.push(`Updated existing files (${uniqueUpdated.length}): focus review there first.`);
      tips.push(`Open changed files and review methods around business-validation entry points (quote load flow, deal/UCID checks, R&R decision path).`);
    }

    if (uniqueCreated.length > 0) {
      tips.push(`Created new files (${uniqueCreated.length}): verify each is truly required by your spec before keeping.`);
    }

    if (updateExistingMode && uniqueCreated.length > 0) {
      tips.push('You requested existing-code update mode. If new files are not desired, re-run with: "update existing file(s) only, do not create new files" and include exact file path(s).');
    }

    if (tips.length === 0) {
      tips.push('No files were updated. Re-run with exact target file path and required method/section names.');
    }

    return tips;
  }

  /** Fallback: single LLM call for small tasks or when manifest fails */
  private async executeSingleCall(
    prompt: string,
    sharedCtx: string,
    workspaceContext: string,
    saveToWorkspace = true,
    modelId?: string,
  ): Promise<AgentResult> {
    const fullPrompt = this.capPrompt(
      `${sharedCtx}\n\nTask: ${prompt}\n\nWorkspace:\n${workspaceContext}`
    );
    try {
      const raw = await this.hpe.askWithRetry(fullPrompt, modelId);
      const parsed = this.parseAgentResponse(raw);
      if (!parsed) {
        return { success: false, message: 'LLM response was not valid JSON', filesWritten: [], fileContents: {}, rawResponse: raw.substring(0, 800) };
      }
      const filesWritten: string[] = [];
      const fileContents: { [p: string]: string } = {};
      const changeBackups = new Map<string, ChangeBackup>();
      for (const file of parsed.files || []) {
        if (!file.path || file.content === undefined) continue;
        const absPath = path.resolve(this.workspacePath, file.path);
        if (!absPath.startsWith(this.workspacePath)) continue;
        filesWritten.push(file.path);
        fileContents[file.path] = file.content;
        if (saveToWorkspace) {
          if (!changeBackups.has(file.path)) {
            const existed = fs.existsSync(absPath);
            changeBackups.set(file.path, {
              path: file.path,
              existed,
              previousContent: existed ? fs.readFileSync(absPath, 'utf-8') : undefined,
            });
          }
          fs.mkdirSync(path.dirname(absPath), { recursive: true });
          fs.writeFileSync(absPath, file.content, 'utf-8');
        }
      }
      const changeSetId = saveToWorkspace && filesWritten.length > 0
        ? this.createChangeSet(Array.from(changeBackups.values()))
        : undefined;
      return {
        success: true,
        message: `${parsed.message || 'Done'}${saveToWorkspace ? '' : ' (not saved to workspace)'}`,
        filesWritten,
        fileContents,
        undoAvailable: !!changeSetId,
        changeSetId,
      };
    } catch (err: any) {
      return { success: false, message: 'LLM call failed', filesWritten: [], fileContents: {}, error: err.message };
    }
  }

  /**
   * Returns tailored quality rules for a specific file based on its path/extension.
   * This replaces the generic list that applied the same rules to every file type.
   */
  private getFileTypeRules(filePath: string, estimatedLines: number): string {
    const p = filePath.toLowerCase();
    const fname = path.basename(p);
    const common = `\u2022 File must be ~${estimatedLines} lines or more — do NOT produce a shorter version.\n` +
                   `\u2022 NEVER truncate. NEVER write "// ...", "// TODO", or any placeholder.\n` +
                   `\u2022 Every section must be fully implemented with real values, not examples or stubs.\n`;

    if (fname === 'pom.xml') return common +
      `\u2022 Include ALL dependencies used across every source file planned (Spring Boot starter-web, data-jpa, security, validation, actuator, etc.).\n` +
      `\u2022 Include build plugins: spring-boot-maven-plugin, maven-compiler-plugin (Java 17+), maven-surefire-plugin.\n` +
      `\u2022 Set <java.version>, <spring-boot.version> properties. Use BOM for version management.\n` +
      `\u2022 Include test dependencies: junit-jupiter, mockito-junit-jupiter, spring-boot-starter-test, testcontainers if integration tests exist.\n`;

    if (fname === 'docker-compose.yml' || fname === 'docker-compose.yaml') return common +
      `\u2022 Define every service: the app, database (PostgreSQL/MySQL), any cache (Redis), message broker (Kafka/RabbitMQ) referenced in the spec.\n` +
      `\u2022 Include proper health-checks, depends_on with service_healthy condition, volume mounts for data persistence.\n` +
      `\u2022 Use environment variables, not hardcoded passwords. Include an .env file in the manifest.\n`;

    if (fname === 'dockerfile') return common +
      `\u2022 Use multi-stage build: build stage (maven/gradle) + slim runtime stage (eclipse-temurin:17-jre-alpine).\n` +
      `\u2022 COPY only the built artifact, not the entire source tree.\n` +
      `\u2022 Run as non-root user. EXPOSE the correct port. Set JVM memory flags as ENV.\n`;

    if (fname.endsWith('application.yml') || fname.endsWith('application.properties')) return common +
      `\u2022 Include server.port, full spring.datasource (url, username, password, pool config), spring.jpa (ddl-auto, show-sql, dialect).\n` +
      `\u2022 Include logging configuration (levels for root, the app package, and hibernate).\n` +
      `\u2022 Include management.endpoints.web.exposure.include for actuator health/info/metrics.\n` +
      `\u2022 Include all @Value / @ConfigurationProperties keys referenced across all source files.\n`;

    if (fname.endsWith('.sql') || p.includes('migration') || p.includes('flyway') || p.includes('liquibase')) return common +
      `\u2022 Create ALL tables, sequences, indexes, foreign keys, constraints derived from the @Entity classes.\n` +
      `\u2022 Include INSERT statements for any required seed/reference data (enums, lookup tables, admin user, etc.).\n` +
      `\u2022 Use IF NOT EXISTS guards. Add comments explaining each table's purpose.\n`;

    if (fname === 'readme.md') return common +
      `\u2022 Include: prerequisites, how to clone, how to configure (.env / application.yml keys), how to build (mvn package / npm install), how to run (java -jar / docker-compose up), how to run tests, API overview with example curl commands.\n`;

    if (p.includes('service') && (p.endsWith('.java') || p.endsWith('.ts') || p.endsWith('.py'))) return common +
      `\u2022 Every public method: @Transactional (Java) or equivalent transaction boundary.\n` +
      `\u2022 Full exception handling: catch specific exceptions, wrap in domain exceptions, log with MDC correlation ID.\n` +
      `\u2022 All business rules from the spec implemented line-by-line, not summarised.\n` +
      `\u2022 SLF4J log at entry (DEBUG), exit (DEBUG), and error (ERROR) with key parameters.\n`;

    if (p.includes('controller') && (p.endsWith('.java') || p.endsWith('.ts'))) return common +
      `\u2022 Every endpoint: correct HTTP method, path, @Valid on request body, ResponseEntity<T> with correct status code.\n` +
      `\u2022 @Operation / @ApiResponse (Swagger/OpenAPI) annotations on every method.\n` +
      `\u2022 Input sanitisation, null checks, meaningful error responses.\n` +
      `\u2022 Log each request at INFO level with request ID from MDC.\n`;

    if (p.includes('test') || p.includes('spec')) return common +
      `\u2022 Cover: happy path, every validation failure, every business-rule edge case, null inputs, exception paths.\n` +
      `\u2022 Use @SpringBootTest + TestRestTemplate for integration tests, Mockito for unit tests.\n` +
      `\u2022 Use @Sql to set up and tear down test data. Use AssertJ fluent assertions.\n` +
      `\u2022 Minimum 10 test methods per test class.\n`;

    if (p.includes('entity') || p.includes('model')) return common +
      `\u2022 All fields from the spec/ERD with correct JPA annotations (@Column, @Id, @GeneratedValue, @ManyToOne, @OneToMany, etc.).\n` +
      `\u2022 Include @Version for optimistic locking if updates are expected.\n` +
      `\u2022 Include @CreatedDate, @LastModifiedDate with @EntityListeners(AuditingEntityListener.class).\n` +
      `\u2022 Override equals/hashCode based on the business key, not the surrogate id.\n`;

    // Generic fallback
    return common +
      `\u2022 Fully implement every function/method — no stubs, no TODOs, no "..." placeholders.\n` +
      `\u2022 Follow the same patterns and naming conventions as the other files in this project.\n` +
      `\u2022 Include all imports, package declarations, and file-level documentation.\n`;
  }

  private capPrompt(p: string): string {
    const MAX = 80_000;
    if (p.length > MAX) {
      console.warn(`[Agent] Prompt capped at ${MAX} chars (was ${p.length})`);
      return p.substring(0, MAX) + '\n\n[...context capped to fit token budget]';
    }
    return p;
  }

  private parseManifest(text: string): { message: string; files: { path: string; purpose: string; lines?: number }[] } | null {
    const attempts: string[] = [text.trim()];
    const block = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (block) attempts.push(block[1].trim());
    const obj = text.match(/\{[\s\S]*\}/);
    if (obj) attempts.push(obj[0]);
    for (const a of attempts) {
      try {
        const p = JSON.parse(a);
        if (Array.isArray(p.files) && p.files.length > 0 && typeof p.files[0].path === 'string') return p;
      } catch {}
    }
    return null;
  }

  private parseAgentResponse(text: string): AgentLLMResponse | null {
    const clean = text.trim();

    // 1. Direct JSON parse
    try {
      const p = JSON.parse(clean);
      if (Array.isArray(p.files)) return p;
    } catch {}

    // 2. JSON inside markdown code block
    const blockMatch = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (blockMatch) {
      try {
        const p = JSON.parse(blockMatch[1].trim());
        if (Array.isArray(p.files)) return p;
      } catch {}
    }

    // 3. Find first {...} JSON object in text
    const objMatch = clean.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        const p = JSON.parse(objMatch[0]);
        if (Array.isArray(p.files)) return p;
      } catch {}
    }

    return null;
  }

  /**
   * Read the content of context files (e.g. TDS JSON) and format them for the prompt.
   * Paths can be absolute or relative to workspacePath.
   */
  private readContextFiles(filePaths: string[]): string {
    if (!filePaths || filePaths.length === 0) return '';
    const BINARY_EXTS = new Set(['docx','doc','xlsx','xls','pptx','ppt','pdf','zip','png','jpg','jpeg','gif','exe','dll','bin','db','sqlite']);
    const parts: string[] = [];
    for (const fp of filePaths) {
      try {
        const ext = path.extname(fp).slice(1).toLowerCase();
        if (BINARY_EXTS.has(ext)) {
          parts.push(`[Skipped binary file: ${fp} — use the .json version from your tds/ folder instead]`);
          continue;
        }
        const abs = path.isAbsolute(fp) ? fp : path.resolve(this.workspacePath, fp);
        // Security: must stay inside workspace
        if (!abs.startsWith(this.workspacePath)) {
          console.warn('Agent: context file outside workspace rejected:', fp);
          continue;
        }
        if (!fs.existsSync(abs)) { parts.push(`[File not found: ${fp}]`); continue; }
        const content = fs.readFileSync(abs, 'utf-8');
        // 30k chars (~7.5k tokens) — enough for a full TDS without crowding the prompt
        const MAX_FILE_CHARS = 30_000;
        const truncated = content.length > MAX_FILE_CHARS
          ? content.substring(0, MAX_FILE_CHARS) + `\n\n[...file truncated at ${MAX_FILE_CHARS} chars — ${content.length - MAX_FILE_CHARS} chars omitted]`
          : content;
        parts.push(`\n[File: ${fp}]\n\`\`\`${ext}\n${truncated}\n\`\`\``);
      } catch (e: any) {
        parts.push(`[Error reading ${fp}: ${e.message}]`);
      }
    }
    return parts.join('\n');
  }

  private getWorkspaceContext(): string {
    const MAX_FILES = 300;
    const files = this.listFiles(this.workspacePath, 0, 4); // max depth 4
    const limited = files.slice(0, MAX_FILES);
    const suffix = files.length > MAX_FILES ? `\n...(${files.length - MAX_FILES} more files omitted)` : '';
    return limited.length > 0 ? limited.join('\n') + suffix : '(empty workspace)';
  }

  private listFiles(dir: string, depth: number, maxDepth: number): string[] {
    if (depth > maxDepth) return [];
    const skip = ['node_modules', '.git', 'dist', '__pycache__', '.next', 'venv', '.venv', 'vector_db', '.pytest_cache', '.angular', 'e2e', 'target', 'build', 'out', '.nyc_output'];
    const result: string[] = [];

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.') || skip.includes(e.name)) continue;
        const rel = path.relative(this.workspacePath, path.join(dir, e.name)).replace(/\\/g, '/');
        if (e.isDirectory()) {
          result.push(`${rel}/`);
          result.push(...this.listFiles(path.join(dir, e.name), depth + 1, maxDepth));
        } else {
          result.push(rel);
        }
      }
    } catch {}

    return result;
  }
}
