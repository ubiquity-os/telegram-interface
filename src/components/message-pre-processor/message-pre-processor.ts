/**
 * Message Pre-Processor Implementation
 *
 * Analyzes incoming messages to extract intent, entities, and routing information
 * using LLM-based analysis with caching for performance optimization
 */

import {
  IMessagePreProcessor,
  ComponentStatus
} from '../../interfaces/component-interfaces.ts';

import {
  ConversationContext,
  MessageAnalysis
} from '../../interfaces/message-types.ts';

import {
  MessagePreProcessorConfig,
  CacheEntry,
  ExtendedMessageAnalysis,
  PreProcessorStats,
  ILLMService,
  AnalysisPromptContext,
  LLMAnalysisResponse
} from './types.ts';

import { PromptBuilder } from './prompt-builder.ts';

// Import Event Bus
import {
  eventBus,
  SystemEventType,
  MessageAnalyzedEvent,
  ComponentInitializedEvent,
  ComponentErrorEvent,
  ErrorOccurredEvent,
  createEventEmitter
} from '../../services/event-bus/index.ts';

export class MessagePreProcessor implements IMessagePreProcessor {
  readonly name = 'MessagePreProcessor';

  private config: MessagePreProcessorConfig;
  private llmService: ILLMService;
  private cache: Map<string, CacheEntry>;
  private stats: PreProcessorStats;
  private isInitialized = false;
  private lastHealthCheck: Date;
  private eventEmitter = createEventEmitter('MessagePreProcessor');

  constructor(
    llmService: ILLMService,
    config?: Partial<MessagePreProcessorConfig>
  ) {
    this.llmService = llmService;
    this.config = {
      maxCacheSize: 100,
      cacheTTL: 3600000, // 1 hour
      temperature: 0.3,
      verbose: false,
      confidenceThreshold: 0.6,
      ...config
    };

    this.cache = new Map();
    this.stats = {
      totalAnalyzed: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageProcessingTime: 0,
      intentDistribution: {},
      errorCount: 0
    };
    this.lastHealthCheck = new Date();
  }

  /**
   * Initialize the Message Pre-Processor
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      throw new Error('MessagePreProcessor is already initialized');
    }

    try {
      // Test LLM service connectivity (skip if configured)
      if (!this.config.skipLLMTest) {
        await this.testLLMService();
      } else if (this.config.verbose) {
        console.log('[MessagePreProcessor] Skipping LLM service test (development mode)');
      }

      this.isInitialized = true;
      this.lastHealthCheck = new Date();

      // Emit component initialized event
      await this.eventEmitter.emit<ComponentInitializedEvent>({
        type: SystemEventType.COMPONENT_INITIALIZED,
        payload: {
          componentName: this.name,
          timestamp: new Date()
        }
      });

      if (this.config.verbose) {
        console.log('[MessagePreProcessor] Initialized successfully');
      }
    } catch (error) {
      throw new Error(`Failed to initialize MessagePreProcessor: ${error.message}`);
    }
  }

  /**
   * Shutdown the Message Pre-Processor
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    // Clear cache
    this.cache.clear();
    this.isInitialized = false;

    if (this.config.verbose) {
      console.log('[MessagePreProcessor] Shutdown complete');
    }
  }

  /**
   * Get component status
   */
  getStatus(): ComponentStatus {
    return {
      name: this.name,
      status: this.isInitialized ? 'healthy' : 'unhealthy',
      lastHealthCheck: this.lastHealthCheck,
      metadata: {
        cacheSize: this.cache.size,
        stats: this.stats,
        uptime: Date.now() - this.lastHealthCheck.getTime()
      }
    };
  }

  /**
   * Analyze a message to extract intent, entities, and routing information
   */
  async analyzeMessage(
    message: string,
    context?: ConversationContext
  ): Promise<MessageAnalysis> {
    if (!this.isInitialized) {
      throw new Error('MessagePreProcessor is not initialized');
    }

    const startTime = Date.now();

    try {
      // Generate message hash for caching
      const messageHash = PromptBuilder.generateMessageHash(message, context);

      // Check cache first
      const cached = await this.getCachedAnalysis(messageHash);
      if (cached) {
        this.stats.cacheHits++;
        if (this.config.verbose) {
          console.log('[MessagePreProcessor] Cache hit for message hash:', messageHash);
        }
        return cached;
      }

      this.stats.cacheMisses++;

      // Perform LLM analysis
      const analysis = await this.performLLMAnalysis(message, context);

      // Cache the result
      await this.cacheAnalysis(messageHash, analysis);

      // Update statistics
      this.updateStats(analysis, Date.now() - startTime);

      // Emit message analyzed event (note: we don't have the full message object here)
      // The SystemOrchestrator will emit the complete event with all required fields

      return analysis;

    } catch (error) {
      this.stats.errorCount++;
      console.error('[MessagePreProcessor] Analysis error:', error);

      // Check if this is an API authentication error
      if (error.message && error.message.includes('401')) {
        console.error('[MessagePreProcessor] AUTHENTICATION ERROR: OpenRouter API key invalid or missing');
        console.error('[MessagePreProcessor] Check OPENROUTER_API_KEY environment variable');
      } else if (error.message && error.message.includes('OpenRouter API error')) {
        console.error('[MessagePreProcessor] OpenRouter API Error:', error.message);
      } else {
        console.error('[MessagePreProcessor] LLM Service Error:', error.message);
      }

      // Emit component error event
      await this.eventEmitter.emit<ComponentErrorEvent>({
        type: SystemEventType.COMPONENT_ERROR,
        payload: {
          componentName: this.name,
          error: error as Error
        }
      });

      // Return fallback analysis with error context
      console.log('[MessagePreProcessor] Falling back to rule-based analysis due to LLM failure');
      const fallback = this.createFallbackAnalysis(message);
      // Add error metadata to fallback
      fallback.confidence = Math.max(fallback.confidence - 0.3, 0.1); // Reduce confidence due to error
      this.updateStats(fallback, Date.now() - startTime);
      return fallback;
    }
  }

  /**
   * Get cached analysis if available
   */
  async getCachedAnalysis(messageHash: string): Promise<MessageAnalysis | null> {
    const entry = this.cache.get(messageHash);

    if (!entry) {
      return null;
    }

    // Check if cache entry is expired
    if (Date.now() - entry.timestamp > this.config.cacheTTL) {
      this.cache.delete(messageHash);
      return null;
    }

    return entry.analysis;
  }

  /**
   * Cache analysis result
   */
  async cacheAnalysis(messageHash: string, analysis: MessageAnalysis): Promise<void> {
    // Enforce cache size limit
    if (this.cache.size >= this.config.maxCacheSize) {
      // Remove oldest entry
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(messageHash, {
      analysis,
      timestamp: Date.now(),
      messageHash
    });
  }

  /**
   * Perform LLM-based message analysis
   */
  private async performLLMAnalysis(
    message: string,
    context?: ConversationContext
  ): Promise<MessageAnalysis> {
    console.log(`[MessagePreProcessor] STARTING LLM ANALYSIS for message: "${message}"`);

    // Build prompts
    const systemPrompt = PromptBuilder.buildSystemPrompt();
    const userPrompt = PromptBuilder.buildUserPrompt({
      message,
      conversationHistory: context,
      // TODO: Pass available tools when integrated with tool manager
      availableTools: []
    });

    console.log(`[MessagePreProcessor] Built prompts - System: ${systemPrompt.substring(0, 100)}...`);
    console.log(`[MessagePreProcessor] Built prompts - User: ${userPrompt.substring(0, 100)}...`);

    // Call LLM service
    console.log(`[MessagePreProcessor] Calling LLM service...`);
    const response = await this.llmService.getAiResponse({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    });

    console.log(`[MessagePreProcessor] LLM service returned: "${response}"`);

    // Parse and validate response
    const llmAnalysis = PromptBuilder.parseAnalysisResponse(response);
    console.log(`[MessagePreProcessor] Parsed analysis:`, JSON.stringify(llmAnalysis, null, 2));

    // Convert to MessageAnalysis format
    const result = this.convertToMessageAnalysis(llmAnalysis);
    console.log(`[MessagePreProcessor] Final MessageAnalysis:`, JSON.stringify(result, null, 2));

    return result;
  }

  /**
   * Convert LLM analysis response to MessageAnalysis format
   */
  private convertToMessageAnalysis(llmAnalysis: LLMAnalysisResponse): MessageAnalysis {
    return {
      intent: llmAnalysis.intent.primary,
      entities: llmAnalysis.entities.reduce((acc, entity) => {
        acc[entity.type] = entity.value;
        return acc;
      }, {} as Record<string, any>),
      suggestedTools: llmAnalysis.suggestedTools.map(tool => tool.toolId),
      confidence: llmAnalysis.confidence,
      requiresContext: llmAnalysis.requiresContext
    };
  }

  /**
   * Create fallback analysis when LLM fails
   */
  private createFallbackAnalysis(message: string): MessageAnalysis {
    const fallback = PromptBuilder.buildFallbackAnalysis(message);
    return this.convertToMessageAnalysis(fallback);
  }

  /**
   * Update statistics
   */
  private updateStats(analysis: MessageAnalysis, processingTime: number): void {
    this.stats.totalAnalyzed++;

    // Update intent distribution
    this.stats.intentDistribution[analysis.intent] =
      (this.stats.intentDistribution[analysis.intent] || 0) + 1;

    // Update average processing time
    this.stats.averageProcessingTime =
      (this.stats.averageProcessingTime * (this.stats.totalAnalyzed - 1) + processingTime) /
      this.stats.totalAnalyzed;
  }

  /**
   * Test LLM service connectivity
   */
  private async testLLMService(): Promise<void> {
    try {
      const testResponse = await this.llmService.getAiResponse({
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Reply with "OK" if you receive this message.' }
        ]
      });

      if (!testResponse || testResponse.trim().length === 0) {
        throw new Error('LLM service returned empty response');
      }
    } catch (error) {
      const err = error as Error;
      throw new Error(`LLM service test failed: ${err.message}`);
    }
  }

  /**
   * Get pre-processor statistics
   */
  getStats(): PreProcessorStats {
    return { ...this.stats };
  }

  /**
   * Clear the analysis cache
   */
  clearCache(): void {
    this.cache.clear();
    if (this.config.verbose) {
      console.log('[MessagePreProcessor] Cache cleared');
    }
  }

  /**
   * Clean up expired cache entries
   */
  cleanupCache(): number {
    const now = Date.now();
    let removed = 0;

    for (const [hash, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.config.cacheTTL) {
        this.cache.delete(hash);
        removed++;
      }
    }

    if (this.config.verbose && removed > 0) {
      console.log(`[MessagePreProcessor] Removed ${removed} expired cache entries`);
    }

    return removed;
  }
}