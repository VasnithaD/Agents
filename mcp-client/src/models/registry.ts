/**
 * Model Registry
 *
 * Central catalogue of all LLM models available through the HPE ChatHPE
 * gateway and direct fallback providers (Azure OpenAI, OpenAI).
 *
 * All models go through the same HPE gateway endpoint — the only thing
 * that changes per call is the `model_name` field in the request body.
 *
 * To add a new model: add an entry to MODEL_REGISTRY below.
 */

export type ModelProvider = 'hpe-gateway' | 'azure-openai' | 'openai';

export interface ModelDefinition {
  /** Exact model_name string sent to the API */
  id: string;
  /** Human-readable label shown in the UI / responses */
  label: string;
  /** Who routes this model */
  provider: ModelProvider;
  /** Max output tokens this model supports */
  maxOutputTokens: number;
  /** Context window in tokens */
  contextWindow: number;
  /** Short capability summary */
  description: string;
  /** Best use-cases for this model */
  bestFor: string[];
  /** Whether this model is available by default (no extra config needed) */
  available: boolean;
}

// ── Model Catalogue ──────────────────────────────────────────────────────────
// All HPE-gateway models share the same endpoint; provider = 'hpe-gateway'.
// The gateway transparently routes to the underlying model.
//
// HPE ChatHPE gateway supported model IDs (api.chathpe.it.hpe.com/v2.8):
//   OpenAI  : gpt-4o-mini, gpt-4o
//   Anthropic: claude-3-5-sonnet-20241022, claude-3-haiku-20240307
//   xAI     : grok-2-1212
//   Meta    : llama-3.1-70b-instruct, llama-3.1-8b-instruct
//   Mistral : mistral-large-latest, mistral-small-latest
//   Google  : gemini-1.5-pro, gemini-1.5-flash   (if org has access)

export const MODEL_REGISTRY: ModelDefinition[] = [
  // ── OpenAI via HPE gateway ────────────────────────────────────────────────
  {
    id             : 'gpt-4o-mini',
    label          : 'GPT-4o Mini   ★ Fast default',
    provider       : 'hpe-gateway',
    maxOutputTokens: 16384,
    contextWindow  : 128000,
    description    : 'Fast, cost-efficient. Best everyday model for chat, code snippets, and quick Q&A.',
    bestFor        : ['quick code gen', 'chat', 'Q&A', 'TDS drafting', 'unit tests'],
    available      : true,
  },
  {
    id             : 'gpt-4o',
    label          : 'GPT-4o   ★ Best OpenAI quality',
    provider       : 'hpe-gateway',
    maxOutputTokens: 16384,
    contextWindow  : 128000,
    description    : 'Most capable OpenAI model. Higher quality, slightly slower. Best for full project generation.',
    bestFor        : ['full Spring Boot project', 'complex architecture', 'deep code review', 'multi-file generation'],
    available      : true,
  },
  // ── Anthropic Claude via HPE gateway ────────────────────────────────────
  {
    id             : 'claude-3-5-sonnet-20241022',
    label          : 'Claude 3.5 Sonnet   ★ Best for long docs',
    provider       : 'hpe-gateway',
    maxOutputTokens: 8096,
    contextWindow  : 200000,
    description    : '200k context window. Best model for reading + reasoning over large specs (TDS/FDS/BRD). Very strong at writing complete files.',
    bestFor        : ['TDS/FDS/BRD analysis', 'large doc Q&A', 'complete file generation', 'refactoring'],
    available      : true,
  },
  {
    id             : 'claude-3-haiku-20240307',
    label          : 'Claude 3 Haiku   (fast & lightweight)',
    provider       : 'hpe-gateway',
    maxOutputTokens: 4096,
    contextWindow  : 200000,
    description    : 'Fastest Claude. Good for quick summarisation, reviews, and chat.',
    bestFor        : ['quick code review', 'summarisation', 'chat'],
    available      : true,
  },
  // ── xAI Grok via HPE gateway ─────────────────────────────────────────────
  {
    id             : 'grok-2-1212',
    label          : 'Grok 2   ★ Best for large codebases',
    provider       : 'hpe-gateway',
    maxOutputTokens: 131072,
    contextWindow  : 131072,
    description    : 'xAI Grok — largest output budget (131k). Best when you need very long generated files or full project in one shot.',
    bestFor        : ['end-to-end project generation', 'very long files', 'large codebase analysis'],
    available      : true,
  },
  // ── Meta Llama via HPE gateway ───────────────────────────────────────────
  {
    id             : 'llama-3.1-70b-instruct',
    label          : 'Llama 3.1 70B   (open-source, strong code)',
    provider       : 'hpe-gateway',
    maxOutputTokens: 8192,
    contextWindow  : 128000,
    description    : 'Meta open-source. Strong at Java/Python code gen. Good privacy option (fully on-prem at HPE).',
    bestFor        : ['Java code generation', 'Python scripts', 'on-prem/private workloads'],
    available      : true,
  },
  {
    id             : 'llama-3.1-8b-instruct',
    label          : 'Llama 3.1 8B   (lightweight, fastest)',
    provider       : 'hpe-gateway',
    maxOutputTokens: 8192,
    contextWindow  : 128000,
    description    : 'Smallest Llama. Very fast. Good for simple tasks and high-volume batch calls.',
    bestFor        : ['simple code snippets', 'batch summarisation', 'chat'],
    available      : true,
  },
  // ── Mistral via HPE gateway ──────────────────────────────────────────────
  {
    id             : 'mistral-large-latest',
    label          : 'Mistral Large   (strong at code & reasoning)',
    provider       : 'hpe-gateway',
    maxOutputTokens: 8192,
    contextWindow  : 128000,
    description    : 'Mistral AI flagship. Particularly strong at coding, instruction-following, and low hallucination rate.',
    bestFor        : ['Java/Python code gen', 'refactoring', 'precise instruction following'],
    available      : true,
  },
  {
    id             : 'mistral-small-latest',
    label          : 'Mistral Small   (fast & efficient)',
    provider       : 'hpe-gateway',
    maxOutputTokens: 8192,
    contextWindow  : 128000,
    description    : 'Smaller Mistral. Fast and efficient for everyday coding tasks.',
    bestFor        : ['quick code gen', 'refactoring', 'code review'],
    available      : true,
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Get model definition by id. Returns default model if not found. */
export function getModel(modelId: string): ModelDefinition {
  return (
    MODEL_REGISTRY.find(m => m.id === modelId) ??
    MODEL_REGISTRY.find(m => m.id === 'gpt-4o-mini')!
  );
}

/** Default model id (reads from env, falls back to gpt-4o-mini). */
export function getDefaultModelId(): string {
  return (process.env.LLM_MODEL_NAME || 'gpt-4o-mini').trim();
}

/** List of all available model IDs — used in the tool schema enum. */
export const AVAILABLE_MODEL_IDS = MODEL_REGISTRY
  .filter(m => m.available)
  .map(m => m.id);

/** Format model list as a readable string for API responses. */
export function formatModelList(): object[] {
  return MODEL_REGISTRY
    .filter(m => m.available)
    .map(m => ({
      id         : m.id,
      label      : m.label,
      description: m.description,
      bestFor    : m.bestFor,
      contextWindow  : m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
    }));
}
