"""
Vector Embeddings Module
Handles document embeddings and vector database operations using FAISS.
Supports RAG (Retrieval Augmented Generation) for the chatbot.
"""

import logging
import json
import os
import re
import hashlib
from pathlib import Path
from typing import List, Dict, Tuple, Optional
import numpy as np
from datetime import datetime

# Import vector DB and embeddings
try:
    from faiss import write_index, read_index
    import faiss
except ImportError:
    faiss = None
    logging.warning("FAISS not installed. Install with: pip install faiss-cpu")

try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    SentenceTransformer = None
    logging.warning("sentence-transformers not installed")

logger = logging.getLogger(__name__)

# Project root and data paths
PROJECT_ROOT = Path(__file__).parent.resolve()
VECTOR_DB_PATH = PROJECT_ROOT / "vector_db"
DOCUMENTS_PATH = Path(os.getenv("VECTOR_SOURCE_PATH", str(PROJECT_ROOT / "projects"))).resolve()
FAISS_INDEX_PATH = VECTOR_DB_PATH / "faiss_index.bin"
METADATA_PATH = VECTOR_DB_PATH / "metadata.json"

SKIP_DIR_NAMES = {
    '.git', '.svn', '.hg', 'node_modules', '__pycache__', '.idea', '.vscode',
    'dist', 'build', 'target', 'out', 'bin', '.mvn', '.gradle'
}

ALLOWED_TEXT_EXTENSIONS = {
    '.txt', '.md', '.rst', '.adoc', '.json', '.yaml', '.yml', '.xml', '.properties', '.ini', '.cfg',
    '.java', '.kt', '.groovy', '.scala', '.py', '.js', '.ts', '.tsx', '.jsx', '.html', '.htm', '.css', '.scss', '.less',
    '.sql', '.sh', '.ps1', '.bat', '.cmd', '.csv', '.env', '.jsp', '.vm', '.ftl', '.xsd', '.wsdl', '.graphql'
}

MAX_FILE_BYTES = int(os.getenv("VECTOR_MAX_FILE_BYTES", str(2 * 1024 * 1024)))

# Ensure vector DB directory exists
VECTOR_DB_PATH.mkdir(exist_ok=True)


def _is_truthy_env(name: str) -> bool:
    return str(os.getenv(name, "")).strip().lower() in {"1", "true", "yes", "on"}


class VectorEmbeddingsManager:
    """Manages document embeddings and vector database operations."""

    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        """
        Initialize the Vector Embeddings Manager.
        
        Args:
            model_name: HuggingFace model name for embeddings (lightweight by default)
        """
        self.model_name = model_name
        self.embedding_model = None
        self.embedding_mode = "hash"
        self.embedding_dimension = int(os.getenv("VECTOR_EMBED_DIM", "384"))
        self.faiss_index = None
        self.documents_metadata = []
        self._initialize_model()

    def _initialize_model(self) -> bool:
        """Initialize the embedding model."""
        try:
            if SentenceTransformer is None:
                logger.warning("sentence-transformers not installed; using hash-based embedding fallback")
                self.embedding_mode = "hash"
                return True
            
            logger.info(f"Loading embedding model: {self.model_name}")
            self.embedding_model = SentenceTransformer(self.model_name)
            logger.info("Embedding model loaded successfully")
            self.embedding_mode = "sentence-transformers"
            return True
        except Exception as e:
            logger.warning(f"Error initializing embedding model ({str(e)}); using hash-based embedding fallback")
            self.embedding_mode = "hash"
            self.embedding_model = None
            return True

    def _hash_embed_text(self, text: str) -> np.ndarray:
        """Lightweight deterministic embedding when sentence-transformers is unavailable."""
        dim = max(32, self.embedding_dimension)
        vec = np.zeros(dim, dtype=np.float32)
        tokens = re.findall(r"[a-zA-Z0-9_]+", (text or "").lower())
        if not tokens:
            return vec
        for token in tokens:
            h = int(hashlib.md5(token.encode("utf-8")).hexdigest(), 16)
            idx = h % dim
            sign = 1.0 if ((h >> 1) & 1) == 0 else -1.0
            vec[idx] += sign
        norm = np.linalg.norm(vec)
        if norm > 0:
            vec = vec / norm
        return vec

    def load_documents_from_projects(self) -> List[Dict[str, str]]:
        """
        Load all documents from the projects folder.
        Supports .txt, .json, and other text-based files.
        
        Returns:
            List of documents with content and metadata
        """
        documents = []
        
        try:
            if not DOCUMENTS_PATH.exists():
                logger.warning(f"Documents path not found: {DOCUMENTS_PATH}")
                return documents
            
            # Walk through project directories
            for root, dirs, files in os.walk(DOCUMENTS_PATH):
                dirs[:] = [d for d in dirs if d not in SKIP_DIR_NAMES and not d.startswith('.')]
                for file in files:
                    file_path = Path(root) / file
                    
                    # Skip certain file types
                    if file.startswith('.') or file.endswith('.pyc'):
                        continue
                    if file_path.suffix.lower() not in ALLOWED_TEXT_EXTENSIONS:
                        continue
                    try:
                        if file_path.stat().st_size > MAX_FILE_BYTES:
                            continue
                    except Exception:
                        continue
                    
                    try:
                        content = self._read_file_content(file_path)
                        if content and len(content.strip()) > 20:  # Skip very short files
                            relative_path = file_path.relative_to(DOCUMENTS_PATH)
                            doc = {
                                "content": content,
                                "file_path": str(relative_path),
                                "full_path": str(file_path),
                                "file_name": file,
                                "file_type": file_path.suffix,
                                "loaded_at": datetime.now().isoformat()
                            }
                            documents.append(doc)
                            logger.info(f"Loaded document: {relative_path}")
                    except Exception as e:
                        logger.warning(f"Could not load {file_path}: {str(e)}")
                        continue
            
            logger.info(f"Total documents loaded: {len(documents)}")
            return documents
            
        except Exception as e:
            logger.error(f"Error loading documents: {str(e)}")
            return documents

    def _read_file_content(self, file_path: Path) -> Optional[str]:
        """Read content from various file types."""
        try:
            if file_path.suffix.lower() not in ALLOWED_TEXT_EXTENSIONS:
                return None
            # Text files
            if file_path.suffix in ['.txt', '.md']:
                with open(file_path, 'r', encoding='utf-8') as f:
                    return f.read()
            
            # JSON files
            elif file_path.suffix == '.json':
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    return json.dumps(data, indent=2)
            
            # CSV files
            elif file_path.suffix == '.csv':
                with open(file_path, 'r', encoding='utf-8') as f:
                    return f.read()
            
            else:
                # Try to read as text
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    return f.read()
                    
        except Exception as e:
            logger.warning(f"Could not read {file_path}: {str(e)}")
            return None

    def chunk_documents(self, documents: List[Dict], chunk_size: int = 500, overlap: int = 100) -> List[Dict]:
        """
        Split documents into chunks for better embedding quality.
        
        Args:
            documents: List of documents
            chunk_size: Size of each chunk in characters
            overlap: Overlap between chunks
            
        Returns:
            List of chunks with metadata
        """
        chunks = []
        chunk_id = 0
        
        for doc in documents:
            content = doc['content']
            file_path = doc['file_path']
            
            # Split content into chunks
            for i in range(0, len(content), chunk_size - overlap):
                chunk_text = content[i:i + chunk_size]
                
                if len(chunk_text.strip()) > 20:  # Only keep meaningful chunks
                    chunks.append({
                        "chunk_id": chunk_id,
                        "content": chunk_text,
                        "file_path": file_path,
                        "file_name": doc['file_name'],
                        "file_type": doc['file_type'],
                        "chunk_index": i // (chunk_size - overlap),
                        "source_doc": doc
                    })
                    chunk_id += 1
        
        logger.info(f"Created {len(chunks)} chunks from {len(documents)} documents")
        return chunks

    def create_embeddings(self, texts: List[str]) -> np.ndarray:
        """
        Create embeddings for a list of texts.
        
        Args:
            texts: List of text strings
            
        Returns:
            Numpy array of embeddings
        """
        try:
            if self.embedding_model is not None:
                embeddings = self.embedding_model.encode(texts, show_progress_bar=True)
                return embeddings
            # Fallback embeddings
            return np.vstack([self._hash_embed_text(t) for t in texts]).astype(np.float32)
        except Exception as e:
            logger.error(f"Error creating embeddings: {str(e)}")
            return None

    def build_faiss_index(self, chunks: List[Dict]) -> bool:
        """
        Build FAISS index from document chunks.
        
        Args:
            chunks: List of document chunks
            
        Returns:
            True if successful
        """
        try:
            logger.info(f"Building FAISS index from {len(chunks)} chunks...")
            
            # Extract texts
            texts = [chunk['content'] for chunk in chunks]
            
            # Create embeddings
            embeddings = self.create_embeddings(texts)
            if embeddings is None:
                return False
            
            # Create FAISS index
            dimension = embeddings.shape[1]
            self.faiss_index = faiss.IndexFlatL2(dimension)
            self.faiss_index.add(embeddings.astype(np.float32))
            
            # Save index
            faiss.write_index(self.faiss_index, str(FAISS_INDEX_PATH))
            logger.info(f"FAISS index saved to {FAISS_INDEX_PATH}")
            
            # Save metadata
            self.documents_metadata = chunks
            self._save_metadata(chunks)
            
            logger.info(f"FAISS index built successfully with {self.faiss_index.ntotal} vectors")
            return True
            
        except Exception as e:
            logger.error(f"Error building FAISS index: {str(e)}")
            return False

    def _save_metadata(self, chunks: List[Dict]) -> None:
        """Save metadata to JSON file."""
        try:
            metadata = []
            for chunk in chunks:
                metadata.append({
                    "chunk_id": chunk['chunk_id'],
                    "file_path": chunk['file_path'],
                    "file_name": chunk['file_name'],
                    "file_type": chunk['file_type'],
                    "chunk_index": chunk['chunk_index'],
                    # Store chunk text to make retrieval/pull operations simpler.
                    "content": chunk.get('content', "")
                })
            
            with open(METADATA_PATH, 'w') as f:
                json.dump(metadata, f, indent=2)
            
            logger.info(f"Metadata saved to {METADATA_PATH}")
        except Exception as e:
            logger.error(f"Error saving metadata: {str(e)}")

    def load_index(self) -> bool:
        """Load existing FAISS index from disk."""
        try:
            if not FAISS_INDEX_PATH.exists():
                logger.warning(f"FAISS index not found at {FAISS_INDEX_PATH}")
                return False
            
            self.faiss_index = faiss.read_index(str(FAISS_INDEX_PATH))
            
            # Load metadata
            if METADATA_PATH.exists():
                with open(METADATA_PATH, 'r') as f:
                    self.documents_metadata = json.load(f)
            
            logger.info(f"Loaded FAISS index with {self.faiss_index.ntotal} vectors")
            return True
            
        except Exception as e:
            logger.error(f"Error loading FAISS index: {str(e)}")
            return False

    def retrieve_relevant_documents(self, query: str, top_k: int = 5) -> List[Dict]:
        """
        Retrieve relevant documents for a query.
        
        Args:
            query: The search query
            top_k: Number of top results to return
            
        Returns:
            List of relevant document chunks
        """
        if self.faiss_index is None:
            logger.error("FAISS index not initialized")
            return []
        
        try:
            # Create query embedding
            if self.embedding_model is not None:
                query_embedding = self.embedding_model.encode([query])[0]
            else:
                query_embedding = self._hash_embed_text(query)
            
            # Search in FAISS
            distances, indices = self.faiss_index.search(
                query_embedding.reshape(1, -1).astype(np.float32),
                min(top_k, self.faiss_index.ntotal)
            )
            
            # Retrieve results
            results = []
            for i, idx in enumerate(indices[0]):
                if idx < len(self.documents_metadata):
                    metadata = self.documents_metadata[int(idx)]
                    # Re-read the actual content if needed
                    results.append({
                        "chunk_id": metadata.get('chunk_id'),
                        "file_path": metadata.get('file_path'),
                        "file_name": metadata.get('file_name'),
                        "file_type": metadata.get('file_type'),
                        "distance": float(distances[0][i]),
                        "relevance_score": 1 / (1 + float(distances[0][i]))  # Convert distance to score
                    })
            
            logger.info(f"Retrieved {len(results)} documents for query: {query}")
            return results
            
        except Exception as e:
            logger.error(f"Error retrieving documents: {str(e)}")
            return []

    def initialize_embeddings(self) -> bool:
        """
        Initialize embeddings by loading documents and building the index.
        This is called during application startup.
        
        Returns:
            True if initialization successful
        """
        try:
            logger.info("Starting embeddings initialization...")
            logger.info(f"Embedding source path: {DOCUMENTS_PATH}")
            force_rebuild = _is_truthy_env("VECTOR_FORCE_REBUILD")
            
            # Try to load existing index unless forced to rebuild.
            if not force_rebuild and self.load_index():
                logger.info("Using existing FAISS index")
                return True
            if force_rebuild:
                logger.info("VECTOR_FORCE_REBUILD is enabled; rebuilding index from source documents")
            
            # Build new index
            logger.info("Building new FAISS index...")
            documents = self.load_documents_from_projects()
            
            if not documents:
                logger.warning("No documents found to embed")
                return False
            
            chunks = self.chunk_documents(documents)
            
            if not chunks:
                logger.warning("No chunks created from documents")
                return False
            
            return self.build_faiss_index(chunks)
            
        except Exception as e:
            logger.error(f"Error initializing embeddings: {str(e)}")
            return False


# Global instance
_embeddings_manager = None


def get_embeddings_manager() -> Optional[VectorEmbeddingsManager]:
    """Get or create the global embeddings manager instance."""
    global _embeddings_manager
    if _embeddings_manager is None:
        _embeddings_manager = VectorEmbeddingsManager()
    return _embeddings_manager


def initialize_embeddings() -> bool:
    """Initialize embeddings for the application."""
    manager = get_embeddings_manager()
    if manager:
        return manager.initialize_embeddings()
    return False
