/**
 * RAG Document Loader
 *
 * Walks the RAG_DOCUMENTS_PATH directory (the NGQ cpq-ngqc-app project) and
 * reads all human-readable source/doc files into memory.
 *
 * Skipped directories: .git, node_modules, target, dist, build, .github,
 *   __pycache__, vendor, coverage, .nyc_output, out
 *
 * Supported extensions: .md .txt .java .properties .xml .yaml .yml
 *   .json .ts .js .py .html .csv
 */

import * as fs from 'fs';
import * as path from 'path';

export interface RawDocument {
  filePath: string;   // relative path from RAG root
  fileName: string;
  content: string;
}

const SUPPORTED_EXTENSIONS = new Set([
  '.md', '.txt',
  '.java', '.properties',
  '.xml', '.yaml', '.yml',
  '.json',
  '.ts', '.js', '.py',
  '.html', '.csv',
]);

// Directories that contain no useful domain knowledge
const SKIP_DIRS = new Set([
  '.git', '.github', '.gitignore',
  'node_modules', 'target', 'dist', 'build',
  '__pycache__', 'vendor', 'coverage', '.nyc_output',
  'out', '.idea', '.vscode', '.mvn',
]);

function readFileSafe(fullPath: string): string | null {
  try {
    return fs.readFileSync(fullPath, { encoding: 'utf-8' });
  } catch {
    return null;
  }
}

function walkDir(dir: string, root: string, results: RawDocument[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    // Skip build artifacts / VCS / dependency directories
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkDir(path.join(dir, entry.name), root, results);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;

    const fullPath = path.join(dir, entry.name);
    const content = readFileSafe(fullPath);
    if (!content || content.trim().length < 30) continue;

    results.push({
      filePath: path.relative(root, fullPath).replace(/\\/g, '/'),
      fileName: entry.name,
      content,
    });
  }
}

/**
 * Load all documents from the given root directory.
 * Returns an empty array if the directory does not exist.
 */
export function loadDocuments(rootDir: string): RawDocument[] {
  if (!fs.existsSync(rootDir)) {
    console.warn(`[RAG] Documents path not found: ${rootDir}`);
    return [];
  }
  const results: RawDocument[] = [];
  walkDir(rootDir, rootDir, results);
  console.log(`[RAG] Loaded ${results.length} documents from ${rootDir}`);
  return results;
}
