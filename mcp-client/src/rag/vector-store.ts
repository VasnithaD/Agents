/**
 * Neural Vector Store  —  persistent, file-backed cosine similarity search.
 *
 * Layout on disk:
 *   <RAG_INDEX_DIR>/info.json     — { dim, count, embeddedAt }
 *   <RAG_INDEX_DIR>/meta.json     — VChunk[] (text + source metadata)
 *   <RAG_INDEX_DIR>/vectors.bin   — raw Float32Array  (dim × count floats)
 *
 * All math is plain TypeScript — zero extra npm packages.
 */

import * as fs   from 'fs';
import * as path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VChunk {
  id:         number;
  text:       string;
  source:     string;   // file path
  fileName:   string;
  chunkIndex: number;
}

export interface VSearchResult {
  chunk: VChunk;
  score: number;        // 0–1 cosine similarity
}

interface StoreInfo {
  dim:         number;
  count:       number;
  embeddedAt:  string;  // ISO timestamp
  docsHash:    string;  // simple fingerprint to detect stale index
}

// ── Math helpers ──────────────────────────────────────────────────────────────

function l2norm(v: Float32Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}

function cosine(a: Float32Array, aNorm: number, b: Float32Array): number {
  if (aNorm === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  const bNorm = l2norm(b);
  return bNorm === 0 ? 0 : dot / (aNorm * bNorm);
}

// ── Store ─────────────────────────────────────────────────────────────────────

export class NeuralVectorStore {
  private chunks:  VChunk[]      = [];
  private vectors: Float32Array[] = [];
  private dim = 0;
  private norms: Float32Array = new Float32Array(0); // precomputed norms

  get size(): number { return this.chunks.length; }

  // ── Write ────────────────────────────────────────────────────────────────

  add(chunk: VChunk, vector: number[]): void {
    const fv = new Float32Array(vector);
    if (this.dim === 0) this.dim = vector.length;
    this.chunks.push(chunk);
    this.vectors.push(fv);
  }

  /** Precompute all norms — call once after all `add()` calls. */
  finalize(): void {
    const n = new Float32Array(this.vectors.length);
    for (let i = 0; i < this.vectors.length; i++) n[i] = l2norm(this.vectors[i]);
    this.norms = n;
  }

  // ── Search ────────────────────────────────────────────────────────────────

  search(queryVector: number[], topK = 6, minScore = 0.25): VSearchResult[] {
    if (this.size === 0) return [];
    const qv    = new Float32Array(queryVector);
    const qNorm = l2norm(qv);

    const scores = new Float32Array(this.vectors.length);
    for (let i = 0; i < this.vectors.length; i++) {
      scores[i] = cosine(qv, qNorm, this.vectors[i]);
    }

    // Partial sort — get top-K indices
    const indices = Array.from({ length: this.vectors.length }, (_, i) => i);
    indices.sort((a, b) => scores[b] - scores[a]);

    return indices
      .slice(0, topK * 3)          // oversample then filter
      .filter(i => scores[i] >= minScore)
      .slice(0, topK)
      .map(i => ({ chunk: this.chunks[i], score: scores[i] }));
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  saveToDisk(dir: string, docsHash: string): void {
    fs.mkdirSync(dir, { recursive: true });

    // meta.json — chunk metadata (no vectors)
    fs.writeFileSync(
      path.join(dir, 'meta.json'),
      JSON.stringify(this.chunks),
      'utf8'
    );

    // vectors.bin — packed Float32Array
    const total = this.chunks.length * this.dim;
    const flat  = new Float32Array(total);
    for (let i = 0; i < this.vectors.length; i++) {
      flat.set(this.vectors[i], i * this.dim);
    }
    fs.writeFileSync(path.join(dir, 'vectors.bin'), Buffer.from(flat.buffer));

    // info.json
    const info: StoreInfo = {
      dim:        this.dim,
      count:      this.chunks.length,
      embeddedAt: new Date().toISOString(),
      docsHash,
    };
    fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify(info, null, 2), 'utf8');

    console.log(`[VectorStore] Saved ${this.chunks.length} vectors (dim=${this.dim}) to ${dir}`);
  }

  /**
   * Load index from disk.
   * @returns `true` if loaded successfully, `false` if index is missing/stale/corrupt.
   */
  loadFromDisk(dir: string, docsHash?: string): boolean {
    try {
      const infoPath = path.join(dir, 'info.json');
      const metaPath = path.join(dir, 'meta.json');
      const vecPath  = path.join(dir, 'vectors.bin');

      if (!fs.existsSync(infoPath) || !fs.existsSync(metaPath) || !fs.existsSync(vecPath)) {
        return false;
      }

      const info: StoreInfo = JSON.parse(fs.readFileSync(infoPath, 'utf8'));

      // Stale check — if documents changed, discard old index
      if (docsHash && info.docsHash !== docsHash) {
        console.log('[VectorStore] Index is stale (documents changed) — will rebuild.');
        return false;
      }

      this.dim    = info.dim;
      this.chunks = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

      const raw  = fs.readFileSync(vecPath);
      const flat = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);

      this.vectors = [];
      for (let i = 0; i < this.chunks.length; i++) {
        this.vectors.push(flat.slice(i * this.dim, (i + 1) * this.dim));
      }

      this.finalize();

      console.log(
        `[VectorStore] Loaded ${this.chunks.length} vectors (dim=${this.dim}) ` +
        `embedded at ${info.embeddedAt}`
      );
      return true;
    } catch (err: any) {
      console.warn('[VectorStore] Failed to load from disk:', err.message);
      return false;
    }
  }

  /** Quick fingerprint of a list of file paths + mtimes. */
  static buildDocsHash(files: Record<string, number>): string {
    const keys = Object.keys(files).sort();
    let h = 0;
    for (const k of keys) {
      const n = files[k];
      for (let i = 0; i < k.length; i++) h = (Math.imul(31, h) + k.charCodeAt(i)) | 0;
      h = (Math.imul(31, h) + n) | 0;
    }
    return (h >>> 0).toString(16);
  }
}
