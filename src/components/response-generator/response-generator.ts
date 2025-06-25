/**
 * Response Generator Implementation
 *
 * Generates natural language responses based on Decision Engine decisions
 * and tool results, formatted for Telegram
 */

import {
  IResponseGenerator,
  IComponent,
  ComponentStatus,
  ResponseContext,
  ToolResult,
  Decision,
  ResponseConstraints
} from '../../interfaces/component-interfaces.ts';

import {
  InternalMessage,
  GeneratedResponse,
  InlineKeyboard
} from '../../interfaces/message-types.ts';
import { LlmService } from '../../services/llm-service/llm-service.ts';
import { OpenRouterMessage } from '../../services/openrouter-types.ts';

import {
  ResponseGeneratorConfig,
  ResponseStrategy,
  FormattingOptions,
  TemplateContext,
  ExtendedResponseMetadata
} from './types.ts';

import { buildInlineKeyboard, buildConfirmationKeyboard } from './keyboard-builder.ts';
import {
  processTemplate,
  formatToolOutput,
  applyMarkdownFormatting,
  createTemplateContext,
  truncateText,
  getRandomGreeting,
  DEFAULT_TEMPLATES
} from './template-engine.ts';

// Import Event Bus
import {
  eventBus,
  SystemEventType,
  ComponentInitializedEvent,
  ComponentErrorEvent,
  createEventEmitter
} from '../../services/event-bus/index.ts';

/**
 * Default configuration
 */
const DEFAULT_CONFIG: ResponseGeneratorConfig = {
  defaultModel: 'deepseek/deepseek-r1:free',
  temperature: 0.7,
  maxTokens: 1000,
  maxResponseLength: 4096,
  enableMarkdown: true,
  responseTemplates: DEFAULT_TEMPLATES,
  maxButtonsPerRow: 3,
  maxRows: 10
};

/**
 * Response Generator component
 */
export class ResponseGenerator implements IResponseGenerator, IComponent {
  public readonly name = 'ResponseGenerator';
  private config: ResponseGeneratorConfig;
  private llmService: LlmService;
  private isInitialized = false;
  private eventEmitter = createEventEmitter('ResponseGenerator');

  constructor(
    llmService: LlmService,
    config: Partial<ResponseGeneratorConfig> = {}
  ) {
    this.llmService = llmService;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the component
   */
  async initialize(): Promise<void> {
    console.log('[ResponseGenerator] Initializing...');
    this.isInitialized = true;

    // Emit component initialized event
    await this.eventEmitter.emit<ComponentInitializedEvent>({
      type: SystemEventType.COMPONENT_INITIALIZED,
      payload: {
        componentName: this.name,
        timestamp: new Date()
      }
    });

    console.log('[ResponseGenerator] Initialized successfully');
  }

  /**
   * Shutdown the component
   */
  async shutdown(): Promise<void> {
    console.log('[ResponseGenerator] Shutting down...');
    this.isInitialized = false;
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
        configuredModel: this.config.defaultModel,
        markdownEnabled: this.config.enableMarkdown
      }
    };
  }

  /**
   * Generate a response based on the given context
   */
  async generateResponse(context: ResponseContext): Promise<GeneratedResponse> {
    const startTime = Date.now();

    try {
      // Determine response strategy
      const strategy = this.determineResponseStrategy(context);

      // Generate response content based on strategy
      let content: string;

      switch (strategy.type) {
        case 'tool_based':
          content = await this.generateToolBasedResponse(context, strategy);
          break;
        case 'clarification':
          content = await this.generateClarificationResponse(context, strategy);
          break;
        case 'error':
          content = await this.generateErrorResponse(context, strategy);
          break;
        case 'direct':
        default:
          content = await this.generateDirectResponse(context, strategy);
      }

      // Apply formatting
      content = this.applyFormatting(content, strategy);

      // Truncate if needed
      content = truncateText(content, this.config.maxResponseLength || 4096);

      // Create inline keyboard if needed
      let inlineKeyboard: InlineKeyboard | undefined;
      if (strategy.includeKeyboard && strategy.keyboardOptions) {
        inlineKeyboard = this.createInlineKeyboard(strategy.keyboardOptions);
      }

      // Prepare metadata
      const metadata: ExtendedResponseMetadata = {
        model: this.config.defaultModel || 'unknown',
        tokensUsed: Math.ceil(content.length / 4), // Rough estimate
        processingTime: Date.now() - startTime,
        toolsUsed: context.toolResults?.map(r => r.toolId) || [],
        strategy,
        formattingApplied: {
          useMarkdown: this.config.enableMarkdown || false,
          includeToolDetails: true,
          summarizeToolResults: false,
          addTimestamp: false
        },
        validationPassed: true
      };

      const response: GeneratedResponse = {
        content,
        metadata
      };

      // Validate response
      const isValid = await this.validateResponse(response);
      metadata.validationPassed = isValid;

      return response;

    } catch (error) {
      console.error('[ResponseGenerator] Error generating response:', error);

      // Emit component error event
      await this.eventEmitter.emit<ComponentErrorEvent>({
        type: SystemEventType.COMPONENT_ERROR,
        payload: {
          componentName: this.name,
          error: error as Error
        }
      });

      // Return error response
      const err = error as Error;
      return {
        content: this.config.responseTemplates?.genericError ||
                 "I apologize, but I encountered an error while generating a response.",
        metadata: {
          model: this.config.defaultModel || 'unknown',
          tokensUsed: 0,
          processingTime: Date.now() - startTime,
          error: err.message
        }
      };
    }
  }

  /**
   * Format tool results into a readable string
   */
  formatToolResults(results: ToolResult[]): string {
    if (!results || results.length === 0) {
      return "No tool results available.";
    }

    const formattedResults = results.map(result => {
      if (result.success) {
        return `✅ ${result.toolId}: ${formatToolOutput(result.output)}`;
      } else {
        return `❌ ${result.toolId}: ${result.error || 'Unknown error'}`;
      }
    });

    return formattedResults.join('\n\n');
  }

  /**
   * Create an inline keyboard from options
   */
  createInlineKeyboard(options: string[]): InlineKeyboard {
    return buildInlineKeyboard(options, {
      maxButtonsPerRow: this.config.maxButtonsPerRow,
      maxRows: this.config.maxRows
    });
  }

  /**
   * Validate a generated response
   */
  async validateResponse(response: GeneratedResponse): Promise<boolean> {
    // Check if content is not empty
    if (!response.content || response.content.trim().length === 0) {
      return false;
    }

    // Check if content is within length limits
    if (response.content.length > (this.config.maxResponseLength || 4096)) {
      return false;
    }

    // Check for prohibited content (if needed)
    // This could be extended with more sophisticated validation

    return true;
  }

  /**
   * Determine response strategy based on context
   */
  private determineResponseStrategy(context: ResponseContext): ResponseStrategy {
    // Check if this is an error response
    if (context.toolResults?.some(r => !r.success)) {
      return {
        type: 'error',
        tone: 'casual',
        includeKeyboard: false
      };
    }

    // Check if tools were used
    if (context.toolResults && context.toolResults.length > 0) {
      return {
        type: 'tool_based',
        tone: context.constraints.tone || 'casual',
        includeKeyboard: context.constraints.requireInlineKeyboard
      };
    }

    // Check if clarification is needed
    if (context.analysis.intent === 'question' && context.analysis.confidence < 0.5) {
      return {
        type: 'clarification',
        tone: 'casual',
        includeKeyboard: true,
        keyboardOptions: context.analysis.suggestedTools || []
      };
    }

    // Default to direct response
    return {
      type: 'direct',
      tone: context.constraints.tone || 'casual',
      includeKeyboard: context.constraints.requireInlineKeyboard
    };
  }

  /**
   * Generate a tool-based response
   */
  private async generateToolBasedResponse(
    context: ResponseContext,
    strategy: ResponseStrategy
  ): Promise<string> {
    const toolResults = this.formatToolResults(context.toolResults || []);

    let systemPrompt = `You are a helpful assistant. Generate a natural response based on the following tool execution results.
                  Use a ${strategy.tone} tone. Keep the response concise and informative.`;

    // Add moderation feedback if present
    if (context.moderationFeedback) {
      systemPrompt += `\n\nIMPORTANT: ${context.moderationFeedback}`;
    }

    // Create prompt for LLM
    const messages: OpenRouterMessage[] = [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: `Original question: ${context.originalMessage}\n\nTool Results:\n${toolResults}\n\nPlease provide a helpful response based on these results.`
      }
    ];

    try {
      const response = await this.llmService.getAiResponse({ messages });
      return response;
    } catch (error) {
      // Fallback to template-based response
      const template = this.config.responseTemplates?.toolSuccess ||
                      "Here are the results: {toolOutput}";

      return processTemplate(template, {
        toolOutput: toolResults,
        action: 'processed your request'
      });
    }
  }

  /**
   * Generate a clarification response
   */
  private async generateClarificationResponse(
    context: ResponseContext,
    strategy: ResponseStrategy
  ): Promise<string> {
    const template = this.config.responseTemplates?.clarificationRequest ||
                    "I need more information to help you with that. {question}";

    const question = "Could you please provide more details about what you're looking for?";

    return processTemplate(template, { question });
  }

  /**
   * Generate an error response
   */
  private async generateErrorResponse(
    context: ResponseContext,
    strategy: ResponseStrategy
  ): Promise<string> {
    const failedTools = context.toolResults?.filter(r => !r.success) || [];

    if (failedTools.length === 0) {
      return this.config.responseTemplates?.genericError ||
             "I apologize, but something went wrong. Please try again.";
    }

    const template = this.config.responseTemplates?.toolError ||
                    "I encountered an error while trying to {action}: {errorMessage}";

    const errorMessages = failedTools
      .map(t => t.error || 'Unknown error')
      .join('; ');

    return processTemplate(template, {
      action: 'process your request',
      errorMessage: errorMessages
    });
  }

  /**
   * Generate a direct response
   */
  private async generateDirectResponse(
    context: ResponseContext,
    strategy: ResponseStrategy
  ): Promise<string> {
    // Build conversation history for context
    const messages: OpenRouterMessage[] = this.buildConversationContext(context);

    // Add the current message
    messages.push({
      role: 'user',
      content: context.originalMessage
    });

    try {
      const response = await this.llmService.getAiResponse({ messages });
      return response;
    } catch (error) {
      console.error('[ResponseGenerator] Error calling LLM:', error);

      // Fallback to a simple response
      if (context.originalMessage.toLowerCase().includes('hello') ||
          context.originalMessage.toLowerCase().includes('hi')) {
        return getRandomGreeting(this.config.responseTemplates?.greetings);
      }

      return "I'm sorry, I couldn't process your request at the moment. Please try again.";
    }
  }

  /**
   * Build conversation context for LLM
   */
  private buildConversationContext(context: ResponseContext): OpenRouterMessage[] {
    let systemPrompt = `You are a helpful assistant. Respond in a ${context.constraints.tone || 'casual'} tone.
                  Keep responses concise and under ${context.constraints.maxLength || 500} characters.`;

    // Add moderation feedback if present
    if (context.moderationFeedback) {
      systemPrompt += `\n\nIMPORTANT: ${context.moderationFeedback}`;
    }

    const messages: OpenRouterMessage[] = [
      {
        role: 'system',
        content: systemPrompt
      }
    ];

    // Add conversation history
    const recentMessages = context.conversationHistory.slice(-5); // Last 5 messages

    for (const msg of recentMessages) {
      messages.push({
        role: msg.metadata.source === 'system' ? 'assistant' : 'user',
        content: msg.content
      });
    }

    return messages;
  }

  /**
   * Apply formatting to the response
   */
  private applyFormatting(content: string, strategy: ResponseStrategy): string {
    let formatted = content;

    // Apply markdown if enabled
    if (this.config.enableMarkdown) {
      formatted = applyMarkdownFormatting(formatted);
    }

    // Add any strategy-specific formatting
    if (strategy.type === 'error') {
      formatted = `⚠️ ${formatted}`;
    }

    return formatted;
  }
}