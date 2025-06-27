/**
 * Types for Message Pre-Processor component
 */

import { ComponentStatus, IComponent } from '../../interfaces/component-interfaces.ts';
import { MessageAnalysis, ConversationContext } from '../../interfaces/message-types.ts';

/**
 * Configuration for Message Pre-Processor
 */
export interface MessagePreProcessorConfig {
  /**
   * Maximum cache size for analysis results
   */
  maxCacheSize: number;

  /**
   * Cache TTL in milliseconds
   */
  cacheTTL: number;

  /**
   * Model to use for analysis (optional, uses LLM service default if not specified)
   */
  analysisModel?: string;

  /**
   * Temperature for analysis (0.0 - 1.0)
   */
  temperature: number;

  /**
   * Enable verbose logging
   */
  verbose: boolean;

  /**
   * Confidence threshold for intent detection
   */
  confidenceThreshold: number;

  /**
   * Skip LLM service test during initialization (for development/testing)
   */
  skipLLMTest?: boolean;
}

/**
 * Cache entry for message analysis
 */
export interface CacheEntry {
  analysis: MessageAnalysis;
  timestamp: number;
  messageHash: string;
}

/**
 * Extended message analysis with internal metadata
 */
export interface ExtendedMessageAnalysis extends MessageAnalysis {
  /**
   * Raw LLM response
   */
  rawResponse?: string;

  /**
   * Processing time in milliseconds
   */
  processingTime: number;

  /**
   * Model used for analysis
   */
  model?: string;

  /**
   * Message hash for caching
   */
  messageHash: string;
}

/**
 * Intent details with sub-categories
 */
export interface IntentDetails {
  primary: 'question' | 'command' | 'tool_request' | 'conversation';
  subcategory?: string;
  indicators: string[];
}

/**
 * Entity extraction result
 */
export interface ExtractedEntity {
  type: string;
  value: any;
  confidence: number;
  position?: {
    start: number;
    end: number;
  };
}

/**
 * Tool suggestion with confidence
 */
export interface ToolSuggestion {
  toolId: string;
  serverId: string;
  confidence: number;
  reason: string;
}

/**
 * Analysis prompt context
 */
export interface AnalysisPromptContext {
  message: string;
  conversationHistory?: ConversationContext;
  availableTools?: string[];
  userPreferences?: Record<string, any>;
}

/**
 * LLM response structure for message analysis
 */
export interface LLMAnalysisResponse {
  intent: IntentDetails;
  entities: ExtractedEntity[];
  suggestedTools: ToolSuggestion[];
  requiresContext: boolean;
  confidence: number;
  reasoning?: string;
}

/**
 * Message Pre-Processor statistics
 */
export interface PreProcessorStats {
  totalAnalyzed: number;
  cacheHits: number;
  cacheMisses: number;
  averageProcessingTime: number;
  intentDistribution: Record<string, number>;
  errorCount: number;
}

/**
 * ILLMService interface for dependency injection
 */
export interface ILLMService {
  getAiResponse(params: {
    messages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
    }>;
  }): Promise<string>;
}