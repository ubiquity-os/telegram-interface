/**
 * Response Generator Types
 */

import {
  ResponseContext,
  ToolResult,
  Decision,
  ResponseConstraints
} from '../../interfaces/component-interfaces.ts';

import {
  GeneratedResponse,
  InlineKeyboard,
  MessageAnalysis
} from '../../interfaces/message-types.ts';

import { LlmService } from '../../services/llm-service/index.ts';

// Re-export common types for convenience
export type {
  ResponseContext,
  GeneratedResponse,
  InlineKeyboard,
  ToolResult,
  ResponseConstraints
};

/**
 * Response Generator configuration
 */
export interface ResponseGeneratorConfig {
  // Model configuration
  defaultModel?: string;
  temperature?: number;
  maxTokens?: number;

  // Response formatting
  maxResponseLength?: number; // Telegram has 4096 char limit
  enableMarkdown?: boolean;

  // Template configuration
  responseTemplates?: ResponseTemplates;

  // Keyboard configuration
  maxButtonsPerRow?: number;
  maxRows?: number;
}

/**
 * Response templates for different scenarios
 */
export interface ResponseTemplates {
  toolSuccess?: string;
  toolError?: string;
  clarificationRequest?: string;
  genericError?: string;
  greetings?: string[];
}

/**
 * Response generation strategy
 */
export interface ResponseStrategy {
  type: 'direct' | 'tool_based' | 'clarification' | 'error';
  tone?: 'formal' | 'casual' | 'technical';
  includeKeyboard?: boolean;
  keyboardOptions?: string[];
  maxLength?: number;
}

/**
 * Response formatting options
 */
export interface FormattingOptions {
  useMarkdown: boolean;
  includeToolDetails: boolean;
  summarizeToolResults: boolean;
  addTimestamp: boolean;
}

/**
 * Tool result formatting context
 */
export interface ToolResultFormattingContext {
  results: ToolResult[];
  userQuery: string;
  analysis: MessageAnalysis;
}

/**
 * Response validation result
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Response Generator interface implementation requirements
 */
export interface IResponseGeneratorImplementation {
  // Configuration
  config: ResponseGeneratorConfig;

  // Services
  llmService: LlmService;

  // Core methods from interface
  generateResponse(context: ResponseContext): Promise<GeneratedResponse>;
  formatToolResults(results: ToolResult[]): string;
  createInlineKeyboard(options: string[]): InlineKeyboard;
  validateResponse(response: GeneratedResponse): Promise<boolean>;

  // Additional internal methods
  determineResponseStrategy(context: ResponseContext): ResponseStrategy;
  applyTemplates(content: string, template: string): string;
  truncateResponse(content: string, maxLength: number): string;
}

/**
 * Response metadata extensions
 */
export interface ExtendedResponseMetadata {
  model: string;
  tokensUsed: number;
  processingTime: number;
  toolsUsed: string[];
  strategy: ResponseStrategy;
  formattingApplied: FormattingOptions;
  validationPassed: boolean;
}

/**
 * Keyboard builder options
 */
export interface KeyboardBuilderOptions {
  maxButtonsPerRow: number;
  maxRows: number;
  buttonStyle?: 'compact' | 'full';
}

/**
 * Template variable context
 */
export interface TemplateContext {
  userName?: string;
  toolName?: string;
  toolOutput?: string;
  errorMessage?: string;
  timestamp?: string;
  [key: string]: any;
}