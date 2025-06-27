/**
 * Tool Service - Tool execution coordination
 *
 * Coordinates tool execution across different platforms and manages tool registry
 */

import { ToolDefinition, ToolCall, ToolResult } from '../interfaces/component-interfaces.ts';
import {
  Platform,
  UMPError,
  UMPErrorType
} from '../core/protocol/ump-types.ts';

/**
 * Tool execution context
 */
export interface ToolExecutionContext {
  sessionId: string;
  userId: string;
  platform: Platform;
  requestId: string;
  timeout?: number;
}

/**
 * Tool execution result with metadata
 */
export interface ToolExecutionResult {
  success: boolean;
  results: ToolResult[];
  executionTime: number;
  metadata: {
    context: ToolExecutionContext;
    toolsRequested: number;
    toolsExecuted: number;
    errors: string[];
  };
}

/**
 * Tool Service Configuration
 */
export interface ToolServiceConfig {
  // Execution settings
  defaultTimeout: number;
  maxConcurrentExecutions: number;
  enableParallelExecution: boolean;

  // Rate limiting
  enableRateLimiting: boolean;
  maxExecutionsPerMinute: number;
  maxExecutionsPerUser: number;

  // Retry settings
  enableRetry: boolean;
  maxRetries: number;
  retryDelay: number;

  // Security
  enableSandboxing: boolean;
  allowedTools: string[];
  blockedTools: string[];

  // Logging
  enableLogging: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Tool registry interface
 */
interface ToolRegistry {
  getAvailableTools(): Promise<ToolDefinition[]>;
  getTool(toolId: string): Promise<ToolDefinition | null>;
  executeTool(toolCall: ToolCall, context: ToolExecutionContext): Promise<ToolResult>;
}

/**
 * Main Tool Service class
 */
export class ToolService {
  private config: ToolServiceConfig;
  private toolRegistry: ToolRegistry;
  private executionTracker = new Map<string, number>(); // userId -> execution count
  private rateLimitTracker = new Map<string, { count: number; resetTime: number }>();
  private activeExecutions = new Map<string, Promise<ToolResult>>();

  constructor(config: ToolServiceConfig, toolRegistry: ToolRegistry) {
    this.config = config;
    this.toolRegistry = toolRegistry;
  }

  /**
   * Execute multiple tools
   */
  async executeTools(
    toolCalls: ToolCall[],
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const startTime = Date.now();

    try {
      this.log('info', `Executing ${toolCalls.length} tools for user ${context.userId}`);

      // Validate execution limits
      await this.validateExecution(toolCalls, context);

      // Filter allowed tools
      const allowedCalls = this.filterAllowedTools(toolCalls);

      if (allowedCalls.length === 0) {
        throw new UMPError(
          'No allowed tools to execute',
          UMPErrorType.VALIDATION_ERROR,
          context.platform
        );
      }

      // Execute tools
      const results = await this.performExecution(allowedCalls, context);

      // Update execution tracking
      this.updateExecutionTracking(context.userId, allowedCalls.length);

      const executionTime = Date.now() - startTime;
      this.log('info', `Completed tool execution in ${executionTime}ms`);

      return {
        success: true,
        results,
        executionTime,
        metadata: {
          context,
          toolsRequested: toolCalls.length,
          toolsExecuted: results.length,
          errors: results.filter(r => !r.success).map(r => r.error || 'Unknown error')
        }
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.log('error', `Tool execution failed: ${error.message}`);

      return {
        success: false,
        results: [],
        executionTime,
        metadata: {
          context,
          toolsRequested: toolCalls.length,
          toolsExecuted: 0,
          errors: [error.message]
        }
      };
    }
  }

  /**
   * Get available tools
   */
  async getAvailableTools(): Promise<ToolDefinition[]> {
    try {
      const allTools = await this.toolRegistry.getAvailableTools();

      // Filter based on configuration
      return allTools.filter(tool => {
        // Check allowed tools
        if (this.config.allowedTools.length > 0) {
          return this.config.allowedTools.includes(tool.name);
        }

        // Check blocked tools
        if (this.config.blockedTools.length > 0) {
          return !this.config.blockedTools.includes(tool.name);
        }

        return true;
      });
    } catch (error) {
      this.log('error', `Failed to get available tools: ${error.message}`);
      return [];
    }
  }

  /**
   * Get tool by ID
   */
  async getTool(toolId: string): Promise<ToolDefinition | null> {
    try {
      const tool = await this.toolRegistry.getTool(toolId);

      if (!tool) {
        return null;
      }

      // Check if tool is allowed
      if (this.isToolAllowed(tool.name)) {
        return tool;
      }

      return null;
    } catch (error) {
      this.log('error', `Failed to get tool ${toolId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get execution statistics
   */
  getExecutionStats(): {
    totalExecutions: number;
    activeExecutions: number;
    executionsByUser: Record<string, number>;
    rateLimitStatus: Record<string, { count: number; remaining: number }>;
  } {
    const executionsByUser: Record<string, number> = {};
    this.executionTracker.forEach((count, userId) => {
      executionsByUser[userId] = count;
    });

    const rateLimitStatus: Record<string, { count: number; remaining: number }> = {};
    this.rateLimitTracker.forEach((status, userId) => {
      rateLimitStatus[userId] = {
        count: status.count,
        remaining: Math.max(0, this.config.maxExecutionsPerMinute - status.count)
      };
    });

    return {
      totalExecutions: Array.from(this.executionTracker.values()).reduce((sum, count) => sum + count, 0),
      activeExecutions: this.activeExecutions.size,
      executionsByUser,
      rateLimitStatus
    };
  }

  /**
   * Validate execution request
   */
  private async validateExecution(
    toolCalls: ToolCall[],
    context: ToolExecutionContext
  ): Promise<void> {
    // Check rate limits
    if (this.config.enableRateLimiting) {
      if (!this.checkRateLimit(context.userId, toolCalls.length)) {
        throw new UMPError(
          'Rate limit exceeded for tool execution',
          UMPErrorType.RATE_LIMIT_EXCEEDED,
          context.platform
        );
      }
    }

    // Check concurrent execution limits
    if (this.activeExecutions.size >= this.config.maxConcurrentExecutions) {
      throw new UMPError(
        'Maximum concurrent executions reached',
        UMPErrorType.TEMPORARY_FAILURE,
        context.platform
      );
    }

    // Check user execution limits
    const userExecutions = this.executionTracker.get(context.userId) || 0;
    if (userExecutions >= this.config.maxExecutionsPerUser) {
      throw new UMPError(
        'User execution limit reached',
        UMPErrorType.RATE_LIMIT_EXCEEDED,
        context.platform
      );
    }
  }

  /**
   * Filter allowed tools
   */
  private filterAllowedTools(toolCalls: ToolCall[]): ToolCall[] {
    return toolCalls.filter(call => this.isToolAllowed(call.toolId));
  }

  /**
   * Check if tool is allowed
   */
  private isToolAllowed(toolName: string): boolean {
    // Check blocked tools first
    if (this.config.blockedTools.includes(toolName)) {
      return false;
    }

    // If allowlist is configured, check it
    if (this.config.allowedTools.length > 0) {
      return this.config.allowedTools.includes(toolName);
    }

    return true;
  }

  /**
   * Perform tool execution
   */
  private async performExecution(
    toolCalls: ToolCall[],
    context: ToolExecutionContext
  ): Promise<ToolResult[]> {
    if (this.config.enableParallelExecution && toolCalls.length > 1) {
      return this.executeInParallel(toolCalls, context);
    } else {
      return this.executeSequentially(toolCalls, context);
    }
  }

  /**
   * Execute tools in parallel
   */
  private async executeInParallel(
    toolCalls: ToolCall[],
    context: ToolExecutionContext
  ): Promise<ToolResult[]> {
    const executionPromises = toolCalls.map(call =>
      this.executeSingleTool(call, context)
    );

    return Promise.all(executionPromises);
  }

  /**
   * Execute tools sequentially
   */
  private async executeSequentially(
    toolCalls: ToolCall[],
    context: ToolExecutionContext
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const call of toolCalls) {
      const result = await this.executeSingleTool(call, context);
      results.push(result);
    }

    return results;
  }

  /**
   * Execute a single tool
   */
  private async executeSingleTool(
    toolCall: ToolCall,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const executionKey = `${context.userId}_${toolCall.toolId}_${Date.now()}`;

    try {
      // Create execution promise
      const executionPromise = this.executeWithTimeout(toolCall, context);
      this.activeExecutions.set(executionKey, executionPromise);

      // Execute with retry logic
      if (this.config.enableRetry) {
        return await this.executeWithRetry(executionPromise, toolCall, context);
      } else {
        return await executionPromise;
      }

    } finally {
      // Clean up active execution
      this.activeExecutions.delete(executionKey);
    }
  }

  /**
   * Execute tool with timeout
   */
  private async executeWithTimeout(
    toolCall: ToolCall,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const timeout = context.timeout || this.config.defaultTimeout;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new UMPError(
          `Tool execution timed out after ${timeout}ms`,
          UMPErrorType.TEMPORARY_FAILURE,
          context.platform
        ));
      }, timeout);

      this.toolRegistry.executeTool(toolCall, context)
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Execute with retry logic
   */
  private async executeWithRetry(
    executionPromise: Promise<ToolResult>,
    toolCall: ToolCall,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    let lastError: Error;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await executionPromise;
      } catch (error) {
        lastError = error as Error;

        if (attempt < this.config.maxRetries) {
          this.log('warn', `Tool execution attempt ${attempt} failed, retrying: ${error.message}`);
          await this.delay(this.config.retryDelay * attempt);
          // Create new execution promise for retry
          executionPromise = this.executeWithTimeout(toolCall, context);
        }
      }
    }

    throw lastError!;
  }

  /**
   * Check rate limit
   */
  private checkRateLimit(userId: string, executionCount: number): boolean {
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute

    const tracker = this.rateLimitTracker.get(userId);

    if (!tracker || now > tracker.resetTime) {
      // Reset or create new tracker
      this.rateLimitTracker.set(userId, {
        count: executionCount,
        resetTime: now + windowMs
      });
      return true;
    }

    if (tracker.count + executionCount > this.config.maxExecutionsPerMinute) {
      return false;
    }

    tracker.count += executionCount;
    return true;
  }

  /**
   * Update execution tracking
   */
  private updateExecutionTracking(userId: string, executionCount: number): void {
    const current = this.executionTracker.get(userId) || 0;
    this.executionTracker.set(userId, current + executionCount);
  }

  /**
   * Delay utility
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Logging utility
   */
  private log(level: string, message: string): void {
    if (!this.config.enableLogging) {
      return;
    }

    const levels = ['debug', 'info', 'warn', 'error'];
    const configLevelIndex = levels.indexOf(this.config.logLevel);
    const messageLevelIndex = levels.indexOf(level);

    if (messageLevelIndex >= configLevelIndex) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [${level.toUpperCase()}] [ToolService] ${message}`);
    }
  }
}

/**
 * Create default configuration for Tool Service
 */
export function createDefaultToolServiceConfig(): ToolServiceConfig {
  return {
    defaultTimeout: 30000, // 30 seconds
    maxConcurrentExecutions: 10,
    enableParallelExecution: true,
    enableRateLimiting: true,
    maxExecutionsPerMinute: 60,
    maxExecutionsPerUser: 1000,
    enableRetry: true,
    maxRetries: 2,
    retryDelay: 1000,
    enableSandboxing: false,
    allowedTools: [], // Empty = allow all
    blockedTools: [], // Empty = block none
    enableLogging: true,
    logLevel: 'info'
  };
}

/**
 * Mock tool registry for development/testing
 */
export class MockToolRegistry implements ToolRegistry {
  async getAvailableTools(): Promise<ToolDefinition[]> {
    return [
      {
        serverId: 'mock',
        name: 'echo',
        description: 'Echo back the input',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string' }
          },
          required: ['text']
        }
      }
    ];
  }

  async getTool(toolId: string): Promise<ToolDefinition | null> {
    const tools = await this.getAvailableTools();
    return tools.find(tool => tool.name === toolId) || null;
  }

  async executeTool(toolCall: ToolCall, context: ToolExecutionContext): Promise<ToolResult> {
    // Mock execution
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate work

    return {
      toolId: toolCall.toolId,
      success: true,
      output: {
        result: `Mock execution of ${toolCall.toolId}`,
        arguments: toolCall.arguments,
        timestamp: new Date().toISOString()
      }
    };
  }
}