/**
 * TF-IDF Vector Store  (pure TypeScript — zero extra dependencies)
 *
 * Builds an in-memory TF-IDF index over document chunks and ranks them
 * with cosine similarity against a query. No external ML library needed.
 *
 * Flow:
 *   1. index(chunks)          — tokenise + build IDF weights
 *   2. search(query, topK)    — return top-K scored chunks
 */

export interface Chunk {
  id: number;
  filePath: string;
  fileName: string;
  content: string;          // raw text
  tokens: string[];         // tokenised form
  tfVector: Map<string, number>;  // term → tf score
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
}

// ── Tokeniser ────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for',
  'of','with','by','from','is','it','its','as','be','was','are',
  'were','been','have','has','had','do','does','did','will','would',
  'could','should','may','might','that','this','these','those',
  'not','no','if','then','else','so','we','you','i','he','she','they',
  'my','your','our','their','all','any','each','both','few','more',
  'most','other','some','such','than','too','very','just','also',
]);

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\-.]/g, ' ')   // keep identifiers/numbers
    .split(/\s+/)
    .map(t => t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))  // trim punctuation
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

function computeTF(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  const total = tokens.length || 1;
  const tf = new Map<string, number>();
  for (const [term, count] of freq) tf.set(term, count / total);
  return tf;
}

// ── TF-IDF Store ─────────────────────────────────────────────────────────────

export class TFIDFStore {
  private chunks: Chunk[] = [];
  private idf: Map<string, number> = new Map();   // term → idf weight
  private indexed = false;

  /** Build the index from raw text chunks. */
  index(items: Array<{ filePath: string; fileName: string; content: string }>): void {
    this.chunks = [];
    this.idf = new Map();

    // Step 1: tokenise all chunks
    for (let i = 0; i < items.length; i++) {
      const tokens = tokenise(items[i].content);
      this.chunks.push({
        id: i,
        filePath: items[i].filePath,
        fileName: items[i].fileName,
        content: items[i].content,
        tokens,
        tfVector: computeTF(tokens),
      });
    }

    // Step 2: compute IDF  — log((N + 1) / (df + 1)) + 1  (smoothed)
    const N = this.chunks.length;
    const df = new Map<string, number>();
    for (const chunk of this.chunks) {
      for (const term of new Set(chunk.tokens)) {
        df.set(term, (df.get(term) ?? 0) + 1);
      }
    }
    for (const [term, count] of df) {
      this.idf.set(term, Math.log((N + 1) / (count + 1)) + 1);
    }

    this.indexed = true;
    console.log(`[RAG] TF-IDF index built: ${this.chunks.length} chunks, ${this.idf.size} unique terms`);
  }

  /** Return top-K chunks most relevant to the query. */
  search(query: string, topK = 5, minScore = 0.05): SearchResult[] {
    if (!this.indexed || this.chunks.length === 0) return [];

    const queryTokens = tokenise(query);
    const queryTF = computeTF(queryTokens);

    // Build query TF-IDF vector
    const queryVec = new Map<string, number>();
    for (const [term, tf] of queryTF) {
      const idfVal = this.idf.get(term) ?? 0;
      if (idfVal > 0) queryVec.set(term, tf * idfVal);
    }

    if (queryVec.size === 0) return [];

    const queryNorm = Math.sqrt([...queryVec.values()].reduce((s, v) => s + v * v, 0));

    // Score every chunk via cosine similarity
    const scored: SearchResult[] = this.chunks.map(chunk => {
      let dot = 0;
      let chunkNorm = 0;
      for (const [term, tf] of chunk.tfVector) {
        const idfVal = this.idf.get(term) ?? 0;
        const tfidf = tf * idfVal;
        chunkNorm += tfidf * tfidf;
        if (queryVec.has(term)) dot += tfidf * (queryVec.get(term)!);
      }
      const score = queryNorm > 0 && chunkNorm > 0
        ? dot / (queryNorm * Math.sqrt(chunkNorm))
        : 0;
      return { chunk, score };
    });

    return scored
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  get isReady(): boolean {
    return this.indexed;
  }

  get chunkCount(): number {
    return this.chunks.length;
  }
}
