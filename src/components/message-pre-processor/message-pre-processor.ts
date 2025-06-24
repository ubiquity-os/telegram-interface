/**
 * Message Pre-Processor implementation
 */

import { callOpenRouter } from '../../services/call-openrouter.ts';
import {
  MessagePreProcessorConfig,
  AnalysisCacheEntry,
  AnalysisMetrics,
  IntentClassificationPrompt
} from './types.ts';

import {
  IMessagePreProcessor,
  ComponentStatus
} from '../../interfaces/component-interfaces.ts';

import {
  MessageAnalysis,
  ConversationContext,
  InternalMessage
} from '../../interfaces/message-types.ts';

import { OpenRouterMessage } from '../../services/openrouter-types.ts';

/**
 * Analyzes incoming messages using LLM to understand intent and extract structured information
 */
export class MessagePreProcessor implements IMessagePreProcessor {
  public readonly name = 'MessagePreProcessor';

  private config: MessagePreProcessorConfig;
  private cache = new Map<string, AnalysisCacheEntry>();
  private metrics: AnalysisMetrics;
  private isInitialized = false;

  constructor(config?: Partial<MessagePreProcessorConfig>) {
    this.config = {
      model: 'anthropic/claude-3-haiku',
      maxCacheSize: 1000,
      cacheExpiryMs: 3600000, // 1 hour
      analysisTimeout: 10000, // 10 seconds
      enableCaching: true,
      debugMode: false,
      ...config
    };

    this.metrics = this.initializeMetrics();
  }

  /**
   * Initialize the Message Pre-Processor
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Initialize cache cleanup interval
    if (this.config.enableCaching) {
      setInterval(() => {
        this.cleanupExpiredCache();
      }, this.config.cacheExpiryMs / 2); // Clean up every 30 minutes if expiry is 1 hour
    }

    this.isInitialized = true;

    if (this.config.debugMode) {
      console.log('[MessagePreProcessor] Initialized successfully');
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

    if (this.config.debugMode) {
      console.log('[MessagePreProcessor] Shutdown completed');
    }
  }

  /**
   * Get component status
   */
  getStatus(): ComponentStatus {
    return {
      name: this.name,
      status: this.isInitialized ? 'healthy' : 'unhealthy',
      lastHealthCheck: new Date(),
      metadata: {
        cacheSize: this.cache.size,
        metrics: this.metrics,
        config: {
          model: this.config.model,
          cachingEnabled: this.config.enableCaching
        }
      }
    };
  }

  /**
   * Analyze message to extract intent, entities, and context
   */
  async analyzeMessage(
    message: string,
    context?: ConversationContext
  ): Promise<MessageAnalysis> {
    const startTime = Date.now();

    try {
      // Check cache first
      const messageHash = this.hashMessage(message);
      const cachedAnalysis = await this.getCachedAnalysis(messageHash);

      if (cachedAnalysis) {
        this.updateCacheHitMetrics();
        return cachedAnalysis;
      }

      // Perform LLM analysis
      const analysis = await this.performLLMAnalysis(message, context);

      // Cache the result
      if (this.config.enableCaching) {
        await this.cacheAnalysis(messageHash, analysis);
      }

      // Update metrics
      const duration = Date.now() - startTime;
      this.updateAnalysisMetrics(analysis, duration);

      return analysis;

    } catch (error) {
      if (this.config.debugMode) {
        console.error('[MessagePreProcessor] Analysis failed:', error);
      }

      // Return fallback analysis
      return this.createFallbackAnalysis(message);
    }
  }

  /**
   * Get cached analysis for a message hash
   */
  async getCachedAnalysis(messageHash: string): Promise<MessageAnalysis | null> {
    if (!this.config.enableCaching) {
      return null;
    }

    const cacheEntry = this.cache.get(messageHash);

    if (!cacheEntry) {
      return null;
    }

    // Check if cache entry is expired
    const isExpired = Date.now() - cacheEntry.timestamp.getTime() > this.config.cacheExpiryMs;

    if (isExpired) {
      this.cache.delete(messageHash);
      return null;
    }

    // Update hit count
    cacheEntry.hitCount++;

    return cacheEntry.analysis;
  }

  /**
   * Cache analysis result
   */
  async cacheAnalysis(messageHash: string, analysis: MessageAnalysis): Promise<void> {
    if (!this.config.enableCaching) {
      return;
    }

    // Check cache size limit
    if (this.cache.size >= this.config.maxCacheSize) {
      this.evictOldestCacheEntry();
    }

    const cacheEntry: AnalysisCacheEntry = {
      messageHash,
      analysis,
      timestamp: new Date(),
      hitCount: 0
    };

    this.cache.set(messageHash, cacheEntry);
  }

  /**
   * Get analysis metrics
   */
  getMetrics(): AnalysisMetrics {
    return { ...this.metrics };
  }

  /**
   * Clear all cached analyses
   */
  clearCache(): void {
    this.cache.clear();
    this.metrics.cacheHitRate = 0;
  }

  /**
   * Perform LLM-based message analysis
   */
  private async performLLMAnalysis(
    message: string,
    context?: ConversationContext
  ): Promise<MessageAnalysis> {
    const prompt = this.buildAnalysisPrompt(message, context);

    const messages: OpenRouterMessage[] = [
      {
        role: 'system',
        content: prompt.systemPrompt
      },
      {
        role: 'user',
        content: message
      }
    ];

    try {
      const response = await callOpenRouter(
        messages,
        this.config.model,
        this.config.analysisTimeout
      );

      return this.parseAnalysisResponse(response);

    } catch (error) {
      if (this.config.debugMode) {
        console.error('[MessagePreProcessor] LLM analysis failed:', error);
      }
      throw error;
    }
  }

  /**
   * Build analysis prompt for LLM
   */
  private buildAnalysisPrompt(message: string, context?: ConversationContext): IntentClassificationPrompt {
    const systemPrompt = `You are an expert message analyzer. Analyze the user's message and return a JSON object with the following structure:

{
  "intent": "question" | "command" | "tool_request" | "conversation",
  "entities": {},
  "suggestedTools": [],
  "confidence": 0.0-1.0,
  "requiresContext": boolean
}

Intent Guidelines:
- "question": User is asking for information or explanation
- "command": User wants to perform a specific action
- "tool_request": User explicitly mentions needing tools or external services
- "conversation": General conversational message

Entity Guidelines:
- Extract any relevant entities like dates, names, numbers, locations
- Use descriptive keys and appropriate values

Tool Suggestion Guidelines:
- Only suggest tools if the message clearly indicates a need for external services
- Common tool categories: search, calculation, weather, file_operations, communication

Confidence Guidelines:
- High (0.8-1.0): Very clear intent and entities
- Medium (0.5-0.8): Somewhat clear, minor ambiguity
- Low (0.0-0.5): Ambiguous or unclear intent

Context Guidelines:
- Set requiresContext to true if understanding requires conversation history
- Consider if the message references previous messages or ongoing topics

${context ? `\nConversation Context:\nPrevious messages: ${context.messages.slice(-3).map(m => `${m.content}`).join(', ')}` : ''}

Respond with ONLY the JSON object, no additional text.`;

    return {
      systemPrompt,
      examples: [], // Could add examples for few-shot learning
      outputFormat: 'json'
    };
  }

  /**
   * Parse LLM response into MessageAnalysis
   */
  private parseAnalysisResponse(response: string): MessageAnalysis {
    try {
      // Clean up response - remove any non-JSON content
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : response;

      const parsed = JSON.parse(jsonStr);

      // Validate required fields
      const analysis: MessageAnalysis = {
        intent: parsed.intent || 'conversation',
        entities: parsed.entities || {},
        suggestedTools: parsed.suggestedTools || [],
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
        requiresContext: Boolean(parsed.requiresContext)
      };

      return analysis;

    } catch (error) {
      if (this.config.debugMode) {
        console.error('[MessagePreProcessor] Failed to parse analysis response:', error);
        console.error('Response was:', response);
      }

      // Return basic analysis if parsing fails
      return {
        intent: 'conversation',
        entities: {},
        suggestedTools: [],
        confidence: 0.3,
        requiresContext: false
      };
    }
  }

  /**
   * Create fallback analysis when LLM analysis fails
   */
  private createFallbackAnalysis(message: string): MessageAnalysis {
    // Simple rule-based fallback
    let intent: MessageAnalysis['intent'] = 'conversation';
    const suggestedTools: string[] = [];

    // Basic intent detection
    if (message.includes('?') || message.toLowerCase().startsWith('what') ||
        message.toLowerCase().startsWith('how') || message.toLowerCase().startsWith('why')) {
      intent = 'question';
    } else if (message.toLowerCase().includes('please') ||
               message.toLowerCase().startsWith('can you') ||
               message.toLowerCase().includes('help me')) {
      intent = 'command';
    }

    // Basic tool suggestion
    if (message.toLowerCase().includes('weather')) {
      suggestedTools.push('weather');
    }
    if (message.toLowerCase().includes('search') || message.toLowerCase().includes('find')) {
      suggestedTools.push('search');
    }

    return {
      intent,
      entities: {},
      suggestedTools,
      confidence: 0.4, // Low confidence for fallback
      requiresContext: false
    };
  }

  /**
   * Generate hash for message (for caching)
   */
  private hashMessage(message: string): string {
    // Simple hash function - in production might want something more robust
    let hash = 0;
    for (let i = 0; i < message.length; i++) {
      const char = message.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupExpiredCache(): void {
    const cutoff = Date.now() - this.config.cacheExpiryMs;
    let cleaned = 0;

    for (const [hash, entry] of this.cache.entries()) {
      if (entry.timestamp.getTime() < cutoff) {
        this.cache.delete(hash);
        cleaned++;
      }
    }

    if (this.config.debugMode && cleaned > 0) {
      console.log(`[MessagePreProcessor] Cleaned up ${cleaned} expired cache entries`);
    }
  }

  /**
   * Evict oldest cache entry when at capacity
   */
  private evictOldestCacheEntry(): void {
    let oldestHash = '';
    let oldestTime = Date.now();

    for (const [hash, entry] of this.cache.entries()) {
      if (entry.timestamp.getTime() < oldestTime) {
        oldestTime = entry.timestamp.getTime();
        oldestHash = hash;
      }
    }

    if (oldestHash) {
      this.cache.delete(oldestHash);
    }
  }

  /**
   * Update metrics after cache hit
   */
  private updateCacheHitMetrics(): void {
    const totalRequests = this.metrics.totalAnalyses + 1;
    const cacheHits = Math.round(this.metrics.cacheHitRate * this.metrics.totalAnalyses) + 1;
    this.metrics.cacheHitRate = cacheHits / totalRequests;
  }

  /**
   * Update metrics after analysis
   */
  private updateAnalysisMetrics(analysis: MessageAnalysis, duration: number): void {
    this.metrics.totalAnalyses++;

    // Update average analysis time
    const total = this.metrics.averageAnalysisTime * (this.metrics.totalAnalyses - 1);
    this.metrics.averageAnalysisTime = (total + duration) / this.metrics.totalAnalyses;

    // Update intent distribution
    this.metrics.intentDistribution[analysis.intent] =
      (this.metrics.intentDistribution[analysis.intent] || 0) + 1;

    // Update confidence distribution
    if (analysis.confidence > 0.8) {
      this.metrics.confidenceDistribution.high++;
    } else if (analysis.confidence > 0.5) {
      this.metrics.confidenceDistribution.medium++;
    } else {
      this.metrics.confidenceDistribution.low++;
    }
  }

  /**
   * Initialize metrics object
   */
  private initializeMetrics(): AnalysisMetrics {
    return {
      totalAnalyses: 0,
      averageAnalysisTime: 0,
      cacheHitRate: 0,
      intentDistribution: {},
      confidenceDistribution: {
        high: 0,
        medium: 0,
        low: 0
      }
    };
  }
}