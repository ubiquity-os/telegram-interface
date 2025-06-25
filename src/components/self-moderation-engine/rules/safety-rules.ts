/**
 * Safety Rules for Self-Moderation Engine
 *
 * Prevents harmful content, ensures user safety, and handles crisis situations
 */

import { ModerationIssue, ModerationIssueType } from '../types.ts';
import { GeneratedResponse } from '../../../interfaces/message-types.ts';
import { ResponseContext } from '../../../interfaces/component-interfaces.ts';

/**
 * Safety rule interface
 */
export interface SafetyRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  severity: 'low' | 'medium' | 'high';
  check: (response: GeneratedResponse, context?: ResponseContext) => Promise<ModerationIssue[]>;
}

/**
 * Crisis helpline information by region
 */
const CRISIS_RESOURCES = {
  general: {
    international: 'International Association for Suicide Prevention: https://www.iasp.info/resources/Crisis_Centres/',
    text: 'Crisis Text Line: Text HOME to 741741 (US/UK/Canada)'
  },

  us: {
    suicide: 'National Suicide Prevention Lifeline: 988 or 1-800-273-8255',
    crisis: 'Crisis Text Line: Text HOME to 741741',
    veterans: 'Veterans Crisis Line: 1-800-273-8255 (Press 1)'
  },

  uk: {
    samaritans: 'Samaritans: 116 123',
    text: 'Crisis Text Line: Text SHOUT to 85258',
    youngMinds: 'YoungMinds: Text YM to 85258'
  },

  canada: {
    talkSuicide: 'Talk Suicide Canada: 1-833-456-4566',
    text: 'Crisis Text Line: Text HOME to 741741',
    kids: 'Kids Help Phone: 1-800-668-6868'
  }
};

/**
 * Safety validation rules
 */
export const safetyRules: SafetyRule[] = [
  {
    id: 'self-harm-prevention',
    name: 'Self-Harm and Crisis Detection',
    description: 'Detects content related to self-harm or crisis situations',
    enabled: true,
    severity: 'high',
    check: async (response: GeneratedResponse, context?: ResponseContext): Promise<ModerationIssue[]> => {
      const issues: ModerationIssue[] = [];
      const content = response.content.toLowerCase();
      const originalMessage = context?.originalMessage?.toLowerCase() || '';

      // Patterns indicating self-harm or crisis
      const crisisPatterns = [
        /\b(suicide|suicidal|kill\s+myself|end\s+my\s+life|want\s+to\s+die)\b/i,
        /\b(self[\s-]?harm|cut\s+myself|hurt\s+myself)\b/i,
        /\b(overdose|OD|take\s+all\s+the\s+pills)\b/i,
        /\b(jump\s+off|jump\s+from)\s+(bridge|building|cliff)\b/i,
        /\bno\s+reason\s+to\s+(live|go\s+on|continue)\b/i
      ];

      // Check if user message contains crisis indicators
      let userInCrisis = false;
      for (const pattern of crisisPatterns) {
        if (pattern.test(originalMessage)) {
          userInCrisis = true;
          break;
        }
      }

      // If user shows signs of crisis, ensure response includes resources
      if (userInCrisis) {
        const hasResources = /\b(helpline|crisis\s+line|support|988|116\s*123)\b/i.test(content);
        const hasEmpathy = /\b(help|support|care|here\s+for\s+you|talk\s+to\s+someone)\b/i.test(content);

        if (!hasResources) {
          issues.push({
            type: ModerationIssueType.UNSAFE_CONTENT,
            severity: 'high',
            description: 'Response to crisis situation must include helpline resources'
          });
        }

        if (!hasEmpathy) {
          issues.push({
            type: ModerationIssueType.UNSAFE_CONTENT,
            severity: 'high',
            description: 'Response to crisis situation must show empathy and encourage seeking help'
          });
        }
      }

      // Check if response itself contains harmful suggestions
      const harmfulSuggestions = [
        /\b(how\s+to|ways\s+to|methods\s+of)\s+(suicide|self[\s-]?harm|hurt\s+yourself)\b/i,
        /\b(effective|painless|quick)\s+(suicide|ways\s+to\s+die)\b/i,
        /\b(you\s+should|consider|try)\s+(killing|harming|hurting)\s+yourself\b/i
      ];

      for (const pattern of harmfulSuggestions) {
        if (pattern.test(content)) {
          issues.push({
            type: ModerationIssueType.UNSAFE_CONTENT,
            severity: 'high',
            description: 'Response contains potentially harmful suggestions'
          });
          break;
        }
      }

      return issues;
    }
  },

  {
    id: 'medical-safety',
    name: 'Medical and Health Safety',
    description: 'Ensures medical information includes appropriate disclaimers',
    enabled: true,
    severity: 'medium',
    check: async (response: GeneratedResponse): Promise<ModerationIssue[]> => {
      const issues: ModerationIssue[] = [];
      const content = response.content.toLowerCase();

      // Medical advice patterns
      const medicalPatterns = [
        /\b(take|consume|ingest)\s+\d+\s*(mg|ml|pills?|tablets?)\b/i,
        /\b(dosage|dose)\s+(is|should\s+be|of)\s+\d+/i,
        /\b(diagnos[ei]|you\s+have|symptoms?\s+indicate)\s+[a-z\s]+(disease|condition|disorder)\b/i,
        /\b(stop|start|change)\s+your\s+medication\b/i,
        /\b(treatment|therapy|medication)\s+for\s+[a-z\s]+\b/i
      ];

      let containsMedicalAdvice = false;
      for (const pattern of medicalPatterns) {
        if (pattern.test(content)) {
          containsMedicalAdvice = true;
          break;
        }
      }

      if (containsMedicalAdvice) {
        // Check for disclaimer
        const disclaimerPatterns = [
          /\b(consult|speak\s+with|see)\s+(a\s+)?(doctor|physician|healthcare|medical\s+professional)\b/i,
          /\b(not\s+medical\s+advice|educational\s+purposes|general\s+information)\b/i,
          /\b(professional\s+medical|qualified\s+healthcare)\s+(advice|guidance|opinion)\b/i
        ];

        let hasDisclaimer = false;
        for (const pattern of disclaimerPatterns) {
          if (pattern.test(content)) {
            hasDisclaimer = true;
            break;
          }
        }

        if (!hasDisclaimer) {
          issues.push({
            type: ModerationIssueType.UNSAFE_CONTENT,
            severity: 'medium',
            description: 'Medical information must include disclaimer to consult healthcare professionals'
          });
        }
      }

      return issues;
    }
  },

  {
    id: 'personal-safety',
    name: 'Personal Safety and Privacy',
    description: 'Prevents sharing of personal information that could compromise safety',
    enabled: true,
    severity: 'high',
    check: async (response: GeneratedResponse): Promise<ModerationIssue[]> => {
      const issues: ModerationIssue[] = [];
      const content = response.content;

      // Patterns for personal information
      const personalInfoPatterns = [
        {
          pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
          type: 'phone number'
        },
        {
          pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
          type: 'email address'
        },
        {
          pattern: /\b\d{1,5}\s+[A-Za-z\s]+\s+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr)\b/gi,
          type: 'physical address'
        },
        {
          pattern: /\b(passport|license|ID)\s*(number|#|no\.?)?\s*:?\s*[A-Z0-9]{6,}\b/gi,
          type: 'identification number'
        }
      ];

      for (const { pattern, type } of personalInfoPatterns) {
        const matches = content.match(pattern);
        if (matches) {
          issues.push({
            type: ModerationIssueType.UNSAFE_CONTENT,
            severity: 'high',
            description: `Response contains ${type} which could compromise user safety`
          });
        }
      }

      // Check for instructions to share personal info
      const sharingPatterns = [
        /\b(share|provide|send|give)\s+(your|me|us)\s+(personal|private|contact)\s+information\b/i,
        /\b(what\s+is|tell\s+me|provide)\s+your\s+(address|phone|email|social\s+security)\b/i
      ];

      for (const pattern of sharingPatterns) {
        if (pattern.test(content)) {
          issues.push({
            type: ModerationIssueType.UNSAFE_CONTENT,
            severity: 'high',
            description: 'Response should not request personal information from users'
          });
          break;
        }
      }

      return issues;
    }
  },

  {
    id: 'minor-safety',
    name: 'Child and Minor Safety',
    description: 'Ensures content is appropriate when interacting with minors',
    enabled: true,
    severity: 'high',
    check: async (response: GeneratedResponse, context?: ResponseContext): Promise<ModerationIssue[]> => {
      const issues: ModerationIssue[] = [];
      const content = response.content.toLowerCase();
      const originalMessage = context?.originalMessage?.toLowerCase() || '';

      // Check if user indicates they are a minor
      const minorIndicators = [
        /\b(i'?m|i\s+am)\s+\d{1,2}\s+years?\s+old\b/i,
        /\b(child|kid|minor|teenager|teen)\b/i,
        /\b(school|homework|parents?|mom|dad)\b/i
      ];

      let possibleMinor = false;
      for (const pattern of minorIndicators) {
        if (pattern.test(originalMessage)) {
          // Check if age mentioned is under 18
          const ageMatch = originalMessage.match(/\b(\d{1,2})\s+years?\s+old\b/i);
          if (ageMatch && parseInt(ageMatch[1]) < 18) {
            possibleMinor = true;
            break;
          } else if (!ageMatch) {
            possibleMinor = true;
            break;
          }
        }
      }

      if (possibleMinor) {
        // Ensure response is age-appropriate
        const inappropriateForMinors = [
          /\b(dating|romantic|relationship)\s+advice\b/i,
          /\b(alcohol|drugs?|smoking|vaping)\b/i,
          /\b(violence|gore|explicit)\s+content\b/i
        ];

        for (const pattern of inappropriateForMinors) {
          if (pattern.test(content)) {
            issues.push({
              type: ModerationIssueType.UNSAFE_CONTENT,
              severity: 'high',
              description: 'Response may contain content inappropriate for minors'
            });
            break;
          }
        }

        // Check for attempts to meet or private communication
        const dangerousPatterns = [
          /\b(meet|meeting)\s+(in\s+person|offline|privately)\b/i,
          /\b(private|direct)\s+(message|chat|conversation)\b/i,
          /\b(don't\s+tell|keep\s+this\s+secret|between\s+us)\b/i
        ];

        for (const pattern of dangerousPatterns) {
          if (pattern.test(content)) {
            issues.push({
              type: ModerationIssueType.UNSAFE_CONTENT,
              severity: 'high',
              description: 'Response contains potentially dangerous suggestions for minors'
            });
            break;
          }
        }
      }

      return issues;
    }
  }
];

/**
 * Apply safety rules to a response
 */
export async function applySafetyRules(
  response: GeneratedResponse,
  context?: ResponseContext
): Promise<ModerationIssue[]> {
  const allIssues: ModerationIssue[] = [];

  for (const rule of safetyRules) {
    if (rule.enabled) {
      try {
        const issues = await rule.check(response, context);
        allIssues.push(...issues);
      } catch (error) {
        console.error(`Error applying safety rule ${rule.id}:`, error);
      }
    }
  }

  return allIssues;
}

/**
 * Add crisis resources to a response if needed
 */
export function addCrisisResources(response: GeneratedResponse, region: string = 'general'): GeneratedResponse {
  const resources = CRISIS_RESOURCES[region as keyof typeof CRISIS_RESOURCES] || CRISIS_RESOURCES.general;

  let resourceText = '\n\n---\n\n**If you are in crisis, please reach out for help:**\n\n';

  for (const [key, value] of Object.entries(resources)) {
    resourceText += `• ${value}\n`;
  }

  resourceText += '\n**You are not alone, and help is available.**';

  return {
    ...response,
    content: response.content + resourceText
  };
}

/**
 * Modify response to be safe and appropriate
 */
export function makeSafeResponse(
  response: GeneratedResponse,
  issues: ModerationIssue[],
  context?: ResponseContext
): GeneratedResponse {
  let safeContent = response.content;

  // Check if crisis response is needed
  const hasCrisisIssue = issues.some(issue =>
    issue.description.includes('crisis') || issue.description.includes('self-harm')
  );

  if (hasCrisisIssue) {
    // Replace response with crisis support message
    safeContent = "I'm concerned about what you're going through. Your life has value, and there are people who want to help. Please reach out to a crisis helpline or mental health professional who can provide the support you need.";

    // Add crisis resources
    return addCrisisResources({ ...response, content: safeContent });
  }

  // Add medical disclaimer if needed
  const hasMedicalIssue = issues.some(issue =>
    issue.description.includes('medical')
  );

  if (hasMedicalIssue) {
    safeContent += '\n\n**Disclaimer:** This information is for educational purposes only and should not replace professional medical advice. Please consult with a qualified healthcare provider for medical guidance.';
  }

  // Remove personal information
  const hasPersonalInfo = issues.some(issue =>
    issue.description.includes('personal information') ||
    issue.description.includes('phone number') ||
    issue.description.includes('email address')
  );

  if (hasPersonalInfo) {
    // Redact personal information patterns
    safeContent = safeContent
      .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE NUMBER REDACTED]')
      .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL REDACTED]')
      .replace(/\b\d{1,5}\s+[A-Za-z\s]+\s+(Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr)\b/gi, '[ADDRESS REDACTED]');
  }

  return {
    ...response,
    content: safeContent
  };
}