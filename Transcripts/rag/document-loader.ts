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

interface FolderNode {
  files: Set<string>;
  subdirs: Set<string>;
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

function getParentDir(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  if (idx === -1) return '.';
  return normalized.slice(0, idx) || '.';
}

function buildFolderManifestDocuments(rootDir: string, docs: RawDocument[]): RawDocument[] {
  const tree = new Map<string, FolderNode>();

  const ensureNode = (dir: string): FolderNode => {
    const key = dir || '.';
    if (!tree.has(key)) {
      tree.set(key, { files: new Set<string>(), subdirs: new Set<string>() });
    }
    return tree.get(key)!;
  };

  ensureNode('.');

  for (const doc of docs) {
    const relPath = doc.filePath.replace(/\\/g, '/');
    const parent = getParentDir(relPath);
    const fileName = path.basename(relPath);
    ensureNode(parent).files.add(fileName);

    const parts = parent === '.' ? [] : parent.split('/');
    let current = '.';
    for (const part of parts) {
      const next = current === '.' ? part : `${current}/${part}`;
      ensureNode(current).subdirs.add(part);
      ensureNode(next);
      current = next;
    }
  }

  const manifests: RawDocument[] = [];
  for (const [dir, node] of tree.entries()) {
    const relDir = dir === '.' ? '' : dir;
    const absDir = path.resolve(rootDir, relDir);
    const files = Array.from(node.files).sort().slice(0, 50);
    const subdirs = Array.from(node.subdirs).sort().slice(0, 50);

    const lines: string[] = [
      '[FOLDER_MANIFEST]',
      `Folder relative path: ${relDir || '.'}`,
      `Folder absolute path: ${absDir}`,
      `Subfolders (${subdirs.length}): ${subdirs.length ? subdirs.join(', ') : 'none'}`,
      `Files (${files.length}): ${files.length ? files.join(', ') : 'none'}`,
    ];

    manifests.push({
      filePath: `__folder__/${(relDir || 'root').replace(/[\\/:*?"<>|]/g, '_')}.folder.txt`,
      fileName: `${path.basename(relDir || 'root')}.folder`,
      content: lines.join('\n'),
    });
  }

  return manifests;
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

  const includeFolderChunks = (process.env.RAG_INCLUDE_FOLDER_CHUNKS || 'true').toLowerCase() !== 'false';
  const folderDocs = includeFolderChunks ? buildFolderManifestDocuments(rootDir, results) : [];
  const combined = results.concat(folderDocs);

  console.log(
    `[RAG] Loaded ${results.length} files + ${folderDocs.length} folder manifests from ${rootDir}`
  );
  return combined;
}
