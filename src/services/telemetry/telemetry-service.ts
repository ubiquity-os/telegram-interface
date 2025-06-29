/**
 * OpenTelemetry Telemetry Service
 * Phase 2.1: Structured logging with OpenTelemetry for comprehensive system observability
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { promises as fs } from 'node:fs';

/**
 * Structured log interface for consistent logging format
 */
export interface StructuredLog {
  timestamp: string;
  correlationId: string;
  component: string;
  phase: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  message: string;
  metadata: Record<string, any>;
  duration?: number;
  error?: {
    type: string;
    message: string;
    stack: string;
  };
}

/**
 * Trace context for correlation ID propagation
 */
export interface TraceContext {
  correlationId: string;
  traceId: string;
  spanId: string;
  startTime: number;
  component: string;
  phase: string;
}

/**
 * File exporter configuration
 */
export interface FileExporterConfig {
  directory: string;
  format: 'json';
  rotation: 'daily' | 'hourly';
  maxFiles?: number;
  maxSizeBytes?: number;
}

/**
 * Telemetry service configuration
 */
export interface TelemetryConfig {
  serviceName: string;
  version: string;
  environment: string;
  fileExporter: FileExporterConfig;
  enableDebugLogs: boolean;
  enableConsoleOutput: boolean;
}

/**
 * Log level enum for type safety
 */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR'
}

/**
 * OpenTelemetry-based Telemetry Service
 */
export class TelemetryService {
  private static instance: TelemetryService;
  private config: TelemetryConfig;
  private asyncLocalStorage = new AsyncLocalStorage<TraceContext>();
  private isInitialized = false;
  private logFileHandle: any = null;
  private currentLogFile: string | null = null;

  private constructor(config: TelemetryConfig) {
    this.config = config;
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: TelemetryConfig): TelemetryService {
    if (!TelemetryService.instance) {
      if (!config) {
        throw new Error('TelemetryService configuration required for first initialization');
      }
      TelemetryService.instance = new TelemetryService(config);
    }
    return TelemetryService.instance;
  }

  /**
   * Initialize the telemetry service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    console.log('[TelemetryService] Initializing OpenTelemetry structured logging...');

    try {
      // Ensure log directory exists
      await this.ensureLogDirectory();

      // Initialize log file rotation
      await this.rotateLogFileIfNeeded();

      this.isInitialized = true;
      console.log(`[TelemetryService] Initialized successfully. Logs directory: ${this.config.fileExporter.directory}`);

      // Log the initialization
      await this.logStructured(LogLevel.INFO, 'TelemetryService', 'initialization', 'Telemetry service initialized', {
        serviceName: this.config.serviceName,
        version: this.config.version,
        environment: this.config.environment,
        logDirectory: this.config.fileExporter.directory
      });

    } catch (error) {
      console.error('[TelemetryService] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Generate a new correlation ID
   */
  generateCorrelationId(): string {
    return `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate a new trace ID
   */
  generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 16)}`;
  }

  /**
   * Generate a new span ID
   */
  generateSpanId(): string {
    return `span_${Math.random().toString(36).substr(2, 12)}`;
  }

  /**
   * Start a new trace with correlation ID
   */
  async startTrace(component: string, phase: string, correlationId?: string): Promise<string> {
    const traceCorrelationId = correlationId || this.generateCorrelationId();
    const traceId = this.generateTraceId();
    const spanId = this.generateSpanId();

    const context: TraceContext = {
      correlationId: traceCorrelationId,
      traceId,
      spanId,
      startTime: Date.now(),
      component,
      phase
    };

    // Store in async local storage for automatic propagation
    this.asyncLocalStorage.enterWith(context);

    await this.logStructured(LogLevel.DEBUG, component, phase, 'Trace started', {
      traceId,
      spanId,
      operation: 'trace_start'
    });

    return traceCorrelationId;
  }

  /**
   * End current trace with duration
   */
  async endTrace(result?: any, error?: Error): Promise<void> {
    const context = this.getCurrentContext();
    if (!context) {
      console.warn('[TelemetryService] No active trace context to end');
      return;
    }

    const duration = Date.now() - context.startTime;

    if (error) {
      await this.logStructured(LogLevel.ERROR, context.component, context.phase, 'Trace ended with error', {
        traceId: context.traceId,
        spanId: context.spanId,
        duration,
        operation: 'trace_end'
      }, duration, error);
    } else {
      await this.logStructured(LogLevel.DEBUG, context.component, context.phase, 'Trace ended successfully', {
        traceId: context.traceId,
        spanId: context.spanId,
        duration,
        operation: 'trace_end',
        result: this.config.enableDebugLogs ? result : '[redacted]'
      }, duration);
    }
  }

  /**
   * Create a new span within current trace
   */
  async startSpan(operation: string, metadata?: Record<string, any>): Promise<string> {
    const context = this.getCurrentContext();
    if (!context) {
      console.warn('[TelemetryService] No active trace context for span');
      return this.generateSpanId();
    }

    const spanId = this.generateSpanId();
    const newContext: TraceContext = {
      ...context,
      spanId,
      startTime: Date.now(),
      phase: operation
    };

    this.asyncLocalStorage.enterWith(newContext);

    await this.logStructured(LogLevel.DEBUG, context.component, operation, 'Span started', {
      traceId: context.traceId,
      parentSpanId: context.spanId,
      spanId,
      operation: 'span_start',
      ...metadata
    });

    return spanId;
  }

  /**
   * End current span with duration
   */
  async endSpan(result?: any, error?: Error): Promise<void> {
    const context = this.getCurrentContext();
    if (!context) {
      console.warn('[TelemetryService] No active span context to end');
      return;
    }

    const duration = Date.now() - context.startTime;

    if (error) {
      await this.logStructured(LogLevel.ERROR, context.component, context.phase, 'Span ended with error', {
        traceId: context.traceId,
        spanId: context.spanId,
        duration,
        operation: 'span_end'
      }, duration, error);
    } else {
      await this.logStructured(LogLevel.DEBUG, context.component, context.phase, 'Span ended successfully', {
        traceId: context.traceId,
        spanId: context.spanId,
        duration,
        operation: 'span_end',
        result: this.config.enableDebugLogs ? result : '[redacted]'
      }, duration);
    }
  }

  /**
   * Log structured message
   */
  async logStructured(
    level: LogLevel,
    component: string,
    phase: string,
    message: string,
    metadata: Record<string, any> = {},
    duration?: number,
    error?: Error
  ): Promise<void> {
    const context = this.getCurrentContext();
    const correlationId = context?.correlationId || 'no-correlation';

    const structuredLog: StructuredLog = {
      timestamp: new Date().toISOString(),
      correlationId,
      component,
      phase,
      level,
      message,
      metadata: {
        traceId: context?.traceId,
        spanId: context?.spanId,
        ...metadata
      },
      ...(duration !== undefined && { duration }),
      ...(error && {
        error: {
          type: error.constructor.name,
          message: error.message,
          stack: error.stack || ''
        }
      })
    };

    // Write to file
    await this.writeLogToFile(structuredLog);

    // Optional console output
    if (this.config.enableConsoleOutput) {
      this.writeLogToConsole(structuredLog);
    }
  }

  /**
   * Log with automatic context
   */
  async log(level: LogLevel, message: string, metadata?: Record<string, any>, error?: Error): Promise<void> {
    const context = this.getCurrentContext();
    const component = context?.component || 'unknown';
    const phase = context?.phase || 'unknown';

    await this.logStructured(level, component, phase, message, metadata, undefined, error);
  }

  /**
   * Log info level message
   */
  async info(message: string, metadata?: Record<string, any>): Promise<void> {
    await this.log(LogLevel.INFO, message, metadata);
  }

  /**
   * Log debug level message
   */
  async debug(message: string, metadata?: Record<string, any>): Promise<void> {
    if (this.config.enableDebugLogs) {
      await this.log(LogLevel.DEBUG, message, metadata);
    }
  }

  /**
   * Log warning level message
   */
  async warn(message: string, metadata?: Record<string, any>): Promise<void> {
    await this.log(LogLevel.WARN, message, metadata);
  }

  /**
   * Log error level message
   */
  async error(message: string, error?: Error, metadata?: Record<string, any>): Promise<void> {
    await this.log(LogLevel.ERROR, message, metadata, error);
  }

  /**
   * Get current trace context
   */
  getCurrentContext(): TraceContext | undefined {
    return this.asyncLocalStorage.getStore();
  }

  /**
   * Get current correlation ID
   */
  getCurrentCorrelationId(): string | undefined {
    return this.getCurrentContext()?.correlationId;
  }

  /**
   * Execute function within trace context
   */
  async withTrace<T>(
    component: string,
    phase: string,
    operation: () => Promise<T>,
    correlationId?: string
  ): Promise<T> {
    const traceCorrelationId = await this.startTrace(component, phase, correlationId);

    try {
      const result = await operation();
      await this.endTrace(result);
      return result;
    } catch (error) {
      await this.endTrace(undefined, error as Error);
      throw error;
    }
  }

  /**
   * Execute function within span context
   */
  async withSpan<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    const spanId = await this.startSpan(operation, metadata);

    try {
      const result = await fn();
      await this.endSpan(result);
      return result;
    } catch (error) {
      await this.endSpan(undefined, error as Error);
      throw error;
    }
  }

  /**
   * Ensure log directory exists
   */
  private async ensureLogDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.config.fileExporter.directory, { recursive: true });
    } catch (error: any) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Rotate log file if needed
   */
  private async rotateLogFileIfNeeded(): Promise<void> {
    const now = new Date();
    const dateString = this.config.fileExporter.rotation === 'daily'
      ? now.toISOString().split('T')[0]  // YYYY-MM-DD
      : now.toISOString().slice(0, 13);  // YYYY-MM-DDTHH

    const newLogFile = `${this.config.fileExporter.directory}/traces-${dateString}.jsonl`;

    if (this.currentLogFile !== newLogFile) {
      // Close current file if open
      if (this.logFileHandle) {
        this.logFileHandle.close();
      }

      // Open new file
      this.logFileHandle = await fs.open(newLogFile, 'a');

      this.currentLogFile = newLogFile;

      // Clean up old files if needed
      await this.cleanupOldLogFiles();
    }
  }

  /**
   * Write log entry to file
   */
  private async writeLogToFile(log: StructuredLog): Promise<void> {
    try {
      await this.rotateLogFileIfNeeded();

      if (this.logFileHandle) {
        const logLine = JSON.stringify(log) + '\n';
        const encoder = new TextEncoder();
        await this.logFileHandle.write(encoder.encode(logLine));
        await this.logFileHandle.sync();
      }
    } catch (error) {
      console.error('[TelemetryService] Failed to write log to file:', error);
    }
  }

  /**
   * Write log entry to console
   */
  private writeLogToConsole(log: StructuredLog): void {
    const prefix = `[${log.timestamp}] [${log.level}] [${log.correlationId}] [${log.component}:${log.phase}]`;
    const suffix = log.duration ? ` (${log.duration}ms)` : '';

    switch (log.level) {
      case LogLevel.ERROR:
        console.error(`${prefix} ${log.message}${suffix}`, log.error ? log.error : '');
        break;
      case LogLevel.WARN:
        console.warn(`${prefix} ${log.message}${suffix}`);
        break;
      case LogLevel.DEBUG:
        if (this.config.enableDebugLogs) {
          console.debug(`${prefix} ${log.message}${suffix}`);
        }
        break;
      default:
        console.log(`${prefix} ${log.message}${suffix}`);
    }
  }

  /**
   * Clean up old log files
   */
  private async cleanupOldLogFiles(): Promise<void> {
    const maxFiles = this.config.fileExporter.maxFiles || 30;

    try {
      const files = [];
      const dirEntries = await fs.readdir(this.config.fileExporter.directory);
      for (const fileName of dirEntries) {
        if (fileName.startsWith('traces-') && fileName.endsWith('.jsonl')) {
          const filePath = `${this.config.fileExporter.directory}/${fileName}`;
          const stat = await fs.stat(filePath);
          files.push({ name: fileName, path: filePath, mtime: stat.mtime || new Date(0) });
        }
      }

      // Sort by modification time (newest first)
      files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      // Remove files beyond maxFiles limit
      for (let i = maxFiles; i < files.length; i++) {
        try {
          await fs.unlink(files[i].path);
          console.log(`[TelemetryService] Removed old log file: ${files[i].name}`);
        } catch (error) {
          console.warn(`[TelemetryService] Failed to remove old log file ${files[i].name}:`, error);
        }
      }
    } catch (error) {
      console.warn('[TelemetryService] Failed to cleanup old log files:', error);
    }
  }

  /**
   * Shutdown the telemetry service
   */
  async shutdown(): Promise<void> {
    if (this.logFileHandle) {
      try {
        await this.logStructured(LogLevel.INFO, 'TelemetryService', 'shutdown', 'Telemetry service shutting down', {
          operation: 'shutdown'
        });

        this.logFileHandle.close();
        this.logFileHandle = null;
        this.currentLogFile = null;
      } catch (error) {
        console.error('[TelemetryService] Error during shutdown:', error);
      }
    }

    this.isInitialized = false;
    console.log('[TelemetryService] Shutdown complete');
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      isInitialized: this.isInitialized,
      currentLogFile: this.currentLogFile,
      config: this.config,
      hasActiveContext: !!this.getCurrentContext()
    };
  }
}

/**
 * Create default telemetry configuration
 */
export function createDefaultTelemetryConfig(): TelemetryConfig {
  const environment = Deno.env.get('ENVIRONMENT') || 'development';

  return {
    serviceName: 'ubiquity-ai',
    version: '1.0.0',
    environment,
    fileExporter: {
      directory: './logs/traces',
      format: 'json',
      rotation: 'daily',
      maxFiles: 30,
      maxSizeBytes: 100 * 1024 * 1024 // 100MB
    },
    enableDebugLogs: environment === 'development',
    enableConsoleOutput: true
  };
}

/**
 * Initialize global telemetry service
 */
export async function initializeTelemetry(config?: Partial<TelemetryConfig>): Promise<TelemetryService> {
  const defaultConfig = createDefaultTelemetryConfig();
  const finalConfig = { ...defaultConfig, ...config };

  const telemetry = TelemetryService.getInstance(finalConfig);
  await telemetry.initialize();

  return telemetry;
}

/**
 * Get global telemetry service instance
 */
export function getTelemetry(): TelemetryService {
  return TelemetryService.getInstance();
}