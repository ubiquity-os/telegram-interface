/**
 * Message Pre-Processor types and interfaces
 */

import {
  MessageAnalysis,
  ConversationContext
} from '../../interfaces/message-types.ts';

// Re-export for convenience
export type {
  MessageAnalysis,
  ConversationContext
};

/**
 * Analysis cache entry
 */
export interface AnalysisCacheEntry {
  messageHash: string;
  analysis: MessageAnalysis;
  timestamp: Date;
  hitCount: number;
}

/**
 * Message pre-processor configuration
 */
export interface MessagePreProcessorConfig {
  model: string;
  maxCacheSize: number;
  cacheExpiryMs: number;
  analysisTimeout: number;
  enableCaching: boolean;
  debugMode: boolean;
}

/**
 * Intent classification prompt template
 */
export interface IntentClassificationPrompt {
  systemPrompt: string;
  examples: IntentExample[];
  outputFormat: string;
}

/**
 * Intent classification example
 */
export interface IntentExample {
  input: string;
  output: MessageAnalysis;
  explanation?: string;
}

/**
 * Entity extraction configuration
 */
export interface EntityConfig {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean' | 'array';
  required: boolean;
  pattern?: string;
  description: string;
}

/**
 * Analysis metrics for monitoring
 */
export interface AnalysisMetrics {
  totalAnalyses: number;
  averageAnalysisTime: number;
  cacheHitRate: number;
  intentDistribution: Record<string, number>;
  confidenceDistribution: {
    high: number; // > 0.8
    medium: number; // 0.5 - 0.8
    low: number; // < 0.5
  };
}

/**
 * Tool suggestion context
 */
export interface ToolSuggestionContext {
  availableTools: string[];
  userHistory: string[];
  conversationContext: ConversationContext;
  messageContent: string;
}