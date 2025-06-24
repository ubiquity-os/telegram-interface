/**
 * Response Generator types and interfaces
 */

import {
  GeneratedResponse,
  MessageAnalysis,
  InternalMessage,
  InlineKeyboard
} from '../../interfaces/message-types.ts';

import {
  ToolResult,
  ResponseContext,
  ResponseConstraints
} from '../../interfaces/component-interfaces.ts';

// Re-export for convenience
export type {
  GeneratedResponse,
  MessageAnalysis,
  InternalMessage,
  InlineKeyboard,
  ToolResult,
  ResponseContext,
  ResponseConstraints
};

/**
 * Response generator configuration
 */
export interface ResponseGeneratorConfig {
  model: string;
  maxTokens: number;
  temperature: number;
  responseTimeout: number;
  enableMarkdown: boolean;
  debugMode: boolean;
}

/**
 * Response template configuration
 */
export interface ResponseTemplate {
  name: string;
  pattern: string;
  variables: string[];
  tone: 'formal' | 'casual' | 'technical';
  useCase: string;
}

/**
 * Formatting options for responses
 */
export interface FormattingOptions {
  maxLength: number;
  allowMarkdown: boolean;
  preserveNewlines: boolean;
  truncateStrategy: 'words' | 'sentences' | 'characters';
  ellipsis: string;
}

/**
 * Tool result formatting configuration
 */
export interface ToolResultFormatter {
  type: 'json' | 'table' | 'list' | 'text';
  includeMetadata: boolean;
  groupByTool: boolean;
  showErrors: boolean;
}

/**
 * Response validation result
 */
export interface ValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
  suggestedFixes?: string[];
  severity: 'low' | 'medium' | 'high';
}

/**
 * Response validation issue
 */
export interface ValidationIssue {
  type: 'length' | 'format' | 'content' | 'safety';
  message: string;
  location?: string;
  suggestion?: string;
}

/**
 * Response generation metrics
 */
export interface ResponseMetrics {
  totalResponses: number;
  averageGenerationTime: number;
  averageLength: number;
  formatDistribution: Record<string, number>;
  validationFailureRate: number;
  toneDistribution: Record<string, number>;
}

/**
 * Inline keyboard configuration
 */
export interface KeyboardConfig {
  maxButtonsPerRow: number;
  maxRows: number;
  style: 'minimal' | 'detailed' | 'contextual';
  includeHelp: boolean;
}

/**
 * Response personalization settings
 */
export interface PersonalizationSettings {
  userId: number;
  preferredTone?: 'formal' | 'casual' | 'technical';
  language?: string;
  timezone?: string;
  customTemplates?: ResponseTemplate[];
}