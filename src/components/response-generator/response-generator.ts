/**
 * Response Generator implementation
 */

import { callOpenRouter } from '../../services/call-openrouter.ts';
import {
  ResponseGeneratorConfig,
  ResponseTemplate,
  FormattingOptions,
  ValidationResult,
  ValidationIssue,
  ResponseMetrics,
  KeyboardConfig,
  ToolResultFormatter
} from './types.ts';

import {
  IResponseGenerator,
  ComponentStatus,
  ResponseContext,
  ToolResult
} from '../../interfaces/component-interfaces.ts';

import {
  GeneratedResponse,
  InlineKeyboard,
  InlineKeyboardButton,
  InternalMessage
} from '../../interfaces/message-types.ts';

import { OpenRouterMessage } from '../../services/openrouter-types.ts';

/**
 * Constructs appropriate responses using LLM with context and tool results
 */
export class ResponseGenerator implements IResponseGenerator {
  public readonly name = 'ResponseGenerator';

  private config: ResponseGeneratorConfig;
  private templates = new Map<string, ResponseTemplate>();
  private metrics: ResponseMetrics;
  private isInitialized = false;

  constructor(config?: Partial<ResponseGeneratorConfig>) {
    this.config = {
      model: 'anthropic/claude-3-haiku',
      maxTokens: 1000,
      temperature: 0.7,
      responseTimeout: 15000,
      enableMarkdown: true,
      debugMode: false,
      ...config
    };

    this.metrics = this.initializeMetrics();
    this.loadDefaultTemplates();
  }

  /**
   * Initialize the Response Generator
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    this.isInitialized = true;

    if (this.config.debugMode) {
      console.log('[ResponseGenerator] Initialized successfully');
    }
  }

  /**
   * Shutdown the Response Generator
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    this.templates.clear();
    this.isInitialized = false;

    if (this.config.debugMode) {
      console.log('[ResponseGenerator] Shutdown completed');
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
        templatesLoaded: this.templates.size,
        metrics: this.metrics,
        config: {
          model: this.config.model,
          maxTokens: this.config.maxTokens
        }
      }
    };
  }

  /**
   * Generate response based on context
   */
  async generateResponse(context: ResponseContext): Promise<GeneratedResponse> {
    const startTime = Date.now();

    try {
      // Build the prompt for response generation
      const prompt = this.buildResponsePrompt(context);

      // Call LLM to generate response
      const messages: OpenRouterMessage[] = [
        {
          role: 'system',
          content: prompt.systemPrompt
        },
        {
          role: 'user',
          content: prompt.userPrompt
        }
      ];

      const responseText = await callOpenRouter(
        messages,
        this.config.model,
        this.config.responseTimeout
      );

      // Create generated response
      const response: GeneratedResponse = {
        content: responseText,
        metadata: {
          model: this.config.model,
          tokensUsed: Math.ceil(responseText.length / 4), // Rough estimate
          processingTime: Date.now() - startTime,
          toolsUsed: context.toolResults ? context.toolResults.map(tr => tr.toolId) : []
        }
      };

      // Apply formatting constraints
      const formattedResponse = this.applyFormatting(response, context.constraints);

      // Update metrics
      this.updateMetrics(formattedResponse, Date.now() - startTime);

      return formattedResponse;

    } catch (error) {
      if (this.config.debugMode) {
        console.error('[ResponseGenerator] Generation failed:', error);
      }

      // Return fallback response
      return this.createFallbackResponse(context, error as Error);
    }
  }

  /**
   * Format tool results for inclusion in response
   */
  formatToolResults(results: ToolResult[]): string {
    if (!results || results.length === 0) {
      return '';
    }

    const config: ToolResultFormatter = {
      type: 'text',
      includeMetadata: false,
      groupByTool: true,
      showErrors: true
    };

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    let formatted = '';

    if (successful.length > 0) {
      formatted += '**Results:**\n\n';

      for (const result of successful) {
        formatted += `• ${result.toolId}: `;

        if (typeof result.output === 'string') {
          formatted += result.output;
        } else {
          formatted += JSON.stringify(result.output, null, 2);
        }

        formatted += '\n';
      }
    }

    if (failed.length > 0 && config.showErrors) {
      formatted += '\n**Issues encountered:**\n\n';

      for (const result of failed) {
        formatted += `• ${result.toolId}: ${result.error || 'Unknown error'}\n`;
      }
    }

    return formatted.trim();
  }

  /**
   * Create inline keyboard from options
   */
  createInlineKeyboard(options: string[]): InlineKeyboard {
    if (!options || options.length === 0) {
      return { inline_keyboard: [] };
    }

    const config: KeyboardConfig = {
      maxButtonsPerRow: 2,
      maxRows: 3,
      style: 'minimal',
      includeHelp: false
    };

    const buttons: InlineKeyboardButton[][] = [];
    let currentRow: InlineKeyboardButton[] = [];

    for (let i = 0; i < options.length && buttons.length < config.maxRows; i++) {
      const option = options[i];

      currentRow.push({
        text: option,
        callback_data: `action_${i}_${option.toLowerCase().replace(/\s+/g, '_')}`
      });

      if (currentRow.length >= config.maxButtonsPerRow || i === options.length - 1) {
        buttons.push([...currentRow]);
        currentRow = [];
      }
    }

    // Add help button if enabled
    if (config.includeHelp && buttons.length < config.maxRows) {
      buttons.push([{
        text: '❓ Help',
        callback_data: 'action_help'
      }]);
    }

    return {
      inline_keyboard: buttons
    };
  }

  /**
   * Validate generated response
   */
  async validateResponse(response: GeneratedResponse): Promise<boolean> {
    const validation = await this.performResponseValidation(response);
    return validation.isValid;
  }

  /**
   * Perform comprehensive response validation
   */
  async performResponseValidation(response: GeneratedResponse): Promise<ValidationResult> {
    const issues: ValidationIssue[] = [];

    // Check length constraints
    if (response.content.length > 4096) { // Telegram message limit
      issues.push({
        type: 'length',
        message: `Response exceeds Telegram limit (${response.content.length}/4096 characters)`,
        suggestion: 'Truncate or split the response'
      });
    }

    if (response.content.length === 0) {
      issues.push({
        type: 'content',
        message: 'Response is empty',
        suggestion: 'Generate meaningful content'
      });
    }

    // Check markdown formatting if enabled
    if (this.config.enableMarkdown) {
      const markdownIssues = this.validateMarkdown(response.content);
      issues.push(...markdownIssues);
    }

    // Check for potentially unsafe content
    const safetyIssues = this.validateSafety(response.content);
    issues.push(...safetyIssues);

    const severity = issues.length === 0 ? 'low' :
                    issues.some(i => i.type === 'safety') ? 'high' : 'medium';

    return {
      isValid: issues.length === 0,
      issues,
      severity,
      suggestedFixes: issues.map(i => i.suggestion).filter(Boolean) as string[]
    };
  }

  /**
   * Get response generation metrics
   */
  getMetrics(): ResponseMetrics {
    return { ...this.metrics };
  }

  /**
   * Build response generation prompt
   */
  private buildResponsePrompt(context: ResponseContext): { systemPrompt: string; userPrompt: string } {
    const { originalMessage, analysis, toolResults, conversationHistory, constraints } = context;

    let systemPrompt = `You are a helpful AI assistant responding to user messages in a Telegram chat.

**Response Guidelines:**
- Be helpful, accurate, and engaging
- Use a ${constraints.tone || 'casual'} tone
- Keep responses under ${constraints.maxLength || 1000} characters
- ${constraints.allowMarkdown ? 'Use Markdown formatting when appropriate' : 'Use plain text only'}
- Be concise but thorough

**Context:**
- User's intent: ${analysis.intent}
- Confidence level: ${analysis.confidence}
- Requires context: ${analysis.requiresContext}

${toolResults && toolResults.length > 0 ? `**Tool Results:**
${this.formatToolResults(toolResults)}

Incorporate these results naturally into your response.` : ''}

${conversationHistory.length > 0 ? `**Recent Conversation:**
${conversationHistory.slice(-3).map(m => `${m.content}`).join('\n')}` : ''}

Respond directly to the user's message with helpful information.`;

    const userPrompt = `User message: "${originalMessage}"`;

    return { systemPrompt, userPrompt };
  }

  /**
   * Apply formatting constraints to response
   */
  private applyFormatting(response: GeneratedResponse, constraints: any): GeneratedResponse {
    let content = response.content;

    // Apply length constraints
    if (constraints.maxLength && content.length > constraints.maxLength) {
      content = this.truncateContent(content, constraints.maxLength);
    }

    // Apply markdown constraints
    if (!constraints.allowMarkdown) {
      content = this.stripMarkdown(content);
    }

    return {
      ...response,
      content
    };
  }

  /**
   * Truncate content while preserving word boundaries
   */
  private truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content;
    }

    const truncated = content.substring(0, maxLength - 3);
    const lastSpace = truncated.lastIndexOf(' ');

    if (lastSpace > maxLength * 0.8) {
      return truncated.substring(0, lastSpace) + '...';
    }

    return truncated + '...';
  }

  /**
   * Strip markdown formatting from content
   */
  private stripMarkdown(content: string): string {
    return content
      .replace(/\*\*(.*?)\*\*/g, '$1') // Bold
      .replace(/\*(.*?)\*/g, '$1')     // Italic
      .replace(/`(.*?)`/g, '$1')       // Code
      .replace(/\[(.*?)\]\(.*?\)/g, '$1') // Links
      .replace(/^#+\s*/gm, '')         // Headers
      .replace(/^[-*+]\s*/gm, '• ')    // Lists
      .trim();
  }

  /**
   * Validate markdown formatting
   */
  private validateMarkdown(content: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check for unmatched markdown syntax
    const boldCount = (content.match(/\*\*/g) || []).length;
    if (boldCount % 2 !== 0) {
      issues.push({
        type: 'format',
        message: 'Unmatched bold markdown syntax',
        suggestion: 'Ensure all ** are properly paired'
      });
    }

    const codeCount = (content.match(/`/g) || []).length;
    if (codeCount % 2 !== 0) {
      issues.push({
        type: 'format',
        message: 'Unmatched code markdown syntax',
        suggestion: 'Ensure all ` are properly paired'
      });
    }

    return issues;
  }

  /**
   * Validate content safety
   */
  private validateSafety(content: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Basic safety checks - in production, this would be more sophisticated
    const sensitivePatterns = [
      /password/i,
      /api[_\s]?key/i,
      /secret/i,
      /token/i
    ];

    for (const pattern of sensitivePatterns) {
      if (pattern.test(content)) {
        issues.push({
          type: 'safety',
          message: 'Response may contain sensitive information',
          suggestion: 'Remove or mask sensitive data'
        });
        break;
      }
    }

    return issues;
  }

  /**
   * Create fallback response for errors
   */
  private createFallbackResponse(context: ResponseContext, error: Error): GeneratedResponse {
    const fallbackContent = "I apologize, but I'm having trouble generating a response right now. Please try again in a moment.";

    return {
      content: fallbackContent,
      metadata: {
        model: 'fallback',
        tokensUsed: 0,
        processingTime: 0,
        error: error.message
      }
    };
  }

  /**
   * Update generation metrics
   */
  private updateMetrics(response: GeneratedResponse, duration: number): void {
    this.metrics.totalResponses++;

    // Update average generation time
    const total = this.metrics.averageGenerationTime * (this.metrics.totalResponses - 1);
    this.metrics.averageGenerationTime = (total + duration) / this.metrics.totalResponses;

    // Update average length
    const lengthTotal = this.metrics.averageLength * (this.metrics.totalResponses - 1);
    this.metrics.averageLength = (lengthTotal + response.content.length) / this.metrics.totalResponses;

    // Update format distribution
    const format = response.content.includes('**') || response.content.includes('*') ? 'markdown' : 'plain';
    this.metrics.formatDistribution[format] = (this.metrics.formatDistribution[format] || 0) + 1;
  }

  /**
   * Initialize metrics object
   */
  private initializeMetrics(): ResponseMetrics {
    return {
      totalResponses: 0,
      averageGenerationTime: 0,
      averageLength: 0,
      formatDistribution: {},
      validationFailureRate: 0,
      toneDistribution: {}
    };
  }

  /**
   * Load default response templates
   */
  private loadDefaultTemplates(): void {
    const defaultTemplates: ResponseTemplate[] = [
      {
        name: 'error',
        pattern: 'I apologize, but {error_message}. Please {suggestion}.',
        variables: ['error_message', 'suggestion'],
        tone: 'formal',
        useCase: 'Error responses'
      },
      {
        name: 'tool_result',
        pattern: 'Based on the {tool_name} results: {results}',
        variables: ['tool_name', 'results'],
        tone: 'technical',
        useCase: 'Tool result presentations'
      },
      {
        name: 'greeting',
        pattern: 'Hello! {greeting_message}',
        variables: ['greeting_message'],
        tone: 'casual',
        useCase: 'Conversation starters'
      }
    ];

    for (const template of defaultTemplates) {
      this.templates.set(template.name, template);
    }
  }
}