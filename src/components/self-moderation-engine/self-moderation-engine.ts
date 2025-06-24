/**
 * Self-Moderation Engine Implementation
 *
 * Validates responses before sending to ensure quality and safety
 */

import { IComponent, ComponentStatus } from '../../interfaces/component-interfaces.ts';
import { GeneratedResponse } from '../../interfaces/message-types.ts';
import { ResponseContext } from '../../interfaces/component-interfaces.ts';
import { ToolResult } from '../mcp-tool-manager/types.ts';
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

/**
 * Default moderation configuration
 */
const DEFAULT_CONFIG: ModerationConfig = {
  confidenceThreshold: 0.8,
  severityThreshold: 'medium',
  contentPolicy: {
    allowPersonalInfo: false,
    allowExternalLinks: true,
    allowCodeExecution: false,
    maxResponseLength: 4000,
    requiredTone: undefined,
    prohibitedPatterns: [
      '(?i)(hack|crack|exploit)',
      '(?i)(bomb|weapon|violence)',
      '(?i)(password|secret|private)',
    ],
    sensitiveTopics: [
      'personal_data',
      'financial_info',
      'medical_advice',
      'legal_advice'
    ]
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

  private config: ModerationConfig = DEFAULT_CONFIG;
  private metrics: ModerationMetrics = {
    totalModerations: 0,
    approvalRate: 0,
    averageModerationTime: 0,
    commonIssueTypes: {} as Record<ModerationIssueType, number>,
    averageConfidence: 0
  };
  private isInitialized = false;

  /**
   * Initialize the component
   */
  async initialize(): Promise<void> {
    this.isInitialized = true;
    console.log('Self-Moderation Engine initialized');
  }

  /**
   * Initialize with custom configuration
   */
  async initializeWithConfig(config: Partial<ModerationConfig>): Promise<void> {
    this.config = { ...DEFAULT_CONFIG, ...config };
    await this.initialize();
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
  async moderateResponse(
    response: GeneratedResponse,
    context: ResponseContext
  ): Promise<ModerationResult> {
    const startTime = Date.now();

    try {
      const issues: ModerationIssue[] = [];
      let totalConfidence = 0;
      let confidenceCount = 0;

      // Content validation
      if (this.config.enableContentFiltering) {
        const contentResult = await this.validateContent(response.content);
        issues.push(...(contentResult.issues || []));
        totalConfidence += contentResult.confidence;
        confidenceCount++;
      }

      // Format validation
      const formatResult = await this.validateFormat(response);
      issues.push(...(formatResult.issues || []));
      totalConfidence += formatResult.confidence;
      confidenceCount++;

      // Tone validation
      if (this.config.enableToneValidation && this.config.contentPolicy.requiredTone) {
        const toneResult = await this.validateTone(response.content, this.config.contentPolicy.requiredTone);
        issues.push(...(toneResult.issues || []));
        totalConfidence += toneResult.confidence;
        confidenceCount++;
      }

      // Tool integration validation
      if (this.config.enableToolIntegrationCheck && context.toolResults) {
        const toolIntegrated = await this.validateToolIntegration(response.content, context.toolResults);
        if (!toolIntegrated) {
          issues.push({
            type: ModerationIssueType.TOOL_RESULTS_NOT_INTEGRATED,
            severity: 'high',
            description: 'Tool results are not properly integrated into the response'
          });
        }
        totalConfidence += toolIntegrated ? 1.0 : 0.0;
        confidenceCount++;
      }

      // Relevance check
      if (this.config.enableRelevanceCheck) {
        const relevanceResult = await this.validateRelevance(response.content, context);
        issues.push(...(relevanceResult.issues || []));
        totalConfidence += relevanceResult.confidence;
        confidenceCount++;
      }

      // Calculate overall confidence
      const confidence = confidenceCount > 0 ? totalConfidence / confidenceCount : 1.0;

      // Determine approval
      const highSeverityIssues = issues.filter(issue => issue.severity === 'high');
      const mediumSeverityIssues = issues.filter(issue => issue.severity === 'medium');

      let approved = true;

      if (this.config.severityThreshold === 'high' && highSeverityIssues.length > 0) {
        approved = false;
      } else if (this.config.severityThreshold === 'medium' && (highSeverityIssues.length > 0 || mediumSeverityIssues.length > 0)) {
        approved = false;
      } else if (this.config.severityThreshold === 'low' && issues.length > 0) {
        approved = false;
      }

      if (confidence < this.config.confidenceThreshold) {
        approved = false;
      }

      const moderationTime = Date.now() - startTime;

      // Update metrics
      this.updateMetrics(approved, moderationTime, confidence, issues);

      const result: ModerationResult = {
        approved,
        issues: issues.length > 0 ? issues : undefined,
        suggestions: issues.length > 0 ? this.suggestImprovements(issues) : undefined,
        confidence,
        moderationTime
      };

      return result;

    } catch (error) {
      console.error('Moderation error:', error);
      return {
        approved: false,
        issues: [{
          type: ModerationIssueType.INCOHERENT_RESPONSE,
          severity: 'high',
          description: `Moderation failed: ${error instanceof Error ? error.message : String(error)}`
        }],
        confidence: 0,
        moderationTime: Date.now() - startTime
      };
    }
  }

  /**
   * Validate tool integration
   */
  async validateToolIntegration(
    response: string,
    toolResults: ToolResult[]
  ): Promise<boolean> {
    if (toolResults.length === 0) return true;

    // Check if response references tool results
    const successfulResults = toolResults.filter(result => result.success);
    if (successfulResults.length === 0) return true;

    // Simple heuristic: check if response contains some content from tool outputs
    for (const result of successfulResults) {
      if (result.output && typeof result.output === 'string') {
        // Extract key terms from tool output
        const outputTerms = this.extractKeyTerms(result.output);
        const responseTerms = this.extractKeyTerms(response);

        // Check for overlap
        const overlap = outputTerms.filter(term => responseTerms.includes(term));
        if (overlap.length > 0) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Validate content against policies
   */
  async validateContent(content: string): Promise<ModerationResult> {
    const issues: ModerationIssue[] = [];

    // Check prohibited patterns
    for (const pattern of this.config.contentPolicy.prohibitedPatterns) {
      const regex = new RegExp(pattern);
      if (regex.test(content)) {
        issues.push({
          type: ModerationIssueType.INAPPROPRIATE_CONTENT,
          severity: 'high',
          description: `Content matches prohibited pattern: ${pattern}`
        });
      }
    }

    // Check length
    if (content.length > this.config.contentPolicy.maxResponseLength) {
      issues.push({
        type: ModerationIssueType.EXCESSIVE_LENGTH,
        severity: 'medium',
        description: `Response exceeds maximum length: ${content.length}/${this.config.contentPolicy.maxResponseLength}`
      });
    }

    // Check for sensitive topics (basic keyword matching)
    for (const topic of this.config.contentPolicy.sensitiveTopics) {
      if (content.toLowerCase().includes(topic.toLowerCase().replace('_', ' '))) {
        issues.push({
          type: ModerationIssueType.UNSAFE_CONTENT,
          severity: 'medium',
          description: `Content may contain sensitive topic: ${topic}`
        });
      }
    }

    return {
      approved: issues.length === 0,
      issues: issues.length > 0 ? issues : undefined,
      confidence: Math.max(0.5, 1.0 - (issues.length * 0.2))
    };
  }

  /**
   * Validate tone
   */
  async validateTone(content: string, expectedTone?: string): Promise<ModerationResult> {
    if (!expectedTone) {
      return { approved: true, confidence: 1.0 };
    }

    const analysis = await this.analyzeText(content);
    const issues: ModerationIssue[] = [];

    if (analysis.tone !== expectedTone && analysis.tone !== 'unknown') {
      issues.push({
        type: ModerationIssueType.INCOHERENT_RESPONSE,
        severity: 'low',
        description: `Tone mismatch: expected ${expectedTone}, detected ${analysis.tone}`
      });
    }

    return {
      approved: issues.length === 0,
      issues: issues.length > 0 ? issues : undefined,
      confidence: analysis.tone === expectedTone ? 1.0 : 0.6
    };
  }

  /**
   * Validate format
   */
  async validateFormat(response: GeneratedResponse): Promise<ModerationResult> {
    const issues: ModerationIssue[] = [];

    // Check for empty response
    if (!response.content.trim()) {
      issues.push({
        type: ModerationIssueType.INCOMPLETE_RESPONSE,
        severity: 'high',
        description: 'Response is empty'
      });
    }

    // Check for broken markdown (basic check)
    const markdownErrors = this.validateMarkdown(response.content);
    issues.push(...markdownErrors);

    return {
      approved: issues.length === 0,
      issues: issues.length > 0 ? issues : undefined,
      confidence: Math.max(0.7, 1.0 - (issues.length * 0.15))
    };
  }

  /**
   * Check content policy
   */
  async checkContentPolicy(content: string, policy: ContentPolicy): Promise<ModerationResult> {
    return this.validateContent(content);
  }

  /**
   * Sanitize content
   */
  sanitizeContent(content: string): string {
    // Remove potential XSS patterns
    let sanitized = content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/on\w+\s*=/gi, '');

    // Remove excessive whitespace
    sanitized = sanitized.replace(/\s+/g, ' ').trim();

    return sanitized;
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
        default:
          suggestions.push('Review and improve the response quality');
      }
    }

    return [...new Set(suggestions)]; // Remove duplicates
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ModerationConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): ModerationConfig {
    return { ...this.config };
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
        totalModerations: this.metrics.totalModerations,
        approvalRate: this.metrics.approvalRate,
        averageModerationTime: this.metrics.averageModerationTime
      }
    };
  }

  /**
   * Get moderation metrics
   */
  getMetrics(): ModerationMetrics {
    return { ...this.metrics };
  }

  /**
   * Validate relevance to context
   */
  private async validateRelevance(response: string, context: ResponseContext): Promise<ModerationResult> {
    const issues: ModerationIssue[] = [];

    // Simple relevance check: ensure response relates to original message
    const messageTerms = this.extractKeyTerms(context.originalMessage);
    const responseTerms = this.extractKeyTerms(response);

    const overlap = messageTerms.filter(term => responseTerms.includes(term));
    const relevanceScore = messageTerms.length > 0 ? overlap.length / messageTerms.length : 1.0;

    if (relevanceScore < 0.3) {
      issues.push({
        type: ModerationIssueType.IRRELEVANT_RESPONSE,
        severity: 'medium',
        description: `Response may not be relevant to the original message (relevance: ${(relevanceScore * 100).toFixed(1)}%)`
      });
    }

    return {
      approved: issues.length === 0,
      issues: issues.length > 0 ? issues : undefined,
      confidence: relevanceScore
    };
  }

  /**
   * Extract key terms from text
   */
  private extractKeyTerms(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3)
      .filter(word => !['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one', 'our', 'had', 'but', 'words', 'with', 'they', 'have', 'this', 'will', 'from', 'that', 'what', 'were', 'said', 'each', 'which', 'their', 'time', 'about', 'would', 'there', 'could', 'other', 'more', 'very', 'into', 'after', 'first', 'well', 'water', 'been', 'call', 'who', 'its', 'now', 'find', 'long', 'down', 'day', 'did', 'get', 'has', 'him', 'his', 'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use'].includes(word));
  }

  /**
   * Analyze text for sentiment, tone, etc.
   */
  private async analyzeText(text: string): Promise<TextAnalysis> {
    // Simple rule-based analysis (in production, might use ML models)
    const words = text.toLowerCase().split(/\s+/);

    // Tone detection
    let tone: TextAnalysis['tone'] = 'unknown';
    if (words.some(word => ['please', 'thank', 'kindly', 'appreciate'].includes(word))) {
      tone = 'formal';
    } else if (words.some(word => ['hey', 'cool', 'awesome', 'great'].includes(word))) {
      tone = 'casual';
    } else if (words.some(word => ['function', 'algorithm', 'implementation', 'code'].includes(word))) {
      tone = 'technical';
    } else if (words.some(word => ['help', 'welcome', 'happy', 'glad'].includes(word))) {
      tone = 'friendly';
    }

    // Sentiment detection
    const positiveWords = words.filter(word => ['good', 'great', 'excellent', 'amazing', 'wonderful', 'perfect'].includes(word));
    const negativeWords = words.filter(word => ['bad', 'terrible', 'awful', 'horrible', 'wrong', 'failed'].includes(word));

    let sentiment: TextAnalysis['sentiment'] = 'neutral';
    if (positiveWords.length > negativeWords.length) {
      sentiment = 'positive';
    } else if (negativeWords.length > positiveWords.length) {
      sentiment = 'negative';
    }

    return {
      sentiment,
      tone,
      topics: [], // Could be enhanced with topic extraction
      entities: [], // Could be enhanced with NER
      flags: []
    };
  }

  /**
   * Validate markdown formatting
   */
  private validateMarkdown(text: string): ModerationIssue[] {
    const issues: ModerationIssue[] = [];

    // Check for unmatched code blocks
    const codeBlockMatches = text.match(/```/g);
    if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
      issues.push({
        type: ModerationIssueType.BROKEN_MARKUP,
        severity: 'low',
        description: 'Unmatched code block markers (```)'
      });
    }

    // Check for unmatched bold/italic
    const boldMatches = text.match(/\*\*/g);
    if (boldMatches && boldMatches.length % 2 !== 0) {
      issues.push({
        type: ModerationIssueType.BROKEN_MARKUP,
        severity: 'low',
        description: 'Unmatched bold markers (**)'
      });
    }

    return issues;
  }

  /**
   * Update metrics
   */
  private updateMetrics(
    approved: boolean,
    moderationTime: number,
    confidence: number,
    issues: ModerationIssue[]
  ): void {
    this.metrics.totalModerations++;

    // Update approval rate
    const totalApproved = this.metrics.approvalRate * (this.metrics.totalModerations - 1) + (approved ? 1 : 0);
    this.metrics.approvalRate = totalApproved / this.metrics.totalModerations;

    // Update average moderation time
    this.metrics.averageModerationTime =
      (this.metrics.averageModerationTime * (this.metrics.totalModerations - 1) + moderationTime) /
      this.metrics.totalModerations;

    // Update average confidence
    this.metrics.averageConfidence =
      (this.metrics.averageConfidence * (this.metrics.totalModerations - 1) + confidence) /
      this.metrics.totalModerations;

    // Update issue type counts
    for (const issue of issues) {
      this.metrics.commonIssueTypes[issue.type] = (this.metrics.commonIssueTypes[issue.type] || 0) + 1;
    }
  }
}