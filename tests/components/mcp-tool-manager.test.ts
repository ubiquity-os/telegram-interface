/**
 * MCP Tool Manager Unit Tests
 */

import { test, expect, describe, beforeEach, afterEach, mock, spyOn } from 'bun:test';
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
  });

  describe('initialization', () => {
    test('should initialize successfully with valid config', async () => {
      await toolManager.initializeWithConfigs(mockConfigs);

      const status = toolManager.getStatus();
      expect(status.name).toBe('MCPToolManager');
      expect(status.status).toBe('healthy');
    });

    test('should handle initialization without config', async () => {
      await toolManager.initialize();

      const status = toolManager.getStatus();
      expect(status.name).toBe('MCPToolManager');
      expect(status.status).toBe('healthy');
    });

    test('should skip disabled servers during initialization', async () => {
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
      expect(status.status).toBe('healthy');
    });
  });

  describe('tool discovery', () => {
    beforeEach(async () => {
      // Mock the discovery process since we can't rely on actual MCP servers in tests
      spyOn(toolManager as any, 'discoverServerTools').mockResolvedValue([
        {
          serverId: 'test-server',
          name: 'test-tool',
          description: 'A test tool for unit testing',
          inputSchema: {
            type: 'object',
            properties: {
              input: { type: 'string', description: 'Test input' }
            },
            required: ['input']
          }
        }
      ]);

      await toolManager.initializeWithConfigs(mockConfigs);
    });

    test('should get available tools', async () => {
      const tools = await toolManager.getAvailableTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('test-tool');
      expect(tools[0].serverId).toBe('test-server');
    });

    test('should get specific tool definition', async () => {
      const tool = await toolManager.getToolDefinition('test-tool');
      expect(tool).toBeDefined();
      expect(tool?.name).toBe('test-tool');
    });

    test('should return null for non-existent tool', async () => {
      const tool = await toolManager.getToolDefinition('non-existent-tool');
      expect(tool).toBeNull();
    });

    test('should refresh tool registry', async () => {
      // Clear the registry first
      (toolManager as any).toolRegistry.clear();

      // Refresh should rediscover tools
      await toolManager.refreshToolRegistry();

      const tools = await toolManager.getAvailableTools();
      expect(tools).toHaveLength(1);
    });
  });

  describe('tool execution', () => {
    beforeEach(async () => {
      // Mock successful client connection and tool discovery
      spyOn(toolManager as any, 'discoverServerTools').mockResolvedValue([
        {
          serverId: 'test-server',
          name: 'test-tool',
          description: 'A test tool',
          inputSchema: { type: 'object' }
        }
      ]);

      // Mock client execution
      const mockClient = {
        isConnected: mock().mockReturnValue(true),
        getCircuitBreakerStatus: mock().mockReturnValue({
          state: CircuitBreakerState.CLOSED,
          failureCount: 0
        }),
        sendRequest: mock().mockResolvedValue({
          success: true,
          result: { output: 'Test output' }
        })
      };

      spyOn(toolManager as any, 'clients', 'get').mockImplementation(() => new Map([
        ['test-server', mockClient]
      ]));

      await toolManager.initializeWithConfigs(mockConfigs);
    });

    test('should execute tool successfully', async () => {
      const toolCall: ToolCall = {
        toolId: 'test-tool',
        serverId: 'test-server',
        arguments: { input: 'test value' }
      };

      // Mock the actual execution method
      spyOn(toolManager as any, 'executeToolInternal').mockResolvedValue({
        success: true,
        output: 'Test output',
        executionTime: 100
      });

      const result = await toolManager.executeTool(toolCall);

      expect(result.success).toBe(true);
      expect(result.output).toBe('Test output');
      expect(result.executionTime).toBe(100);
    });

    test('should handle tool execution failure', async () => {
      const toolCall: ToolCall = {
        toolId: 'test-tool',
        serverId: 'test-server',
        arguments: {}
      };

      spyOn(toolManager as any, 'executeToolInternal').mockResolvedValue({
        success: false,
        error: 'Tool execution failed',
        executionTime: 50
      });

      const result = await toolManager.executeTool(toolCall);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Tool execution failed');
    });

    test('should handle server not found error', async () => {
      const toolCall: ToolCall = {
        toolId: 'test-tool',
        serverId: 'non-existent-server',
        arguments: {}
      };

      const result = await toolManager.executeTool(toolCall);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Server not found');
    });

    test('should execute multiple tools', async () => {
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

      spyOn(toolManager as any, 'executeToolInternal')
        .mockResolvedValueOnce({
          success: true,
          output: 'Output 1',
          executionTime: 100
        })
        .mockResolvedValueOnce({
          success: true,
          output: 'Output 2',
          executionTime: 150
        });

      const results = await toolManager.executeMultipleTools(toolCalls);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });
  });

  describe('server status monitoring', () => {
    beforeEach(async () => {
      const mockClient = {
        getStatus: mock().mockReturnValue({
          serverId: 'test-server',
          status: 'connected',
          toolCount: 1,
          responseTime: 100
        })
      };

      spyOn(toolManager as any, 'clients', 'get').mockImplementation(() => new Map([
        ['test-server', mockClient]
      ]));

      await toolManager.initializeWithConfigs(mockConfigs);
    });

    test('should get server status', async () => {
      const status = await toolManager.getServerStatus('test-server');

      expect(status).toBeDefined();
      expect(status.serverId).toBe('test-server');
      expect(status.status).toBe('connected');
    });

    test('should get all server statuses', async () => {
      const statuses = await toolManager.getAllServerStatuses();

      expect(statuses).toHaveLength(1);
      expect(statuses[0].serverId).toBe('test-server');
    });

    test('should get circuit breaker status', () => {
      const mockClient = {
        getCircuitBreakerStatus: mock().mockReturnValue({
          state: CircuitBreakerState.CLOSED,
          failureCount: 0
        })
      };

      spyOn(toolManager as any, 'clients', 'get').mockImplementation(() => mockClient);

      const status = toolManager.getCircuitBreakerStatus('test-server');

      expect(status.state).toBe(CircuitBreakerState.CLOSED);
      expect(status.failureCount).toBe(0);
    });
  });

  describe('system prompt generation', () => {
    beforeEach(async () => {
      // Mock tool registry with some tools
      const mockTools: ToolDefinition[] = [
        {
          serverId: 'test-server',
          name: 'example-tool',
          description: 'An example tool for testing',
          inputSchema: {
            type: 'object',
            properties: {
              input: { type: 'string', description: 'Input parameter' }
            },
            required: ['input']
          }
        }
      ];

      spyOn(toolManager as any, 'toolRegistry', 'get').mockImplementation(() => ({
        getAllTools: mock().mockReturnValue(mockTools)
      }));

      await toolManager.initializeWithConfigs(mockConfigs);
    });

    test('should generate system prompt with available tools', () => {
      const systemPrompt = toolManager.generateSystemPromptTools();

      expect(systemPrompt).toContain('example-tool');
      expect(systemPrompt).toContain('<test-server_example-tool>');
      expect(systemPrompt).toContain('<input>');
      expect(systemPrompt).toContain('An example tool for testing');
    });

    test('should handle empty tool list', () => {
      spyOn(toolManager as any, 'toolRegistry', 'get').mockImplementation(() => ({
        getAllTools: mock().mockReturnValue([])
      }));

      const systemPrompt = toolManager.generateSystemPromptTools();

      expect(systemPrompt).toContain('No external tools available');
    });
  });

  describe('error handling', () => {
    test('should handle initialization errors gracefully', async () => {
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
      await expect(toolManager.initializeWithConfigs(invalidConfigs)).resolves.not.toThrow();
    });

    test('should handle circuit breaker open state', () => {
      const mockClient = {
        getCircuitBreakerStatus: mock().mockReturnValue({
          state: CircuitBreakerState.OPEN,
          failureCount: 5,
          nextRetryTime: new Date(Date.now() + 30000)
        })
      };

      spyOn(toolManager as any, 'clients', 'get').mockImplementation(() => mockClient);

      const status = toolManager.getCircuitBreakerStatus('test-server');

      expect(status.state).toBe(CircuitBreakerState.OPEN);
      expect(status.failureCount).toBe(5);
    });
  });

  describe('component lifecycle', () => {
    test('should provide health status', () => {
      const status = toolManager.getStatus();

      expect(status.name).toBe('MCPToolManager');
      expect(status.lastHealthCheck).toBeInstanceOf(Date);
      expect(status.metadata).toBeDefined();
    });

    test('should shutdown gracefully', async () => {
      await toolManager.initializeWithConfigs(mockConfigs);

      // Should not throw
      await expect(toolManager.shutdown()).resolves.not.toThrow();

      const status = toolManager.getStatus();
      expect(status.status).toBe('unhealthy'); // Should be unhealthy after shutdown
    });
  });
});