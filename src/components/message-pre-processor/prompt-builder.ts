/**
 * Prompt builder for Message Pre-Processor
 *
 * Constructs structured prompts for LLM analysis to ensure
 * consistent and accurate message analysis
 */

import { AnalysisPromptContext, LLMAnalysisResponse } from './types.ts';
import { ConversationContext } from '../../interfaces/message-types.ts';

export class PromptBuilder {
  /**
   * Build the system prompt for message analysis
   */
  static buildSystemPrompt(): string {
    return `You are a message analysis expert for a chatbot. Your task is to analyze incoming messages and extract structured information.

You must respond with a JSON object matching this exact structure:
{
  "intent": {
    "primary": "question" | "command" | "tool_request" | "conversation",
    "subcategory": string (optional),
    "indicators": [string array of key phrases/patterns that led to this classification]
  },
  "entities": [
    {
      "type": string (e.g., "location", "time", "person", "number", "tool_name"),
      "value": any,
      "confidence": number (0.0-1.0),
      "position": { "start": number, "end": number } (optional)
    }
  ],
  "suggestedTools": [
    {
      "toolId": string,
      "serverId": string,
      "confidence": number (0.0-1.0),
      "reason": string
    }
  ],
  "requiresContext": boolean,
  "confidence": number (0.0-1.0),
  "reasoning": string (brief explanation of the analysis)
}

Intent Classifications:
- "question": User is asking for information or clarification
- "command": User is giving a direct instruction or request for action
- "tool_request": User explicitly or implicitly wants to use a specific tool/service
- "conversation": General chat, greetings, or social interaction

Entity Types to Extract:
- location: Geographic locations, addresses, places
- time: Dates, times, durations, temporal references
- person: Names, usernames, references to people
- number: Quantities, amounts, numeric values
- tool_name: References to available tools or services
- url: Web addresses, links
- topic: Main subject or theme of the message

Tool Suggestions:
- Only suggest tools that are explicitly mentioned or strongly implied
- Include confidence scores based on how clearly the tool is referenced
- Provide reasoning for each suggestion

Context Requirements:
- Set requiresContext to true if the message references previous conversation
- Examples: "what about", "the same", "it", "that", pronouns without clear antecedents

Confidence Scoring:
- 1.0: Absolutely certain
- 0.8-0.9: Very confident
- 0.6-0.7: Moderately confident
- 0.4-0.5: Somewhat uncertain
- Below 0.4: Low confidence

IMPORTANT: Return ONLY valid JSON, no markdown formatting or additional text.`;
  }

  /**
   * Build the user prompt for message analysis
   */
  static buildUserPrompt(context: AnalysisPromptContext): string {
    let prompt = `Analyze this message:\n"${context.message}"`;

    // Add conversation history if available
    if (context.conversationHistory && context.conversationHistory.messages.length > 0) {
      prompt += '\n\nRecent conversation history:';
      const recentMessages = context.conversationHistory.messages.slice(-5); // Last 5 messages
      for (const msg of recentMessages) {
        const role = msg.metadata.source === 'telegram' ? 'User' : 'Bot';
        prompt += `\n${role}: ${msg.content}`;
      }
    }

    // Add available tools if provided
    if (context.availableTools && context.availableTools.length > 0) {
      prompt += '\n\nAvailable tools:';
      for (const tool of context.availableTools) {
        prompt += `\n- ${tool}`;
      }
    }

    // Add user preferences if provided
    if (context.userPreferences) {
      prompt += '\n\nUser preferences:';
      for (const [key, value] of Object.entries(context.userPreferences)) {
        prompt += `\n- ${key}: ${value}`;
      }
    }

    return prompt;
  }

  /**
   * Parse the LLM response into structured analysis
   */
  static parseAnalysisResponse(rawResponse: string): LLMAnalysisResponse {
    try {
      // Clean the response - remove any markdown formatting
      const cleanedResponse = rawResponse
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleanedResponse);

      // Validate required fields
      if (!parsed.intent || !parsed.intent.primary) {
        throw new Error('Missing required field: intent.primary');
      }

      if (!Array.isArray(parsed.entities)) {
        parsed.entities = [];
      }

      if (!Array.isArray(parsed.suggestedTools)) {
        parsed.suggestedTools = [];
      }

      if (typeof parsed.requiresContext !== 'boolean') {
        parsed.requiresContext = false;
      }

      if (typeof parsed.confidence !== 'number') {
        parsed.confidence = 0.5;
      }

      return parsed as LLMAnalysisResponse;
    } catch (error) {
      throw new Error(`Failed to parse LLM response: ${error.message}`);
    }
  }

  /**
   * Build a simple analysis for fallback (when LLM fails)
   */
  static buildFallbackAnalysis(message: string, context?: ConversationContext): LLMAnalysisResponse {
    // Simple heuristics for fallback
    const lowerMessage = message.toLowerCase();

    let intent: LLMAnalysisResponse['intent'] = {
      primary: 'conversation',
      indicators: []
    };

    // Check for questions
    if (lowerMessage.includes('?') ||
        lowerMessage.startsWith('what') ||
        lowerMessage.startsWith('who') ||
        lowerMessage.startsWith('when') ||
        lowerMessage.startsWith('where') ||
        lowerMessage.startsWith('why') ||
        lowerMessage.startsWith('how')) {
      intent.primary = 'question';
      intent.indicators = ['question mark or question word'];
    }

    // Check for commands
    const commandPatterns = ['/start', '/help', '/stop', 'please', 'can you', 'could you', 'would you'];
    if (commandPatterns.some(pattern => lowerMessage.includes(pattern))) {
      intent.primary = 'command';
      intent.indicators = ['command pattern detected'];
    }

    // Check for context-dependent questions using conversation history
    let requiresContext = false;
    if (context && context.messages.length > 0) {
      const contextualPatterns = [
        'what was', 'what did', 'my first', 'my last', 'earlier', 'before',
        'previous', 'that message', 'the message', 'what i said', 'what you said'
      ];

      if (contextualPatterns.some(pattern => lowerMessage.includes(pattern))) {
        requiresContext = true;
        intent.primary = 'question';
        intent.indicators.push('context-dependent question pattern');
      }
    }

    return {
      intent,
      entities: [],
      suggestedTools: [],
      requiresContext,
      confidence: 0.3,
      reasoning: `Fallback analysis using simple heuristics${context ? ' with conversation context' : ''}`
    };
  }

  /**
   * Extract message hash for caching
   */
  static generateMessageHash(message: string, context?: ConversationContext): string {
    // Simple hash combining message and recent context
    let hashInput = message;

    if (context && context.messages.length > 0) {
      // Include last 3 messages in hash for context-dependent analysis
      const recentMessages = context.messages.slice(-3).map(m => m.content).join('|');
      hashInput = `${message}|${recentMessages}`;
    }

    // Simple hash function (in production, use a proper hash like SHA-256)
    let hash = 0;
    for (let i = 0; i < hashInput.length; i++) {
      const char = hashInput.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return Math.abs(hash).toString(36);
  }
}