/**
 * Tool Registry
 *
 * Manages tool definitions and their metadata
 */

import {
  ToolDefinition,
  ToolRegistryEntry,
  HealthCheckResult,
  RegistryRefreshConfig,
  VersionComparisonResult,
  RegistryHealthStatus,
  MCPRequest,
  MCPResponse
} from './types.ts';
import { TelemetryService } from '../../services/telemetry/telemetry-service.ts';

/**
 * Tool registry for managing available tools
 */
export class ToolRegistry {
  private tools = new Map<string, ToolRegistryEntry>();
  private refreshConfig: RegistryRefreshConfig;
  private refreshInterval?: number;
  private healthCheckInterval?: number;
  private telemetry?: TelemetryService;

  constructor(
    config?: Partial<RegistryRefreshConfig>,
    telemetry?: TelemetryService
  ) {
    this.refreshConfig = {
      intervalMs: 300000, // 5 minutes default
      enableAutoRefresh: false,
      healthCheckIntervalMs: 60000, // 1 minute default
      maxHealthCheckHistory: 10,
      deprecationWarningDays: 30,
      ...config
    };
    this.telemetry = telemetry;
  }

  /**
   * Register a tool from an MCP server
   */
  async registerTool(definition: ToolDefinition): Promise<void> {
    const toolId = `${definition.serverId}/${definition.name}`;

    const existing = this.tools.get(toolId);

    // Set version and modification date if not provided
    if (!definition.version) {
      definition.version = '1.0.0';
    }
    if (!definition.lastModified) {
      definition.lastModified = new Date();
    }
    if (!definition.healthStatus) {
      definition.healthStatus = 'healthy';
    }

    this.tools.set(toolId, {
      definition,
      lastUsed: existing?.lastUsed,
      usageCount: existing?.usageCount || 0,
      averageExecutionTime: existing?.averageExecutionTime,
      healthCheckHistory: existing?.healthCheckHistory || []
    });

    await this.telemetry?.info('Tool registered', {
      toolId,
      version: definition.version,
      serverId: definition.serverId
    });
  }

  /**
   * Get tool definition by ID
   */
  getToolDefinition(toolId: string): ToolDefinition | null {
    const entry = this.tools.get(toolId);
    return entry ? entry.definition : null;
  }

  /**
   * Get all available tools
   */
  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(entry => entry.definition);
  }

  /**
   * Get tools for a specific server
   */
  getToolsForServer(serverId: string): ToolDefinition[] {
    return Array.from(this.tools.values())
      .filter(entry => entry.definition.serverId === serverId)
      .map(entry => entry.definition);
  }

  /**
   * Update tool usage statistics
   */
  updateToolUsage(toolId: string, executionTime: number): void {
    const entry = this.tools.get(toolId);
    if (entry) {
      entry.lastUsed = new Date();
      entry.usageCount++;

      // Update average execution time
      if (entry.averageExecutionTime) {
        entry.averageExecutionTime = (entry.averageExecutionTime + executionTime) / 2;
      } else {
        entry.averageExecutionTime = executionTime;
      }
    }
  }

  /**
   * Remove all tools for a server
   */
  removeServerTools(serverId: string): void {
    for (const [toolId, entry] of this.tools) {
      if (entry.definition.serverId === serverId) {
        this.tools.delete(toolId);
      }
    }
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Generate system prompt format for tools
   * This implements the DIRECT XML format to fix the tool format mismatch
   */
  generateSystemPromptTools(): string {
    const tools = this.getAllTools();
    if (tools.length === 0) {
      return "## External Tools\n\nNo external tools are currently available.";
    }

    let prompt = "## External Tools\n\n";
    prompt += "You have access to the following external tools. Use them directly with XML format:\n\n";

    for (const tool of tools) {
      const toolName = `${tool.serverId}_${tool.name}`;
      prompt += `### ${toolName}\n`;
      if (tool.description) {
        prompt += `Description: ${tool.description}\n`;
      }

      prompt += `Usage:\n`;
      prompt += `<${toolName}>\n`;

      // Generate parameters from schema
      if (tool.inputSchema?.properties) {
        for (const [paramName, paramDef] of Object.entries(tool.inputSchema.properties)) {
          const isRequired = tool.inputSchema.required?.includes(paramName);
          const paramSchema = paramDef as any;
          prompt += `<${paramName}>${this.getExampleValue(paramSchema)}${isRequired ? '' : ' (optional)'}</${paramName}>\n`;
        }
      }

      prompt += `</${toolName}>\n\n`;
    }

    return prompt;
  }

  /**
   * Parse direct XML tool call to internal format
   */
  parseDirectToolCall(toolName: string, params: Record<string, string>): {
    serverId: string;
    toolName: string;
    arguments: Record<string, any>;
  } | null {
    // Extract server and tool name from combined name
    const parts = toolName.split('_');
    if (parts.length < 2) return null;

    const serverId = parts[0];
    const actualToolName = parts.slice(1).join('_');

    // Find the tool definition
    const toolId = `${serverId}/${actualToolName}`;
    const definition = this.getToolDefinition(toolId);
    if (!definition) return null;

    // Convert string parameters to proper types based on schema
    const arguments_: Record<string, any> = {};
    if (definition.inputSchema?.properties) {
      for (const [paramName, value] of Object.entries(params)) {
        const paramSchema = definition.inputSchema.properties[paramName] as any;
        arguments_[paramName] = this.convertParameter(value, paramSchema);
      }
    } else {
      // No schema, use as-is
      Object.assign(arguments_, params);
    }

    return {
      serverId,
      toolName: actualToolName,
      arguments: arguments_
    };
  }

  /**
   * Convert parameter value based on schema type
   */
  private convertParameter(value: string, schema: any): any {
    if (!schema?.type) return value;

    switch (schema.type) {
      case 'number':
        const num = Number(value);
        return isNaN(num) ? value : num;
      case 'integer':
        const int = parseInt(value, 10);
        return isNaN(int) ? value : int;
      case 'boolean':
        return value.toLowerCase() === 'true';
      case 'array':
        try {
          return JSON.parse(value);
        } catch {
          return [value];
        }
      case 'object':
        try {
          return JSON.parse(value);
        } catch {
          return { value };
        }
      default:
        return value;
    }
  }

  /**
   * Get example value for parameter based on schema
   */
  private getExampleValue(schema: any): string {
    if (!schema?.type) return 'value';

    switch (schema.type) {
      case 'string':
        if (schema.enum) return schema.enum[0];
        return schema.description ? `"${schema.description.toLowerCase().replace(/\s+/g, '_')}"` : '"example"';
      case 'number':
      case 'integer':
        return '42';
      case 'boolean':
        return 'true';
      case 'array':
        return '["item1", "item2"]';
      case 'object':
        return '{"key": "value"}';
      default:
        return 'value';
    }
  }

  /**
   * Get registry statistics
   */
  getStatistics() {
    const totalTools = this.tools.size;
    const servers = new Set(Array.from(this.tools.values()).map(entry => entry.definition.serverId));
    const totalUsage = Array.from(this.tools.values()).reduce((sum, entry) => sum + entry.usageCount, 0);
    const avgExecutionTime = Array.from(this.tools.values())
      .filter(entry => entry.averageExecutionTime)
      .reduce((sum, entry, _, arr) => sum + (entry.averageExecutionTime! / arr.length), 0);

    return {
      totalTools,
      totalServers: servers.size,
      totalUsage,
      averageExecutionTime: avgExecutionTime || 0
    };
  }

  /**
   * Perform health check for a specific tool
   * Phase 4.1: Tool Health Checks
   */
  async performToolHealthCheck(toolId: string): Promise<HealthCheckResult> {
    const entry = this.tools.get(toolId);
    if (!entry) {
      throw new Error(`Tool not found: ${toolId}`);
    }

    const startTime = Date.now();
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    let error: string | undefined;
    let details: Record<string, any> = {};

    try {
      // Simulate health check - in real implementation, this would test tool connectivity
      const responseTime = Date.now() - startTime;

      // Simple health assessment based on response time and usage patterns
      if (responseTime > 5000) {
        status = 'unhealthy';
        details.reason = 'High response time';
      } else if (responseTime > 2000) {
        status = 'degraded';
        details.reason = 'Elevated response time';
      }

      details.responseTime = responseTime;
      details.lastUsed = entry.lastUsed;
      details.usageCount = entry.usageCount;

      await this.telemetry?.debug('Tool health check completed', {
        toolId,
        status,
        responseTime
      });

    } catch (err) {
      status = 'unhealthy';
      error = err instanceof Error ? err.message : 'Unknown error';

      await this.telemetry?.error('Tool health check failed', err instanceof Error ? err : undefined, {
        toolId,
        errorMessage: error
      });
    }

    const result: HealthCheckResult = {
      timestamp: new Date(),
      status,
      responseTime: Date.now() - startTime,
      error,
      details
    };

    // Update tool definition health status
    entry.definition.healthStatus = status;

    // Add to health check history
    entry.healthCheckHistory = entry.healthCheckHistory || [];
    entry.healthCheckHistory.push(result);

    // Maintain history limit
    if (entry.healthCheckHistory.length > this.refreshConfig.maxHealthCheckHistory) {
      entry.healthCheckHistory.shift();
    }

    return result;
  }

  /**
   * Get overall registry health status
   * Phase 4.1: Tool Health Checks
   */
  async getRegistryHealth(): Promise<RegistryHealthStatus> {
    const tools = Array.from(this.tools.values());
    const totalTools = tools.length;

    let healthyTools = 0;
    let degradedTools = 0;
    let unhealthyTools = 0;
    let improving = 0;
    let stable = 0;
    let degrading = 0;

    for (const entry of tools) {
      const status = entry.definition.healthStatus || 'healthy';

      switch (status) {
        case 'healthy':
          healthyTools++;
          break;
        case 'degraded':
          degradedTools++;
          break;
        case 'unhealthy':
          unhealthyTools++;
          break;
      }

      // Analyze health trends
      const history = entry.healthCheckHistory || [];
      if (history.length >= 2) {
        const recent = history.slice(-2);
        const isImproving = recent[0].status === 'unhealthy' && recent[1].status !== 'unhealthy';
        const isDegrading = recent[0].status === 'healthy' && recent[1].status !== 'healthy';

        if (isImproving) improving++;
        else if (isDegrading) degrading++;
        else stable++;
      } else {
        stable++;
      }
    }

    // Determine overall health
    let overallHealth: 'healthy' | 'degraded' | 'unhealthy';
    if (unhealthyTools > totalTools * 0.3) {
      overallHealth = 'unhealthy';
    } else if (degradedTools > totalTools * 0.5) {
      overallHealth = 'degraded';
    } else {
      overallHealth = 'healthy';
    }

    const status: RegistryHealthStatus = {
      overallHealth,
      totalTools,
      healthyTools,
      degradedTools,
      unhealthyTools,
      lastHealthCheck: new Date(),
      healthTrends: {
        improving,
        stable,
        degrading
      }
    };

    await this.telemetry?.info('Registry health check completed', {
      overallHealth,
      totalTools,
      healthyTools,
      degradedTools,
      unhealthyTools
    });

    return status;
  }

  /**
   * Perform health checks for all tools
   * Phase 4.1: Tool Health Checks
   */
  async performHealthChecks(): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];

    for (const [toolId] of this.tools) {
      try {
        const result = await this.performToolHealthCheck(toolId);
        results.push(result);
      } catch (error) {
        await this.telemetry?.error('Health check failed for tool', error instanceof Error ? error : undefined, {
          toolId,
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return results;
  }

  /**
   * Compare two semantic versions
   * Phase 4.1: Tool Versioning Support
   */
  compareVersions(version1: string, version2: string): VersionComparisonResult {
    const parseVersion = (version: string) => {
      const parts = version.split('.').map(Number);
      return {
        major: parts[0] || 0,
        minor: parts[1] || 0,
        patch: parts[2] || 0
      };
    };

    const v1 = parseVersion(version1);
    const v2 = parseVersion(version2);

    let isNewer = false;
    let changeType: 'major' | 'minor' | 'patch' | 'unknown' = 'unknown';
    let isCompatible = true;

    if (v2.major > v1.major) {
      isNewer = true;
      changeType = 'major';
      isCompatible = false; // Major version changes break compatibility
    } else if (v2.major === v1.major && v2.minor > v1.minor) {
      isNewer = true;
      changeType = 'minor';
    } else if (v2.major === v1.major && v2.minor === v1.minor && v2.patch > v1.patch) {
      isNewer = true;
      changeType = 'patch';
    }

    return {
      toolId: '', // Will be set by caller
      currentVersion: version1,
      newVersion: version2,
      isNewer,
      isCompatible,
      changeType
    };
  }

  /**
   * Get tools by version pattern
   * Phase 4.1: Tool Versioning Support
   */
  getToolsByVersion(versionPattern?: string): ToolDefinition[] {
    const tools = this.getAllTools();

    if (!versionPattern) {
      return tools;
    }

    return tools.filter(tool => {
      if (!tool.version) return false;

      // Simple pattern matching - could be enhanced with more sophisticated patterns
      if (versionPattern.includes('*')) {
        const pattern = versionPattern.replace(/\*/g, '.*');
        const regex = new RegExp(`^${pattern}$`);
        return regex.test(tool.version);
      }

      return tool.version === versionPattern;
    });
  }

  /**
   * Mark a tool as deprecated
   * Phase 4.1: Enhanced Registry Capabilities
   */
  async deprecateTool(toolId: string, notice: string): Promise<void> {
    const entry = this.tools.get(toolId);
    if (!entry) {
      throw new Error(`Tool not found: ${toolId}`);
    }

    entry.definition.deprecationNotice = notice;

    await this.telemetry?.info('Tool deprecated', {
      toolId,
      notice
    });
  }

  /**
   * Get deprecated tools
   * Phase 4.1: Enhanced Registry Capabilities
   */
  getDeprecatedTools(): ToolDefinition[] {
    return this.getAllTools().filter(tool => tool.deprecationNotice);
  }

  /**
   * Start periodic refresh mechanism
   * Phase 4.1: Periodic Refresh Mechanism
   */
  async startPeriodicRefresh(): Promise<void> {
    if (!this.refreshConfig.enableAutoRefresh) {
      await this.telemetry?.debug('Periodic refresh disabled in configuration');
      return;
    }

    // Stop existing intervals
    this.stopPeriodicRefresh();

    // Start registry refresh interval
    this.refreshInterval = setInterval(async () => {
      try {
        await this.telemetry?.debug('Starting periodic registry refresh');
        // In real implementation, this would trigger tool discovery refresh
        // For now, we just log the event
      } catch (error) {
        await this.telemetry?.error('Periodic refresh failed', error instanceof Error ? error : undefined, {
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, this.refreshConfig.intervalMs);

    // Start health check interval
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthChecks();
      } catch (error) {
        await this.telemetry?.error('Periodic health check failed', error instanceof Error ? error : undefined, {
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }, this.refreshConfig.healthCheckIntervalMs);

    await this.telemetry?.info('Periodic refresh started', {
      refreshIntervalMs: this.refreshConfig.intervalMs,
      healthCheckIntervalMs: this.refreshConfig.healthCheckIntervalMs
    });
  }

  /**
   * Stop periodic refresh mechanism
   * Phase 4.1: Periodic Refresh Mechanism
   */
  stopPeriodicRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }

  /**
   * Update refresh configuration
   * Phase 4.1: Periodic Refresh Mechanism
   */
  async updateRefreshConfig(config: Partial<RegistryRefreshConfig>): Promise<void> {
    const wasRunning = this.refreshInterval !== undefined;

    // Stop current intervals
    this.stopPeriodicRefresh();

    // Update configuration
    this.refreshConfig = {
      ...this.refreshConfig,
      ...config
    };

    // Restart if it was running
    if (wasRunning && this.refreshConfig.enableAutoRefresh) {
      await this.startPeriodicRefresh();
    }

    await this.telemetry?.info('Refresh configuration updated', {
      config: this.refreshConfig
    });
  }

  /**
   * Dispose of registry resources
   * Phase 4.1: Enhanced cleanup
   */
  dispose(): void {
    this.stopPeriodicRefresh();
    this.clear();
  }
}