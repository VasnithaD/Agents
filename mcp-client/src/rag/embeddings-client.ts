/**
 * Embeddings Client
 *
 * Converts text → dense float vectors using:
 *   1. HPE ChatHPE gateway  (/embeddings  — same JWT auth as chat)
 *   2. OpenAI               (text-embedding-3-small)
 *
 * Throws if neither is available — caller falls back to TF-IDF.
 */

import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const HPE_BASE    = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
const HPE_TOKEN   = (process.env.AUTHENTICATION_TOKEN  || '').trim();
const HPE_CLIENT  = (process.env.CLIENT_ID             || '').trim();
const OPENAI_KEY  = (process.env.OPENAI_API_KEY        || '').trim();
const EMBED_MODEL = (process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small').trim();

// ── Batch helper ──────────────────────────────────────────────────────────────

function batches<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── HPE gateway ───────────────────────────────────────────────────────────────

async function embedViaHPE(texts: string[]): Promise<number[][]> {
  const url = `${HPE_BASE}/embeddings`;
  const resp = await axios.post(
    url,
    { input: texts, model: 'text-embedding-ada-002' },
    {
      headers: {
        Authorization: `Bearer ${HPE_TOKEN}`,
        client_id: HPE_CLIENT,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    }
  );
  // OpenAI-compatible response: { data: [ { embedding: number[] } ] }
  return (resp.data.data as any[]).map((d: any) => d.embedding as number[]);
}

// ── OpenAI ────────────────────────────────────────────────────────────────────

async function embedViaOpenAI(texts: string[]): Promise<number[][]> {
  // Dynamic import so the module loads even without the openai package being used
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: OPENAI_KEY });
  const resp = await client.embeddings.create({ model: EMBED_MODEL, input: texts });
  return resp.data.map(d => d.embedding);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Embed a batch of texts.  Tries HPE first, falls back to OpenAI.
 * @param texts  up to 100 strings per call (batching handled internally)
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (HPE_TOKEN && HPE_BASE) {
    try {
      return await embedViaHPE(texts);
    } catch (err: any) {
      console.warn('[Embed] HPE embeddings failed, trying OpenAI fallback:', err.message);
    }
  }
  if (OPENAI_KEY) {
    return await embedViaOpenAI(texts);
  }
  throw new Error(
    'No embedding API available.\n' +
    'Add OPENAI_API_KEY=sk-... to .env  OR  connect to HPE VPN.'
  );
}

/**
 * Embed many texts in parallel batches of 50.
 * Reports progress via console every 500 embeddings.
 */
export async function embedAll(
  texts: string[],
  onProgress?: (done: number, total: number) => void
): Promise<number[][]> {
  const BATCH = 50;
  const all: number[][] = [];
  const groups = batches(texts, BATCH);
  let done = 0;
  for (const group of groups) {
    const vecs = await embedBatch(group);
    all.push(...vecs);
    done += group.length;
    onProgress?.(done, texts.length);
    if (done % 500 === 0) console.log(`[Embed] ${done}/${texts.length} embedded`);
  }
  return all;
}

/** Returns true if at least one embedding backend is configured. */
export function embeddingAvailable(): boolean {
  return !!(HPE_TOKEN && HPE_BASE) || !!OPENAI_KEY;
}
