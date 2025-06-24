/**
 * MCP Tool Manager Unit Tests - Deno Native
 */

import { assertEquals, assertExists, assertRejects, assertObjectMatch } from "std/testing/asserts.ts";
import { describe, it, beforeEach, afterEach } from "std/testing/bdd.ts";
import { stub, restore, returnsNext, spy, assertSpyCalls } from "std/testing/mock.ts";

import { MCPToolManager } from '../../src/components/mcp-tool-manager/mcp-tool-manager.ts';
import { MCPServerConfig, ToolCall, ToolDefinition, CircuitBreakerState } from '../../src/components/mcp-tool-manager/types.ts';

describe('MCPToolManager', () => {
  let toolManager: MCPToolManager;
  let mockConfigs: MCPServerConfig[];

  beforeEach(() => {
    mockConfigs = [
      {
        name: 'test-server',
        command: 'echo',
        args: ['test'],
        transport: 'stdio',
        enabled: true,
        timeout: 5000
      }
    ];

    toolManager = new MCPToolManager();
  });

  afterEach(async () => {
    await toolManager.shutdown();
    restore(); // Restore all stubs and spies
  });

  describe('initialization', () => {
    it('should initialize successfully with valid config', async () => {
      await toolManager.initializeWithConfigs(mockConfigs);

      const status = toolManager.getStatus();
      assertEquals(status.name, 'MCPToolManager');
      assertEquals(status.status, 'healthy');
    });

    it('should handle initialization without config', async () => {
      await toolManager.initialize();

      const status = toolManager.getStatus();
      assertEquals(status.name, 'MCPToolManager');
      assertEquals(status.status, 'healthy');
    });

    it('should skip disabled servers during initialization', async () => {
      const configsWithDisabled = [
        ...mockConfigs,
        {
          name: 'disabled-server',
          command: 'echo',
          args: ['disabled'],
          transport: 'stdio' as const,
          enabled: false,
          timeout: 5000
        }
      ];

      await toolManager.initializeWithConfigs(configsWithDisabled);
      const status = toolManager.getStatus();
      assertEquals(status.status, 'healthy');
    });
  });

  describe('tool discovery', () => {
    beforeEach(async () => {
      // Let the real implementation work with mock process - no more stubs interfering
      await toolManager.initializeWithConfigs(mockConfigs);
    });

    it('should get available tools', async () => {
      const tools = await toolManager.getAvailableTools();
      assertEquals(tools.length, 1);
      assertEquals(tools[0].name, 'test-tool');
      assertEquals(tools[0].serverId, 'test-server');
    });

    it('should get specific tool definition', async () => {
      // Tools are stored with serverId/toolName format in the registry
      const tool = await toolManager.getToolDefinition('test-server/test-tool');
      assertExists(tool);
      assertEquals(tool?.name, 'test-tool');
    });

    it('should return null for non-existent tool', async () => {
      const tool = await toolManager.getToolDefinition('non-existent-tool');
      assertEquals(tool, null);
    });

    it('should refresh tool registry', async () => {
      // Clear the registry first
      (toolManager as any).toolRegistry.clear();

      // Refresh should rediscover tools from mock process
      await toolManager.refreshToolRegistry();

      const tools = await toolManager.getAvailableTools();
      assertEquals(tools.length, 1);
    });
  });

  describe('tool execution', () => {
    beforeEach(async () => {
      // Let real implementation work - just initialize normally
      await toolManager.initializeWithConfigs(mockConfigs);
    });

    it('should execute tool successfully', async () => {
      const toolCall: ToolCall = {
        toolId: 'test-tool',
        serverId: 'test-server',
        arguments: { input: 'test value' }
      };

      const result = await toolManager.executeTool(toolCall);

      assertEquals(result.success, true);
      assertExists(result.output);
      assertExists(result.executionTime);
    });

    it('should handle tool execution failure', async () => {
      const toolCall: ToolCall = {
        toolId: 'non-existent-tool',
        serverId: 'test-server',
        arguments: {}
      };

      const result = await toolManager.executeTool(toolCall);

      assertEquals(result.success, false);
      assertExists(result.error);
    });

    it('should handle server not found error', async () => {
      const toolCall: ToolCall = {
        toolId: 'test-tool',
        serverId: 'non-existent-server',
        arguments: {}
      };

      const result = await toolManager.executeTool(toolCall);

      assertEquals(result.success, false);
      assertExists(result.error);
      assertEquals(result.error!.includes('Server') && (result.error!.includes('not found') || result.error!.includes('not connected')), true);
    });

    it('should execute multiple tools', async () => {
      const toolCalls: ToolCall[] = [
        {
          toolId: 'test-tool',
          serverId: 'test-server',
          arguments: { input: 'test1' }
        },
        {
          toolId: 'test-tool',
          serverId: 'test-server',
          arguments: { input: 'test2' }
        }
      ];

      const results = await toolManager.executeMultipleTools(toolCalls);

      assertEquals(results.length, 2);
      assertEquals(results[0].success, true);
      assertEquals(results[1].success, true);
    });
  });

  describe('server status monitoring', () => {
    beforeEach(async () => {
      const mockClient = {
        getStatus: () => ({
          serverId: 'test-server',
          status: 'connected',
          toolCount: 1,
          responseTime: 100
        })
      };

      Object.defineProperty(toolManager, 'clients', {
        get: () => new Map([['test-server', mockClient]])
      });

      await toolManager.initializeWithConfigs(mockConfigs);
    });

    it('should get server status', async () => {
      const status = await toolManager.getServerStatus('test-server');

      assertExists(status);
      assertEquals(status.serverId, 'test-server');
      assertEquals(status.status, 'connected');
    });

    it('should get all server statuses', async () => {
      const statuses = await toolManager.getAllServerStatuses();

      assertEquals(statuses.length, 1);
      assertEquals(statuses[0].serverId, 'test-server');
    });

    it('should get circuit breaker status', () => {
      const mockClient = {
        getCircuitBreakerStatus: () => ({
          state: CircuitBreakerState.CLOSED,
          failureCount: 0
        })
      };

      Object.defineProperty(toolManager, 'clients', {
        get: () => new Map([['test-server', mockClient]])
      });

      const status = toolManager.getCircuitBreakerStatus('test-server');

      assertEquals(status.state, CircuitBreakerState.CLOSED);
      assertEquals(status.failureCount, 0);
    });
  });

  describe('system prompt generation', () => {
    beforeEach(async () => {
      // Use real implementation - it will discover the tools from mock process
      await toolManager.initializeWithConfigs(mockConfigs);
    });

    it('should generate system prompt with available tools', () => {
      const systemPrompt = toolManager.generateSystemPromptTools();

      assertEquals(systemPrompt.includes('test-tool'), true);
      assertEquals(systemPrompt.includes('<test-server_test-tool>'), true);
      assertEquals(systemPrompt.includes('A test tool for unit testing'), true);
    });

    it('should handle empty tool list', () => {
      // Create a new manager with no servers to get empty tool list
      const emptyManager = new MCPToolManager();
      const systemPrompt = emptyManager.generateSystemPromptTools();

      assertEquals(systemPrompt.includes('No external tools'), true);
    });
  });

  describe('error handling', () => {
    it('should handle initialization errors gracefully', async () => {
      const invalidConfigs: MCPServerConfig[] = [
        {
          name: 'invalid-server',
          command: 'non-existent-command',
          args: [],
          transport: 'stdio',
          enabled: true,
          timeout: 5000
        }
      ];

      // Should not throw, but may log errors
      await toolManager.initializeWithConfigs(invalidConfigs);
      // Test passes if no exception is thrown
    });

    it('should handle circuit breaker open state', () => {
      const mockClient = {
        getCircuitBreakerStatus: () => ({
          state: CircuitBreakerState.OPEN,
          failureCount: 5,
          nextRetryTime: new Date(Date.now() + 30000)
        })
      };

      Object.defineProperty(toolManager, 'clients', {
        get: () => new Map([['test-server', mockClient]])
      });

      const status = toolManager.getCircuitBreakerStatus('test-server');

      assertEquals(status.state, CircuitBreakerState.OPEN);
      assertEquals(status.failureCount, 5);
    });
  });

  describe('component lifecycle', () => {
    it('should provide health status', () => {
      const status = toolManager.getStatus();

      assertEquals(status.name, 'MCPToolManager');
      assertExists(status.lastHealthCheck);
      assertEquals(status.lastHealthCheck instanceof Date, true);
      assertExists(status.metadata);
    });

    it('should shutdown gracefully', async () => {
      await toolManager.initializeWithConfigs(mockConfigs);

      // Should not throw
      await toolManager.shutdown();

      const status = toolManager.getStatus();
      assertEquals(status.status, 'healthy'); // Status should remain healthy after clean shutdown
    });
  });
});