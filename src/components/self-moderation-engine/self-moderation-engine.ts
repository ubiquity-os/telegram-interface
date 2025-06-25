/**
 * Self-Moderation Engine Implementation
 *
 * Validates responses before sending to ensure quality and safety
 */

import { IComponent, ComponentStatus } from '../../interfaces/component-interfaces.ts';
import { GeneratedResponse, InternalMessage, MessageAnalysis } from '../../interfaces/message-types.ts';
import { ResponseContext } from '../../interfaces/component-interfaces.ts';
import { ToolResult } from '../mcp-tool-manager/types.ts';
import { EventBus } from '../../services/event-bus/event-bus.ts';
import { SystemEventType } from '../../services/event-bus/types.ts';
import {
  ISelfModerationEngine,
  ModerationResult,
  ModerationConfig,
  ModerationIssue,
  ModerationIssueType,
  ContentPolicy,
  TextAnalysis,
  ContentFlag,
  ModerationMetrics
} from './types.ts';

// Import rule modules
import { contentRules, sanitizeContent } from './rules/content-rules.ts';
import { qualityRules, improveResponseQuality } from './rules/quality-rules.ts';
import { safetyRules, makeSafeResponse } from './rules/safety-rules.ts';
import { toolRules } from './rules/tool-rules.ts';

/**
 * Default moderation configuration
 */
const DEFAULT_CONFIG: ModerationConfig = {
  confidenceThreshold: 0.7,
  severityThreshold: 'medium',
  contentPolicy: {
    allowPersonalInfo: false,
    allowExternalLinks: true,
    allowCodeExecution: false,
    maxResponseLength: 4000,
    requiredTone: 'formal',
    prohibitedPatterns: [],
    sensitiveTopics: []
  },
  enableContentFiltering: true,
  enableToneValidation: true,
  enableToolIntegrationCheck: true,
  enableRelevanceCheck: true,
  maxModerationTime: 5000
};

/**
 * Self-Moderation Engine implementation
 */
export class SelfModerationEngine implements ISelfModerationEngine, IComponent {
  public readonly name = 'SelfModerationEngine';
  private logger = console;
  private eventBus?: EventBus;

  private config: ModerationConfig = DEFAULT_CONFIG;
  private metrics: ModerationMetrics = {
    totalModerations: 0,
    approvalRate: 0,
    averageModerationTime: 0,
    commonIssueTypes: {} as Record<ModerationIssueType, number>,
    averageConfidence: 0
  };

  // Internal tracking for metric calculations
  private _totalApprovals = 0;
  private _totalModerationTime = 0;
  private _totalConfidence = 0;

  private isInitialized = false;

  /**
   * Initialize the component (IComponent interface - no parameters)
   */
  async initialize(): Promise<void> {
    this.isInitialized = true;
    this.logger.log('Self-Moderation Engine initialized');
  }

  /**
   * Initialize with configuration (ISelfModerationEngine interface)
   */
  async initializeWithConfig(config: ModerationConfig): Promise<void> {
    this.config = { ...DEFAULT_CONFIG, ...config };
    await this.initialize();
  }

  /**
   * Set event bus for event emissions
   */
  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus;
  }

  /**
   * Shutdown the component
   */
  async shutdown(): Promise<void> {
    this.isInitialized = false;
  }

  /**
   * Main moderation function
   */
  async moderateResponse(response: GeneratedResponse, context: ResponseContext): Promise<ModerationResult> {
    const startTime = Date.now();
    const requestId = response.metadata?.messageId || `mod-${Date.now()}`;

    // Emit moderation started event
    this.eventBus?.emit({
      id: `moderation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: SystemEventType.MODERATION_STARTED,
      timestamp: new Date(),
      source: 'SelfModerationEngine',
      payload: {
        response,
        requestId
      }
    });

    try {
      const allIssues: ModerationIssue[] = [];
      let moderatedResponse: GeneratedResponse | undefined;
      let confidence = 1.0;

      // Apply content rules
      if (this.config.enableContentFiltering) {
        for (const rule of contentRules) {
          if (rule.enabled) {
            const issues = await rule.check(response.content);
            if (issues.length > 0) {
              allIssues.push(...issues);
              confidence = Math.min(confidence, 0.8);
            }
          }
        }
      }

      // Apply quality rules
      for (const rule of qualityRules) {
        if (rule.enabled) {
          const issues = await rule.check(response, context);
          if (issues.length > 0) {
            allIssues.push(...issues);
            confidence = Math.min(confidence, 0.85);
          }
        }
      }

      // Apply safety rules
      for (const rule of safetyRules) {
        if (rule.enabled) {
          const issues = await rule.check(response, context);
          if (issues.length > 0) {
            allIssues.push(...issues);
            confidence = Math.min(confidence, 0.7);
          }
        }
      }

      // Apply tool rules
      if (this.config.enableToolIntegrationCheck && context.toolResults?.length) {
        for (const rule of toolRules) {
          if (rule.enabled) {
            const issues = await rule.check(response, context);
            if (issues.length > 0) {
              allIssues.push(...issues);
              confidence = Math.min(confidence, 0.75);
            }
          }
        }
      }

      // Determine approval based on severity and confidence
      const highSeverityIssues = allIssues.filter(issue => issue.severity === 'high');
      const mediumSeverityIssues = allIssues.filter(issue => issue.severity === 'medium');

      let approved = true;

      if (this.config.severityThreshold === 'high' && highSeverityIssues.length > 0) {
        approved = false;
      } else if (this.config.severityThreshold === 'medium' &&
                 (highSeverityIssues.length > 0 || mediumSeverityIssues.length > 0)) {
        approved = false;
      } else if (this.config.severityThreshold === 'low' && allIssues.length > 0) {
        approved = false;
      }

      if (confidence < this.config.confidenceThreshold) {
        approved = false;
      }

      // Apply modifications if needed
      if (!approved && allIssues.length > 0) {
        moderatedResponse = await this.createModeratedResponse(response, allIssues, context);
      }

      const moderationTime = Date.now() - startTime;

      // Update metrics
      this.updateMetrics(approved, moderationTime, confidence, allIssues);

      const result: ModerationResult = {
        approved,
        issues: allIssues.length > 0 ? allIssues : undefined,
        suggestions: allIssues.length > 0 ? this.suggestImprovements(allIssues) : undefined,
        confidence,
        moderationTime,
        moderatedResponse
      };

      // Emit appropriate event based on result
      if (approved) {
        this.eventBus?.emit({
          id: `moderation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: SystemEventType.MODERATION_APPROVED,
          timestamp: new Date(),
          source: 'SelfModerationEngine',
          payload: {
            response: result.moderatedResponse || response,
            confidence: result.confidence,
            requestId
          }
        });
      } else {
        this.eventBus?.emit({
          id: `moderation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: SystemEventType.MODERATION_REJECTED,
          timestamp: new Date(),
          source: 'SelfModerationEngine',
          payload: {
            response,
            reasons: allIssues,
            requestId
          }
        });
      }

      if (moderatedResponse) {
        this.eventBus?.emit({
          id: `moderation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: SystemEventType.MODERATION_MODIFIED,
          timestamp: new Date(),
          source: 'SelfModerationEngine',
          payload: {
            originalResponse: response,
            modifiedResponse: moderatedResponse,
            requestId
          }
        });
      }

      return result;

    } catch (error) {
      this.logger.error('Moderation error:', error);
      const moderationTime = Date.now() - startTime;
      this.updateMetrics(false, moderationTime, 0, []);

      const errorIssue: ModerationIssue = {
        type: ModerationIssueType.INCOHERENT_RESPONSE,
        severity: 'high',
        description: `Moderation failed: ${error instanceof Error ? error.message : String(error)}`
      };

      this.eventBus?.emit({
        id: `moderation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: SystemEventType.MODERATION_FAILED,
        timestamp: new Date(),
        source: 'SelfModerationEngine',
        payload: {
          response,
          error: error instanceof Error ? error : new Error(String(error)),
          requestId
        }
      });

      return {
        approved: false,
        issues: [errorIssue],
        confidence: 0,
        moderationTime
      };
    }
  }

  /**
   * Create a moderated response based on issues found
   */
  private async createModeratedResponse(
    response: GeneratedResponse,
    issues: ModerationIssue[],
    context: ResponseContext
  ): Promise<GeneratedResponse> {
    let modifiedResponse = response;

    // Apply content sanitization for inappropriate content
    if (issues.some(i => i.type === ModerationIssueType.INAPPROPRIATE_CONTENT)) {
      modifiedResponse = {
        ...modifiedResponse,
        content: sanitizeContent(modifiedResponse.content)
      };
    }

    // Apply safety modifications
    const safetyIssues = issues.filter(i => i.type === ModerationIssueType.UNSAFE_CONTENT);
    if (safetyIssues.length > 0) {
      modifiedResponse = makeSafeResponse(modifiedResponse, safetyIssues, context);
    }

    // Apply quality improvements
    if (issues.some(i => [
      ModerationIssueType.INCOMPLETE_RESPONSE,
      ModerationIssueType.INCOHERENT_RESPONSE,
      ModerationIssueType.BROKEN_MARKUP
    ].includes(i.type))) {
      modifiedResponse = improveResponseQuality(modifiedResponse);
    }

    // Handle tool integration issues
    if (issues.some(i => i.type === ModerationIssueType.TOOL_RESULTS_NOT_INTEGRATED) && context.toolResults) {
      // Add a note about tool results if they're missing
      const toolNote = '\n\nBased on the tools used, here are the results:\n' +
        context.toolResults
          .filter(r => r.success)
          .map(r => `- ${r.toolId}: ${JSON.stringify(r.output)}`)
          .join('\n');
      modifiedResponse = {
        ...modifiedResponse,
        content: modifiedResponse.content + toolNote
      };
    }

    return {
      ...modifiedResponse,
      metadata: {
        ...modifiedResponse.metadata,
        moderated: true,
        moderationIssues: issues.map(i => i.type)
      }
    };
  }

  /**
   * Validate tool integration (legacy method)
   */
  async validateToolIntegration(response: string, toolResults: ToolResult[]): Promise<boolean> {
    if (toolResults.length === 0) return true;

    const dummyResponse: GeneratedResponse = { content: response, metadata: {} };
    const context: ResponseContext = {
      originalMessage: '',
      analysis: {} as MessageAnalysis,
      conversationHistory: [],
      constraints: {
        maxLength: 4000,
        allowMarkdown: true,
        requireInlineKeyboard: false
      },
      toolResults
    };

    // Check all tool rules
    for (const rule of toolRules) {
      if (rule.enabled) {
        const issues = await rule.check(dummyResponse, context);
        if (issues.length > 0) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Validate content (legacy method)
   */
  async validateContent(content: string): Promise<ModerationResult> {
    const issues: ModerationIssue[] = [];
    let confidence = 1.0;

    // Apply all content rules
    for (const rule of contentRules) {
      if (rule.enabled) {
        const ruleIssues = await rule.check(content);
        if (ruleIssues.length > 0) {
          issues.push(...ruleIssues);
          confidence = Math.min(confidence, 0.8);
        }
      }
    }

    return {
      approved: issues.length === 0,
      issues: issues.length > 0 ? issues : undefined,
      confidence
    };
  }

  /**
   * Validate tone (legacy method)
   */
  async validateTone(content: string, expectedTone?: string): Promise<ModerationResult> {
    const analysis = await this.analyzeText(content);
    const issues: ModerationIssue[] = [];

    if (expectedTone && analysis.tone !== expectedTone && analysis.tone !== 'unknown') {
      issues.push({
        type: ModerationIssueType.INCOHERENT_RESPONSE,
        severity: 'medium',
        description: `Tone mismatch: expected ${expectedTone}, detected ${analysis.tone}`
      });
    }

    return {
      approved: issues.length === 0,
      issues: issues.length > 0 ? issues : undefined,
      confidence: issues.length === 0 ? 0.95 : 0.7
    };
  }

  /**
   * Validate format (legacy method)
   */
  async validateFormat(response: GeneratedResponse): Promise<ModerationResult> {
    const context: ResponseContext = {
      originalMessage: '',
      analysis: {} as MessageAnalysis,
      conversationHistory: [],
      constraints: {
        maxLength: 4000,
        allowMarkdown: true,
        requireInlineKeyboard: false
      }
    };

    const issues: ModerationIssue[] = [];

    // Check format-related quality rules
    for (const rule of qualityRules) {
      if (rule.enabled && rule.name.toLowerCase().includes('format')) {
        const ruleIssues = await rule.check(response, context);
        issues.push(...ruleIssues);
      }
    }

    return {
      approved: issues.length === 0,
      issues: issues.length > 0 ? issues : undefined,
      confidence: issues.length === 0 ? 0.95 : 0.8
    };
  }

  /**
   * Analyze text for sentiment, tone, etc.
   */
  async analyzeText(text: string): Promise<TextAnalysis> {
    // Simple text analysis implementation
    const wordCount = text.split(/\s+/).length;
    const sentenceCount = text.split(/[.!?]+/).filter(s => s.trim()).length;
    const avgWordsPerSentence = sentenceCount > 0 ? wordCount / sentenceCount : 0;

    // Determine sentiment based on keywords
    const positiveWords = ['great', 'excellent', 'good', 'happy', 'wonderful', 'amazing', 'thank'];
    const negativeWords = ['bad', 'terrible', 'awful', 'hate', 'horrible', 'poor', 'wrong'];

    const lowerText = text.toLowerCase();
    const positiveCount = positiveWords.filter(word => lowerText.includes(word)).length;
    const negativeCount = negativeWords.filter(word => lowerText.includes(word)).length;

    let sentiment: 'positive' | 'negative' | 'neutral' = 'neutral';
    if (positiveCount > negativeCount) sentiment = 'positive';
    else if (negativeCount > positiveCount) sentiment = 'negative';

    // Determine tone based on text characteristics
    let tone: 'formal' | 'casual' | 'technical' | 'friendly' | 'unknown' = 'unknown';

    if (text.includes('please') || text.includes('kindly') || avgWordsPerSentence > 15) {
      tone = 'formal';
    } else if (text.includes('hey') || text.includes('gonna') || text.includes('!')) {
      tone = 'casual';
    } else if (/\b(API|SDK|function|method|parameter|algorithm)\b/i.test(text)) {
      tone = 'technical';
    } else if (text.includes('😊') || text.includes('😄') || /\b(hi|hello|thanks)\b/i.test(text)) {
      tone = 'friendly';
    }

    // Extract topics (simple keyword extraction)
    const commonWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for']);
    const words = text.toLowerCase().match(/\b\w+\b/g) || [];
    const topics = words
      .filter(word => word.length > 4 && !commonWords.has(word))
      .slice(0, 5);

    return {
      sentiment,
      tone,
      topics,
      entities: [], // Simple implementation doesn't extract entities
      flags: []
    };
  }

  /**
   * Check content policy
   */
  async checkContentPolicy(content: string, policy: ContentPolicy): Promise<ModerationResult> {
    // Store original config and temporarily apply the provided policy
    const originalPolicy = this.config.contentPolicy;
    this.config.contentPolicy = policy;

    const result = await this.validateContent(content);

    // Restore original policy
    this.config.contentPolicy = originalPolicy;

    return result;
  }

  /**
   * Sanitize content
   */
  sanitizeContent(content: string): string {
    return sanitizeContent(content);
  }

  /**
   * Suggest improvements
   */
  suggestImprovements(issues: ModerationIssue[]): string[] {
    const suggestions: string[] = [];

    for (const issue of issues) {
      switch (issue.type) {
        case ModerationIssueType.EXCESSIVE_LENGTH:
          suggestions.push('Consider shortening the response for better readability');
          break;
        case ModerationIssueType.TOOL_RESULTS_NOT_INTEGRATED:
          suggestions.push('Include and reference the tool results in your response');
          break;
        case ModerationIssueType.INCOMPLETE_RESPONSE:
          suggestions.push('Provide a more complete and detailed response');
          break;
        case ModerationIssueType.INAPPROPRIATE_CONTENT:
          suggestions.push('Remove inappropriate content and rephrase professionally');
          break;
        case ModerationIssueType.BROKEN_MARKUP:
          suggestions.push('Fix markdown formatting errors');
          break;
        case ModerationIssueType.UNSAFE_CONTENT:
          suggestions.push('Remove potentially harmful content and provide safer alternatives');
          break;
        case ModerationIssueType.SPAM_CONTENT:
          suggestions.push('Remove repetitive or promotional content');
          break;
        case ModerationIssueType.OFF_TOPIC:
          suggestions.push('Focus on addressing the user\'s specific question or request');
          break;
        case ModerationIssueType.INCOHERENT_RESPONSE:
          suggestions.push('Restructure the response for better clarity and coherence');
          break;
        case ModerationIssueType.CONTRADICTORY_INFORMATION:
          suggestions.push('Resolve contradictions and provide consistent information');
          break;
      }
    }

    return [...new Set(suggestions)]; // Remove duplicates
  }

  /**
   * Get current configuration
   */
  getConfig(): ModerationConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ModerationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get moderation metrics
   */
  getMetrics(): ModerationMetrics {
    return { ...this.metrics };
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
        initialized: this.isInitialized,
        message: this.isInitialized ? 'Self-Moderation Engine is operational' : 'Not initialized',
        uptime: Date.now(),
        metrics: {
          totalModerations: this.metrics.totalModerations,
          approvalRate: this.metrics.approvalRate,
          averageConfidence: this.metrics.averageConfidence,
          averageModerationTime: this.metrics.averageModerationTime
        }
      }
    };
  }

  /**
   * Update internal metrics
   */
  private updateMetrics(
    approved: boolean,
    moderationTime: number,
    confidence: number,
    issues: ModerationIssue[]
  ): void {
    this.metrics.totalModerations++;

    if (approved) {
      this._totalApprovals++;
    }

    this._totalModerationTime += moderationTime;
    this._totalConfidence += confidence;

    // Update approval rate
    this.metrics.approvalRate = this._totalApprovals / this.metrics.totalModerations;

    // Update average moderation time
    this.metrics.averageModerationTime = this._totalModerationTime / this.metrics.totalModerations;

    // Update average confidence
    this.metrics.averageConfidence = this._totalConfidence / this.metrics.totalModerations;

    // Update common issue types
    for (const issue of issues) {
      this.metrics.commonIssueTypes[issue.type] =
        (this.metrics.commonIssueTypes[issue.type] || 0) + 1;
    }
  }
}