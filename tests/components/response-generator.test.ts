/**
 * Response Generator component tests
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { ResponseGenerator } from '../../src/components/response-generator/response-generator.ts';
import {
  ResponseContext,
  ResponseConstraints,
  ToolResult
} from '../../src/interfaces/component-interfaces.ts';
import {
  MessageAnalysis,
  InternalMessage,
  GeneratedResponse
} from '../../src/interfaces/message-types.ts';

// Mock the OpenRouter service
const mockCallOpenRouter = mock(async () => {
  return 'This is a generated response based on your request.';
});

// Mock the module
mock.module('../../src/services/call-openrouter.ts', () => ({
  callOpenRouter: mockCallOpenRouter
}));

describe('ResponseGenerator', () => {
  let responseGenerator: ResponseGenerator;

  beforeEach(() => {
    responseGenerator = new ResponseGenerator({
      model: 'anthropic/claude-3-haiku',
      maxTokens: 1000,
      temperature: 0.7,
      responseTimeout: 10000,
      enableMarkdown: true,
      debugMode: false
    });
    mockCallOpenRouter.mockClear();
  });

  describe('Initialization', () => {
    test('should initialize successfully', async () => {
      await responseGenerator.initialize();

      const status = responseGenerator.getStatus();
      expect(status.status).toBe('healthy');
      expect(status.name).toBe('ResponseGenerator');
    });

    test('should handle double initialization gracefully', async () => {
      await responseGenerator.initialize();
      await responseGenerator.initialize(); // Should not throw

      const status = responseGenerator.getStatus();
      expect(status.status).toBe('healthy');
    });

    test('should shutdown properly', async () => {
      await responseGenerator.initialize();
      await responseGenerator.shutdown();

      const status = responseGenerator.getStatus();
      expect(status.status).toBe('unhealthy');
    });
  });

  describe('Response Generation', () => {
    beforeEach(async () => {
      await responseGenerator.initialize();
    });

    test('should generate response for simple message', async () => {
      const analysis: MessageAnalysis = {
        intent: 'question',
        confidence: 0.8,
        entities: {},
        requiresContext: false,
        suggestedTools: []
      };

      const constraints: ResponseConstraints = {
        maxLength: 1000,
        allowMarkdown: true,
        requireInlineKeyboard: false,
        tone: 'casual'
      };

      const context: ResponseContext = {
        originalMessage: 'What is TypeScript?',
        analysis,
        conversationHistory: [],
        constraints
      };

      const response = await responseGenerator.generateResponse(context);

      expect(response).toBeDefined();
      expect(response.content).toBeTruthy();
      expect(response.metadata).toBeDefined();
      expect(response.metadata.model).toBe('anthropic/claude-3-haiku');
      expect(mockCallOpenRouter).toHaveBeenCalled();
    });

    test('should generate response with tool results', async () => {
      const toolResults: ToolResult[] = [
        {
          toolId: 'search',
          success: true,
          output: 'Search results about TypeScript: TypeScript is a typed superset of JavaScript.'
        }
      ];

      const analysis: MessageAnalysis = {
        intent: 'tool_request',
        confidence: 0.9,
        entities: { query: 'TypeScript' },
        requiresContext: false,
        suggestedTools: ['search']
      };

      const constraints: ResponseConstraints = {
        maxLength: 1500,
        allowMarkdown: true,
        requireInlineKeyboard: false,
        tone: 'technical'
      };

      const context: ResponseContext = {
        originalMessage: 'Search for information about TypeScript',
        analysis,
        toolResults,
        conversationHistory: [],
        constraints
      };

      const response = await responseGenerator.generateResponse(context);

      expect(response.content).toBeTruthy();
      expect(response.metadata.toolsUsed).toContain('search');
      expect(mockCallOpenRouter).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('Tool Results')
          })
        ]),
        expect.any(String),
        expect.any(Number)
      );
    });

    test('should include conversation history in context', async () => {
      const conversationHistory: InternalMessage[] = [
        {
          id: 'msg1',
          chatId: 12345,
          userId: 123,
          content: 'Tell me about programming languages',
          timestamp: new Date(),
          metadata: { source: 'telegram' }
        },
        {
          id: 'msg2',
          chatId: 12345,
          userId: 123,
          content: 'Programming languages are tools for writing software',
          timestamp: new Date(),
          metadata: { source: 'system' }
        }
      ];

      const analysis: MessageAnalysis = {
        intent: 'question',
        confidence: 0.7,
        entities: {},
        requiresContext: true,
        suggestedTools: []
      };

      const constraints: ResponseConstraints = {
        maxLength: 1000,
        allowMarkdown: true,
        requireInlineKeyboard: false,
        tone: 'formal'
      };

      const context: ResponseContext = {
        originalMessage: 'Can you tell me more about that?',
        analysis,
        conversationHistory,
        constraints
      };

      const response = await responseGenerator.generateResponse(context);

      expect(response.content).toBeTruthy();
      expect(mockCallOpenRouter).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('Recent Conversation')
          })
        ]),
        expect.any(String),
        expect.any(Number)
      );
    });

    test('should respect tone constraints', async () => {
      const toneTestCases = ['formal', 'casual', 'technical'] as const;

      for (const tone of toneTestCases) {
        const analysis: MessageAnalysis = {
          intent: 'question',
          confidence: 0.8,
          entities: {},
          requiresContext: false,
          suggestedTools: []
        };

        const constraints: ResponseConstraints = {
          maxLength: 1000,
          allowMarkdown: true,
          requireInlineKeyboard: false,
          tone
        };

        const context: ResponseContext = {
          originalMessage: 'Test message',
          analysis,
          conversationHistory: [],
          constraints
        };

        const response = await responseGenerator.generateResponse(context);

        expect(response.content).toBeTruthy();
        expect(mockCallOpenRouter).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              role: 'system',
              content: expect.stringContaining(tone)
            })
          ]),
          expect.any(String),
          expect.any(Number)
        );

        mockCallOpenRouter.mockClear();
      }
    });
  });

  describe('Tool Result Formatting', () => {
    beforeEach(async () => {
      await responseGenerator.initialize();
    });

    test('should format successful tool results', async () => {
      const toolResults: ToolResult[] = [
        {
          toolId: 'search',
          success: true,
          output: 'Search results about AI'
        },
        {
          toolId: 'weather',
          success: true,
          output: { temperature: '22°C', condition: 'sunny' }
        }
      ];

      const formatted = responseGenerator.formatToolResults(toolResults);

      expect(formatted).toContain('Results:');
      expect(formatted).toContain('search: Search results about AI');
      expect(formatted).toContain('weather:');
      expect(formatted).toContain('temperature');
    });

    test('should format failed tool results', async () => {
      const toolResults: ToolResult[] = [
        {
          toolId: 'search',
          success: true,
          output: 'Successful search result'
        },
        {
          toolId: 'weather',
          success: false,
          error: 'Weather service unavailable'
        }
      ];

      const formatted = responseGenerator.formatToolResults(toolResults);

      expect(formatted).toContain('Results:');
      expect(formatted).toContain('search: Successful search result');
      expect(formatted).toContain('Issues encountered:');
      expect(formatted).toContain('weather: Weather service unavailable');
    });

    test('should handle empty tool results', async () => {
      const formatted = responseGenerator.formatToolResults([]);
      expect(formatted).toBe('');
    });
  });

  describe('Inline Keyboard Creation', () => {
    beforeEach(async () => {
      await responseGenerator.initialize();
    });

    test('should create inline keyboard from options', async () => {
      const options = ['Option 1', 'Option 2', 'Option 3'];
      const keyboard = responseGenerator.createInlineKeyboard(options);

      expect(keyboard.inline_keyboard).toBeDefined();
      expect(keyboard.inline_keyboard.length).toBeGreaterThan(0);

      // Flatten all buttons to check
      const allButtons = keyboard.inline_keyboard.flat();
      expect(allButtons).toHaveLength(3);
      expect(allButtons[0].text).toBe('Option 1');
      expect(allButtons[0].callback_data).toContain('action_0_option_1');
    });

    test('should handle empty options array', async () => {
      const keyboard = responseGenerator.createInlineKeyboard([]);
      expect(keyboard.inline_keyboard).toEqual([]);
    });

    test('should limit keyboard size', async () => {
      const manyOptions = Array.from({ length: 10 }, (_, i) => `Option ${i + 1}`);
      const keyboard = responseGenerator.createInlineKeyboard(manyOptions);

      // Should not exceed max rows (3) and max buttons per row (2) = 6 total
      const totalButtons = keyboard.inline_keyboard.flat().length;
      expect(totalButtons).toBeLessThanOrEqual(6);
    });
  });

  describe('Response Validation', () => {
    beforeEach(async () => {
      await responseGenerator.initialize();
    });

    test('should validate correct response', async () => {
      const response: GeneratedResponse = {
        content: 'This is a valid response with good length.',
        metadata: {
          model: 'test-model',
          tokensUsed: 50,
          processingTime: 1000
        }
      };

      const isValid = await responseGenerator.validateResponse(response);
      expect(isValid).toBe(true);
    });

    test('should detect overly long responses', async () => {
      const longContent = 'a'.repeat(5000); // Exceeds Telegram limit
      const response: GeneratedResponse = {
        content: longContent,
        metadata: {
          model: 'test-model',
          tokensUsed: 1000,
          processingTime: 2000
        }
      };

      const isValid = await responseGenerator.validateResponse(response);
      expect(isValid).toBe(false);
    });

    test('should detect empty responses', async () => {
      const response: GeneratedResponse = {
        content: '',
        metadata: {
          model: 'test-model',
          tokensUsed: 0,
          processingTime: 500
        }
      };

      const isValid = await responseGenerator.validateResponse(response);
      expect(isValid).toBe(false);
    });

    test('should validate markdown formatting', async () => {
      const responseWithBadMarkdown: GeneratedResponse = {
        content: 'This has **unmatched bold markdown',
        metadata: {
          model: 'test-model',
          tokensUsed: 20,
          processingTime: 800
        }
      };

      const isValid = await responseGenerator.validateResponse(responseWithBadMarkdown);
      expect(isValid).toBe(false);
    });
  });

  describe('Response Formatting', () => {
    beforeEach(async () => {
      await responseGenerator.initialize();
    });

    test('should apply length constraints', async () => {
      const longResponse = 'a'.repeat(2000);
      mockCallOpenRouter.mockResolvedValueOnce(longResponse);

      const analysis: MessageAnalysis = {
        intent: 'question',
        confidence: 0.8,
        entities: {},
        requiresContext: false,
        suggestedTools: []
      };

      const constraints: ResponseConstraints = {
        maxLength: 500, // Shorter than response
        allowMarkdown: true,
        requireInlineKeyboard: false,
        tone: 'casual'
      };

      const context: ResponseContext = {
        originalMessage: 'Test message',
        analysis,
        conversationHistory: [],
        constraints
      };

      const response = await responseGenerator.generateResponse(context);

      expect(response.content.length).toBeLessThanOrEqual(500);
      expect(response.content).toMatch(/\.\.\.$/); // Should end with ellipsis
    });

    test('should strip markdown when not allowed', async () => {
      const markdownResponse = 'This has **bold** and *italic* text with `code`.';
      mockCallOpenRouter.mockResolvedValueOnce(markdownResponse);

      const analysis: MessageAnalysis = {
        intent: 'question',
        confidence: 0.8,
        entities: {},
        requiresContext: false,
        suggestedTools: []
      };

      const constraints: ResponseConstraints = {
        maxLength: 1000,
        allowMarkdown: false, // No markdown allowed
        requireInlineKeyboard: false,
        tone: 'casual'
      };

      const context: ResponseContext = {
        originalMessage: 'Test message',
        analysis,
        conversationHistory: [],
        constraints
      };

      const response = await responseGenerator.generateResponse(context);

      expect(response.content).not.toContain('**');
      expect(response.content).not.toContain('*');
      expect(response.content).not.toContain('`');
      expect(response.content).toContain('bold');
      expect(response.content).toContain('italic');
      expect(response.content).toContain('code');
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await responseGenerator.initialize();
    });

    test('should handle LLM generation failures', async () => {
      mockCallOpenRouter.mockRejectedValueOnce(new Error('Network error'));

      const analysis: MessageAnalysis = {
        intent: 'question',
        confidence: 0.8,
        entities: {},
        requiresContext: false,
        suggestedTools: []
      };

      const constraints: ResponseConstraints = {
        maxLength: 1000,
        allowMarkdown: true,
        requireInlineKeyboard: false,
        tone: 'casual'
      };

      const context: ResponseContext = {
        originalMessage: 'Test message',
        analysis,
        conversationHistory: [],
        constraints
      };

      const response = await responseGenerator.generateResponse(context);

      // Should return fallback response
      expect(response.content).toContain('having trouble generating');
      expect(response.metadata.model).toBe('fallback');
      expect(response.metadata.error).toBe('Network error');
    });

    test('should handle timeout scenarios', async () => {
      // Create generator with very short timeout
      const fastGenerator = new ResponseGenerator({
        responseTimeout: 1 // 1ms timeout
      });
      await fastGenerator.initialize();

      // Mock a slow response
      mockCallOpenRouter.mockImplementationOnce(() =>
        new Promise(resolve => setTimeout(() => resolve('Slow response'), 100))
      );

      const analysis: MessageAnalysis = {
        intent: 'question',
        confidence: 0.8,
        entities: {},
        requiresContext: false,
        suggestedTools: []
      };

      const constraints: ResponseConstraints = {
        maxLength: 1000,
        allowMarkdown: true,
        requireInlineKeyboard: false,
        tone: 'casual'
      };

      const context: ResponseContext = {
        originalMessage: 'Test message',
        analysis,
        conversationHistory: [],
        constraints
      };

      const response = await fastGenerator.generateResponse(context);

      // Should return fallback response due to timeout
      expect(response.metadata.model).toBe('fallback');
    });
  });

  describe('Metrics Tracking', () => {
    beforeEach(async () => {
      await responseGenerator.initialize();
    });

    test('should track response generation metrics', async () => {
      const analysis: MessageAnalysis = {
        intent: 'question',
        confidence: 0.8,
        entities: {},
        requiresContext: false,
        suggestedTools: []
      };

      const constraints: ResponseConstraints = {
        maxLength: 1000,
        allowMarkdown: true,
        requireInlineKeyboard: false,
        tone: 'casual'
      };

      const context: ResponseContext = {
        originalMessage: 'Test message',
        analysis,
        conversationHistory: [],
        constraints
      };

      await responseGenerator.generateResponse(context);

      const metrics = responseGenerator.getMetrics();
      expect(metrics.totalResponses).toBe(1);
      expect(metrics.averageGenerationTime).toBeGreaterThan(0);
      expect(metrics.averageLength).toBeGreaterThan(0);
    });

    test('should track format distribution', async () => {
      // Generate markdown response
      mockCallOpenRouter.mockResolvedValueOnce('Response with **markdown**');

      const analysis: MessageAnalysis = {
        intent: 'question',
        confidence: 0.8,
        entities: {},
        requiresContext: false,
        suggestedTools: []
      };

      const constraints: ResponseConstraints = {
        maxLength: 1000,
        allowMarkdown: true,
        requireInlineKeyboard: false,
        tone: 'casual'
      };

      const context: ResponseContext = {
        originalMessage: 'Test message',
        analysis,
        conversationHistory: [],
        constraints
      };

      await responseGenerator.generateResponse(context);

      const metrics = responseGenerator.getMetrics();
      expect(metrics.formatDistribution.markdown).toBe(1);
    });
  });

  describe('Configuration', () => {
    test('should use custom configuration', async () => {
      const customGenerator = new ResponseGenerator({
        model: 'custom-model',
        maxTokens: 2000,
        temperature: 0.5,
        responseTimeout: 20000,
        enableMarkdown: false,
        debugMode: true
      });

      await customGenerator.initialize();

      const status = customGenerator.getStatus();
      expect(status.metadata?.config?.model).toBe('custom-model');
      expect(status.metadata?.config?.maxTokens).toBe(2000);
    });

    test('should use default configuration when none provided', async () => {
      const defaultGenerator = new ResponseGenerator();
      await defaultGenerator.initialize();

      const status = defaultGenerator.getStatus();
      expect(status.metadata?.config).toBeDefined();
      expect(status.status).toBe('healthy');
    });
  });
});