/**
 * RAG Retriever  —  singleton that owns the full RAG lifecycle:
 *
 *   initialize()   → load docs, build TF-IDF + Neural indexes, build AST index
 *   retrieve(q, k) → return top-K chunks as formatted context string
 *   retrieveSymbol(name) → return complete method/class from AST (precise)
 *   getStatus()    → report on readiness
 *
 * Hybrid approach:
 * - AST index: precise method/class lookup → complete code units
 * - Vector index: semantic search → related concepts
 * - TF-IDF: fast fallback → keyword search
 *
 * Documents are loaded from RAG_DOCUMENTS_PATH (env var).
 * Default: the sibling Transcripts_final/Transcripts/projects folder.
 *
 * The index is rebuilt automatically whenever new files are detected
 * (polling every RAG_WATCH_INTERVAL_MS, default 120 000 ms / 2 min).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { loadDocuments, RawDocument } from './document-loader';
import { TFIDFStore, SearchResult } from './tfidf-store';
import { NeuralVectorStore, VSearchResult } from './vector-store';
import { embedBatch, embedAll, embeddingAvailable } from './embeddings-client';
import { astIndexer, ASTSymbol } from './ast-indexer';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// ── Public types ─────────────────────────────────────────────────────────────

export interface RagSource {
  file:      string;   // base filename (e.g. QuoteService.java)
  path:      string;   // full path from the indexed docs folder
  chunks:    number;   // how many chunks were retrieved from this file
  linesRead: number;   // total lines across those chunks
}

// ── Configuration ────────────────────────────────────────────────────────────

const RAG_DOCUMENTS_PATH: string = (
  process.env.RAG_DOCUMENTS_PATH ||
  path.resolve(__dirname, '../../../Transcripts_final/Transcripts/projects')
).trim();

const RAG_INDEX_DIR: string = (
  process.env.RAG_INDEX_PATH ||
  path.resolve(__dirname, '../../rag-index')
).trim();

const CHUNK_SIZE   = parseInt(process.env.RAG_CHUNK_SIZE   || '1800');  // chars — large enough to hold a full method body
const CHUNK_OVERLAP= parseInt(process.env.RAG_CHUNK_OVERLAP|| '200');   // chars
const WATCH_MS     = parseInt(process.env.RAG_WATCH_INTERVAL_MS || '120000');

// ── Chunker ──────────────────────────────────────────────────────────────────

interface TextChunk {
  filePath: string;
  fileName: string;
  content: string;
}

function chunkDocuments(docs: RawDocument[]): TextChunk[] {
  const chunks: TextChunk[] = [];
  for (const doc of docs) {
    const text = doc.content;
    const step = CHUNK_SIZE - CHUNK_OVERLAP;
    for (let i = 0; i < text.length; i += step) {
      const slice = text.slice(i, i + CHUNK_SIZE).trim();
      if (slice.length > 30) {
        chunks.push({ filePath: doc.filePath, fileName: doc.fileName, content: slice });
      }
    }
  }
  return chunks;
}

// ── Snapshot helper (detect file changes) ────────────────────────────────────

function buildSnapshot(dir: string): Record<string, number> {
  const snap: Record<string, number> = {};
  if (!fs.existsSync(dir)) return snap;
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) walk(fp);
      else { try { snap[fp] = fs.statSync(fp).mtimeMs; } catch { /* skip */ } }
    }
  };
  walk(dir);
  return snap;
}

function snapshotChanged(a: Record<string, number>, b: Record<string, number>): boolean {
  const keysA = Object.keys(a), keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return true;
  return keysA.some(k => a[k] !== b[k]);
}

// ── Singleton Retriever ───────────────────────────────────────────────────────

class RAGRetriever {
  // TF-IDF — always available, instant startup
  private tfidf    = new TFIDFStore();
  private tfidfOk  = false;

  // Neural — built asynchronously, persisted to disk
  private neural   = new NeuralVectorStore();
  private neuralOk = false;
  private embedding= false;   // currently building neural index

  private docCount = 0;
  private lastSnapshot: Record<string, number> = {};
  private watchTimer: NodeJS.Timeout | null = null;

  /** Load docs and build index. Call once at startup. */
  async initialize(): Promise<void> {
    await this._rebuild();
    this._startWatcher();
  }

  private async _rebuild(): Promise<void> {
    console.log(`[RAG] Loading documents from: ${RAG_DOCUMENTS_PATH}`);
    const docs = loadDocuments(RAG_DOCUMENTS_PATH);
    if (docs.length === 0) {
      console.warn('[RAG] No documents found — RAG context will be unavailable.');
      this.tfidfOk = false;
      return;
    }

    const chunks = chunkDocuments(docs);
    this.docCount = docs.length;
    this.lastSnapshot = buildSnapshot(RAG_DOCUMENTS_PATH);

    // ── Step 1: TF-IDF index (immediate) ─────────────────────────────────
    this.tfidf.index(chunks);
    this.tfidfOk = true;
    console.log(`[RAG] TF-IDF index built: ${chunks.length} chunks`);

    // ── Step 2: Neural index (async, background) ──────────────────────────
    const docsHash = NeuralVectorStore.buildDocsHash(this.lastSnapshot);
    const loaded   = this.neural.loadFromDisk(RAG_INDEX_DIR, docsHash);

    if (loaded) {
      this.neuralOk = true;
      console.log(`[RAG] Neural index loaded from disk (${this.neural.size} vectors)`);
    } else if (embeddingAvailable()) {
      // Build in background — don't block server startup
      this._buildNeuralIndex(chunks, docsHash).catch(err =>
        console.warn('[RAG] Neural index build failed:', err.message)
      );
    } else {
      console.log('[RAG] No embedding API configured — using TF-IDF only.');
      console.log('[RAG] To enable neural search: add OPENAI_API_KEY to .env');
    }

    // ── Step 3: AST index for symbol-based lookup (immediate) ──────────────────
    // Index CPQ project for precise method/class retrieval
    const cpqProjectPath = path.resolve(__dirname, '../../../Transcripts_final/cpq-ngqc-app');
    if (fs.existsSync(cpqProjectPath)) {
      console.log('[RAG] Building AST index for CPQ project...');
      try {
        astIndexer.indexDirectory(cpqProjectPath);
        console.log(`[RAG] AST index ready: ${JSON.stringify(astIndexer.getStatus())}`);
      } catch (err) {
        console.warn('[RAG] AST indexing failed:', (err as Error).message);
      }
    } else {
      console.log('[RAG] CPQ project not found at:', cpqProjectPath);
    }
  }

  private async _buildNeuralIndex(
    chunks: { filePath: string; fileName: string; content: string }[],
    docsHash: string
  ): Promise<void> {
    if (this.embedding) return;
    this.embedding = true;
    console.log(`[RAG] Building neural index for ${chunks.length} chunks...`);

    try {
      const store  = new NeuralVectorStore();
      const texts  = chunks.map(c => c.content);
      const vectors = await embedAll(texts, (done, total) => {
        if (done % 1000 === 0) console.log(`[RAG] Embedding ${done}/${total}`);
      });

      for (let i = 0; i < chunks.length; i++) {
        store.add({
          id:         i,
          text:       chunks[i].content,
          source:     chunks[i].filePath,
          fileName:   chunks[i].fileName,
          chunkIndex: i,
        }, vectors[i]);
      }
      store.finalize();
      store.saveToDisk(RAG_INDEX_DIR, docsHash);

      this.neural   = store;
      this.neuralOk = true;
      console.log(`[RAG] Neural index ready: ${store.size} vectors`);
    } finally {
      this.embedding = false;
    }
  }

  private _startWatcher(): void {
    if (WATCH_MS <= 0) return;
    this.watchTimer = setInterval(async () => {
      const current = buildSnapshot(RAG_DOCUMENTS_PATH);
      if (snapshotChanged(this.lastSnapshot, current)) {
        console.log('[RAG] Change detected — rebuilding index...');
        await this._rebuild();
      }
    }, WATCH_MS);
    // Don't prevent Node from exiting
    this.watchTimer.unref();
  }

  /**
   * Retrieve the top-K most relevant chunks for a query.
   * Uses neural search when the index is ready, TF-IDF otherwise.
   * Returns a formatted string ready to prepend to an LLM prompt.
   */
  async retrieve(query: string, topK = 5): Promise<string> {
    // ── Neural search (best quality) ──────────────────────────────────────
    if (this.neuralOk) {
      try {
        const queryVec = await embedBatch([query]);
        const results: VSearchResult[] = this.neural.search(queryVec[0], topK);
        if (results.length > 0) {
          return this._formatNeural(results, query);
        }
      } catch {
        // fall through to TF-IDF
      }
    }

    // ── TF-IDF fallback ────────────────────────────────────────────────────
    if (!this.tfidfOk) return '';
    const results: SearchResult[] = this.tfidf.search(query, topK);
    if (results.length === 0) return '';
    return this._formatTFIDF(results);
  }

  /**
   * Multi-query retrieval: run several targeted queries and merge/deduplicate results.
   * Used for per-file code generation so each file gets domain-specific context.
   */
  async retrieveMulti(queries: string[], topKEach = 6): Promise<string> {
    const seen = new Set<string>();
    const allLines: string[] = [
      '### Project Knowledge Base — targeted retrieval',
      '',
    ];
    let chunkIndex = 1;
    for (const q of queries) {
      let raw = '';
      try { raw = await this.retrieve(q, topKEach); } catch { continue; }
      // strip the header from each individual result block
      const stripped = raw
        .replace(/^### Relevant NGQ Project Context.*\n\*.*\*\n/m, '')
        .replace(/^\*Use the above context.*\*\n?$/m, '');
      // dedup by chunk content hash
      for (const block of stripped.split('\n---\n')) {
        const key = block.slice(0, 80).trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        allLines.push(`#### [${chunkIndex++}] (query: ${q.slice(0, 60)})`);
        allLines.push(block.trim());
        allLines.push('');
        allLines.push('---');
        allLines.push('');
      }
    }
    if (chunkIndex === 1) return '';   // nothing retrieved
    allLines.push('*Use the above context to ground your code. Quote field names, class names, and business rules verbatim.*');
    return allLines.join('\n');
  }

  getChunkCount(): number {
    if (this.neuralOk) return this.neural.size;
    return this.tfidf.chunkCount ?? 0;
  }

  // ── Public source type ───────────────────────────────────────────────────
  // Exposed so agent-handler can collect and pass to the UI
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Like retrieveMulti but also returns per-file metadata so the UI can display
   * a Copilot-style "N files read" pill with clickable file names + line counts.
   */
  async retrieveMultiWithSources(
    queries: string[],
    topKEach = 6
  ): Promise<{ context: string; sources: RagSource[] }> {
    const seen        = new Set<string>();
    // file path → { file, path, chunks, linesRead }
    const sourceMap   = new Map<string, RagSource>();
    const allLines: string[] = ['### Project Knowledge Base — targeted retrieval', ''];
    let chunkIndex = 1;

    for (const q of queries) {
      // ── Neural ──────────────────────────────────────────────────────────
      if (this.neuralOk) {
        try {
          const queryVec = await embedBatch([q]);
          const results: VSearchResult[] = this.neural.search(queryVec[0], topKEach);
          for (const { chunk, score } of results) {
            const key = chunk.text.slice(0, 80).trim();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            allLines.push(`#### [${chunkIndex++}] ${chunk.fileName}  (${(score * 100).toFixed(1)}%)`);
            allLines.push(`> Path: ${chunk.source}`);
            allLines.push('');
            allLines.push(chunk.text);
            allLines.push('');
            allLines.push('---');
            allLines.push('');
            // accumulate source metadata
            const existing = sourceMap.get(chunk.source);
            const lineCount = chunk.text.split('\n').length;
            if (existing) {
              existing.chunks++;
              existing.linesRead += lineCount;
            } else {
              sourceMap.set(chunk.source, {
                file: chunk.fileName,
                path: chunk.source,
                chunks: 1,
                linesRead: lineCount,
              });
            }
          }
          continue;  // skip TF-IDF for this query
        } catch { /* fall through */ }
      }
      // ── TF-IDF fallback ─────────────────────────────────────────────────
      if (!this.tfidfOk) continue;
      const results: SearchResult[] = this.tfidf.search(q, topKEach);
      for (const { chunk, score } of results) {
        const key = chunk.content.slice(0, 80).trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        allLines.push(`#### [${chunkIndex++}] ${chunk.fileName}  (${(score * 100).toFixed(1)}%)`);
        allLines.push(`> Path: ${chunk.filePath}`);
        allLines.push('');
        allLines.push(chunk.content);
        allLines.push('');
        allLines.push('---');
        allLines.push('');
        const existing = sourceMap.get(chunk.filePath);
        const lineCount = chunk.content.split('\n').length;
        if (existing) {
          existing.chunks++;
          existing.linesRead += lineCount;
        } else {
          sourceMap.set(chunk.filePath, {
            file: chunk.fileName,
            path: chunk.filePath,
            chunks: 1,
            linesRead: lineCount,
          });
        }
      }
    }

    if (chunkIndex === 1) return { context: '', sources: [] };
    allLines.push('*Use the above context to ground your code. Quote field names, class names, and business rules verbatim.*');
    return {
      context: allLines.join('\n'),
      sources: Array.from(sourceMap.values()).sort((a, b) => b.linesRead - a.linesRead),
    };
  }

  private _formatNeural(results: VSearchResult[], _query: string): string {
    const lines = [
      '### Relevant NGQ Project Context  (neural semantic search)',
      `*${results.length} passage(s) retrieved via embedding similarity.*`,
      '',
    ];
    for (let i = 0; i < results.length; i++) {
      const { chunk, score } = results[i];
      lines.push(`#### [${i + 1}] ${chunk.fileName}  (similarity: ${(score * 100).toFixed(1)}%)`);
      lines.push(`> Path: ${chunk.source}`);
      lines.push('');
      lines.push(chunk.text);
      lines.push('');
      lines.push('---');
      lines.push('');
    }
    lines.push('*Use the above context to ground your answer. Do not invent information not present.*');
    lines.push('');
    return lines.join('\n');
  }

  private _formatTFIDF(results: SearchResult[]): string {
    const lines = [
      '### Relevant NGQ Project Context  (keyword search)',
      `*${results.length} passage(s) retrieved via TF-IDF. Neural index building in background.*`,
      '',
    ];
    for (let i = 0; i < results.length; i++) {
      const { chunk, score } = results[i];
      lines.push(`#### [${i + 1}] ${chunk.fileName}  (relevance: ${(score * 100).toFixed(1)}%)`);
      lines.push(`> Path: ${chunk.filePath}`);
      lines.push('');
      lines.push(chunk.content);
      lines.push('');
      lines.push('---');
      lines.push('');
    }
    lines.push('*Use the above context to ground your answer. Do not invent information not present.*');
    lines.push('');
    return lines.join('\n');
  }

  // ── AST-based symbol retrieval (PRECISE) ──────────────────────────────────

  /**
   * Find a complete method or class by name
   * Returns FULL source code, not chunks
   * Example: retrieveSymbol('QuoteService') → complete class with all methods
   */
  retrieveSymbol(symbolName: string): { symbol: ASTSymbol; context: string } | null {
    const symbol = astIndexer.findSymbol(symbolName);
    if (!symbol) return null;

    // For classes, include all methods
    if (symbol.type === 'class') {
      const methods = astIndexer.findMethodsInClass(symbolName);
      const context = `${symbol.content}\n\n` + methods.map(m => m.content).join('\n\n');
      return { symbol, context };
    }

    // For methods/functions, return as-is
    return {
      symbol,
      context: symbol.content,
    };
  }

  /**
   * Find all methods in a class (by class name)
   */
  retrieveClassMethods(className: string): ASTSymbol[] {
    return astIndexer.findMethodsInClass(className);
  }

  /**
   * Find files that contain a symbol
   */
  retrieveFilesWithSymbol(symbolName: string): string[] {
    return astIndexer.findFilesWithSymbol(symbolName);
  }

  /**
   * Reconstruct complete file (all symbols + imports)
   */
  retrieveCompleteFile(className: string): { content: string; symbols: ASTSymbol[] } | null {
    return astIndexer.getCompleteFile(className);
  }

  getStatus(): {
    ready: boolean; neuralReady: boolean; buildingNeural: boolean;
    docCount: number; chunkCount: number; vectorCount: number; documentsPath: string; indexPath: string;
    astStatus?: any;
  } {
    const astStatus = astIndexer.getStatus();
    return {
      ready:          this.tfidfOk || this.neuralOk,
      neuralReady:    this.neuralOk,
      buildingNeural: this.embedding,
      docCount:       this.docCount,
      chunkCount:     this.tfidf.chunkCount,
      vectorCount:    this.neural.size,
      documentsPath:  RAG_DOCUMENTS_PATH,
      indexPath:      RAG_INDEX_DIR,
      astStatus,
    };
  }
}

// Export singleton
export const ragRetriever = new RAGRetriever();

/** Call once when the MCP server starts. */
export async function initializeRAG(): Promise<void> {
  await ragRetriever.initialize();
}
