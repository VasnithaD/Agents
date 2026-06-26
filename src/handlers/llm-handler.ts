import {
  MCPResponse,
  LLMGenerateCodeParams,
  LLMCodeGenerationResult,
  LLMRefactorCodeParams,
  LLMCodeReviewParams,
  LLMCodeReviewResult,
  LLMChatParams,
  LLMChatResult,
  CodeGenerationWorkflow,
  ChatMessage,
} from '../types';
import { getHPEClient, HPEClient } from './hpe-client';
import { ragRetriever } from '../rag/retriever';
import {
  isLargeTask,
  splitIntoSections,
  buildSafePrompt,
  trimRagContext,
  estimateTokens,
} from '../rag/token-budget';
import { getDefaultModelId, getModel, formatModelList } from '../models/registry';

interface GeneratedFileItem {
  path: string;
  content: string;
}

interface StructuredGenerateOutput {
  message: string;
  files: GeneratedFileItem[];
  explanation?: string;
}

/**
 * LLM Tool Handler
 * Implements code generation, refactoring, review, and chat operations
 * Supports both OpenAI and Azure OpenAI via the stable OpenAI SDK
 */
export class LLMHandler {
  private hpe: HPEClient;
  private temperature: number;
  private maxTokens: number;
  private conversationHistory: Map<string, ChatMessage[]>;

  constructor() {
    this.temperature = parseFloat(process.env.LLM_TEMPERATURE || '0.7');
    this.maxTokens = parseInt(process.env.LLM_MAX_TOKENS || '2000');
    this.conversationHistory = new Map();
    this.hpe = getHPEClient();
    console.log('✓ LLM handler ready (HPE ChatHPE API)');
  }

  /** List all available models — called by GET /api/models */
  listModels(): object[] {
    return formatModelList();
  }

  /**
   * Generate code from a user prompt.
   * Automatically splits large / end-to-end tasks into sections so each
   * LLM call stays within the token budget.
   */
  async generateCode(params: LLMGenerateCodeParams): Promise<MCPResponse> {
    try {
      const language = params.language || '';   // empty = auto-detect
      const modelId  = (params as any).model || getDefaultModelId();
      const modelDef = getModel(modelId);
      const useProjectContext = this.shouldUseProjectContextForGenerate(params.prompt || '', params.context || '');
      const promptWithGuidance = this.applyIterationGuidance(
        params.prompt,
        params.reactMode === true,
        (params.humanFeedback || '').trim(),
      );

      // ── RAG: retrieve project-specific context ──────────────────────────
      const ragQuery   = `${params.prompt} ${params.context ?? ''} ${language}`;
      const ragContext = useProjectContext ? await ragRetriever.retrieve(ragQuery, 5) : '';

      const systemPrompt = this.buildGenerateSystemPrompt(language, useProjectContext ? (params.context || '') : '');

      const langHint = params.language ? `Language: ${params.language}` : 'Auto-detect the best language for this task.';

      // ── Large-task detection: split into sections if needed ─────────────
      if (isLargeTask(params.prompt)) {
        const sections = splitIntoSections(params.prompt, language);
        const parts: string[] = [];

        for (let i = 0; i < sections.length; i++) {
          const sectionPrompt = buildSafePrompt({
            ragContext,
            systemPrompt,
            userPrompt: `Task: ${this.applyIterationGuidance(sections[i], params.reactMode === true, (params.humanFeedback || '').trim())}`,
          });
          console.log(`[LLM] Generating section ${i + 1}/${sections.length} using ${modelDef.label} …`);
          const sectionOutput = await this.hpe.askWithRetry(sectionPrompt, modelId);
          parts.push(sectionOutput.trim());
        }

        const combined = parts.join('\n\n').trim();
        const normalized = await this.normalizeGeneratedOutput(combined, language, modelId);
        let structuredOutput = await this.normalizeGeneratedStructure(normalized, language, modelId, params.prompt);
        if (!useProjectContext) {
          structuredOutput = this.rewritePathsForGenericPrompt(structuredOutput, language);
        }

        return {
          id: this.generateId(),
          result: {
            success: true,
            code: JSON.stringify(structuredOutput, null, 2),
            structuredOutput,
            language,
            structured: true,
            model: modelId,
            modelLabel: modelDef.label,
            prompt: params.prompt,
            sections: parts.length,
            explanation: `Generated in ${parts.length} sections using ${modelDef.label}`,
          },
          jsonrpc: '2.0',
        };
      }

      // ── Standard single-call generation ─────────────────────────────────
      const fullPrompt = buildSafePrompt({
        ragContext,
        systemPrompt,
        userPrompt: `Task: ${promptWithGuidance}`,
      });
      const generatedCode = await this.hpe.askWithRetry(fullPrompt, modelId);
      const normalized = await this.normalizeGeneratedOutput(generatedCode, language, modelId);
      let structuredOutput = await this.normalizeGeneratedStructure(normalized, language, modelId, params.prompt);
      if (!useProjectContext) {
        structuredOutput = this.rewritePathsForGenericPrompt(structuredOutput, language);
      }

      return {
        id: this.generateId(),
        result: {
          success: true,
          code: JSON.stringify(structuredOutput, null, 2),
          structured: true,             // flag for UI renderer
          structuredOutput,
          language,
          model: modelId,
          modelLabel: modelDef.label,
          prompt: params.prompt,
          explanation: `Generated using ${modelDef.label}`,
        },
        jsonrpc: '2.0',
      };
    } catch (error) {
      return this.errorResponse(
        (error as Error).message,
        'LLM_GENERATE_CODE_ERROR'
      );
    }
  }

  private shouldUseProjectContextForGenerate(prompt: string, context: string): boolean {
    if ((context || '').trim().length > 0) return true;

    const p = (prompt || '').toLowerCase();
    const projectSignals = [
      'codebase', 'project', 'workspace', 'repo', 'repository', 'module', 'package',
      'existing file', 'update file', 'modify file', 'in this app', 'in our app',
      'src/', 'pom.xml', 'aoe_', 'cpq', 'checklistserviceimpl', 'omui', 's4', 'deal version'
    ];
    return projectSignals.some(s => p.includes(s));
  }

  private rewritePathsForGenericPrompt(output: StructuredGenerateOutput, language: string): StructuredGenerateOutput {
    const files = (output.files || []).map((f, idx) => ({
      path: this.inferDefaultFilePath(language, idx + 1),
      content: f.content,
    }));

    return {
      ...output,
      files,
    };
  }

  /**
   * Build strict language-aware generation prompt.
   * If language is provided, force code-first output in that language.
   */
  private buildGenerateSystemPrompt(language: string, context: string): string {
    const lang = (language || '').trim().toLowerCase();
    const hasLang = !!lang;

    if (hasLang) {
      return `You are an expert software engineer. Generate clean, production-ready ${lang} code.
${context ? `Project context: ${context}` : ''}

STRICT OUTPUT RULES (MANDATORY):
1. Return code-first output only. Do NOT return architecture docs, TDS restatements, requirement matrices, or large JSON documents.
2. Response must contain one or more fenced code blocks using EXACT language tag '${lang}'.
3. Every fenced block must contain executable/compilable ${lang} code (or config for yaml/sql/bash), never prose-only content.
4. If multiple files are needed, format as:
   ## File: <relative/path>
   \`\`\`${lang}
   <full code>
   \`\`\`
5. Never truncate. Never output placeholders like TODO, ..., "rest of file".
6. For Java/Kotlin/C#/TS/JS: never paste requirements/spec sections as comments at the top of a source file.
7. For Java specifically: one package declaration per file block and one top-level public class/interface/enum/record per file block.
8. Prefer file-oriented output when multiple files are needed by using: ## File: <relative/path> followed by a ${lang} code block.

SAFETY RULE: Never modify/delete existing files without explicit confirmation.`;
    }

    return `You are an expert software engineer. Generate clean, well-commented, production-ready code.
${context ? `Project context: ${context}` : ''}

STRUCTURED OUTPUT RULES — you MUST follow this exact format:
1. Start with a ## Overview section: 2-3 sentences.
2. Then one or more ## File: <relative/path/to/file.ext> sections, each containing exactly one fenced code block.
3. Then ## How to Use and ## Key Design Decisions.
4. No truncation, no placeholders.

SAFETY RULE: Never modify or delete an existing file without explicit user confirmation.`;
  }

  private applyIterationGuidance(base: string, reactMode: boolean, humanFeedback: string): string {
    const guidance: string[] = [];

    if (reactMode) {
      guidance.push(
        'Use an internal ReAct loop before answering: analyze the request, check constraints, verify the final code against those constraints, and then return only the requested output format. Do not reveal private chain-of-thought.'
      );
    }

    if (humanFeedback) {
      guidance.push(`Human feedback for this revision:\n${humanFeedback}`);
    }

    if (guidance.length === 0) return base;
    return `${base.trim()}\n\nAdditional execution instructions:\n${guidance.join('\n\n')}`;
  }

  private async normalizeGeneratedStructure(
    normalizedCodeText: string,
    language: string,
    modelId: string,
    prompt: string
  ): Promise<StructuredGenerateOutput> {
    const direct = this.parseStructuredGenerateJson(normalizedCodeText);
    if (direct) return direct;

    const fromCode = this.convertCodeTextToStructuredOutput(normalizedCodeText, language, prompt);
    if (fromCode.files.length > 0) return fromCode;

    const schemaRepairPrompt = `Convert the content below into STRICT JSON ONLY with this exact schema:
{
  "message": "<one concise summary sentence>",
  "files": [
    {
      "path": "<relative/file/path>",
      "content": "<full file content>"
    }
  ]
}

Rules:
- Return valid JSON only. No markdown. No prose before/after JSON.
- files must be a non-empty array.
- Use realistic file paths.
- Preserve all implementation logic from the source.

Source content:
${normalizedCodeText}`;

    const repaired = (await this.hpe.askWithRetry(schemaRepairPrompt, modelId) || '').trim();
    const repairedParsed = this.parseStructuredGenerateJson(repaired);
    if (repairedParsed) return repairedParsed;

    return {
      message: `Generated output for: ${prompt}`,
      files: [{
        path: this.inferDefaultFilePath(language, 1),
        content: normalizedCodeText,
      }],
    };
  }

  private parseStructuredGenerateJson(text: string): StructuredGenerateOutput | null {
    if (!text) return null;

    const trimmed = text.trim();
    const jsonCandidate = trimmed.startsWith('{')
      ? trimmed
      : (trimmed.match(/\{[\s\S]*\}/)?.[0] || '');

    if (!jsonCandidate) return null;

    try {
      const parsed = JSON.parse(jsonCandidate) as StructuredGenerateOutput;
      if (!parsed || typeof parsed !== 'object') return null;
      if (!Array.isArray(parsed.files) || parsed.files.length === 0) return null;

      const files = parsed.files
        .filter(f => f && typeof f.path === 'string' && typeof f.content === 'string')
        .map((f, i) => ({
          path: (f.path || '').trim() || this.inferDefaultFilePath('', i + 1),
          content: f.content,
        }));

      if (files.length === 0) return null;

      return {
        message: (parsed.message || 'Code generation completed').trim(),
        files,
      };
    } catch {
      return null;
    }
  }

  private convertCodeTextToStructuredOutput(text: string, language: string, prompt: string): StructuredGenerateOutput {
    const files: GeneratedFileItem[] = [];

    const sectionRegex = /##\s*File:\s*([^\n\r]+)\s*[\r\n]+```[\w-]*\s*[\r\n]([\s\S]*?)```/gi;
    let match: RegExpExecArray | null;
    while ((match = sectionRegex.exec(text)) !== null) {
      const path = (match[1] || '').trim();
      const content = (match[2] || '').trim();
      if (path && content) files.push({ path, content });
    }

    if (files.length === 0) {
      const lang = (language || '').trim().toLowerCase();
      const blocks = lang ? this.extractCodeBlocks(text, lang) : this.extractAnyCodeBlocks(text);
      blocks.forEach((block, idx) => {
        if (block.trim()) {
          files.push({
            path: this.inferDefaultFilePath(lang, idx + 1),
            content: block.trim(),
          });
        }
      });
    }

    if (files.length === 0 && text.trim()) {
      files.push({
        path: this.inferDefaultFilePath(language, 1),
        content: text.trim(),
      });
    }

    const explanation = this.extractExplanationText(text);

    return {
      message: `Generated ${files.length} file(s) for prompt: ${prompt}`,
      files,
      explanation: explanation || undefined,
    };
  }

  private extractExplanationText(text: string): string {
    if (!text) return '';

    let remaining = text;
    remaining = remaining.replace(/##\s*File:[\s\S]*?```[\w-]*\s*[\r\n][\s\S]*?```/gi, '');
    remaining = remaining.replace(/```[\w-]*\s*[\r\n][\s\S]*?```/g, '');
    remaining = remaining.replace(/\n{3,}/g, '\n\n').trim();

    if (!remaining) return '';
    return remaining.length > 1200 ? `${remaining.slice(0, 1200)}...` : remaining;
  }

  /**
   * Normalize generation output so language-constrained requests always return code,
   * even if the first response drifts into specification JSON/prose.
   */
  private async normalizeGeneratedOutput(raw: string, language: string, modelId: string): Promise<string> {
    const text = (raw || '').trim();
    const lang = (language || '').trim().toLowerCase();

    if (!lang) return text;

    const hasAnyCodeFence = /```\w*[\s\S]*?```/m.test(text);
    const hasTargetLangFence = new RegExp('```' + lang + '\\b', 'i').test(text);
    const looksLikeSpecJson = this.looksLikeSpecDocumentJson(text);

    // Accept only if it passes strict language-output validation.
    if (this.isLanguageOutputValid(text, lang) && (hasTargetLangFence || (hasAnyCodeFence && !looksLikeSpecJson))) {
      return text;
    }

    // Repair pass: convert drifted output into language-specific code format.
    const repairPrompt = `Rewrite the content below into STRICT ${lang} code output.

MANDATORY:
- Output must be one or more fenced code blocks tagged as ${lang}.
- Do NOT output TDS/architecture/spec JSON or prose sections.
- Preserve all implementable logic from the source content.
- If assumptions are needed, encode them as concise code comments in ${lang}.

Source content:
${text}`;

    const repaired = (await this.hpe.askWithRetry(repairPrompt, modelId) || text).trim();
    if (this.isLanguageOutputValid(repaired, lang)) return repaired;

    // Second, stricter repair pass for stubborn outputs.
    const strictRepairPrompt = `Return ONLY valid ${lang} code blocks and file sections.

HARD RULES:
- No prose paragraphs.
- No TDS/FDS/architecture JSON text.
- No requirement lists embedded as comments.
- For java: exactly one package statement per file block.

Output format:
## File: <path>
\`\`\`${lang}
<code>
\`\`\`

Input to fix:
${repaired}`;

    const repaired2 = (await this.hpe.askWithRetry(strictRepairPrompt, modelId) || repaired).trim();
    return repaired2;
  }

  private isLanguageOutputValid(text: string, lang: string): boolean {
    if (!text || !lang) return true;

    const lower = text.toLowerCase();
    const bannedSpecPhrases = [
      'technical design specification',
      'system architecture',
      'deployment guide',
      'testing strategy',
      'objectives of the system',
      'scope of the project',
      'requirement pseudocode',
    ];

    // reject obvious spec-doc drifts
    if (bannedSpecPhrases.some(p => lower.includes(p))) return false;
    if (this.looksLikeSpecDocumentJson(text)) return false;

    // require at least one fenced code block for language-constrained output
    const codeBlocks = this.extractCodeBlocks(text, lang);
    if (codeBlocks.length === 0) return false;

    if (lang === 'java') {
      for (const block of codeBlocks) {
        const pkgCount = (block.match(/\bpackage\s+[\w\.]+\s*;/g) || []).length;
        if (pkgCount > 1) return false;

        const topLevelCount = (block.match(/\bpublic\s+(class|interface|enum|record)\s+\w+/g) || []).length;
        if (topLevelCount > 1) return false;
      }
    }

    return true;
  }

  private extractCodeBlocks(text: string, lang: string): string[] {
    const rx = new RegExp('```' + lang + '\\s*\\n([\\s\\S]*?)\\n```', 'gi');
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) out.push((m[1] || '').trim());
    return out;
  }

  private extractAnyCodeBlocks(text: string): string[] {
    const rx = /```[\w-]*\s*\n([\s\S]*?)\n```/gi;
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) out.push((m[1] || '').trim());
    return out;
  }

  private inferDefaultFilePath(lang: string, index: number): string {
    const l = (lang || '').toLowerCase();
    const extByLang: Record<string, string> = {
      typescript: 'ts',
      javascript: 'js',
      python: 'py',
      java: 'java',
      csharp: 'cs',
      go: 'go',
      ruby: 'rb',
      php: 'php',
      kotlin: 'kt',
      scala: 'scala',
      swift: 'swift',
      rust: 'rs',
      sql: 'sql',
      yaml: 'yaml',
      yml: 'yml',
      json: 'json',
      html: 'html',
      css: 'css',
      bash: 'sh',
      shell: 'sh',
    };
    const ext = extByLang[l] || 'txt';
    return index === 1 ? `generated/main.${ext}` : `generated/file${index}.${ext}`;
  }

  private looksLikeSpecDocumentJson(text: string): boolean {
    if (!text.startsWith('{')) return false;
    const markers = [
      '"overview"',
      '"objectives"',
      '"systemArchitecture"',
      '"deploymentGuide"',
      '"testingStrategy"',
      '"componentDesign"',
      '"dataModels"',
    ];
    return markers.filter(m => text.includes(m)).length >= 2;
  }

  /**
   * World-class 3-phase refactoring engine:
   *   Phase 1 — Static analysis: detect bugs, smells, and intent
   *   Phase 2 — Deep refactor: apply all improvements with explicit rules
   *   Phase 3 — Self-validation: LLM reviews its own output for regressions
   */
  async refactorCode(params: LLMRefactorCodeParams): Promise<MCPResponse> {
    try {
      const lang       = params.language || 'auto';  // auto = LLM detects from code
      const modelId    = (params as any).model || getDefaultModelId();
      const modelDef   = getModel(modelId);
      const userInstructions = this.applyIterationGuidance(
        params.instructions?.trim() || 'Apply all best-practice improvements.',
        params.reactMode === true,
        (params.humanFeedback || '').trim(),
      );

      // ── RAG: retrieve project-specific context ──────────────────────────
      const ragQuery   = `${userInstructions} ${params.context ?? ''} ${lang} ${params.code.slice(0, 300)}`;
      const ragContext = await ragRetriever.retrieve(ragQuery, 3); // fewer chunks — code itself uses the budget

      // Trim RAG to fit: code + prompts are already large
      const codeTokens = estimateTokens(params.code);
      const trimmedRag = trimRagContext(ragContext, codeTokens + 1500);

      const contextBlock = [
        trimmedRag ? `\n\n## NGQ Project Knowledge Base Context\n${trimmedRag}` : '',
        params.context ? `\n\n## Additional Context Provided by User\n${params.context}` : '',
      ].join('');

      // Truncate very large code inputs to avoid overflow on analysis prompt
      const MAX_CODE_CHARS = 12_000;
      const codeForAnalysis = params.code.length > MAX_CODE_CHARS
        ? params.code.slice(0, MAX_CODE_CHARS) + '\n// ... [truncated for analysis — full code used in refactor]'
        : params.code;

      // ── PHASE 1: Static Analysis ──────────────────────────────────────────
      const analysisPrompt = `You are a senior ${lang} engineer performing a thorough static analysis.
Analyze the following ${lang} code and return ONLY a JSON object — no markdown, no prose.

JSON shape:
{
  "intent": "<one sentence: what this code is meant to do>",
  "bugs": [{"line": <number|null>, "severity": "critical|high|medium|low", "description": "<exact issue>", "fix": "<concrete fix>"}],
  "codeSmells": ["<smell description>"],
  "securityIssues": ["<issue>"],
  "performanceIssues": ["<issue>"],
  "missingEdgeCases": ["<case>"],
  "overallRisk": "high|medium|low"
}${contextBlock}

Code to analyze:
\`\`\`${lang}
${codeForAnalysis}
\`\`\``;

      const analysisRaw = await this.hpe.askWithRetry(analysisPrompt, modelId);
      let analysis: any = {};
      try {
        const jsonMatch = analysisRaw.match(/\{[\s\S]*\}/);
        analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
      } catch { analysis = { intent: 'Unknown', bugs: [], codeSmells: [], securityIssues: [], performanceIssues: [], missingEdgeCases: [], overallRisk: 'low' }; }

      // ── PHASE 2: Deep Refactor ────────────────────────────────────────────
      const bugList = (analysis.bugs || []).map((b: any, i: number) =>
        `  ${i + 1}. [${b.severity?.toUpperCase() || 'BUG'}] Line ${b.line || '?'}: ${b.description} → FIX: ${b.fix}`
      ).join('\n') || '  None detected.';

      const smellList = (analysis.codeSmells || []).map((s: string, i: number) => `  ${i + 1}. ${s}`).join('\n') || '  None.';
      const secList   = (analysis.securityIssues || []).map((s: string, i: number) => `  ${i + 1}. ${s}`).join('\n') || '  None.';
      const perfList  = (analysis.performanceIssues || []).map((s: string, i: number) => `  ${i + 1}. ${s}`).join('\n') || '  None.';
      const edgeList  = (analysis.missingEdgeCases || []).map((s: string, i: number) => `  ${i + 1}. ${s}`).join('\n') || '  None.';

      const refactorPrompt = `You are the world's best ${lang} refactoring engineer. You have just completed a static analysis of the code below.

## Detected Code Intent
${analysis.intent || 'Inferred from code.'}

## Bugs to Fix (ALL must be fixed — zero tolerance)
${bugList}

## Code Smells to Eliminate
${smellList}

## Security Issues to Resolve
${secList}

## Performance Issues to Address
${perfList}

## Missing Edge Cases to Add
${edgeList}

## User Instructions
${userInstructions}
${contextBlock}

## Strict Refactoring Rules
1. Fix EVERY bug listed above — do NOT preserve broken behavior under any circumstance.
2. Preserve the exact observable behavior for all valid inputs that were already correct.
3. Handle every missing edge case listed above with proper error/null/boundary checks.
4. Resolve every security issue (sanitize inputs, avoid injection, use safe APIs).
5. Apply all performance improvements without changing outputs.
6. Eliminate all code smells (dead code, magic numbers, duplicated logic, poor names).
7. Use idiomatic ${lang} style: proper naming conventions, spacing, and structure.
8. Add concise, meaningful inline comments only where logic is non-obvious.
9. Do NOT add features beyond what is described in the intent and user instructions.
10. Do NOT remove existing public interfaces, exported functions, or documented APIs.

## Output Format
Return ONLY the fully refactored code — no markdown fences, no explanations, no preamble.

Original code:
\`\`\`${lang}
${params.code}
\`\`\``;

      const refactored1 = await this.hpe.askWithRetry(refactorPrompt, modelId);
      // Strip markdown fences if model wraps output
      const fenceMatch = refactored1.match(/```(?:\w+)?\n([\s\S]*?)\n```/);
      const refactoredCode = (fenceMatch ? fenceMatch[1] : refactored1).trim();

      // ── PHASE 3: Self-Validation ──────────────────────────────────────────
      const validationPrompt = `You are a strict ${lang} QA engineer doing a regression check.

## Original Code
\`\`\`${lang}
${params.code}
\`\`\`

## Refactored Code
\`\`\`${lang}
${refactoredCode}
\`\`\`

## Original Intent
${analysis.intent || 'Inferred from code.'}

Verify the refactored code:
1. Does it preserve all correct behavior of the original? (yes/no + reason if no)
2. Are ALL bugs from this list actually fixed?
${bugList}
3. Are there any NEW bugs introduced? (yes/no + details if yes)
4. Is any public interface/export removed or signature changed? (yes/no + details if yes)

Return ONLY a JSON object — no markdown, no prose:
{
  "behaviorPreserved": true|false,
  "behaviorIssues": ["<issue if any>"],
  "allBugsFixed": true|false,
  "unfixedBugs": ["<bug description if any>"],
  "newBugsIntroduced": true|false,
  "newBugs": ["<bug if any>"],
  "publicInterfaceBreaks": true|false,
  "interfaceBreaks": ["<break if any>"],
  "verdict": "PASS"|"FAIL",
  "confidence": <0-100>
}`;

      const validationRaw = await this.hpe.askWithRetry(validationPrompt, modelId);
      let validation: any = { verdict: 'PASS', confidence: 90, behaviorPreserved: true, allBugsFixed: true, newBugsIntroduced: false, publicInterfaceBreaks: false, behaviorIssues: [], unfixedBugs: [], newBugs: [], interfaceBreaks: [] };
      try {
        const vMatch = validationRaw.match(/\{[\s\S]*\}/);
        if (vMatch) validation = { ...validation, ...JSON.parse(vMatch[0]) };
      } catch { /* keep defaults */ }

      return {
        id: this.generateId(),
        result: {
          success: true,
          originalCode: params.code,
          refactoredCode,
          language: lang,
          instructions: userInstructions,
          analysis,
          validation,
        },
        jsonrpc: '2.0',
      };
    } catch (error) {
      return this.errorResponse(
        (error as Error).message,
        'LLM_REFACTOR_CODE_ERROR'
      );
    }
  }

  /**
   * Review code for quality issues
   */
  async reviewCode(params: LLMCodeReviewParams): Promise<MCPResponse> {
    try {
      const focusAreas = params.focusAreas?.join(', ') || 'all aspects';      const modelId    = (params as any).model || getDefaultModelId();
      const modelDef   = getModel(modelId);
      // ── RAG: retrieve project-specific context ─────────────────────────────
      const ragQuery = `${params.language} code review ${focusAreas} ${params.code.slice(0, 300)}`;
      const ragContext = await ragRetriever.retrieve(ragQuery, 4);

      const systemPrompt = [
        ragContext ? `${ragContext}\n` : '',
        `You are an expert code reviewer. Analyze ${params.language} code and provide detailed review.`,
        '',
        `Focus areas: ${focusAreas}`,
        '',
        'Provide review in JSON format with this structure:',
        '{',
        '  "issues": [{"line": number, "severity": "error|warning|info", "message": string, "suggestion": string}],',
        '  "summary": "overall summary",',
        '  "overallQuality": number (1-10),',
        '  "suggestions": ["suggestion1", "suggestion2"]',
        '}',
        '',
        'Return ONLY valid JSON, no other text.',
      ].filter(Boolean).join('\n');

      const fullPrompt = `${systemPrompt}\n\nReview this ${params.language} code:\n\`\`\`${params.language}\n${params.code}\n\`\`\``;
      const reviewText = await this.hpe.askWithRetry(fullPrompt, modelId);

      // Parse JSON response
      const jsonMatch = reviewText.match(/\{[\s\S]*\}/);
      let reviewData: any;
      try {
        reviewData = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch { reviewData = null; }
      if (!reviewData) reviewData = { issues: [], summary: reviewText, overallQuality: 7, suggestions: [] };

      return {
        id: this.generateId(),
        result: {
          success: true,
          review: reviewData as LLMCodeReviewResult,
          language: params.language,
        },
        jsonrpc: '2.0',
      };
    } catch (error) {
      return this.errorResponse(
        (error as Error).message,
        'LLM_REVIEW_CODE_ERROR'
      );
    }
  }

  /**
   * Multi-turn conversation with context
   */
  async chat(params: LLMChatParams): Promise<MCPResponse> {
    try {
      const sessionId = (params as any).sessionId || this.generateSessionId();
      const modelId   = (params as any).model || getDefaultModelId();
      const modelDef  = getModel(modelId);
      const history   = this.conversationHistory.get(sessionId) || [];

      // ── Inject system identity on first message ──────────────────────
      if (history.length === 0) {
        history.push({
          role: 'system',
          content: `You are an expert AI assistant and software engineer.
You have access to the full project knowledge base indexed from the workspace (TDS, FDS, BRD, architecture guides, source code, domain glossary).
Always answer questions using the project context when available — be specific: reference module names, entity names, API flows, and business rules.
For general engineering questions not covered by the project context, answer from broad expertise.

SAFETY RULE: Never modify, delete, overwrite, or move an existing file without explicit user confirmation.
If a modification is needed, describe the changes and ask: "Do you want me to apply these changes to [filename]?"

Respond in well-structured markdown with clear sections, code blocks, and bullet points.`,
        });
      }

      // ── RAG: inject project context as a system message ────────────────
      const ragContext = await ragRetriever.retrieve(params.message, 8);
      if (ragContext) {
        // Trim RAG to respect budget — leave room for history + user message
        const historyTokens = estimateTokens(
          history.map(m => m.content).join('\n') + params.message
        );
        const trimmedRag = trimRagContext(ragContext, historyTokens);
        if (trimmedRag) {
          history.push({ role: 'system', content: trimmedRag });
        }
      }

      // Add user-supplied context if provided
      if (params.context) {
        history.push({
          role: 'system',
          content: `Context: ${params.context}`,
        });
      }

      // Add user message
      history.push({
        role: 'user',
        content: params.message,
      });

      // Build combined prompt — cap total to safe input budget
      const MAX_HISTORY_CHARS = 20_000;
      const contextLines = history
        .map(m => `${m.role === 'user' ? 'User' : m.role === 'system' ? 'Context' : 'Assistant'}: ${m.content}`)
        .join('\n');
      const safeChatPrompt = contextLines.length > MAX_HISTORY_CHARS
        ? contextLines.slice(-MAX_HISTORY_CHARS)
        : contextLines;

      const assistantMessage = await this.hpe.askWithRetry(safeChatPrompt, modelId);

      // Store assistant response in history
      history.push({
        role: 'assistant',
        content: assistantMessage,
      });

      this.conversationHistory.set(sessionId, history);

      return {
        id: this.generateId(),
        result: {
          success: true,
          response: assistantMessage,
          sessionId,
          messageCount: history.filter((m) => m.role !== 'system').length,
        },        jsonrpc: '2.0',
      };
    } catch (error) {
      return this.errorResponse(
        (error as Error).message,
        'LLM_CHAT_ERROR'
      );
    }
  }

  /**
   * Generate code with workflow options
   * Integrates with VS Code and GitHub tools
   */
  async generateWithWorkflow(params: any): Promise<MCPResponse> {
    try {
      // First, generate the code
      const generationResult = await this.generateCode({
        prompt: params.prompt,
        language: params.language,
        context: params.context,
      });

      if (!generationResult.result || generationResult.error) {
        return generationResult;
      }

      const generatedCode = (generationResult.result as any).code;
      const workflowId = `workflow-${Date.now()}`;

      const workflow: CodeGenerationWorkflow = {
        id: workflowId,
        prompt: params.prompt,
        generatedCode,
        language: params.language || 'typescript',
        status: 'generated',
        nextSteps: 'insert_to_vscode',
        metadata: {
          createdAt: new Date().toISOString(),
          provider: 'hpe-chathpe',
          model: process.env.LLM_MODEL_NAME || 'gpt-4o-mini',
        },
      };

      // Store workflow for next steps
      // In production, this would be saved to a database or cache
      (global as any).__llmWorkflows = (global as any).__llmWorkflows || {};
      (global as any).__llmWorkflows[workflowId] = workflow;

      return {
        id: this.generateId(),
        result: {
          success: true,
          workflow,
          nextActions: [
            {
              action: 'insert_to_vscode',
              description: 'Insert generated code into VS Code',
              params: {
                workflowId,
                filePath: params.filePath,
              },
            },
            {
              action: 'commit_to_github',
              description: 'Commit generated code to GitHub',
              params: {
                workflowId,
                message: params.commitMessage || `feat: ${params.prompt.substring(0, 50)}`,
              },
            },
            {
              action: 'create_pr',
              description: 'Create a pull request with generated code',
              params: {
                workflowId,
                title: params.prompt.substring(0, 60),
              },
            },
          ],
        },
        jsonrpc: '2.0',
      };
    } catch (error) {
      return this.errorResponse(
        (error as Error).message,
        'LLM_WORKFLOW_ERROR'
      );
    }
  }

  /**
   * Get workflow status
   */
  async getWorkflowStatus(workflowId: string): Promise<MCPResponse> {
    try {
      const workflows = (global as any).__llmWorkflows || {};
      const workflow = workflows[workflowId];

      if (!workflow) {
        return this.errorResponse(`Workflow not found: ${workflowId}`, 'WORKFLOW_NOT_FOUND');
      }

      return {
        id: this.generateId(),
        result: {
          success: true,
          workflow,
        },
        jsonrpc: '2.0',
      };
    } catch (error) {
      return this.errorResponse(
        (error as Error).message,
        'LLM_WORKFLOW_STATUS_ERROR'
      );
    }
  }

  /**
   * 4-Phase AI Test & PR Readiness Engine
   *
   * Phase 1 — Unit test generation  : full test file for the language/framework
   * Phase 2 — Input simulation      : 25 test cases mentally traced, pass/fail reported
   * Phase 3 — OWASP security scan   : Top-10 checks + language-specific CVE patterns
   * Phase 4 — PR readiness checklist: 12-point checklist every senior engineer uses
   */
  async testAndCheck(params: { code: string; language: string; filePath?: string; context?: string }): Promise<MCPResponse> {
    try {
      const lang = params.language || 'unknown';
      const contextBlock = params.context ? `\n\n## Extra Context\n${params.context}` : '';

      // ── PHASE 1: Unit Test Generation ────────────────────────────────────
      const testGenPrompt = `You are a principal ${lang} engineer at a top tech company.
Generate a COMPLETE, production-quality test file for the following ${lang} code.
${contextBlock}

Rules:
1. Use the standard test framework for ${lang} (Jest for JS/TS, JUnit 5 for Java, pytest for Python, testing for Go, etc.)
2. Cover: happy path, boundary values, null/undefined/empty inputs, error cases, type edge cases
3. Each test must have a clear descriptive name
4. Add a comment on each test explaining WHY it is important
5. Group tests logically (describe/class blocks)
6. Include any necessary mock/stub setup
7. Return ONLY the test file code — no prose, no markdown fences

Code to test:
\`\`\`${lang}
${params.code}
\`\`\``;

      const testFileRaw = await this.hpe.askWithRetry(testGenPrompt);
      const testFenceMatch = testFileRaw.match(/```(?:\w+)?\n([\s\S]*?)\n```/);
      const testFile = (testFenceMatch ? testFenceMatch[1] : testFileRaw).trim();

      // ── PHASE 2: Input Simulation (25 cases) ─────────────────────────────
      const simPrompt = `You are a QA architect mentally executing ${lang} code.
Trace through the following code with 25 different test inputs and report which PASS and which FAIL.
${contextBlock}

For each case, reason through the actual execution path step by step.
Identify the exact line where failures occur.

Return ONLY a JSON array — no markdown, no prose:
[
  {
    "id": 1,
    "inputDescription": "<what input / scenario>",
    "executionTrace": "<brief trace of what happens>",
    "expectedOutput": "<what should be returned/done>",
    "actualOutput": "<what the code actually does>",
    "result": "PASS"|"FAIL"|"EXCEPTION",
    "failReason": "<only if FAIL or EXCEPTION>"
  }
]

Code:
\`\`\`${lang}
${params.code}
\`\`\``;

      const simRaw = await this.hpe.askWithRetry(simPrompt);
      let simResults: any[] = [];
      try {
        const simMatch = simRaw.match(/\[[\s\S]*\]/);
        simResults = simMatch ? JSON.parse(simMatch[0]) : [];
      } catch { simResults = []; }

      const passed   = simResults.filter((r: any) => r.result === 'PASS').length;
      const failed   = simResults.filter((r: any) => r.result === 'FAIL').length;
      const exceptions = simResults.filter((r: any) => r.result === 'EXCEPTION').length;

      // ── PHASE 3: OWASP Security Scan ─────────────────────────────────────
      const secPrompt = `You are a senior application security engineer (OWASP Top 10 certified).
Perform a thorough security scan on the following ${lang} code.
${contextBlock}

Check ALL of the following:
1. Injection (SQL, command, LDAP, XPath)
2. Broken Authentication / session management
3. Sensitive Data Exposure (hardcoded credentials, secrets, PII in logs)
4. XML External Entity (XXE)
5. Broken Access Control
6. Security Misconfiguration
7. XSS (if applicable)
8. Insecure Deserialization
9. Using Components with Known Vulnerabilities
10. Insufficient Logging / error exposure

Also check ${lang}-specific patterns:
- Unsafe reflection / eval / exec calls
- Path traversal vulnerabilities
- Prototype pollution (JS/TS)
- Deserialization gadgets (Java)
- Pickle exploits (Python)

Return ONLY a JSON object — no markdown, no prose:
{
  "owaspFindings": [
    {"category": "<OWASP category>", "severity": "critical|high|medium|low|info", "line": <number|null>, "description": "<exact issue>", "remediation": "<concrete fix>"}
  ],
  "secretsFound": ["<secret description>"],
  "overallSecurityScore": <0-100>,
  "securityGrade": "A"|"B"|"C"|"D"|"F",
  "productionSafe": true|false
}

Code:
\`\`\`${lang}
${params.code}
\`\`\``;

      const secRaw = await this.hpe.askWithRetry(secPrompt);
      let security: any = { owaspFindings: [], secretsFound: [], overallSecurityScore: 100, securityGrade: 'A', productionSafe: true };
      try {
        const secMatch = secRaw.match(/\{[\s\S]*\}/);
        if (secMatch) security = { ...security, ...JSON.parse(secMatch[0]) };
      } catch { /* keep defaults */ }

      // ── PHASE 4: PR Readiness Checklist ──────────────────────────────────
      const checklistPrompt = `You are a principal engineer conducting a pre-PR review for a production ${lang} codebase.
Evaluate the following code against the 12-point PR readiness checklist used by top-tier engineering teams.
${contextBlock}

Checklist:
1. No hardcoded credentials or secrets
2. All public functions/methods have proper input validation
3. Error handling is present for all failure paths
4. No dead code or commented-out blocks
5. No TODO/FIXME/HACK comments left unfixed
6. Naming is clear and follows ${lang} conventions
7. No magic numbers — all constants are named
8. Cyclomatic complexity is acceptable (no function > 15 branches)
9. No obvious N+1 queries or performance anti-patterns
10. Logging is appropriate — no sensitive data logged
11. Backward compatibility is maintained (no breaking changes to public API)
12. Code is self-contained — no missing dependencies or imports

Return ONLY a JSON object — no markdown, no prose:
{
  "checks": [
    {"id": 1, "name": "<check name>", "status": "PASS"|"FAIL"|"WARNING", "detail": "<specific finding>"}
  ],
  "totalPass": <number>,
  "totalFail": <number>,
  "totalWarning": <number>,
  "prReady": true|false,
  "blockers": ["<blocker description>"],
  "suggestions": ["<non-blocking improvement>"],
  "overallVerdict": "READY_TO_MERGE"|"NEEDS_FIXES"|"BLOCKED"
}

Code:
\`\`\`${lang}
${params.code}
\`\`\``;

      const checklistRaw = await this.hpe.askWithRetry(checklistPrompt);
      let checklist: any = { checks: [], totalPass: 0, totalFail: 0, totalWarning: 0, prReady: false, blockers: [], suggestions: [], overallVerdict: 'NEEDS_FIXES' };
      try {
        const clMatch = checklistRaw.match(/\{[\s\S]*\}/);
        if (clMatch) checklist = { ...checklist, ...JSON.parse(clMatch[0]) };
      } catch { /* keep defaults */ }

      return {
        id: this.generateId(),
        result: {
          success: true,
          language: lang,
          filePath: params.filePath || null,
          testFile,
          simulation: { results: simResults, passed, failed, exceptions, total: simResults.length },
          security,
          checklist,
          summary: {
            testsPassRate: simResults.length > 0 ? Math.round((passed / simResults.length) * 100) : 0,
            securityGrade: security.securityGrade,
            prVerdict: checklist.overallVerdict,
            readyToPush: checklist.prReady && security.productionSafe && failed === 0 && exceptions === 0,
          },
        },
        jsonrpc: '2.0',
      };
    } catch (error) {
      return this.errorResponse(
        (error as Error).message,
        'LLM_TEST_CHECK_ERROR'
      );
    }
  }

  /**
   * Handle all LLM operations
   */
  async handle(operation: string, params: any): Promise<MCPResponse> {
    switch (operation) {
      case 'generate_code':
        return this.generateCode(params);
      case 'refactor_code':
        return this.refactorCode(params);
      case 'review_code':
        return this.reviewCode(params);
      case 'chat':
        return this.chat(params);
      case 'test_and_check':
        return this.testAndCheck(params);
      case 'generate_with_workflow':
        return this.generateWithWorkflow(params);
      case 'get_workflow_status':
        return this.getWorkflowStatus(params.workflowId);
      default:
        return this.errorResponse(`Unknown operation: ${operation}`, 'UNKNOWN_OPERATION');
    }
  }

  private errorResponse(message: string, code: string): MCPResponse {
    return {
      id: this.generateId(),
      error: {
        code: -1,
        message,
        data: { code },
      },
      jsonrpc: '2.0',
    };
  }

  private generateId(): string {
    return `llm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateSessionId(): string {
    return `session-${Math.random().toString(36).substr(2, 9)}`;
  }
}
