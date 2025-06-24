/**
 * Self-Moderation Engine Unit Tests
 */

import { test, expect, describe, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { SelfModerationEngine } from '../../src/components/self-moderation-engine/self-moderation-engine.ts';
import {
  ModerationConfig,
  ModerationIssueType,
  ModerationResult
} from '../../src/components/self-moderation-engine/types.ts';
import { GeneratedResponse } from '../../src/interfaces/message-types.ts';
import { ResponseContext, ToolResult, MessageAnalysis, InternalMessage, ResponseConstraints } from '../../src/interfaces/component-interfaces.ts';

describe('SelfModerationEngine', () => {
  let moderationEngine: SelfModerationEngine;
  let mockConfig: Partial<ModerationConfig>;

  beforeEach(async () => {
    mockConfig = {
      confidenceThreshold: 0.8,
      severityThreshold: 'medium',
      contentPolicy: {
        allowPersonalInfo: false,
        allowExternalLinks: true,
        allowCodeExecution: false,
        maxResponseLength: 1000,
        requiredTone: 'formal',
        prohibitedPatterns: ['test-prohibited'],
        sensitiveTopics: ['test-sensitive']
      },
      enableContentFiltering: true,
      enableToneValidation: true,
      enableToolIntegrationCheck: true,
      enableRelevanceCheck: true,
      maxModerationTime: 5000
    };

    moderationEngine = new SelfModerationEngine();
    await moderationEngine.initializeWithConfig(mockConfig);
  });

  afterEach(async () => {
    await moderationEngine.shutdown();
  });

  const createMockResponseContext = (originalMessage: string, toolResults?: ToolResult[]): ResponseContext => {
    const mockAnalysis: MessageAnalysis = {
      intent: 'question',
      entities: {},
      confidence: 0.9,
      requiresContext: false
    };

    const mockConstraints: ResponseConstraints = {
      maxLength: 4096,
      allowMarkdown: true,
      requireInlineKeyboard: false,
      tone: 'formal'
    };

    return {
      originalMessage,
      analysis: mockAnalysis,
      toolResults: toolResults || [],
      conversationHistory: [],
      constraints: mockConstraints
    };
  };

  describe('initialization', () => {
    test('should initialize successfully with config', async () => {
      const engine = new SelfModerationEngine();
      await engine.initializeWithConfig(mockConfig);

      const status = engine.getStatus();
      expect(status.name).toBe('SelfModerationEngine');
      expect(status.status).toBe('healthy');

      await engine.shutdown();
    });

    test('should initialize with default config', async () => {
      const engine = new SelfModerationEngine();
      await engine.initialize();

      const status = engine.getStatus();
      expect(status.name).toBe('SelfModerationEngine');
      expect(status.status).toBe('healthy');

      await engine.shutdown();
    });

    test('should update configuration', () => {
      const newConfig: Partial<ModerationConfig> = {
        confidenceThreshold: 0.9,
        severityThreshold: 'high'
      };

      moderationEngine.updateConfig(newConfig);
      const currentConfig = moderationEngine.getConfig();

      expect(currentConfig.confidenceThreshold).toBe(0.9);
      expect(currentConfig.severityThreshold).toBe('high');
    });
  });

  describe('content validation', () => {
    test('should approve clean content', async () => {
      const response: GeneratedResponse = {
        content: 'This is a clean, professional response.',
        metadata: {}
      };

      const context = createMockResponseContext('Hello, how are you?');
      const result = await moderationEngine.moderateResponse(response, context);

      expect(result.approved).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.issues).toBeUndefined();
    });

    test('should detect prohibited patterns', async () => {
      const response: GeneratedResponse = {
        content: 'This contains test-prohibited content.',
        metadata: {}
      };

      const context = createMockResponseContext('Test message');
      const result = await moderationEngine.moderateResponse(response, context);

      expect(result.approved).toBe(false);
      expect(result.issues).toBeDefined();
      expect(result.issues![0].type).toBe(ModerationIssueType.INAPPROPRIATE_CONTENT);
    });

    test('should detect excessive length', async () => {
      const longContent = 'a'.repeat(1500); // Exceeds the 1000 char limit in mock config
      const response: GeneratedResponse = {
        content: longContent,
        metadata: {}
      };

      const context = createMockResponseContext('Tell me something');
      const result = await moderationEngine.moderateResponse(response, context);

      expect(result.approved).toBe(false);
      expect(result.issues).toBeDefined();
      expect(result.issues!.some(issue => issue.type === ModerationIssueType.EXCESSIVE_LENGTH)).toBe(true);
    });

    test('should detect sensitive topics', async () => {
      const response: GeneratedResponse = {
        content: 'This discusses test-sensitive information.',
        metadata: {}
      };

      const context = createMockResponseContext('Tell me about this topic');
      const result = await moderationEngine.moderateResponse(response, context);

      expect(result.approved).toBe(false);
      expect(result.issues).toBeDefined();
      expect(result.issues!.some(issue => issue.type === ModerationIssueType.UNSAFE_CONTENT)).toBe(true);
    });

    test('should detect empty responses', async () => {
      const response: GeneratedResponse = {
        content: '',
        metadata: {}
      };

      const context = createMockResponseContext('Say something');
      const result = await moderationEngine.moderateResponse(response, context);

      expect(result.approved).toBe(false);
      expect(result.issues).toBeDefined();
      expect(result.issues!.some(issue => issue.type === ModerationIssueType.INCOMPLETE_RESPONSE)).toBe(true);
    });
  });

  describe('tool integration validation', () => {
    test('should approve when tool results are integrated', async () => {
      const response: GeneratedResponse = {
        content: 'Based on the search results: important information found.',
        metadata: {}
      };

      const toolResults: ToolResult[] = [
        {
          toolId: 'search-tool',
          success: true,
          output: 'important information found'
        }
      ];

      const context = createMockResponseContext('Search for information', toolResults);
      const result = await moderationEngine.moderateResponse(response, context);

      expect(result.approved).toBe(true);
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    test('should detect when tool results are not integrated', async () => {
      const response: GeneratedResponse = {
        content: 'Here is some generic response without using the tool results.',
        metadata: {}
      };

      const toolResults: ToolResult[] = [
        {
          toolId: 'search-tool',
          success: true,
          output: 'specific unique information from tool'
        }
      ];

      const context = createMockResponseContext('Search for information', toolResults);
      const result = await moderationEngine.moderateResponse(response, context);

      expect(result.approved).toBe(false);
      expect(result.issues).toBeDefined();
      expect(result.issues!.some(issue => issue.type === ModerationIssueType.TOOL_RESULTS_NOT_INTEGRATED)).toBe(true);
    });

    test('should handle failed tool results gracefully', async () => {
      const response: GeneratedResponse = {
        content: 'I apologize, but I was unable to retrieve the information.',
        metadata: {}
      };

      const toolResults: ToolResult[] = [
        {
          toolId: 'search-tool',
          success: false,
          error: 'Tool execution failed'
        }
      ];

      const context = createMockResponseContext('Search for information', toolResults);
      const result = await moderationEngine.moderateResponse(response, context);

      // Should not penalize for tool integration when tools failed
      expect(result.approved).toBe(true);
    });
  });

  describe('tone validation', () => {
    test('should validate tone when required tone is set', async () => {
      // Mock the tone analysis to return the expected tone
      spyOn(moderationEngine as any, 'analyzeText').mockResolvedValue({
        sentiment: 'neutral',
        tone: 'formal',
        topics: [],
        entities: [],
        flags: []
      });

      const response: GeneratedResponse = {
        content: 'Thank you for your inquiry. I would be happy to assist you.',
        metadata: {}
      };

      const context = createMockResponseContext('Can you help me?');
      const result = await moderationEngine.moderateResponse(response, context);

      expect(result.approved).toBe(true);
    });

    test('should detect tone mismatch', async () => {
      // Mock the tone analysis to return a different tone
      spyOn(moderationEngine as any, 'analyzeText').mockResolvedValue({
        sentiment: 'neutral',
        tone: 'casual',
        topics: [],
        entities: [],
        flags: []
      });

      const response: GeneratedResponse = {
        content: 'Hey there! What\'s up?',
        metadata: {}
      };

      const context = createMockResponseContext('Can you help me?');
      const result = await moderationEngine.moderateResponse(response, context);

      expect(result.approved).toBe(false);
      expect(result.issues).toBeDefined();
      expect(result.issues!.some(issue => issue.type === ModerationIssueType.INCOHERENT_RESPONSE)).toBe(true);
    });
  });

  describe('relevance validation', () => {
    test('should approve relevant responses', async () => {
      const response: GeneratedResponse = {
        content: 'The weather today is sunny and warm.',
        metadata: {}
      };

      const context = createMockResponseContext('What is the weather like today?');
      const result = await moderationEngine.moderateResponse(response, context);

      expect(result.approved).toBe(true);
    });

    test('should detect irrelevant responses', async () => {
      const response: GeneratedResponse = {
        content: 'Here is a recipe for chocolate cake.',
        metadata: {}
      };

      const context = createMockResponseContext('What is the weather like today?');
      const result = await moderationEngine.moderateResponse(response, context);

      expect(result.approved).toBe(false);
      expect(result.issues).toBeDefined();
      expect(result.issues!.some(issue => issue.type === ModerationIssueType.IRRELEVANT_RESPONSE)).toBe(true);
    });
  });

  describe('markdown validation', () => {
    test('should detect broken markdown', async () => {
      const response: GeneratedResponse = {
        content: 'Here is some code:\n```javascript\nconsole.log("hello");\n// Missing closing backticks',
        metadata: {}
      };

      const context = createMockResponseContext('Show me some code');
      const result = await moderationEngine.moderateResponse(response, context);

      expect(result.approved).toBe(false);
      expect(result.issues).toBeDefined();
      expect(result.issues!.some(issue => issue.type === ModerationIssueType.BROKEN_MARKUP)).toBe(true);
    });

    test('should approve well-formatted markdown', async () => {
      const response: GeneratedResponse = {
        content: 'Here is some code:\n```javascript\nconsole.log("hello");\n```\n\nThis is **bold** text.',
        metadata: {}
      };

      const context = createMockResponseContext('Show me some code');
      const result = await moderationEngine.moderateResponse(response, context);

      expect(result.approved).toBe(true);
    });
  });

  describe('content sanitization', () => {
    test('should sanitize XSS patterns', () => {
      const maliciousContent = 'Hello <script>alert("xss")</script> world';
      const sanitized = moderationEngine.sanitizeContent(maliciousContent);

      expect(sanitized).not.toContain('<script>');
      expect(sanitized).not.toContain('alert');
      expect(sanitized).toContain('Hello');
      expect(sanitized).toContain('world');
    });

    test('should remove excessive whitespace', () => {
      const messyContent = 'Hello    world\n\n\n\n    with   lots    of   spaces';
      const sanitized = moderationEngine.sanitizeContent(messyContent);

      expect(sanitized).toBe('Hello world with lots of spaces');
    });

    test('should remove javascript: URLs', () => {
      const maliciousContent = 'Click <a href="javascript:alert(1)">here</a>';
      const sanitized = moderationEngine.sanitizeContent(maliciousContent);

      expect(sanitized).not.toContain('javascript:');
    });
  });

  describe('suggestions and improvements', () => {
    test('should provide helpful suggestions for issues', () => {
      const issues = [
        {
          type: ModerationIssueType.EXCESSIVE_LENGTH,
          severity: 'medium' as const,
          description: 'Response too long'
        },
        {
          type: ModerationIssueType.TOOL_RESULTS_NOT_INTEGRATED,
          severity: 'high' as const,
          description: 'Tool results not used'
        }
      ];

      const suggestions = moderationEngine.suggestImprovements(issues);

      expect(suggestions).toContain('Consider shortening the response for better readability');
      expect(suggestions).toContain('Include and reference the tool results in your response');
      expect(suggestions.length).toBeGreaterThan(0);
    });

    test('should not duplicate suggestions', () => {
      const issues = [
        {
          type: ModerationIssueType.EXCESSIVE_LENGTH,
          severity: 'medium' as const,
          description: 'Response too long'
        },
        {
          type: ModerationIssueType.EXCESSIVE_LENGTH,
          severity: 'medium' as const,
          description: 'Response too long again'
        }
      ];

      const suggestions = moderationEngine.suggestImprovements(issues);
      const lengthSuggestions = suggestions.filter(s => s.includes('shortening'));

      expect(lengthSuggestions).toHaveLength(1);
    });
  });

  describe('metrics tracking', () => {
    test('should track moderation metrics', async () => {
      const response: GeneratedResponse = {
        content: 'This is a test response.',
        metadata: {}
      };

      const context = createMockResponseContext('Test message');
      await moderationEngine.moderateResponse(response, context);

      const metrics = moderationEngine.getMetrics();

      expect(metrics.totalModerations).toBe(1);
      expect(metrics.approvalRate).toBeGreaterThanOrEqual(0);
      expect(metrics.averageModerationTime).toBeGreaterThan(0);
      expect(metrics.averageConfidence).toBeGreaterThanOrEqual(0);
    });

    test('should update metrics over multiple moderations', async () => {
      const response1: GeneratedResponse = {
        content: 'First response',
        metadata: {}
      };

      const response2: GeneratedResponse = {
        content: 'Second response',
        metadata: {}
      };

      const context = createMockResponseContext('Test message');

      await moderationEngine.moderateResponse(response1, context);
      await moderationEngine.moderateResponse(response2, context);

      const metrics = moderationEngine.getMetrics();

      expect(metrics.totalModerations).toBe(2);
    });
  });

  describe('error handling', () => {
    test('should handle moderation errors gracefully', async () => {
      // Mock an error in content validation
      spyOn(moderationEngine as any, 'validateContent').mockRejectedValue(new Error('Validation failed'));

      const response: GeneratedResponse = {
        content: 'Test response',
        metadata: {}
      };

      const context = createMockResponseContext('Test message');
      const result = await moderationEngine.moderateResponse(response, context);

      expect(result.approved).toBe(false);
      expect(result.issues).toBeDefined();
      expect(result.issues![0].type).toBe(ModerationIssueType.INCOHERENT_RESPONSE);
      expect(result.confidence).toBe(0);
    });

    test('should handle configuration edge cases', () => {
      const extremeConfig: Partial<ModerationConfig> = {
        confidenceThreshold: 1.5, // Invalid value > 1
        maxModerationTime: -1000 // Invalid negative value
      };

      // Should not throw when updating with invalid config
      expect(() => moderationEngine.updateConfig(extremeConfig)).not.toThrow();

      const config = moderationEngine.getConfig();
      expect(config.confidenceThreshold).toBe(1.5); // Accepts the value but may clamp internally
    });
  });

  describe('component lifecycle', () => {
    test('should provide health status', () => {
      const status = moderationEngine.getStatus();

      expect(status.name).toBe('SelfModerationEngine');
      expect(status.status).toBe('healthy');
      expect(status.lastHealthCheck).toBeInstanceOf(Date);
      expect(status.metadata).toBeDefined();
      expect(status.metadata?.totalModerations).toBeDefined();
    });

    test('should shutdown gracefully', async () => {
      await expect(moderationEngine.shutdown()).resolves.not.toThrow();

      const status = moderationEngine.getStatus();
      expect(status.status).toBe('unhealthy');
    });
  });
});