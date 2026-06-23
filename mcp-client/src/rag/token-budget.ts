/**
 * Token Budget Manager
 *
 * Estimates token counts (1 token ≈ 4 chars — conservative for code/English)
 * and enforces a safe budget so prompts never exceed the model context window.
 *
 * Responsibilities:
 *   - trimRagContext()   — trim RAG chunks to fit within the reserved budget
 *   - isLargeTask()      — detect prompts that will produce multi-section output
 *   - splitIntoSections()— decompose a large task into ordered sub-tasks
 *   - buildSafePrompt()  — assemble final prompt that fits within maxInputTokens
 */

// ── Constants ────────────────────────────────────────────────────────────────

// gpt-4o-mini context window is 128k tokens; stay well under to be safe
const MODEL_CONTEXT_WINDOW  = parseInt(process.env.LLM_CONTEXT_WINDOW   || '28000'); // tokens
const MAX_OUTPUT_TOKENS      = parseInt(process.env.LLM_MAX_TOKENS       || '8000');
const CHARS_PER_TOKEN        = 4;   // conservative estimate

// How many tokens we reserve for the model's output
const OUTPUT_RESERVE         = MAX_OUTPUT_TOKENS;
// Maximum tokens we allow in the combined input prompt
const MAX_INPUT_TOKENS       = MODEL_CONTEXT_WINDOW - OUTPUT_RESERVE;

// ── Helpers ──────────────────────────────────────────────────────────────────

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateChars(tokens: number): number {
  return tokens * CHARS_PER_TOKEN;
}

// ── RAG context trimmer ──────────────────────────────────────────────────────

/**
 * Given a full RAG context string and the tokens already used by the base
 * prompt, return a trimmed version that fits in the remaining budget.
 *
 * Strategy: keep whole chunk sections, drop from the bottom up.
 */
export function trimRagContext(ragContext: string, usedTokens: number): string {
  const budget = MAX_INPUT_TOKENS - usedTokens;
  if (budget <= 0) return '';

  const budgetChars = estimateChars(budget);
  if (ragContext.length <= budgetChars) return ragContext;

  // Split on chunk separators (--- dividers added by retriever.ts)
  const sections = ragContext.split(/\n---\n/);
  const kept: string[] = [];
  let total = 0;

  for (const section of sections) {
    if (total + section.length > budgetChars) break;
    kept.push(section);
    total += section.length + 5; // +5 for the separator
  }

  if (kept.length === 0) return '';
  return kept.join('\n---\n') + '\n\n*[RAG context trimmed to fit token budget]*\n';
}

// ── Large-task detector ──────────────────────────────────────────────────────

const LARGE_TASK_KEYWORDS = [
  'end to end', 'end-to-end', 'full project', 'entire', 'complete',
  'all modules', 'all components', 'generate all', 'full application',
  'whole', 'from scratch', 'full implementation', 'complete implementation',
  'all layers', 'all files', 'full stack', 'fullstack',
  'document', 'specification', 'tds', 'fds', 'brd',
  'architecture', 'design document',
];

export function isLargeTask(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  return LARGE_TASK_KEYWORDS.some(kw => lower.includes(kw));
}

// ── Section splitter ─────────────────────────────────────────────────────────

/**
 * Detect what kind of large task it is and return an ordered list of
 * sub-prompts, each small enough to fit in one LLM call.
 */
export function splitIntoSections(prompt: string, language: string): string[] {
  const lower = prompt.toLowerCase();

  // ── Document generation (TDS / FDS / BRD / Architecture) ────────────
  if (/\b(tds|technical design|technical spec)\b/.test(lower)) {
    return [
      `${prompt}\n\n[SECTION 1/5] Generate: Overview, Objectives, Scope, and System Architecture only. Be thorough.`,
      `${prompt}\n\n[SECTION 2/5] Generate: Data Models, Database Schema, and Entity Relationships only. Be thorough.`,
      `${prompt}\n\n[SECTION 3/5] Generate: API Endpoints, Service Interfaces, and Integration Points only. Be thorough.`,
      `${prompt}\n\n[SECTION 4/5] Generate: Component Design, Class Diagrams, and Sequence Flows only. Be thorough.`,
      `${prompt}\n\n[SECTION 5/5] Generate: Security, Error Handling, Testing Strategy, and Deployment Guide only. Be thorough.`,
    ];
  }

  if (/\b(fds|functional design|functional spec)\b/.test(lower)) {
    return [
      `${prompt}\n\n[SECTION 1/4] Generate: Executive Summary, Business Objectives, and User Personas only. Be thorough.`,
      `${prompt}\n\n[SECTION 2/4] Generate: Functional Requirements and Feature Specifications only. Be thorough.`,
      `${prompt}\n\n[SECTION 3/4] Generate: User Flows, Screen Descriptions, and UI Interactions only. Be thorough.`,
      `${prompt}\n\n[SECTION 4/4] Generate: Business Rules, Validations, Acceptance Criteria, and Appendix only. Be thorough.`,
    ];
  }

  // ── Full application / end-to-end code generation ───────────────────
  if (/\b(full|complete|end.to.end|entire)\b.*\b(app|application|project|system)\b/.test(lower)
      || /\b(app|application|project|system)\b.*\b(full|complete|end.to.end|entire)\b/.test(lower)) {
    return [
      `${prompt}\n\n[SECTION 1/4] Generate ONLY: Project setup, configuration files, package.json / pom.xml, folder structure, and entry point. Do not generate anything else yet.`,
      `${prompt}\n\n[SECTION 2/4] Generate ONLY: Data models, database schemas, and repository/DAO layer. Do not repeat what was in section 1.`,
      `${prompt}\n\n[SECTION 3/4] Generate ONLY: Service/business logic layer and API route handlers. Do not repeat prior sections.`,
      `${prompt}\n\n[SECTION 4/4] Generate ONLY: Frontend components / UI layer, tests, and deployment configuration. Do not repeat prior sections.`,
    ];
  }

  // ── Generic large doc / code — split into 3 parts ────────────────────
  return [
    `${prompt}\n\n[SECTION 1/3] Generate the FIRST THIRD of this task. Stop at a logical boundary. Do not summarise — generate real content.`,
    `${prompt}\n\n[SECTION 2/3] Continue from where section 1 ended. Generate the MIDDLE THIRD. Do not repeat section 1.`,
    `${prompt}\n\n[SECTION 3/3] Continue and complete the final third. Do not repeat previous sections.`,
  ];
}

// ── Safe prompt assembler ────────────────────────────────────────────────────

/**
 * Assemble the final prompt string, trimming RAG context if necessary
 * to stay within the input token budget.
 */
export function buildSafePrompt(parts: {
  ragContext: string;
  systemPrompt: string;
  userPrompt: string;
}): string {
  const baseTokens = estimateTokens(parts.systemPrompt + parts.userPrompt);
  const trimmedRag = trimRagContext(parts.ragContext, baseTokens);

  return [trimmedRag, parts.systemPrompt, '', parts.userPrompt]
    .filter(Boolean)
    .join('\n');
}
