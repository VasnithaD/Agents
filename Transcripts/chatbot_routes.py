"""
Clean Chatbot Routes Module
Handles all chatbot endpoints with proper error handling.
"""

import json
import logging
from flask import request, jsonify, render_template
from datetime import datetime

logger = logging.getLogger(__name__)


def register_chatbot_routes(app):
    """Register all chatbot API endpoints with the Flask app."""
    
    # Note: The /chatbot page route is already defined in app.py
    # This module registers only the API endpoints
    
    @app.route('/api/chatbot/message', methods=['POST'])
    def chatbot_message():
        """Handle chatbot message requests."""
        try:
            data = request.get_json()
            
            if not data:
                return jsonify({"error": "No data provided"}), 400
            
            user_message = data.get('message', '').strip()
            
            if not user_message:
                return jsonify({"error": "Message cannot be empty"}), 400
            
            # Log the message
            logger.info(f"User message: {user_message}")
            
            # Get chatbot response
            from chatbot_ai import get_chatbot_response
            response = get_chatbot_response(user_message)
            
            return jsonify({
                "success": True,
                "response": response,
                "timestamp": datetime.now().isoformat()
            }), 200
            
        except Exception as e:
            logger.error(f"Error in chatbot message endpoint: {str(e)}", exc_info=True)
            return jsonify({
                "error": "Failed to process message",
                "details": str(e)
            }), 500
    
    
    @app.route('/api/chatbot/context', methods=['GET'])
    def chatbot_context():
        """Get chatbot context information."""
        try:
            from chatbot_ai import get_chatbot_context
            context = get_chatbot_context()
            
            return jsonify({
                "success": True,
                "context": context
            }), 200
            
        except Exception as e:
            logger.error(f"Error getting chatbot context: {str(e)}")
            return jsonify({
                "error": "Failed to get context",
                "details": str(e)
            }), 500
    
    
    @app.route('/api/chatbot/health', methods=['GET'])
    def chatbot_health():
        """Check chatbot health status."""
        try:
            from chatbot_ai import check_chatbot_health
            health = check_chatbot_health()
            
            return jsonify({
                "success": True,
                "status": health['status'],
                "details": health.get('details', {})
            }), 200
            
        except Exception as e:
            logger.error(f"Error checking chatbot health: {str(e)}")
            return jsonify({
                "success": False,
                "status": "error",
                "details": str(e)
            }), 500
    
    
    logger.info("Chatbot routes registered successfully")
