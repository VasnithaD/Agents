#!/usr/bin/env python
"""
Initialize Vector Embeddings for Chatbot
This script loads all project documents and creates vector embeddings for RAG.

Usage:
    python init_embeddings.py

This should be run once before starting the Flask application, or can be scheduled
to run periodically to update the embeddings with new documents.
"""

import sys
import logging
from pathlib import Path

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)

# Add script dir to path
SCRIPT_DIR = Path(__file__).parent.resolve()
sys.path.insert(0, str(SCRIPT_DIR))

try:
    from vector_embeddings import initialize_embeddings, get_embeddings_manager
except ImportError as e:
    logger.error(f"Failed to import vector_embeddings module: {e}")
    logger.error("Make sure all dependencies are installed: pip install -r requirements.txt")
    sys.exit(1)


def main():
    """Main initialization function."""
    logger.info("=" * 60)
    logger.info("Vector Embeddings Initialization")
    logger.info("=" * 60)
    
    try:
        logger.info("Starting embeddings initialization...")
        
        # Initialize embeddings
        success = initialize_embeddings()
        
        if success:
            logger.info("\n✓ Embeddings initialized successfully!")
            logger.info("\nVector Database Summary:")
            logger.info("-" * 60)
            
            # Print statistics
            manager = get_embeddings_manager()
            if manager:
                if manager.faiss_index:
                    logger.info(f"  • Total vectors in index: {manager.faiss_index.ntotal}")
                    logger.info(f"  • Vector dimension: {manager.faiss_index.d}")
                
                if manager.documents_metadata:
                    logger.info(f"  • Total document chunks: {len(manager.documents_metadata)}")
                    
                    # Count unique files
                    unique_files = set()
                    for chunk in manager.documents_metadata:
                        if 'file_path' in chunk:
                            unique_files.add(chunk['file_path'])
                    logger.info(f"  • Unique source files: {len(unique_files)}")
                    
                    # List some files
                    if unique_files:
                        logger.info("\n  Sample indexed files:")
                        for file_path in sorted(list(unique_files))[:5]:
                            logger.info(f"    - {file_path}")
                        if len(unique_files) > 5:
                            logger.info(f"    ... and {len(unique_files) - 5} more")
            
            logger.info("-" * 60)
            logger.info("\n✓ The chatbot is now ready to answer questions about your projects!")
            logger.info("✓ Documents have been indexed and are ready for RAG queries.")
            return 0
            
        else:
            logger.error("\n✗ Failed to initialize embeddings")
            logger.error("Please check the error messages above and ensure:")
            logger.error("  • All required dependencies are installed")
            logger.error("  • Project documents exist in the 'projects' directory")
            logger.error("  • You have sufficient disk space")
            return 1
            
    except Exception as e:
        logger.error(f"\n✗ Unexpected error during initialization: {e}", exc_info=True)
        return 1
    finally:
        logger.info("=" * 60)


if __name__ == "__main__":
    sys.exit(main())
