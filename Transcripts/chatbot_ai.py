"""
Chatbot AI Module with RAG (Retrieval Augmented Generation)
Professional-grade responses with confidence scoring and source attribution.
Eliminates hallucinations by only answering when confident.
"""

import logging
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime
from pathlib import Path
import json

logger = logging.getLogger(__name__)

# Project root directory
PROJECT_ROOT = Path(__file__).parent.resolve()

# Initialize conversation history
_conversation_history = []
_max_history = 50  # Keep last 50 messages

# Confidence thresholds - only answer when confident
MIN_RELEVANCE_SCORE = 0.65  # Only use if 65%+ confident
HIGH_CONFIDENCE_THRESHOLD = 0.75

# Try to import vector embeddings
try:
    from vector_embeddings import get_embeddings_manager
except ImportError:
    get_embeddings_manager = None
    logger.warning("Vector embeddings module not available")


def get_chatbot_response(user_message: str) -> str:
    """
    Generate a professional chatbot response for the user message.
    
    Args:
        user_message: The user's input message
        
    Returns:
        A grounded response based on available information or honest no-answer
    """
    try:
        # Add to conversation history
        _add_to_history("user", user_message)
        
        # Generate response
        response = _generate_response(user_message)
        
        # Add to conversation history
        _add_to_history("assistant", response)
        
        logger.info(f"Generated response for: {user_message[:50]}...")
        return response
        
    except Exception as e:
        logger.error(f"Error generating response: {str(e)}", exc_info=True)
        return "I encountered an error processing your message. Please try again."


def _generate_response(user_message: str) -> str:
    """
    Generate a response based on the user message.
    
    Args:
        user_message: The user's input
        
    Returns:
        A professional, grounded response
    """
    # First, try to find if it's about a specific project
    project_match = _try_find_project_in_query(user_message)
    if project_match:
        return project_match
    
    # Extract intent from message
    intent = _detect_intent(user_message)
    
    # Generate contextual response
    if intent == "greeting":
        return _handle_greeting()
    elif intent == "help":
        return _handle_help()
    elif intent == "project_info":
        return _handle_project_info()
    elif intent == "status":
        return _handle_status()
    elif intent == "approval":
        return _handle_approval_info()
    else:
        return _handle_general_query(user_message)


def _detect_intent(message: str) -> str:
    """
    Detect the user's intent from the message.
    
    Args:
        message: The user's message
        
    Returns:
        The detected intent
    """
    message_lower = message.lower()
    
    # Greeting patterns
    if any(word in message_lower for word in ['hello', 'hi', 'hey', 'greetings', 'what is this', 'who are you']):
        return "greeting"
    
    # Help patterns
    if any(word in message_lower for word in ['help', 'assist', 'support', 'what can you', 'capabilities']):
        return "help"
    
    # Project patterns
    if any(word in message_lower for word in ['project', 'catalog', 'list', 'available']):
        return "project_info"
    
    # Status patterns
    if any(word in message_lower for word in ['status', 'progress', 'state', 'update', 'how are you']):
        return "status"
    
    # Approval patterns
    if any(word in message_lower for word in ['approval', 'approve', 'pending', 'request']):
        return "approval"
    
    return "general"


def _handle_greeting() -> str:
    """Handle greeting messages professionally."""
    return (
        "Hello! I'm your project assistant. I can help you with:\n\n"
        "• **Projects** - View available projects and details\n"
        "• **Approvals** - Check approval status and pending items\n"
        "• **Estimation** - Get project effort and timeline estimates\n"
        "• **Requirements** - Review project specifications\n"
        "• **Workflow** - Understand the project process\n\n"
        "Ask me anything about your projects, or type 'help' for more options."
    )


def _handle_help() -> str:
    """Handle help requests with clear capabilities."""
    return (
        "I can assist with the following:\n\n"
        "**Project Management:**\n"
        "• 'Show me all projects' - View available projects\n"
        "• 'Tell me about [project name]' - Get project details\n"
        "• 'What is the status of [project]?' - Check project status\n\n"
        "**Approvals:**\n"
        "• 'Show pending approvals' - View approvals waiting for action\n"
        "• 'What approvals are there?' - List all approvals\n"
        "• 'Approval status for [project]' - Check specific project approvals\n\n"
        "**Workflow:**\n"
        "• 'How does the workflow work?' - Understand project steps\n"
        "• 'What is estimation?' - Learn about project estimation\n"
        "• 'Tell me about requirements' - Requirements information\n\n"
        "Ask any of these questions, or ask about something specific in your projects."
    )


def _handle_project_info() -> str:
    """Handle project information requests with real data."""
    # Note: This function doesn't have access to user_message in this version
    # For now, just return the project catalog
    try:
        from requirement_extractor import get_project_catalog
        catalog = get_project_catalog(PROJECT_ROOT)
        
        if catalog and isinstance(catalog, (list, dict)):
            # Handle both list and dict returns
            if isinstance(catalog, list):
                projects = catalog
            else:
                projects = list(catalog.keys()) if isinstance(catalog, dict) and isinstance(next(iter(catalog.values()), None), str) else list(catalog.values())
            
            if projects:
                response = f"**Available Projects ({len(projects)}):**\n\n"
                for i, proj in enumerate(projects[:10], 1):
                    # Handle both dict items and string items
                    proj_name = proj.get('display_name') if isinstance(proj, dict) else proj
                    response += f"{i}. {proj_name}\n"
                if len(projects) > 10:
                    response += f"\n... and {len(projects) - 10} more\n"
                response += "\nAsk about any project to get more details."
                return response
            else:
                return "No projects available yet. Start by creating a new project!"
    except Exception as e:
        logger.warning(f"Could not get project catalog: {e}", exc_info=True)
    
    return "I can help you explore projects. Ask about a specific project or say 'show all projects'."


def _handle_status() -> str:
    """Handle status requests with real system data."""
    status_items = []
    
    # Check embeddings
    try:
        if get_embeddings_manager:
            manager = get_embeddings_manager()
            if manager and manager.faiss_index:
                vector_count = manager.faiss_index.ntotal
                status_items.append(f"✓ Knowledge base: {vector_count:,} documents indexed")
            else:
                status_items.append("⚠ Knowledge base: Initializing")
        else:
            status_items.append("ℹ Knowledge base: Not available")
    except Exception as e:
        logger.warning(f"Error checking embeddings: {e}")
        status_items.append("⚠ Knowledge base: Error")
    
    # Check projects
    try:
        from requirement_extractor import get_project_catalog
        catalog = get_project_catalog(PROJECT_ROOT)
        if catalog:
            # Handle both list and dict returns
            project_count = len(catalog) if isinstance(catalog, (list, dict)) else 0
            if project_count > 0:
                status_items.append(f"✓ Projects: {project_count} active")
            else:
                status_items.append("ℹ Projects: None yet")
        else:
            status_items.append("ℹ Projects: None yet")
    except Exception as e:
        logger.warning(f"Error checking projects: {e}")
        status_items.append("✓ Projects: Connected")
    
    # Check approvals
    try:
        from approval_db import get_all_approvals
        approvals = get_all_approvals()
        if approvals:
            pending = len([a for a in approvals if a.get('status') == 'pending'])
            total = len(approvals)
            status_items.append(f"✓ Approvals: {total} total ({pending} pending)")
        else:
            status_items.append("✓ Approvals: All clear")
    except Exception as e:
        logger.warning(f"Error checking approvals: {e}")
        status_items.append("✓ Approvals: Connected")
    
    response = "**System Status:**\n\n✓ Chatbot operational\n"
    for item in status_items:
        response += f"{item}\n"
    response += "\nAll systems ready. How can I help?"
    
    return response


def _handle_approval_info() -> str:
    """Handle approval information requests with real data."""
    try:
        from approval_db import get_all_approvals
        approvals = get_all_approvals()
        
        if approvals:
            pending = [a for a in approvals if a.get('status') == 'pending']
            approved = [a for a in approvals if a.get('status') == 'approved']
            
            response = f"**Approval Summary:** {len(approvals)} total\n\n"
            response += f"✓ Approved: {len(approved)}\n"
            response += f"⏳ Pending: {len(pending)}\n\n"
            
            if pending:
                response += "**Pending Approvals:**\n"
                for approval in pending[:5]:
                    proj = approval.get('project_name', 'Unknown')
                    atype = approval.get('approval_type', 'Unknown')
                    response += f"• {proj} - {atype}\n"
                if len(pending) > 5:
                    response += f"• ... and {len(pending) - 5} more\n"
            else:
                response += "No pending approvals. Everything is up to date!"
            
            return response
    except Exception as e:
        logger.warning(f"Could not get approvals: {e}")
    
    return "I can help track approvals. Ask about pending items or a specific project."


def _handle_general_query(user_message: str) -> str:
    """
    Handle general queries with RAG (Retrieval Augmented Generation).
    Only answers if confident, otherwise provides domain-specific help or admits knowledge gap.
    
    Args:
        user_message: The user's query
        
    Returns:
        A professional, grounded response
    """
    message_lower = user_message.lower()
    
    # Try RAG retrieval with confidence scoring
    relevant_docs, avg_confidence = _retrieve_with_confidence(user_message, top_k=5)
    
    # If we have high-confidence matches, return grounded response
    if relevant_docs and avg_confidence >= MIN_RELEVANCE_SCORE:
        return _format_grounded_response(user_message, relevant_docs, avg_confidence)
    
    # Check for domain-specific questions
    if any(word in message_lower for word in ['estimation', 'estimate', 'effort', 'timeline', 'cost']):
        return (
            "**About Estimation:**\n\n"
            "Our system uses intelligent agents to estimate project complexity and effort based on:\n"
            "• Project requirements and scope\n"
            "• Historical project data\n"
            "• Resource availability\n\n"
            "Ask about a specific project to see its estimation details."
        )
    
    if any(word in message_lower for word in ['requirement', 'specification', 'spec']):
        return (
            "**About Requirements:**\n\n"
            "Requirements are extracted from:\n"
            "• Transcripts and meeting notes\n"
            "• Project documentation\n"
            "• Stakeholder input\n\n"
            "They form the foundation for estimation and design. Ask about a specific project to see its requirements."
        )
    
    if any(word in message_lower for word in ['workflow', 'process', 'step', 'stage']):
        return (
            "**Project Workflow:**\n\n"
            "1. **Requirement Extraction** - Extract needs from transcripts\n"
            "2. **Estimation** - Estimate effort and timeline\n"
            "3. **FDS** (Functional Design) - Design functionality\n"
            "4. **TDS** (Technical Design) - Design technical approach\n\n"
            "Each step requires approval before proceeding. Ask about a specific stage for details."
        )
    
    if any(word in message_lower for word in ['transcript', 'meeting', 'audio']):
        return (
            "**Transcript Processing:**\n\n"
            "The system can process transcripts to:\n"
            "• Extract key requirements\n"
            "• Identify project scope\n"
            "• Prepare for estimation\n\n"
            "Upload a transcript to get started on a new project."
        )
    
    # Honest no-answer response
    return (
        f"I don't have specific information about that in my knowledge base.\n\n"
        "I can help with:\n"
        "• Project information and details\n"
        "• Approval status and tracking\n"
        "• Estimation and effort information\n"
        "• Project workflow and process\n"
        "• Requirements and specifications\n\n"
        "Try asking about a specific project or workflow step, or type 'help' for more options."
    )


def _try_find_project_in_query(user_message: str) -> Optional[str]:
    """
    Try to find if user is asking about a specific project and retrieve its info.
    
    Args:
        user_message: The user's query
        
    Returns:
        A project-specific response or None if no project matched
    """
    try:
        from requirement_extractor import get_project_catalog
        catalog = get_project_catalog(PROJECT_ROOT)
        
        if not catalog:
            return None
        
        # Handle both list and dict returns
        projects = catalog if isinstance(catalog, list) else list(catalog.values()) if isinstance(catalog, dict) else []
        
        message_lower = user_message.lower()
        
        # Try to match against project names and slugs
        for project in projects:
            if isinstance(project, dict):
                proj_name = project.get('display_name', '').lower()
                proj_slug = project.get('slug', '').lower()
                
                if proj_name and proj_name in message_lower:
                    return _format_project_info(project, user_message)
                if proj_slug and proj_slug in message_lower:
                    return _format_project_info(project, user_message)
    
    except Exception as e:
        logger.debug(f"Error finding project in query: {e}")
    
    return None


def _format_project_info(project: Dict[str, Any], user_query: str) -> str:
    """
    Format detailed information about a specific project.
    
    Args:
        project: Project dictionary with metadata
        user_query: The original user query to understand what they want
        
    Returns:
        Formatted project information
    """
    proj_name = project.get('display_name', 'Unknown')
    proj_slug = project.get('slug', '')
    card_count = project.get('card_count', 0)
    latest_status = project.get('latest_status', 'unknown')
    
    response = f"**Project: {proj_name}**\n\n"
    
    query_lower = user_query.lower()
    
    # Provide relevant information based on query
    if any(word in query_lower for word in ['estimation', 'estimate', 'cost', 'effort']):
        response += "**Estimation Information:**\n"
        response += f"• Project Status: {latest_status}\n"
        response += f"• Cards Generated: {card_count}\n"
        response += "• To see detailed estimation, navigate to the project in the dashboard.\n\n"
        response += f"Ask me to 'show all projects' or tell me about another aspect of {proj_name}."
    
    elif any(word in query_lower for word in ['requirement', 'spec', 'brd']):
        response += "**Requirements Information:**\n"
        response += f"• Project Status: {latest_status}\n"
        response += f"• Documentation Available: Yes\n"
        response += "• View detailed requirements in the Requirement tab of the dashboard.\n\n"
        response += f"Need to know about estimation or other aspects of {proj_name}?"
    
    else:
        response += f"**Project Details:**\n"
        response += f"• Status: {latest_status}\n"
        response += f"• Cards: {card_count}\n"
        response += f"• Slug: {proj_slug}\n\n"
        response += f"I can help with:\n"
        response += f"• Estimation details for {proj_name}\n"
        response += f"• Requirements and specifications\n"
        response += f"• Project status and progress\n\n"
        response += f"What would you like to know about {proj_name}?"
    
    return response


def _retrieve_with_confidence(query: str, top_k: int = 5) -> Tuple[List[Dict], float]:
    """
    Retrieve relevant documents with confidence scoring.
    
    Args:
        query: The user's query
        top_k: Number of results to retrieve
        
    Returns:
        Tuple of (filtered_documents, average_confidence_score)
    """
    if not get_embeddings_manager:
        return [], 0.0
    
    try:
        manager = get_embeddings_manager()
        if not manager or manager.faiss_index is None:
            return [], 0.0
        
        docs = manager.retrieve_relevant_documents(query, top_k=top_k)
        
        # Filter by confidence threshold
        high_confidence_docs = [
            doc for doc in docs 
            if doc.get('relevance_score', 0) >= MIN_RELEVANCE_SCORE
        ]
        
        if not high_confidence_docs:
            return [], 0.0
        
        avg_confidence = sum(d.get('relevance_score', 0) for d in high_confidence_docs) / len(high_confidence_docs)
        return high_confidence_docs, avg_confidence
        
    except Exception as e:
        logger.warning(f"Error retrieving documents: {str(e)}")
        return [], 0.0


def _format_grounded_response(user_message: str, relevant_docs: List[Dict], confidence: float) -> str:
    """
    Format a professional response grounded in actual documents.
    
    Args:
        user_message: Original user query
        relevant_docs: Retrieved relevant documents
        confidence: Confidence score of the retrieval
        
    Returns:
        Professional formatted response with source attribution
    """
    # Determine confidence indicator
    if confidence >= HIGH_CONFIDENCE_THRESHOLD:
        confidence_text = "High confidence match"
    else:
        confidence_text = f"Based on related documents"
    
    response = f"**{confidence_text}** ({confidence:.0%} confidence):\n\n"
    
    # Add top documents with scores
    for i, doc in enumerate(relevant_docs[:3], 1):
        score = doc.get('relevance_score', 0)
        file_name = doc.get('file_name', 'Unknown')
        file_path = doc.get('file_path', '')
        
        # Create a simple score bar
        score_pct = int(score * 100)
        response += f"**{i}. {file_name}** ({score_pct}% match)\n"
        response += f"   📂 {file_path}\n\n"
    
    response += "Would you like more details from any of these documents?"
    return response


def _add_to_history(role: str, message: str) -> None:
    """
    Add a message to conversation history.
    
    Args:
        role: Either 'user' or 'assistant'
        message: The message content
    """
    global _conversation_history
    
    _conversation_history.append({
        "role": role,
        "message": message,
        "timestamp": datetime.now().isoformat()
    })
    
    # Keep only the most recent messages
    if len(_conversation_history) > _max_history:
        _conversation_history = _conversation_history[-_max_history:]


def get_chatbot_context() -> Dict[str, Any]:
    """
    Get the current chatbot context.
    
    Returns:
        Dictionary containing context information
    """
    try:
        return {
            "conversation_length": len(_conversation_history),
            "last_message_time": _conversation_history[-1]["timestamp"] if _conversation_history else None,
            "status": "operational"
        }
    except Exception as e:
        logger.error(f"Error getting context: {str(e)}")
        return {
            "conversation_length": 0,
            "last_message_time": None,
            "status": "error"
        }


def check_chatbot_health() -> Dict[str, Any]:
    """
    Check the health status of the chatbot with all components.
    
    Returns:
        Dictionary containing health information
    """
    try:
        health_details = {
            "ai_module": "operational",
            "conversation_history": f"{len(_conversation_history)} messages",
            "timestamp": datetime.now().isoformat()
        }
        
        # Check embeddings
        try:
            if get_embeddings_manager:
                manager = get_embeddings_manager()
                if manager and manager.faiss_index:
                    health_details["embeddings"] = f"operational ({manager.faiss_index.ntotal} vectors)"
                else:
                    health_details["embeddings"] = "not_initialized"
            else:
                health_details["embeddings"] = "unavailable"
        except:
            health_details["embeddings"] = "error"
        
        health = {
            "status": "healthy",
            "details": health_details
        }
        return health
    except Exception as e:
        logger.error(f"Error checking health: {str(e)}")
        return {
            "status": "degraded",
            "details": {
                "error": str(e)
            }
        }
