/**
 * Tool Rules for Self-Moderation Engine
 *
 * Validates tool integration, ensures tool results are properly used,
 * and checks for appropriate tool usage in responses
 */

import { ModerationIssue, ModerationIssueType } from '../types.ts';
import { GeneratedResponse } from '../../../interfaces/message-types.ts';
import { ResponseContext } from '../../../interfaces/component-interfaces.ts';
import { ToolResult } from '../../mcp-tool-manager/types.ts';

/**
 * Tool rule interface
 */
export interface ToolRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  severity: 'low' | 'medium' | 'high';
  check: (response: GeneratedResponse, context?: ResponseContext) => Promise<ModerationIssue[]>;
}

/**
 * Tool validation rules
 */
export const toolRules: ToolRule[] = [
  {
    id: 'tool-result-integration',
    name: 'Tool Result Integration Check',
    description: 'Ensures tool results are properly integrated into responses',
    enabled: true,
    severity: 'high',
    check: async (response: GeneratedResponse, context?: ResponseContext): Promise<ModerationIssue[]> => {
      const issues: ModerationIssue[] = [];

      if (!context?.toolResults || context.toolResults.length === 0) {
        return issues; // No tools used, nothing to check
      }

      const responseContent = response.content.toLowerCase();
      const successfulResults = context.toolResults.filter(result => result.success);

      // If all tools failed, response should acknowledge this
      if (successfulResults.length === 0) {
        const acknowledgesFailure = /\b(failed|error|unable|couldn't|could not|problem)\b/i.test(response.content);

        if (!acknowledgesFailure) {
          issues.push({
            type: ModerationIssueType.TOOL_RESULTS_NOT_INTEGRATED,
            severity: 'high',
            description: 'Response does not acknowledge that tool execution failed'
          });
        }
        return issues;
      }

      // Check if successful tool results are referenced
      let integratedCount = 0;

      for (const result of successfulResults) {
        let isIntegrated = false;

        // Check for direct output integration
        if (result.output && typeof result.output === 'string') {
          // Look for key terms or values from the output
          const outputTerms = extractKeyTermsFromOutput(result.output);
          const foundTerms = outputTerms.filter(term =>
            responseContent.includes(term.toLowerCase())
          );

          if (foundTerms.length >= Math.min(2, outputTerms.length)) {
            isIntegrated = true;
          }
        }

        // Check for tool name reference
        if (responseContent.includes(result.toolId.toLowerCase())) {
          isIntegrated = true;
        }

        // Check for structured data integration
        if (result.output && typeof result.output === 'object') {
          const jsonKeys = Object.keys(result.output);
          const foundKeys = jsonKeys.filter(key =>
            responseContent.includes(key.toLowerCase())
          );

          if (foundKeys.length > 0) {
            isIntegrated = true;
          }
        }

        if (isIntegrated) {
          integratedCount++;
        }
      }

      // Require at least 50% of successful results to be integrated
      const integrationRatio = integratedCount / successfulResults.length;

      if (integrationRatio < 0.5) {
        issues.push({
          type: ModerationIssueType.TOOL_RESULTS_NOT_INTEGRATED,
          severity: 'high',
          description: `Only ${integratedCount} of ${successfulResults.length} tool results are integrated into the response`
        });
      }

      return issues;
    }
  },

  {
    id: 'tool-accuracy',
    name: 'Tool Result Accuracy Check',
    description: 'Ensures tool results are not misrepresented',
    enabled: true,
    severity: 'high',
    check: async (response: GeneratedResponse, context?: ResponseContext): Promise<ModerationIssue[]> => {
      const issues: ModerationIssue[] = [];

      if (!context?.toolResults || context.toolResults.length === 0) {
        return issues;
      }

      const responseContent = response.content;

      // Check for common misrepresentations
      for (const result of context.toolResults) {
        if (!result.success && result.error) {
          // Check if response claims success for failed tools
          const successClaims = [
            new RegExp(`${result.toolId}.*successfully`, 'i'),
            new RegExp(`successfully.*${result.toolId}`, 'i'),
            new RegExp(`${result.toolId}.*completed`, 'i')
          ];

          for (const pattern of successClaims) {
            if (pattern.test(responseContent)) {
              issues.push({
                type: ModerationIssueType.MISREPRESENTED_TOOL_OUTPUT,
                severity: 'high',
                description: `Response claims success for failed tool: ${result.toolId}`
              });
              break;
            }
          }
        }

        // Check for numerical accuracy if tool returned numbers
        if (result.output && typeof result.output === 'object') {
          const numbers = extractNumbersFromObject(result.output);

          for (const { key, value } of numbers) {
            // Look for the key near a different number
            const keyIndex = responseContent.toLowerCase().indexOf(key.toLowerCase());
            if (keyIndex !== -1) {
              const nearbyText = responseContent.substring(
                Math.max(0, keyIndex - 50),
                Math.min(responseContent.length, keyIndex + 50)
              );

              const responseNumbers = nearbyText.match(/\d+\.?\d*/g) || [];
              const hasCorrectNumber = responseNumbers.some(num =>
                Math.abs(parseFloat(num) - value) < 0.01
              );

              if (responseNumbers.length > 0 && !hasCorrectNumber) {
                issues.push({
                  type: ModerationIssueType.MISREPRESENTED_TOOL_OUTPUT,
                  severity: 'medium',
                  description: `Potential numerical inaccuracy for ${key}: tool returned ${value}`
                });
              }
            }
          }
        }
      }

      return issues;
    }
  },

  {
    id: 'tool-timeliness',
    name: 'Tool Result Timeliness Check',
    description: 'Ensures tool results are current and not outdated',
    enabled: true,
    severity: 'medium',
    check: async (response: GeneratedResponse, context?: ResponseContext): Promise<ModerationIssue[]> => {
      const issues: ModerationIssue[] = [];

      if (!context?.toolResults || context.toolResults.length === 0) {
        return issues;
      }

      const responseContent = response.content.toLowerCase();

      // Check for time-sensitive tool results
      for (const result of context.toolResults) {
        if (result.success && result.output) {
          // Check for weather-related tools
          if (result.toolId.toLowerCase().includes('weather')) {
            const hasTemporal = /\b(current|now|today|forecast)\b/i.test(response.content);

            if (!hasTemporal) {
              issues.push({
                type: ModerationIssueType.OUTDATED_TOOL_RESULTS,
                severity: 'medium',
                description: 'Weather information should specify temporal context (current, forecast, etc.)'
              });
            }
          }

          // Check for price/stock related tools
          if (result.toolId.toLowerCase().match(/price|stock|market|rate/)) {
            const hasTimestamp = /\b(as of|current|latest|updated)\b/i.test(response.content);

            if (!hasTimestamp) {
              issues.push({
                type: ModerationIssueType.OUTDATED_TOOL_RESULTS,
                severity: 'medium',
                description: 'Financial/market data should include timestamp or recency indicator'
              });
            }
          }
        }
      }

      return issues;
    }
  },

  {
    id: 'tool-attribution',
    name: 'Tool Attribution Check',
    description: 'Ensures proper attribution of information from tools',
    enabled: true,
    severity: 'low',
    check: async (response: GeneratedResponse, context?: ResponseContext): Promise<ModerationIssue[]> => {
      const issues: ModerationIssue[] = [];

      if (!context?.toolResults || context.toolResults.length === 0) {
        return issues;
      }

      const responseContent = response.content.toLowerCase();
      const hasMultipleTools = context.toolResults.length > 1;
      const hasExternalTools = context.toolResults.some(result =>
        result.toolId.toLowerCase().includes('search') ||
        result.toolId.toLowerCase().includes('api') ||
        result.toolId.toLowerCase().includes('fetch')
      );

      // If using external data sources, should attribute
      if (hasExternalTools) {
        const attributionPatterns = [
          /\b(according to|based on|from|via|using|source)\b/i,
          /\b(search results|api|data from)\b/i
        ];

        const hasAttribution = attributionPatterns.some(pattern => pattern.test(response.content));

        if (!hasAttribution) {
          issues.push({
            type: ModerationIssueType.TOOL_RESULTS_NOT_INTEGRATED,
            severity: 'low',
            description: 'Response should attribute information from external tools/sources'
          });
        }
      }

      // If multiple tools used, should clarify which info comes from where
      if (hasMultipleTools && !hasExternalTools) {
        const toolNames = context.toolResults.map(r => r.toolId.toLowerCase());
        const mentionedTools = toolNames.filter(name => responseContent.includes(name));

        if (mentionedTools.length === 0) {
          issues.push({
            type: ModerationIssueType.TOOL_RESULTS_NOT_INTEGRATED,
            severity: 'low',
            description: 'Response uses multiple tools but doesn\'t clarify information sources'
          });
        }
      }

      return issues;
    }
  }
];

/**
 * Extract key terms from tool output for integration checking
 */
function extractKeyTermsFromOutput(output: string): string[] {
  // Remove common words and extract meaningful terms
  const commonWords = new Set([
    'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but',
    'in', 'with', 'from', 'for', 'to', 'of', 'as', 'by', 'that', 'this',
    'it', 'be', 'are', 'was', 'were', 'been', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might'
  ]);

  // Extract words and numbers
  const terms = output.match(/\b[\w\d]+\b/g) || [];

  return terms
    .filter(term => term.length > 3)
    .filter(term => !commonWords.has(term.toLowerCase()))
    .filter(term => !/^\d+$/.test(term) || term.length === 4) // Keep 4-digit numbers (years)
    .slice(0, 10); // Limit to top 10 terms
}

/**
 * Extract numbers from an object for accuracy checking
 */
function extractNumbersFromObject(obj: any, prefix: string = ''): Array<{ key: string; value: number }> {
  const numbers: Array<{ key: string; value: number }> = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'number') {
      numbers.push({ key: fullKey, value });
    } else if (typeof value === 'string' && /^\d+\.?\d*$/.test(value)) {
      numbers.push({ key: fullKey, value: parseFloat(value) });
    } else if (typeof value === 'object' && value !== null) {
      numbers.push(...extractNumbersFromObject(value, fullKey));
    }
  }

  return numbers;
}

/**
 * Apply tool rules to a response
 */
export async function applyToolRules(
  response: GeneratedResponse,
  context?: ResponseContext
): Promise<ModerationIssue[]> {
  const allIssues: ModerationIssue[] = [];

  for (const rule of toolRules) {
    if (rule.enabled) {
      try {
        const issues = await rule.check(response, context);
        allIssues.push(...issues);
      } catch (error) {
        console.error(`Error applying tool rule ${rule.id}:`, error);
      }
    }
  }

  return allIssues;
}

/**
 * Generate tool integration suggestions
 */
export function generateToolIntegrationHints(
  toolResults: ToolResult[]
): string[] {
  const hints: string[] = [];

  for (const result of toolResults) {
    if (result.success) {
      if (typeof result.output === 'string') {
        hints.push(`Include key information from ${result.toolId}: "${result.output.substring(0, 100)}..."`);
      } else if (typeof result.output === 'object') {
        const keys = Object.keys(result.output).slice(0, 3).join(', ');
        hints.push(`Reference data from ${result.toolId} including: ${keys}`);
      }
    } else {
      hints.push(`Acknowledge that ${result.toolId} failed: ${result.error}`);
    }
  }

  return hints;
}