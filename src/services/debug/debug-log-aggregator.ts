/**
 * Debug Log Aggregator
 * Phase 2.2: Aggregates debug logs by correlation ID for comprehensive request tracing
 */

import { StructuredLog } from '../telemetry/telemetry-service.ts';

export interface RequestDebugInfo {
  correlationId: string;
  startTime: string;
  endTime?: string;
  totalDuration?: number;
  component: string;
  phases: PhaseDebugInfo[];
  tools: ToolDebugInfo[];
  errors: ErrorDebugInfo[];
  performance: PerformanceDebugInfo;
  llmInteractions: LLMDebugInfo[];
  stateTransitions: StateTransitionDebugInfo[];
  circuitBreakerEvents: CircuitBreakerEventDebugInfo[];
}

export interface PhaseDebugInfo {
  phase: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  status: 'started' | 'completed' | 'failed';
  metadata: Record<string, any>;
}

export interface ToolDebugInfo {
  toolName: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  input?: any;
  output?: any;
  status: 'started' | 'completed' | 'failed';
  error?: string;
}

export interface ErrorDebugInfo {
  timestamp: string;
  phase: string;
  errorType: string;
  errorMessage: string;
  stack?: string;
  metadata: Record<string, any>;
}

export interface PerformanceDebugInfo {
  phases: Record<string, number>;
  totalDuration: number;
  slowestPhase: string;
  fastestPhase: string;
  averagePhaseTime: number;
}

export interface LLMDebugInfo {
  timestamp: string;
  phase: string;
  prompt?: string;
  response?: string;
  model?: string;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  duration?: number;
}

export interface StateTransitionDebugInfo {
  timestamp: string;
  fromState: string;
  toState: string;
  trigger: string;
  metadata: Record<string, any>;
}

export interface CircuitBreakerEventDebugInfo {
  timestamp: string;
  component: string;
  event: 'opened' | 'closed' | 'half-open' | 'failed' | 'succeeded';
  errorCount?: number;
  metadata: Record<string, any>;
}

export interface DebugSummary {
  correlationId: string;
  status: 'success' | 'error' | 'timeout';
  totalDuration: number;
  phaseCount: number;
  toolCount: number;
  errorCount: number;
  llmInteractionCount: number;
  slowestPhase: string;
  criticalErrors: string[];
  recommendations: string[];
}

export interface SearchCriteria {
  correlationId?: string;
  component?: string;
  phase?: string;
  level?: string;
  timeRange?: {
    start: Date;
    end: Date;
  };
  hasError?: boolean;
  minDuration?: number;
  maxDuration?: number;
}

/**
 * Debug Log Aggregator class for collecting and analyzing logs by correlation ID
 */
export class DebugLogAggregator {
  private logsByCorrelationId = new Map<string, StructuredLog[]>();
  private maxRetainedLogs = 1000;
  private logRetentionMs = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Add a structured log to the aggregator
   */
  addLog(log: StructuredLog): void {
    const correlationId = log.correlationId;

    if (!this.logsByCorrelationId.has(correlationId)) {
      this.logsByCorrelationId.set(correlationId, []);
    }

    const logs = this.logsByCorrelationId.get(correlationId)!;
    logs.push(log);

    // Maintain size limits
    this.cleanupOldLogs();
  }

  /**
   * Aggregate all logs for a specific correlation ID into debug info
   */
  aggregateByCorrelationId(correlationId: string): RequestDebugInfo | null {
    const logs = this.logsByCorrelationId.get(correlationId);
    if (!logs || logs.length === 0) {
      return null;
    }

    // Sort logs by timestamp
    logs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const firstLog = logs[0];
    const lastLog = logs[logs.length - 1];

    const startTime = firstLog.timestamp;
    const endTime = lastLog.timestamp;
    const totalDuration = new Date(endTime).getTime() - new Date(startTime).getTime();

    // Aggregate phases
    const phases = this.aggregatePhases(logs);

    // Aggregate tools
    const tools = this.aggregateTools(logs);

    // Aggregate errors
    const errors = this.aggregateErrors(logs);

    // Calculate performance metrics
    const performance = this.calculatePerformance(logs, phases);

    // Aggregate LLM interactions
    const llmInteractions = this.aggregateLLMInteractions(logs);

    // Aggregate state transitions
    const stateTransitions = this.aggregateStateTransitions(logs);

    // Aggregate circuit breaker events
    const circuitBreakerEvents = this.aggregateCircuitBreakerEvents(logs);

    return {
      correlationId,
      startTime,
      endTime,
      totalDuration,
      component: firstLog.component,
      phases,
      tools,
      errors,
      performance,
      llmInteractions,
      stateTransitions,
      circuitBreakerEvents
    };
  }

  /**
   * Export debug information formatted for LLM analysis
   */
  exportForLLMAnalysis(correlationId: string): string {
    const debugInfo = this.aggregateByCorrelationId(correlationId);
    if (!debugInfo) {
      return `No debug information found for correlation ID: ${correlationId}`;
    }

    const lines: string[] = [];
    lines.push(`# Debug Analysis for ${correlationId}\n`);

    lines.push(`## Overview`);
    lines.push(`- Total Duration: ${debugInfo.totalDuration}ms`);
    lines.push(`- Component: ${debugInfo.component}`);
    lines.push(`- Phases: ${debugInfo.phases.length}`);
    lines.push(`- Tools Used: ${debugInfo.tools.length}`);
    lines.push(`- Errors: ${debugInfo.errors.length}`);
    lines.push(`- LLM Interactions: ${debugInfo.llmInteractions.length}\n`);

    if (debugInfo.phases.length > 0) {
      lines.push(`## Phase Timeline`);
      debugInfo.phases.forEach(phase => {
        lines.push(`- ${phase.phase}: ${phase.status} (${phase.duration || 'unknown'}ms)`);
      });
      lines.push('');
    }

    if (debugInfo.tools.length > 0) {
      lines.push(`## Tool Usage`);
      debugInfo.tools.forEach(tool => {
        lines.push(`- ${tool.toolName}: ${tool.status} (${tool.duration || 'unknown'}ms)`);
        if (tool.error) {
          lines.push(`  Error: ${tool.error}`);
        }
      });
      lines.push('');
    }

    if (debugInfo.errors.length > 0) {
      lines.push(`## Errors`);
      debugInfo.errors.forEach(error => {
        lines.push(`- ${error.phase}: ${error.errorType} - ${error.errorMessage}`);
      });
      lines.push('');
    }

    lines.push(`## Performance Analysis`);
    lines.push(`- Slowest Phase: ${debugInfo.performance.slowestPhase}`);
    lines.push(`- Fastest Phase: ${debugInfo.performance.fastestPhase}`);
    lines.push(`- Average Phase Time: ${debugInfo.performance.averagePhaseTime}ms`);

    return lines.join('\n');
  }

  /**
   * Get debug summary for a correlation ID
   */
  getDebugSummary(correlationId: string): DebugSummary | null {
    const debugInfo = this.aggregateByCorrelationId(correlationId);
    if (!debugInfo) {
      return null;
    }

    const status = debugInfo.errors.length > 0 ? 'error' : 'success';
    const criticalErrors = debugInfo.errors
      .filter(e => e.errorType.includes('Critical') || e.errorType.includes('Fatal'))
      .map(e => e.errorMessage);

    const recommendations: string[] = [];

    // Generate recommendations based on analysis
    if (debugInfo.totalDuration > 5000) {
      recommendations.push('Consider optimizing slow operations (>5s total time)');
    }

    if (debugInfo.tools.some(t => t.status === 'failed')) {
      recommendations.push('Review failed tool executions');
    }

    if (debugInfo.errors.length > 3) {
      recommendations.push('High error count detected - review error handling');
    }

    return {
      correlationId,
      status,
      totalDuration: debugInfo.totalDuration,
      phaseCount: debugInfo.phases.length,
      toolCount: debugInfo.tools.length,
      errorCount: debugInfo.errors.length,
      llmInteractionCount: debugInfo.llmInteractions.length,
      slowestPhase: debugInfo.performance.slowestPhase,
      criticalErrors,
      recommendations
    };
  }

  /**
   * Search logs based on criteria
   */
  searchLogs(criteria: SearchCriteria): StructuredLog[] {
    const results: StructuredLog[] = [];

    for (const [correlationId, logs] of this.logsByCorrelationId) {
      if (criteria.correlationId && correlationId !== criteria.correlationId) {
        continue;
      }

      for (const log of logs) {
        if (this.matchesCriteria(log, criteria)) {
          results.push(log);
        }
      }
    }

    return results.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  /**
   * Get all correlation IDs currently tracked
   */
  getTrackedCorrelationIds(): string[] {
    return Array.from(this.logsByCorrelationId.keys());
  }

  /**
   * Clear logs for a specific correlation ID
   */
  clearCorrelationId(correlationId: string): void {
    this.logsByCorrelationId.delete(correlationId);
  }

  /**
   * Clear all logs
   */
  clearAll(): void {
    this.logsByCorrelationId.clear();
  }

  private aggregatePhases(logs: StructuredLog[]): PhaseDebugInfo[] {
    const phaseMap = new Map<string, PhaseDebugInfo>();

    for (const log of logs) {
      const phase = log.phase;

      if (!phaseMap.has(phase)) {
        phaseMap.set(phase, {
          phase,
          startTime: log.timestamp,
          status: 'started',
          metadata: {}
        });
      }

      const phaseInfo = phaseMap.get(phase)!;

      // Update end time and duration
      phaseInfo.endTime = log.timestamp;
      if (phaseInfo.startTime) {
        phaseInfo.duration = new Date(log.timestamp).getTime() - new Date(phaseInfo.startTime).getTime();
      }

      // Update status based on log content
      if (log.level === 'ERROR') {
        phaseInfo.status = 'failed';
      } else if (log.message.includes('completed') || log.message.includes('ended')) {
        phaseInfo.status = 'completed';
      }

      // Merge metadata
      Object.assign(phaseInfo.metadata, log.metadata);
    }

    return Array.from(phaseMap.values());
  }

  private aggregateTools(logs: StructuredLog[]): ToolDebugInfo[] {
    const tools: ToolDebugInfo[] = [];

    const toolLogs = logs.filter(log =>
      log.metadata?.operation?.includes('tool') ||
      log.phase.includes('tool') ||
      log.component.includes('Tool')
    );

    for (const log of toolLogs) {
      if (log.metadata?.toolName) {
        tools.push({
          toolName: log.metadata.toolName,
          startTime: log.timestamp,
          status: log.level === 'ERROR' ? 'failed' : 'completed',
          input: log.metadata?.input,
          output: log.metadata?.output,
          duration: log.duration,
          error: log.error?.message
        });
      }
    }

    return tools;
  }

  private aggregateErrors(logs: StructuredLog[]): ErrorDebugInfo[] {
    return logs
      .filter(log => log.level === 'ERROR' && log.error)
      .map(log => ({
        timestamp: log.timestamp,
        phase: log.phase,
        errorType: log.error!.type,
        errorMessage: log.error!.message,
        stack: log.error!.stack,
        metadata: log.metadata
      }));
  }

  private calculatePerformance(logs: StructuredLog[], phases: PhaseDebugInfo[]): PerformanceDebugInfo {
    const phaseDurations: Record<string, number> = {};
    let totalDuration = 0;

    for (const phase of phases) {
      if (phase.duration) {
        phaseDurations[phase.phase] = phase.duration;
        totalDuration += phase.duration;
      }
    }

    const durations = Object.values(phaseDurations);
    const slowestPhase = Object.entries(phaseDurations)
      .reduce((a, b) => a[1] > b[1] ? a : b, ['', 0])[0];
    const fastestPhase = Object.entries(phaseDurations)
      .reduce((a, b) => a[1] < b[1] ? a : b, ['', Infinity])[0];
    const averagePhaseTime = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    return {
      phases: phaseDurations,
      totalDuration,
      slowestPhase,
      fastestPhase,
      averagePhaseTime
    };
  }

  private aggregateLLMInteractions(logs: StructuredLog[]): LLMDebugInfo[] {
    return logs
      .filter(log =>
        log.component.includes('LLM') ||
        log.phase.includes('llm') ||
        log.metadata?.prompt ||
        log.metadata?.response
      )
      .map(log => ({
        timestamp: log.timestamp,
        phase: log.phase,
        prompt: log.metadata?.prompt,
        response: log.metadata?.response,
        model: log.metadata?.model,
        tokenUsage: log.metadata?.tokenUsage,
        duration: log.duration
      }));
  }

  private aggregateStateTransitions(logs: StructuredLog[]): StateTransitionDebugInfo[] {
    return logs
      .filter(log =>
        log.metadata?.operation === 'state_transition' ||
        log.message.includes('state') ||
        log.metadata?.fromState
      )
      .map(log => ({
        timestamp: log.timestamp,
        fromState: log.metadata?.fromState || 'unknown',
        toState: log.metadata?.toState || 'unknown',
        trigger: log.metadata?.trigger || log.message,
        metadata: log.metadata
      }));
  }

  private aggregateCircuitBreakerEvents(logs: StructuredLog[]): CircuitBreakerEventDebugInfo[] {
    return logs
      .filter(log =>
        log.component.includes('CircuitBreaker') ||
        log.message.includes('circuit') ||
        log.metadata?.circuitBreakerState
      )
      .map(log => ({
        timestamp: log.timestamp,
        component: log.component,
        event: log.metadata?.event || 'unknown',
        errorCount: log.metadata?.errorCount,
        metadata: log.metadata
      }));
  }

  private matchesCriteria(log: StructuredLog, criteria: SearchCriteria): boolean {
    if (criteria.component && log.component !== criteria.component) {
      return false;
    }

    if (criteria.phase && log.phase !== criteria.phase) {
      return false;
    }

    if (criteria.level && log.level !== criteria.level) {
      return false;
    }

    if (criteria.hasError !== undefined) {
      if (criteria.hasError && !log.error) {
        return false;
      }
      if (!criteria.hasError && log.error) {
        return false;
      }
    }

    if (criteria.timeRange) {
      const logTime = new Date(log.timestamp);
      if (logTime < criteria.timeRange.start || logTime > criteria.timeRange.end) {
        return false;
      }
    }

    if (criteria.minDuration !== undefined && (!log.duration || log.duration < criteria.minDuration)) {
      return false;
    }

    if (criteria.maxDuration !== undefined && (!log.duration || log.duration > criteria.maxDuration)) {
      return false;
    }

    return true;
  }

  private cleanupOldLogs(): void {
    const now = Date.now();
    const cutoffTime = now - this.logRetentionMs;

    // Remove old correlation IDs
    for (const [correlationId, logs] of this.logsByCorrelationId) {
      const oldestLog = logs[0];
      if (oldestLog && new Date(oldestLog.timestamp).getTime() < cutoffTime) {
        this.logsByCorrelationId.delete(correlationId);
      }
    }

    // If still too many, remove oldest
    if (this.logsByCorrelationId.size > this.maxRetainedLogs) {
      const sortedIds = Array.from(this.logsByCorrelationId.entries())
        .sort((a, b) => new Date(a[1][0].timestamp).getTime() - new Date(b[1][0].timestamp).getTime())
        .slice(0, this.logsByCorrelationId.size - this.maxRetainedLogs);

      for (const [id] of sortedIds) {
        this.logsByCorrelationId.delete(id);
      }
    }
  }
}