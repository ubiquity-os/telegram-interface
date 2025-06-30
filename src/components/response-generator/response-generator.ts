/**
 * Response Generator Implementation
 *
 * Generates natural language responses based on Decision Engine decisions
 * and tool results, formatted for Telegram
 */

import { injectable, inject } from 'inversify';
import { TYPES } from '../../core/types.ts';
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
import { LlmService } from '../../services/llm-service/index.ts';
import { OpenRouterMessage } from '../../services/openrouter-types.ts';

import type {
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
  defaultModel: 'microsoft/mai-ds-r1:free',
  temperature: 0.7,
  // Don't artificially limit free models - let them use their natural token limits
  maxResponseLength: 4096,
  enableMarkdown: true,
  responseTemplates: DEFAULT_TEMPLATES,
  maxButtonsPerRow: 3,
  maxRows: 10
};

/**
 * Response Generator component
 */
@injectable()
export class ResponseGenerator implements IResponseGenerator, IComponent {
  public readonly name = 'ResponseGenerator';
  private config: ResponseGeneratorConfig;
  private llmService: LlmService;
  private isInitialized = false;
  private eventEmitter = createEventEmitter('ResponseGenerator');

  constructor(
    @inject(TYPES.LLMService) llmService: LlmService,
    @inject(TYPES.ResponseGeneratorConfig) config: ResponseGeneratorConfig
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
    console.log(`=== RESPONSE GENERATOR CALLED ===`);
    console.log(`[ResponseGenerator] generateResponse called with context:`, JSON.stringify(context, null, 2));

    const startTime = Date.now();

    try {
      // Determine response strategy
      const strategy = this.determineResponseStrategy(context);
      console.log(`[ResponseGenerator] Determined strategy:`, JSON.stringify(strategy, null, 2));

      // Generate response content based on strategy
      let content: string;

      switch (strategy.type) {
        case 'tool_based':
          console.log(`[ResponseGenerator] Using tool_based strategy`);
          content = await this.generateToolBasedResponse(context, strategy);
          break;
        case 'clarification':
          console.log(`[ResponseGenerator] Using clarification strategy`);
          content = await this.generateClarificationResponse(context, strategy);
          break;
        case 'error':
          console.log(`[ResponseGenerator] Using error strategy`);
          content = await this.generateErrorResponse(context, strategy);
          break;
        case 'direct':
        default:
          console.log(`[ResponseGenerator] Using direct strategy`);
          content = await this.generateDirectResponse(context, strategy);
      }

      console.log(`[ResponseGenerator] Generated content: "${content}"`);

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
      const response = await this.llmService.generateResponse(messages, {
        models: [this.config.defaultModel],
        temperature: this.config.temperature
      });
      return response.content;
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
    console.log(`=== LLM SERVICE CALLED ===`);
    console.log(`[ResponseGenerator] generateDirectResponse called with context:`, {
      originalMessage: context.originalMessage,
      analysisIntent: context.analysis?.intent,
      analysisConfidence: context.analysis?.confidence,
      conversationHistoryLength: context.conversationHistory?.length || 0,
      constraints: context.constraints
    });

    console.log(`[ResponseGenerator] STARTING buildConversationContext() call`);

    // Build conversation history for context - this should NOT include the current message
    const messages: OpenRouterMessage[] = this.buildConversationContext(context);

    console.log(`[ResponseGenerator] RETURNED from buildConversationContext() with ${messages.length} messages`);

    // CRITICAL FIX: Always add the current message as it's the new user input we're responding to
    // The buildConversationContext should only process existing conversation history
    console.log(`[ResponseGenerator] Adding current message: "${context.originalMessage}"`);

    messages.push({
      role: 'user',
      content: context.originalMessage
    });

    console.log(`[ResponseGenerator] After adding current message: ${messages.length} messages total`);
    console.log(`[ResponseGenerator] Built messages for LLM:`, JSON.stringify(messages, null, 2));

    try {
      const response = await this.llmService.getAiResponse({ messages });
      return response;
    } catch (error) {
      console.error('[ResponseGenerator] LLM service error:', error);
      return this.generateContextAwareFallback(context);
    }
  }

  /**
   * Build conversation context for LLM
   */
  private buildConversationContext(context: ResponseContext): OpenRouterMessage[] {
    console.log(`[ResponseGenerator] *** ENTERING buildConversationContext() ***`);
    console.log(`[ResponseGenerator] Context received:`, {
      conversationHistoryLength: context.conversationHistory?.length || 0,
      originalMessage: context.originalMessage
    });

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

    console.log(`[ResponseGenerator] CONVERSATION HISTORY DEBUG:`);
    console.log(`[ResponseGenerator] Total history length: ${context.conversationHistory.length}`);
    console.log(`[ResponseGenerator] Recent messages to process: ${recentMessages.length}`);
    console.log(`[ResponseGenerator] Full conversation history:`, JSON.stringify(context.conversationHistory, null, 2));

    for (let i = 0; i < recentMessages.length; i++) {
      const msg = recentMessages[i];
      console.log(`[ResponseGenerator] Processing message ${i + 1}/${recentMessages.length}:`);
      console.log(`[ResponseGenerator]   - ID: ${msg.id}`);
      console.log(`[ResponseGenerator]   - Content: "${msg.content}"`);
      console.log(`[ResponseGenerator]   - Source: ${msg.metadata.source}`);

      const role = msg.metadata.source === 'system' ? 'assistant' : 'user';
      console.log(`[ResponseGenerator]   - Mapped to role: ${role}`);

      messages.push({
        role,
        content: msg.content
      });

      console.log(`[ResponseGenerator]   - Added to messages array (total now: ${messages.length})`);
    }

    console.log(`[ResponseGenerator] FINAL MESSAGES ARRAY:`, JSON.stringify(messages, null, 2));
    return messages;
  }

  /**
   * Generate context-aware fallback response when LLM service fails
   */
  private generateContextAwareFallback(context: ResponseContext): string {
    const message = context.originalMessage.toLowerCase();
    const conversation = context.conversationHistory || [];

    console.log(`[ResponseGenerator] Generating context-aware fallback for: "${context.originalMessage}"`);
    console.log(`[ResponseGenerator] Available conversation history: ${conversation.length} messages`);

    // Handle greetings
    if (message.includes('hello') || message.includes('hi') || message.includes('hey')) {
      return getRandomGreeting(this.config.responseTemplates?.greetings);
    }

    // Handle conversation history questions
    if (conversation.length > 0) {
      // Questions about first message
      if (message.includes('first message') || message.includes('very first')) {
        const firstUserMessage = conversation.find(msg =>
          msg.metadata.source === 'telegram' && msg.content.length > 0
        );
        if (firstUserMessage) {
          return `I can see your first message was: "${firstUserMessage.content}"`;
        }
      }

      // Questions about last message
      if (message.includes('last message') || message.includes('previous message')) {
        const lastUserMessage = [...conversation]
          .reverse()
          .find(msg => msg.metadata.source === 'telegram' && msg.content.length > 0);
        if (lastUserMessage) {
          return `Your last message was: "${lastUserMessage.content}"`;
        }
      }

      // Questions about what was said
      if (message.includes('what did i say') || message.includes('what i said')) {
        const userMessages = conversation
          .filter(msg => msg.metadata.source === 'telegram')
          .slice(-3); // Last 3 user messages
        if (userMessages.length > 0) {
          const messageList = userMessages.map((msg, i) => `${i + 1}. "${msg.content}"`).join('\n');
          return `Here are your recent messages:\n${messageList}`;
        }
      }

      // Questions about what bot said
      if (message.includes('what did you say') || message.includes('what you said')) {
        const botMessages = conversation
          .filter(msg => msg.metadata.source === 'system')
          .slice(-3); // Last 3 bot messages
        if (botMessages.length > 0) {
          const messageList = botMessages.map((msg, i) => `${i + 1}. "${msg.content}"`).join('\n');
          return `Here are my recent responses:\n${messageList}`;
        }
      }

      // General conversation summary
      if (message.includes('conversation') || message.includes('talked about')) {
        const messageCount = conversation.length;
        const userMessageCount = conversation.filter(msg => msg.metadata.source === 'telegram').length;
        return `We've exchanged ${messageCount} messages so far. You've sent ${userMessageCount} messages and I've responded ${messageCount - userMessageCount} times.`;
      }

      // Questions about specific content
      if (message.includes('about') || message.includes('mentioned')) {
        const recentMessages = conversation.slice(-5);
        const hasContent = recentMessages.some(msg => msg.content.length > 10);
        if (hasContent) {
          return `I can see we've been discussing various topics. While I can't process your full request right now, I can see our conversation history and will reference it when my main systems are available.`;
        }
      }
    }

    // Handle commands or direct requests
    if (message.includes('help') || message.startsWith('/help')) {
      return `I'm having technical difficulties with my main AI system, but I can still access our conversation history. Try asking me about our previous messages or wait a moment for my full capabilities to return.`;
    }

    // Default context-aware fallback
    if (conversation.length > 0) {
      return `I'm experiencing technical difficulties with my main AI system, but I can see we have ${conversation.length} messages in our conversation. Feel free to ask about our previous discussion or try your request again in a moment.`;
    }

    // Complete fallback when no context is available
    return "I'm sorry, I'm experiencing technical difficulties and couldn't process your request. Please try again in a moment.";
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
