/**
 * Quality Rules for Self-Moderation Engine
 *
 * Ensures response quality, coherence, completeness, and proper formatting
 */

import { ModerationIssue, ModerationIssueType } from '../types.ts';
import { GeneratedResponse } from '../../../interfaces/message-types.ts';
import { ResponseContext } from '../../../interfaces/component-interfaces.ts';

/**
 * Quality rule interface
 */
export interface QualityRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  severity: 'low' | 'medium' | 'high';
  check: (response: GeneratedResponse, context?: ResponseContext) => Promise<ModerationIssue[]>;
}

/**
 * Quality validation rules
 */
export const qualityRules: QualityRule[] = [
  {
    id: 'response-completeness',
    name: 'Response Completeness Check',
    description: 'Ensures responses are complete and not cut off',
    enabled: true,
    severity: 'high',
    check: async (response: GeneratedResponse): Promise<ModerationIssue[]> => {
      const issues: ModerationIssue[] = [];
      const content = response.content.trim();

      // Check for empty response
      if (!content) {
        issues.push({
          type: ModerationIssueType.INCOMPLETE_RESPONSE,
          severity: 'high',
          description: 'Response is empty'
        });
        return issues;
      }

      // Check for very short responses (less than 10 characters)
      if (content.length < 10) {
        issues.push({
          type: ModerationIssueType.INCOMPLETE_RESPONSE,
          severity: 'medium',
          description: 'Response is too short to be meaningful'
        });
      }

      // Check for incomplete sentences (ends without proper punctuation)
      const lastChar = content[content.length - 1];
      const properEndings = ['.', '!', '?', ':', ')', ']', '}', '"', "'"];
      const lastSentence = content.split(/[.!?]/).pop()?.trim() || '';

      if (lastSentence.length > 20 && !properEndings.includes(lastChar)) {
        issues.push({
          type: ModerationIssueType.INCOMPLETE_RESPONSE,
          severity: 'medium',
          description: 'Response appears to be cut off mid-sentence'
        });
      }

      // Check for ellipsis at the end suggesting incomplete thought
      if (content.endsWith('...') && !content.endsWith('....')) {
        issues.push({
          type: ModerationIssueType.INCOMPLETE_RESPONSE,
          severity: 'low',
          description: 'Response ends with ellipsis, suggesting incomplete thought'
        });
      }

      return issues;
    }
  },

  {
    id: 'coherence-check',
    name: 'Response Coherence Check',
    description: 'Validates response coherence and logical flow',
    enabled: true,
    severity: 'medium',
    check: async (response: GeneratedResponse, context?: ResponseContext): Promise<ModerationIssue[]> => {
      const issues: ModerationIssue[] = [];
      const content = response.content;

      // Check for excessive repetition of phrases
      const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
      const sentenceSet = new Set<string>();
      let repetitionCount = 0;

      for (const sentence of sentences) {
        const normalized = sentence.trim().toLowerCase();
        if (sentenceSet.has(normalized)) {
          repetitionCount++;
        }
        sentenceSet.add(normalized);
      }

      if (repetitionCount > 2) {
        issues.push({
          type: ModerationIssueType.INCOHERENT_RESPONSE,
          severity: 'medium',
          description: `Response contains ${repetitionCount} repeated sentences`
        });
      }

      // Check for contradictions (simple heuristic)
      const contradictionPatterns = [
        /\b(yes|true|correct|right)\b.*\b(no|false|incorrect|wrong)\b/gi,
        /\b(always|all|every)\b.*\b(never|none|no)\b/gi,
        /\b(can|able|possible)\b.*\b(cannot|unable|impossible)\b/gi
      ];

      for (const pattern of contradictionPatterns) {
        if (pattern.test(content)) {
          issues.push({
            type: ModerationIssueType.CONTRADICTORY_INFORMATION,
            severity: 'medium',
            description: 'Response may contain contradictory statements'
          });
          break;
        }
      }

      // Check for random character sequences that suggest corruption
      if (/[^\s]{50,}/.test(content)) {
        issues.push({
          type: ModerationIssueType.INCOHERENT_RESPONSE,
          severity: 'high',
          description: 'Response contains unusually long unbroken character sequences'
        });
      }

      return issues;
    }
  },

  {
    id: 'formatting-validation',
    name: 'Format and Structure Validation',
    description: 'Checks for proper formatting and markdown structure',
    enabled: true,
    severity: 'low',
    check: async (response: GeneratedResponse): Promise<ModerationIssue[]> => {
      const issues: ModerationIssue[] = [];
      const content = response.content;

      // Check for unclosed markdown elements
      const markdownPairs = [
        { open: '```', close: '```', name: 'code blocks' },
        { open: '`', close: '`', name: 'inline code' },
        { open: '**', close: '**', name: 'bold text' },
        { open: '*', close: '*', name: 'italic text' },
        { open: '[', close: ']', name: 'links' },
        { open: '(', close: ')', name: 'parentheses' }
      ];

      for (const pair of markdownPairs) {
        const openCount = (content.match(new RegExp(pair.open.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        const closeCount = (content.match(new RegExp(pair.close.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

        if (openCount !== closeCount && Math.abs(openCount - closeCount) > 1) {
          issues.push({
            type: ModerationIssueType.BROKEN_MARKUP,
            severity: 'low',
            description: `Unclosed ${pair.name}: ${openCount} opening, ${closeCount} closing`
          });
        }
      }

      // Check for broken lists
      const lines = content.split('\n');
      let inList = false;
      let listIndent = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+/);

        if (listMatch) {
          if (!inList) {
            inList = true;
            listIndent = listMatch[1].length;
          } else if (Math.abs(listMatch[1].length - listIndent) > 4) {
            issues.push({
              type: ModerationIssueType.BROKEN_MARKUP,
              severity: 'low',
              description: `Inconsistent list indentation at line ${i + 1}`
            });
          }
        } else if (inList && line.trim() && !line.startsWith(' '.repeat(listIndent))) {
          inList = false;
        }
      }

      // Check for excessive blank lines
      if (/\n{4,}/.test(content)) {
        issues.push({
          type: ModerationIssueType.INVALID_FORMAT,
          severity: 'low',
          description: 'Response contains excessive blank lines'
        });
      }

      return issues;
    }
  },

  {
    id: 'relevance-check',
    name: 'Response Relevance Check',
    description: 'Ensures response is relevant to the original query',
    enabled: true,
    severity: 'high',
    check: async (response: GeneratedResponse, context?: ResponseContext): Promise<ModerationIssue[]> => {
      const issues: ModerationIssue[] = [];

      if (!context?.originalMessage) {
        return issues; // Can't check relevance without context
      }

      const responseContent = response.content.toLowerCase();
      const originalMessage = context.originalMessage.toLowerCase();

      // Extract key terms from the original message
      const queryTerms = originalMessage
        .split(/\s+/)
        .filter(term => term.length > 3)
        .filter(term => !['what', 'when', 'where', 'which', 'that', 'this', 'with', 'from', 'have', 'will'].includes(term));

      // Count how many query terms appear in the response
      const matchedTerms = queryTerms.filter(term => responseContent.includes(term));
      const relevanceRatio = queryTerms.length > 0 ? matchedTerms.length / queryTerms.length : 1;

      // If less than 20% of key terms are in the response, it might be off-topic
      if (relevanceRatio < 0.2 && queryTerms.length > 2) {
        issues.push({
          type: ModerationIssueType.IRRELEVANT_RESPONSE,
          severity: 'high',
          description: 'Response appears to be off-topic or unrelated to the query'
        });
      }

      // Check for generic responses that don't address the specific query
      const genericPhrases = [
        /^i understand/i,
        /^i see/i,
        /^that's interesting/i,
        /^thank you for/i,
        /^i appreciate/i
      ];

      const firstSentence = response.content.split(/[.!?]/)[0].trim();
      const isGenericStart = genericPhrases.some(pattern => pattern.test(firstSentence));

      if (isGenericStart && relevanceRatio < 0.5) {
        issues.push({
          type: ModerationIssueType.OFF_TOPIC,
          severity: 'medium',
          description: 'Response starts with generic phrase and may not address the specific query'
        });
      }

      return issues;
    }
  },

  {
    id: 'length-validation',
    name: 'Response Length Validation',
    description: 'Ensures response length is appropriate',
    enabled: true,
    severity: 'medium',
    check: async (response: GeneratedResponse, context?: ResponseContext): Promise<ModerationIssue[]> => {
      const issues: ModerationIssue[] = [];
      const content = response.content;
      const maxLength = context?.constraints?.maxLength || 4096;

      // Check if response exceeds maximum length
      if (content.length > maxLength) {
        issues.push({
          type: ModerationIssueType.EXCESSIVE_LENGTH,
          severity: 'high',
          description: `Response exceeds maximum length: ${content.length}/${maxLength} characters`
        });
      }

      // Check if response is too long for a simple query
      if (context?.originalMessage) {
        const queryLength = context.originalMessage.length;
        const responseLength = content.length;

        // If response is more than 20x the query length for short queries
        if (queryLength < 50 && responseLength > queryLength * 20) {
          issues.push({
            type: ModerationIssueType.EXCESSIVE_LENGTH,
            severity: 'low',
            description: 'Response may be unnecessarily verbose for the query'
          });
        }
      }

      return issues;
    }
  }
];

/**
 * Apply quality rules to a response
 */
export async function applyQualityRules(
  response: GeneratedResponse,
  context?: ResponseContext
): Promise<ModerationIssue[]> {
  const allIssues: ModerationIssue[] = [];

  for (const rule of qualityRules) {
    if (rule.enabled) {
      try {
        const issues = await rule.check(response, context);
        allIssues.push(...issues);
      } catch (error) {
        console.error(`Error applying quality rule ${rule.id}:`, error);
      }
    }
  }

  return allIssues;
}

/**
 * Attempt to fix common quality issues in a response
 */
export function improveResponseQuality(response: GeneratedResponse): GeneratedResponse {
  let improvedContent = response.content;

  // Fix excessive blank lines
  improvedContent = improvedContent.replace(/\n{4,}/g, '\n\n');

  // Ensure proper sentence ending
  const lastChar = improvedContent[improvedContent.length - 1];
  const properEndings = ['.', '!', '?', ':', ')', ']', '}'];
  if (!properEndings.includes(lastChar) && improvedContent.length > 20) {
    // Add period if the last sentence seems complete
    const lastSentence = improvedContent.split(/[.!?]/).pop()?.trim() || '';
    if (lastSentence.split(' ').length > 3) {
      improvedContent += '.';
    }
  }

  // Fix common markdown issues
  // Balance code blocks
  const codeBlockCount = (improvedContent.match(/```/g) || []).length;
  if (codeBlockCount % 2 !== 0) {
    improvedContent += '\n```';
  }

  return {
    ...response,
    content: improvedContent
  };
}