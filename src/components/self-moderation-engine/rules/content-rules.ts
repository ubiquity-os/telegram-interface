/**
 * Content Rules for Self-Moderation Engine
 *
 * Enforces content policies including inappropriate content detection,
 * prohibited patterns, and sensitive topic handling
 */

import { ModerationIssue, ModerationIssueType } from '../types.ts';
import { GeneratedResponse } from '../../../interfaces/message-types.ts';

/**
 * Content rule interface
 */
export interface ContentRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  severity: 'low' | 'medium' | 'high';
  check: (content: string) => Promise<ModerationIssue[]>;
}

/**
 * Prohibited content patterns with categories
 */
const PROHIBITED_PATTERNS = {
  violence: [
    /\b(kill|murder|assault|attack|harm|hurt|injure|damage)\s+(someone|people|myself|yourself)\b/gi,
    /\b(weapon|gun|knife|bomb|explosive)\s+(making|creating|building)\b/gi,
    /\bhow\s+to\s+(kill|harm|hurt|attack)\b/gi
  ],

  illegal: [
    /\b(hack|crack|bypass|break into|exploit)\s+(system|account|password|security)\b/gi,
    /\b(illegal|illicit|unlawful)\s+(activity|download|drug|substance)\b/gi,
    /\b(piracy|copyright\s+infringement|steal\s+content)\b/gi
  ],

  personalInfo: [
    /\b(SSN|social\s+security\s+number):\s*\d{3}-?\d{2}-?\d{4}\b/gi,
    /\b(credit\s+card|card\s+number):\s*\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/gi,
    /\b(password|passcode|pin):\s*[^\s]+\b/gi,
    /\b(private\s+key|secret\s+key):\s*[A-Za-z0-9+/=]+\b/gi
  ],

  inappropriate: [
    /\b(spam|scam|phishing|fraud)\s+(email|message|link)\b/gi,
    /\b(adult|explicit|nsfw|pornographic)\s+content\b/gi,
    /\b(gambling|betting|casino)\s+(site|link|promotion)\b/gi
  ],

  manipulation: [
    /\b(pretend|act\s+as|roleplay)\s+(you\s+are|to\s+be)\s+(human|person|someone\s+else)\b/gi,
    /\b(ignore|bypass|override)\s+(your\s+)?(rules|instructions|guidelines|restrictions)\b/gi,
    /\bdo\s+not\s+follow\s+your\s+(rules|guidelines|instructions)\b/gi
  ]
};

/**
 * Sensitive topics that require careful handling
 */
const SENSITIVE_TOPICS = {
  medical: {
    patterns: [
      /\b(diagnose|diagnosis|medical\s+advice|treatment)\b/gi,
      /\b(prescription|medication|drug)\s+(recommendation|advice)\b/gi,
      /\b(symptoms?|illness|disease)\s+(diagnosis|treatment)\b/gi
    ],
    message: "Medical advice should come from qualified healthcare professionals"
  },

  legal: {
    patterns: [
      /\b(legal\s+advice|lawyer|attorney)\s+(recommendation|needed)\b/gi,
      /\b(sue|lawsuit|legal\s+action)\s+(advice|recommendation)\b/gi,
      /\b(contract|agreement)\s+(review|interpretation)\b/gi
    ],
    message: "Legal advice should come from qualified legal professionals"
  },

  financial: {
    patterns: [
      /\b(investment|trading|stock)\s+(advice|recommendation|tip)\b/gi,
      /\b(cryptocurrency|crypto|bitcoin)\s+(investment|trading)\s+advice\b/gi,
      /\b(guaranteed|risk-free)\s+(profit|return|income)\b/gi
    ],
    message: "Financial advice should come from qualified financial advisors"
  },

  crisis: {
    patterns: [
      /\b(suicide|self-harm|hurt\s+myself)\b/gi,
      /\b(depression|anxiety)\s+(severe|crisis|emergency)\b/gi,
      /\b(mental\s+health)\s+(crisis|emergency)\b/gi
    ],
    message: "Please contact emergency services or crisis helplines for immediate assistance"
  }
};

/**
 * Content validation rules
 */
export const contentRules: ContentRule[] = [
  {
    id: 'prohibited-content',
    name: 'Prohibited Content Detection',
    description: 'Detects content matching prohibited patterns',
    enabled: true,
    severity: 'high',
    check: async (content: string): Promise<ModerationIssue[]> => {
      const issues: ModerationIssue[] = [];

      for (const [category, patterns] of Object.entries(PROHIBITED_PATTERNS)) {
        for (const pattern of patterns) {
          if (pattern.test(content)) {
            issues.push({
              type: ModerationIssueType.INAPPROPRIATE_CONTENT,
              severity: 'high',
              description: `Content contains prohibited ${category} content`
            });
            break; // One issue per category
          }
        }
      }

      return issues;
    }
  },

  {
    id: 'sensitive-topics',
    name: 'Sensitive Topic Detection',
    description: 'Identifies sensitive topics requiring disclaimers',
    enabled: true,
    severity: 'medium',
    check: async (content: string): Promise<ModerationIssue[]> => {
      const issues: ModerationIssue[] = [];

      for (const [topic, config] of Object.entries(SENSITIVE_TOPICS)) {
        for (const pattern of config.patterns) {
          if (pattern.test(content)) {
            issues.push({
              type: ModerationIssueType.UNSAFE_CONTENT,
              severity: 'medium',
              description: `Response contains ${topic} advice: ${config.message}`
            });
            break; // One issue per topic
          }
        }
      }

      return issues;
    }
  },

  {
    id: 'spam-detection',
    name: 'Spam and Repetition Detection',
    description: 'Detects spam patterns and excessive repetition',
    enabled: true,
    severity: 'medium',
    check: async (content: string): Promise<ModerationIssue[]> => {
      const issues: ModerationIssue[] = [];

      // Check for excessive repetition
      const words = content.toLowerCase().split(/\s+/);
      const wordFreq: Record<string, number> = {};

      for (const word of words) {
        if (word.length > 3) { // Ignore short words
          wordFreq[word] = (wordFreq[word] || 0) + 1;
        }
      }

      // If any word appears more than 20% of total words, it's spam
      const totalWords = words.length;
      for (const [word, count] of Object.entries(wordFreq)) {
        if (count > 5 && count / totalWords > 0.2) {
          issues.push({
            type: ModerationIssueType.SPAM_CONTENT,
            severity: 'medium',
            description: `Excessive repetition detected: "${word}" appears ${count} times`
          });
          break;
        }
      }

      // Check for all caps (more than 50% of alphabetic characters)
      const alphaChars = content.replace(/[^a-zA-Z]/g, '');
      const upperChars = content.replace(/[^A-Z]/g, '');
      if (alphaChars.length > 20 && upperChars.length / alphaChars.length > 0.5) {
        issues.push({
          type: ModerationIssueType.SPAM_CONTENT,
          severity: 'low',
          description: 'Excessive use of capital letters detected'
        });
      }

      // Check for excessive punctuation
      const punctuationCount = (content.match(/[!?]{3,}/g) || []).length;
      if (punctuationCount > 2) {
        issues.push({
          type: ModerationIssueType.SPAM_CONTENT,
          severity: 'low',
          description: 'Excessive punctuation detected'
        });
      }

      return issues;
    }
  },

  {
    id: 'url-validation',
    name: 'URL and Link Validation',
    description: 'Validates URLs and external links',
    enabled: true,
    severity: 'medium',
    check: async (content: string): Promise<ModerationIssue[]> => {
      const issues: ModerationIssue[] = [];

      // Find all URLs
      const urlPattern = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/gi;
      const urls = content.match(urlPattern) || [];

      // Check for suspicious domains
      const suspiciousDomains = [
        'bit.ly', 'tinyurl.com', 'goo.gl', 'ow.ly', 'short.link',
        'click.here', 'free-money', 'get-rich-quick'
      ];

      for (const url of urls) {
        const urlLower = url.toLowerCase();
        for (const domain of suspiciousDomains) {
          if (urlLower.includes(domain)) {
            issues.push({
              type: ModerationIssueType.UNSAFE_CONTENT,
              severity: 'medium',
              description: `Suspicious URL detected: ${url}`
            });
            break;
          }
        }
      }

      // Warn about too many URLs
      if (urls.length > 3) {
        issues.push({
          type: ModerationIssueType.SPAM_CONTENT,
          severity: 'low',
          description: `Response contains too many URLs (${urls.length})`
        });
      }

      return issues;
    }
  }
];

/**
 * Apply content rules to a response
 */
export async function applyContentRules(response: GeneratedResponse): Promise<ModerationIssue[]> {
  const allIssues: ModerationIssue[] = [];

  for (const rule of contentRules) {
    if (rule.enabled) {
      try {
        const issues = await rule.check(response.content);
        allIssues.push(...issues);
      } catch (error) {
        console.error(`Error applying content rule ${rule.id}:`, error);
      }
    }
  }

  return allIssues;
}

/**
 * Sanitize content by removing or replacing problematic patterns
 */
export function sanitizeContent(content: string): string {
  let sanitized = content;

  // Remove personal information patterns
  for (const pattern of PROHIBITED_PATTERNS.personalInfo) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  // Remove excessive punctuation
  sanitized = sanitized.replace(/([!?]){3,}/g, '$1');

  // Normalize excessive whitespace
  sanitized = sanitized.replace(/\s{3,}/g, '  ');

  // Remove zero-width characters that could be used for bypassing
  sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF]/g, '');

  return sanitized.trim();
}