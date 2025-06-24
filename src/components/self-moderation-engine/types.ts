/**
 * Self-Moderation Engine Types
 *
 * Defines interfaces and types for response validation and moderation
 */

import { GeneratedResponse } from '../../interfaces/message-types.ts';
import { ResponseContext } from '../../interfaces/component-interfaces.ts';
import { ToolResult } from '../mcp-tool-manager/types.ts';

/**
 * Moderation result
 */
export interface ModerationResult {
  approved: boolean;
  issues?: ModerationIssue[];
  suggestions?: string[];
  confidence: number;
  moderationTime?: number;
}

/**
 * Moderation issue types
 */
export interface ModerationIssue {
  type: ModerationIssueType;
  severity: 'low' | 'medium' | 'high';
  description: string;
  location?: {
    start: number;
    end: number;
  };
}

/**
 * Types of moderation issues
 */
export enum ModerationIssueType {
  // Content issues
  INAPPROPRIATE_CONTENT = 'inappropriate_content',
  UNSAFE_CONTENT = 'unsafe_content',
  SPAM_CONTENT = 'spam_content',

  // Relevance issues
  OFF_TOPIC = 'off_topic',
  IRRELEVANT_RESPONSE = 'irrelevant_response',
  MISSING_CONTEXT = 'missing_context',

  // Format issues
  INVALID_FORMAT = 'invalid_format',
  BROKEN_MARKUP = 'broken_markup',
  EXCESSIVE_LENGTH = 'excessive_length',

  // Coherence issues
  INCOHERENT_RESPONSE = 'incoherent_response',
  CONTRADICTORY_INFORMATION = 'contradictory_information',
  INCOMPLETE_RESPONSE = 'incomplete_response',

  // Tool integration issues
  TOOL_RESULTS_NOT_INTEGRATED = 'tool_results_not_integrated',
  MISREPRESENTED_TOOL_OUTPUT = 'misrepresented_tool_output',
  OUTDATED_TOOL_RESULTS = 'outdated_tool_results'
}

/**
 * Content policy configuration
 */
export interface ContentPolicy {
  // Safety policies
  allowPersonalInfo: boolean;
  allowExternalLinks: boolean;
  allowCodeExecution: boolean;

  // Content restrictions
  maxResponseLength: number;
  requiredTone?: 'formal' | 'casual' | 'technical' | 'friendly';

  // Prohibited content patterns
  prohibitedPatterns: string[];
  sensitiveTopics: string[];
}

/**
 * Moderation configuration
 */
export interface ModerationConfig {
  // Thresholds
  confidenceThreshold: number;
  severityThreshold: 'low' | 'medium' | 'high';

  // Policies
  contentPolicy: ContentPolicy;

  // Feature flags
  enableContentFiltering: boolean;
  enableToneValidation: boolean;
  enableToolIntegrationCheck: boolean;
  enableRelevanceCheck: boolean;

  // Performance
  maxModerationTime: number;
}

/**
 * Self-Moderation Engine interface
 */
export interface ISelfModerationEngine {
  // Initialize with configuration
  initialize(config: ModerationConfig): Promise<void>;

  // Core moderation functions
  moderateResponse(
    response: GeneratedResponse,
    context: ResponseContext
  ): Promise<ModerationResult>;

  validateToolIntegration(
    response: string,
    toolResults: ToolResult[]
  ): Promise<boolean>;

  // Content validation
  validateContent(content: string): Promise<ModerationResult>;
  validateTone(content: string, expectedTone?: string): Promise<ModerationResult>;
  validateFormat(response: GeneratedResponse): Promise<ModerationResult>;

  // Policy checks
  checkContentPolicy(content: string, policy: ContentPolicy): Promise<ModerationResult>;

  // Utility functions
  sanitizeContent(content: string): string;
  suggestImprovements(issues: ModerationIssue[]): string[];

  // Configuration
  updateConfig(config: Partial<ModerationConfig>): void;
  getConfig(): ModerationConfig;
}

/**
 * Text analysis result
 */
export interface TextAnalysis {
  sentiment: 'positive' | 'negative' | 'neutral';
  tone: 'formal' | 'casual' | 'technical' | 'friendly' | 'unknown';
  topics: string[];
  entities: string[];
  flags: ContentFlag[];
}

/**
 * Content flags
 */
export interface ContentFlag {
  type: 'safety' | 'policy' | 'quality';
  reason: string;
  confidence: number;
}

/**
 * Moderation metrics
 */
export interface ModerationMetrics {
  totalModerations: number;
  approvalRate: number;
  averageModerationTime: number;
  commonIssueTypes: Record<ModerationIssueType, number>;
  averageConfidence: number;
}