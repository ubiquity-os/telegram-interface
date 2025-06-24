/**
 * Message Pre-Processor component tests
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { MessagePreProcessor } from '../../src/components/message-pre-processor/message-pre-processor.ts';
import { ConversationContext, MessageAnalysis } from '../../src/interfaces/message-types.ts';

// Mock the OpenRouter service
const mockCallOpenRouter = mock(async () => {
  return JSON.stringify({
    intent: 'question',
    confidence: 0.85,
    entities: { topic: 'weather' },
    requiresContext: false,
    suggestedTools: ['weather']
  });
});

// Mock the module
mock.module('../../src/services/call-openrouter.ts', () => ({
  callOpenRouter: mockCallOpenRouter
}));

describe('MessagePreProcessor', () => {
  let mpp: MessagePreProcessor;

  beforeEach(() => {
    mpp = new MessagePreProcessor({
      debugMode: false,
      maxCacheSize: 100,
      model: 'anthropic/claude-3-haiku',
      analysisTimeout: 5000
    });
    mockCallOpenRouter.mockClear();
  });

  describe('Initialization', () => {
    test('should initialize successfully', async () => {
      await mpp.initialize();

      const status = mpp.getStatus();
      expect(status.status).toBe('healthy');
      expect(status.name).toBe('MessagePreProcessor');
    });

    test('should handle double initialization gracefully', async () => {
      await mpp.initialize();
      await mpp.initialize(); // Should not throw

      const status = mpp.getStatus();
      expect(status.status).toBe('healthy');
    });

    test('should shutdown properly', async () => {
      await mpp.initialize();
      await mpp.shutdown();

      const status = mpp.getStatus();
      expect(status.status).toBe('unhealthy');
    });
  });

  describe('Message Analysis', () => {
    beforeEach(async () => {
      await mpp.initialize();
    });

    test('should analyze simple question', async () => {
      const message = 'What is the weather today?';

      const analysis = await mpp.analyzeMessage(message);

      expect(analysis).toBeDefined();
      expect(analysis.intent).toBe('question');
      expect(analysis.confidence).toBeGreaterThan(0.5);
      expect(mockCallOpenRouter).toHaveBeenCalled();
    });

    test('should analyze command message', async () => {
      mockCallOpenRouter.mockResolvedValueOnce(JSON.stringify({
        intent: 'command',
        confidence: 0.95,
        entities: { command: '/help' },
        requiresContext: false,
        suggestedTools: []
      }));

      const message = '/help';
      const analysis = await mpp.analyzeMessage(message);

      expect(analysis.intent).toBe('command');
      expect(analysis.confidence).toBeGreaterThan(0.9);
      expect(analysis.entities.command).toBe('/help');
    });

    test('should detect tool requirements', async () => {
      mockCallOpenRouter.mockResolvedValueOnce(JSON.stringify({
        intent: 'tool_request',
        confidence: 0.8,
        entities: { query: 'latest news' },
        requiresContext: false,
        suggestedTools: ['search', 'news']
      }));

      const message = 'Get me the latest news about AI';
      const analysis = await mpp.analyzeMessage(message);

      expect(analysis.intent).toBe('tool_request');
      expect(analysis.suggestedTools).toContain('search');
      expect(analysis.suggestedTools).toContain('news');
    });

    test('should handle conversation context', async () => {
      const context: ConversationContext = {
        chatId: 12345,
        userId: 123,
        messages: [{
          id: 'msg1',
          chatId: 12345,
          userId: 123,
          content: 'Tell me about TypeScript',
          timestamp: new Date(),
          metadata: { source: 'telegram' }
        }],
        metadata: {
          startTime: new Date(),
          lastUpdateTime: new Date(),
          messageCount: 1
        }
      };

      mockCallOpenRouter.mockResolvedValueOnce(JSON.stringify({
        intent: 'conversation',
        confidence: 0.7,
        entities: {},
        requiresContext: true,
        suggestedTools: []
      }));

      const message = 'Can you give me more details?';
      const analysis = await mpp.analyzeMessage(message, context);

      expect(analysis.requiresContext).toBe(true);
      expect(mockCallOpenRouter).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('conversation history')
          })
        ]),
        expect.any(String),
        expect.any(Number)
      );
    });

    test('should extract entities correctly', async () => {
      mockCallOpenRouter.mockResolvedValueOnce(JSON.stringify({
        intent: 'question',
        confidence: 0.85,
        entities: {
          location: 'Tokyo',
          date: 'tomorrow',
          type: 'weather'
        },
        requiresContext: false,
        suggestedTools: ['weather']
      }));

      const message = 'What will the weather be like in Tokyo tomorrow?';
      const analysis = await mpp.analyzeMessage(message);

      expect(analysis.entities.location).toBe('Tokyo');
      expect(analysis.entities.date).toBe('tomorrow');
      expect(analysis.entities.type).toBe('weather');
    });
  });

  describe('Caching', () => {
    beforeEach(async () => {
      await mpp.initialize();
    });

    test('should cache analysis results', async () => {
      const message = 'What is the weather?';

      // First call
      await mpp.analyzeMessage(message);
      expect(mockCallOpenRouter).toHaveBeenCalledTimes(1);

      // Second call should use cache
      await mpp.analyzeMessage(message);
      expect(mockCallOpenRouter).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    test('should handle cache hits correctly', async () => {
      const message = 'Test message for caching';
      // Use private method indirectly by creating a mock hash
      const mockHash = 'test-hash-123';

      const mockAnalysis: MessageAnalysis = {
        intent: 'conversation',
        confidence: 0.8,
        entities: {},
        requiresContext: false,
        suggestedTools: []
      };

      // Cache the analysis
      await mpp.cacheAnalysis(mockHash, mockAnalysis);

      // Retrieve from cache
      const cachedAnalysis = await mpp.getCachedAnalysis(mockHash);
      expect(cachedAnalysis).toEqual(mockAnalysis);
    });

    test('should return null for cache miss', async () => {
      const nonExistentHash = 'non-existent-hash';
      const result = await mpp.getCachedAnalysis(nonExistentHash);
      expect(result).toBeNull();
    });

    test('should respect cache size limits', async () => {
      // Create MPP with small cache size
      const smallCacheMpp = new MessagePreProcessor({
        maxCacheSize: 2
      });
      await smallCacheMpp.initialize();

      // Add 3 items to cache (exceeding limit of 2)
      const analysis1: MessageAnalysis = { intent: 'conversation', confidence: 0.8, entities: {}, requiresContext: false, suggestedTools: [] };
      const analysis2: MessageAnalysis = { intent: 'question', confidence: 0.9, entities: {}, requiresContext: false, suggestedTools: [] };
      const analysis3: MessageAnalysis = { intent: 'command', confidence: 0.95, entities: {}, requiresContext: false, suggestedTools: [] };

      await smallCacheMpp.cacheAnalysis('hash1', analysis1);
      await smallCacheMpp.cacheAnalysis('hash2', analysis2);
      await smallCacheMpp.cacheAnalysis('hash3', analysis3);

      // First item should be evicted
      const result1 = await smallCacheMpp.getCachedAnalysis('hash1');
      const result3 = await smallCacheMpp.getCachedAnalysis('hash3');

      expect(result1).toBeNull(); // Evicted
      expect(result3).not.toBeNull(); // Still cached
    });

    test('should clear cache correctly', async () => {
      const message = 'Test message for cache clearing';

      // Add something to cache
      await mpp.analyzeMessage(message);
      const status1 = mpp.getStatus();
      expect(status1.metadata?.cacheSize).toBeGreaterThan(0);

      // Clear cache
      mpp.clearCache();
      const status2 = mpp.getStatus();
      expect(status2.metadata?.cacheSize).toBe(0);
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await mpp.initialize();
    });

    test('should handle LLM analysis failures', async () => {
      mockCallOpenRouter.mockRejectedValueOnce(new Error('Network error'));

      const message = 'Test message';
      const analysis = await mpp.analyzeMessage(message);

      // Should return fallback analysis
      expect(analysis).toBeDefined();
      expect(analysis.intent).toBe('conversation');
      expect(analysis.confidence).toBeLessThan(0.5);
    });

    test('should handle invalid JSON responses', async () => {
      mockCallOpenRouter.mockResolvedValueOnce('invalid json response');

      const message = 'Test message';
      const analysis = await mpp.analyzeMessage(message);

      // Should return fallback analysis
      expect(analysis.intent).toBe('conversation');
      expect(analysis.confidence).toBeLessThan(0.5);
    });

    test('should handle empty messages', async () => {
      const message = '';
      const analysis = await mpp.analyzeMessage(message);

      // Should return fallback for empty messages
      expect(analysis.intent).toBe('conversation');
      expect(analysis.confidence).toBeLessThan(0.5);
    });

    test('should handle very long messages', async () => {
      const longMessage = 'a'.repeat(10000); // Very long message

      const analysis = await mpp.analyzeMessage(longMessage);

      expect(analysis).toBeDefined();
      expect(mockCallOpenRouter).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(String),
        expect.any(Number)
      );
    });
  });

  describe('Intent Classification', () => {
    beforeEach(async () => {
      await mpp.initialize();
    });

    test('should classify different intent types', async () => {
      const testCases = [
        {
          message: 'Hello there!',
          expectedIntent: 'conversation',
          mockResponse: { intent: 'conversation', confidence: 0.8, entities: {}, requiresContext: false, suggestedTools: [] }
        },
        {
          message: 'How do I install Node.js?',
          expectedIntent: 'question',
          mockResponse: { intent: 'question', confidence: 0.9, entities: { topic: 'nodejs' }, requiresContext: false, suggestedTools: [] }
        },
        {
          message: '/start',
          expectedIntent: 'command',
          mockResponse: { intent: 'command', confidence: 0.95, entities: { command: '/start' }, requiresContext: false, suggestedTools: [] }
        },
        {
          message: 'Search for the latest AI news',
          expectedIntent: 'tool_request',
          mockResponse: { intent: 'tool_request', confidence: 0.85, entities: { query: 'AI news' }, requiresContext: false, suggestedTools: ['search'] }
        }
      ];

      for (const testCase of testCases) {
        mockCallOpenRouter.mockResolvedValueOnce(JSON.stringify(testCase.mockResponse));

        const analysis = await mpp.analyzeMessage(testCase.message);
        expect(analysis.intent).toBe(testCase.expectedIntent);
      }
    });
  });

  describe('Configuration', () => {
    test('should use custom configuration', async () => {
      const customMpp = new MessagePreProcessor({
        model: 'custom-model',
        analysisTimeout: 10000,
        maxCacheSize: 500,
        debugMode: true
      });

      await customMpp.initialize();

      const status = customMpp.getStatus();
      expect(status.metadata?.config?.model).toBe('custom-model');
    });

    test('should use default configuration when none provided', async () => {
      const defaultMpp = new MessagePreProcessor();
      await defaultMpp.initialize();

      const status = defaultMpp.getStatus();
      expect(status.metadata?.config).toBeDefined();
      expect(status.status).toBe('healthy');
    });
  });

  describe('Performance Metrics', () => {
    beforeEach(async () => {
      await mpp.initialize();
    });

    test('should track analysis metrics', async () => {
      const message = 'Test message for metrics';

      await mpp.analyzeMessage(message);

      const metrics = mpp.getMetrics();
      expect(metrics.totalAnalyses).toBe(1);
      expect(metrics.averageAnalysisTime).toBeGreaterThan(0);
    });

    test('should track cache performance', async () => {
      const message1 = 'First message';
      const message2 = 'First message'; // Same message

      await mpp.analyzeMessage(message1);
      await mpp.analyzeMessage(message2); // Cache hit

      const metrics = mpp.getMetrics();
      expect(metrics.cacheHitRate).toBeGreaterThan(0);
    });

    test('should track intent distribution', async () => {
      mockCallOpenRouter.mockResolvedValueOnce(JSON.stringify({
        intent: 'question',
        confidence: 0.9,
        entities: {},
        requiresContext: false,
        suggestedTools: []
      }));

      const message = 'What is this?';
      await mpp.analyzeMessage(message);

      const metrics = mpp.getMetrics();
      expect(metrics.intentDistribution.question).toBe(1);
    });

    test('should track confidence distribution', async () => {
      mockCallOpenRouter.mockResolvedValueOnce(JSON.stringify({
        intent: 'conversation',
        confidence: 0.9, // High confidence
        entities: {},
        requiresContext: false,
        suggestedTools: []
      }));

      const message = 'Hello world';
      await mpp.analyzeMessage(message);

      const metrics = mpp.getMetrics();
      expect(metrics.confidenceDistribution.high).toBe(1);
    });
  });
});