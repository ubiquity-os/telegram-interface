/**
 * Debug Service
 * Phase 2.2: Enhanced debug capabilities built on top of telemetry infrastructure
 */

import { TelemetryService, LogLevel, StructuredLog } from '../telemetry/telemetry-service.ts';
import { DebugLogAggregator, RequestDebugInfo, DebugSummary, SearchCriteria } from './debug-log-aggregator.ts';
import { DebugConfig } from '../../utils/config.ts';

export interface ComponentDebugConfig {
  component: string;
  enabled: boolean;
  verboseLogging: boolean;
  logInputs: boolean;
  logOutputs: boolean;
  performanceTiming: boolean;
}

export interface DebugMetrics {
  totalRequests: number;
  averageRequestTime: number;
  errorRate: number;
  slowRequestsCount: number;
  componentStats: Record<string, {
    requestCount: number;
    averageTime: number;
    errorCount: number;
  }>;
}

/**
 * Debug Service implementation
 */
export class DebugService {
  private static instance: DebugService;
  private telemetry: TelemetryService;
  private aggregator: DebugLogAggregator;
  private globalConfig: DebugConfig;
  private componentConfigs = new Map<string, ComponentDebugConfig>();
  private metrics: DebugMetrics;
  private performanceTimers = new Map<string, number>();
  private isInitialized = false;

  private constructor(telemetry: TelemetryService, config: DebugConfig) {
    this.telemetry = telemetry;
    this.globalConfig = config;
    this.aggregator = new DebugLogAggregator();
    this.metrics = {
      totalRequests: 0,
      averageRequestTime: 0,
      errorRate: 0,
      slowRequestsCount: 0,
      componentStats: {}
    };
  }

  /**
   * Get singleton instance
   */
  public static getInstance(telemetry?: TelemetryService, config?: DebugConfig): DebugService {
    if (!DebugService.instance) {
      if (!telemetry || !config) {
        throw new Error('TelemetryService and DebugConfig required for first initialization');
      }
      DebugService.instance = new DebugService(telemetry, config);
    }
    return DebugService.instance;
  }

  /**
   * Initialize the debug service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    console.log('[DebugService] Initializing debug mode enhancements...');

    try {
      // Hook into telemetry log writes to aggregate debug information
      this.hookIntoTelemetryService();

      this.isInitialized = true;

      await this.telemetry.logStructured({
        level: LogLevel.INFO,
        component: 'DebugService',
        phase: 'initialization',
        message: 'Debug service initialized successfully',
        metadata: {
          debugEnabled: this.globalConfig.enabled,
          verboseLogging: this.globalConfig.verboseLogging,
          features: {
            logPrompts: this.globalConfig.logPrompts,
            logResponses: this.globalConfig.logResponses,
            logToolInputs: this.globalConfig.logToolInputs,
            logToolOutputs: this.globalConfig.logToolOutputs,
            logStateTransitions: this.globalConfig.logStateTransitions,
            performanceTiming: this.globalConfig.performanceTiming,
            logCircuitBreakerEvents: this.globalConfig.logCircuitBreakerEvents
          }
        }
      });

      console.log('[DebugService] Initialized successfully');
    } catch (error) {
      console.error('[DebugService] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Configure debug settings for a specific component
   */
  configureComponent(componentConfig: ComponentDebugConfig): void {
    this.componentConfigs.set(componentConfig.component, componentConfig);

    if (this.isDebugEnabled()) {
      this.debugLog('component_configuration', 'Component debug configuration updated', {
        component: componentConfig.component,
        config: componentConfig
      });
    }
  }

  /**
   * Check if debug is enabled globally
   */
  isDebugEnabled(): boolean {
    return this.globalConfig.enabled;
  }

  /**
   * Check if debug is enabled for a specific component
   */
  isComponentDebugEnabled(component: string): boolean {
    if (!this.globalConfig.enabled) {
      return false;
    }

    const componentConfig = this.componentConfigs.get(component);
    return componentConfig?.enabled ?? true; // Default to enabled if no specific config
  }

  /**
   * Check if verbose logging is enabled for a component
   */
  isVerboseLoggingEnabled(component?: string): boolean {
    if (!this.globalConfig.enabled || !this.globalConfig.verboseLogging) {
      return false;
    }

    if (component) {
      const componentConfig = this.componentConfigs.get(component);
      return componentConfig?.verboseLogging ?? true;
    }

    return true;
  }

  /**
   * Log debug information
   */
  async debugLog(
    phase: string,
    message: string,
    metadata: Record<string, any> = {},
    component?: string
  ): Promise<void> {
    if (!this.isDebugEnabled()) {
      return;
    }

    const currentContext = this.telemetry.getCurrentContext();
    const logComponent = component || currentContext?.component || 'Debug';

    if (!this.isComponentDebugEnabled(logComponent)) {
      return;
    }

    await this.telemetry.logStructured({
      level: LogLevel.DEBUG,
      component: logComponent,
      phase: phase,
      message: message,
      metadata: {
        debugMode: true,
        ...metadata
      }
    });
  }

  /**
   * Log verbose debug information (only when verbose mode is enabled)
   */
  async verboseLog(
    phase: string,
    message: string,
    metadata: Record<string, any> = {},
    component?: string
  ): Promise<void> {
    const logComponent = component || this.telemetry.getCurrentContext()?.component || 'Debug';

    if (!this.isVerboseLoggingEnabled(logComponent)) {
      return;
    }

    await this.debugLog(phase, `[VERBOSE] ${message}`, metadata, component);
  }

  /**
   * Log LLM prompt (if enabled)
   */
  async logPrompt(
    prompt: string,
    metadata: Record<string, any> = {},
    component: string = 'LLMService'
  ): Promise<void> {
    if (!this.globalConfig.logPrompts) {
      return;
    }

    await this.debugLog('llm_prompt', 'LLM prompt logged', {
      prompt,
      promptLength: prompt.length,
      ...metadata
    }, component);
  }

  /**
   * Log LLM response (if enabled)
   */
  async logResponse(
    response: string,
    metadata: Record<string, any> = {},
    component: string = 'LLMService'
  ): Promise<void> {
    if (!this.globalConfig.logResponses) {
      return;
    }

    await this.debugLog('llm_response', 'LLM response logged', {
      response,
      responseLength: response.length,
      ...metadata
    }, component);
  }

  /**
   * Log tool input (if enabled)
   */
  async logToolInput(
    toolName: string,
    input: any,
    metadata: Record<string, any> = {},
    component: string = 'MCPToolManager'
  ): Promise<void> {
    if (!this.globalConfig.logToolInputs) {
      return;
    }

    await this.debugLog('tool_input', 'Tool input logged', {
      toolName,
      input,
      inputType: typeof input,
      ...metadata
    }, component);
  }

  /**
   * Log tool output (if enabled)
   */
  async logToolOutput(
    toolName: string,
    output: any,
    metadata: Record<string, any> = {},
    component: string = 'MCPToolManager'
  ): Promise<void> {
    if (!this.globalConfig.logToolOutputs) {
      return;
    }

    await this.debugLog('tool_output', 'Tool output logged', {
      toolName,
      output,
      outputType: typeof output,
      ...metadata
    }, component);
  }

  /**
   * Log state transition (if enabled)
   */
  async logStateTransition(
    fromState: string,
    toState: string,
    trigger: string,
    metadata: Record<string, any> = {},
    component: string = 'DecisionEngine'
  ): Promise<void> {
    if (!this.globalConfig.logStateTransitions) {
      return;
    }

    await this.debugLog('state_transition', 'State transition logged', {
      fromState,
      toState,
      trigger,
      operation: 'state_transition',
      ...metadata
    }, component);
  }

  /**
   * Log circuit breaker event (if enabled)
   */
  async logCircuitBreakerEvent(
    event: 'opened' | 'closed' | 'half-open' | 'failed' | 'succeeded',
    metadata: Record<string, any> = {},
    component: string = 'CircuitBreaker'
  ): Promise<void> {
    if (!this.globalConfig.logCircuitBreakerEvents) {
      return;
    }

    await this.debugLog('circuit_breaker', 'Circuit breaker event logged', {
      event,
      circuitBreakerState: event,
      ...metadata
    }, component);
  }

  /**
   * Start performance timer
   */
  startPerformanceTimer(timerId: string, component?: string): void {
    if (!this.globalConfig.performanceTiming) {
      return;
    }

    const key = component ? `${component}:${timerId}` : timerId;
    this.performanceTimers.set(key, Date.now());

    this.debugLog('performance_timer_start', 'Performance timer started', {
      timerId,
      component
    }, component);
  }

  /**
   * End performance timer and log result
   */
  async endPerformanceTimer(
    timerId: string,
    component?: string,
    metadata: Record<string, any> = {}
  ): Promise<number | null> {
    if (!this.globalConfig.performanceTiming) {
      return null;
    }

    const key = component ? `${component}:${timerId}` : timerId;
    const startTime = this.performanceTimers.get(key);

    if (!startTime) {
      await this.debugLog('performance_timer_error', 'Performance timer not found', {
        timerId,
        component
      }, component);
      return null;
    }

    const duration = Date.now() - startTime;
    this.performanceTimers.delete(key);

    await this.debugLog('performance_timer_end', 'Performance timer completed', {
      timerId,
      duration,
      component,
      ...metadata
    }, component);

    // Update metrics
    this.updatePerformanceMetrics(component || 'unknown', duration);

    return duration;
  }

  /**
   * Get aggregated debug information for a correlation ID
   */
  getRequestDebugInfo(correlationId: string): RequestDebugInfo | null {
    return this.aggregator.aggregateByCorrelationId(correlationId);
  }

  /**
   * Export debug information for LLM analysis
   */
  exportForLLMAnalysis(correlationId: string): string {
    return this.aggregator.exportForLLMAnalysis(correlationId);
  }

  /**
   * Get debug summary for a correlation ID
   */
  getDebugSummary(correlationId: string): DebugSummary | null {
    return this.aggregator.getDebugSummary(correlationId);
  }

  /**
   * Search logs based on criteria
   */
  searchLogs(criteria: SearchCriteria): StructuredLog[] {
    return this.aggregator.searchLogs(criteria);
  }

  /**
   * Get current debug metrics
   */
  getMetrics(): DebugMetrics {
    return { ...this.metrics };
  }

  /**
   * Clear debug data for a correlation ID
   */
  clearCorrelationId(correlationId: string): void {
    this.aggregator.clearCorrelationId(correlationId);
  }

  /**
   * Update global debug configuration
   */
  updateConfig(newConfig: Partial<DebugConfig>): void {
    this.globalConfig = { ...this.globalConfig, ...newConfig };

    this.debugLog('config_update', 'Debug configuration updated', {
      newConfig,
      mergedConfig: this.globalConfig
    });
  }

  /**
   * Get list of all tracked correlation IDs
   */
  getTrackedCorrelationIds(): string[] {
    return this.aggregator.getTrackedCorrelationIds();
  }

  /**
   * Hook into telemetry service to capture logs for aggregation
   */
  private hookIntoTelemetryService(): void {
    // Store original writeLogToFile method
    const originalWriteLogToFile = (this.telemetry as any).writeLogToFile;

    // Override to capture logs for aggregation
    (this.telemetry as any).writeLogToFile = async (log: StructuredLog) => {
      // Add to aggregator if debug is enabled
      if (this.globalConfig.enabled) {
        this.aggregator.addLog(log);
      }

      // Call original method
      return originalWriteLogToFile.call(this.telemetry, log);
    };
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(component: string, duration: number): void {
    this.metrics.totalRequests++;

    // Update component stats
    if (!this.metrics.componentStats[component]) {
      this.metrics.componentStats[component] = {
        requestCount: 0,
        averageTime: 0,
        errorCount: 0
      };
    }

    const stats = this.metrics.componentStats[component];
    stats.requestCount++;
    stats.averageTime = ((stats.averageTime * (stats.requestCount - 1)) + duration) / stats.requestCount;

    // Update global averages
    this.metrics.averageRequestTime = ((this.metrics.averageRequestTime * (this.metrics.totalRequests - 1)) + duration) / this.metrics.totalRequests;

    // Track slow requests (>2 seconds)
    if (duration > 2000) {
      this.metrics.slowRequestsCount++;
    }
  }

  /**
   * Shutdown debug service
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    await this.debugLog('shutdown', 'Debug service shutting down', {
      finalMetrics: this.metrics,
      trackedCorrelationIds: this.aggregator.getTrackedCorrelationIds().length
    });

    this.aggregator.clearAll();
    this.performanceTimers.clear();
    this.isInitialized = false;
  }
}

/**
 * Global debug service instance
 */
let debugServiceInstance: DebugService | null = null;

/**
 * Initialize debug service
 */
export async function initializeDebugService(
  telemetry: TelemetryService,
  config: DebugConfig
): Promise<DebugService> {
  debugServiceInstance = DebugService.getInstance(telemetry, config);
  await debugServiceInstance.initialize();
  return debugServiceInstance;
}

/**
 * Get debug service instance
 */
export function getDebugService(): DebugService | null {
  return debugServiceInstance;
}