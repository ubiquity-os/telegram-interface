/**
 * Component Factory
 * Creates and configures all system components with proper dependencies
 */

import { getConfig } from '../utils/config.ts';

// Core Services
import { LlmService } from '../services/llm-service/llm-service.ts';

// Components
import { ErrorHandler } from '../components/error-handler/error-handler.ts';
import { ContextManager } from '../components/context-manager/context-manager.ts';
import { KVContextStorage } from '../components/context-manager/kv-context-storage.ts';
import { MessagePreProcessor } from '../components/message-pre-processor/message-pre-processor.ts';
import { DecisionEngine } from '../components/decision-engine/decision-engine.ts';
import { ResponseGenerator } from '../components/response-generator/response-generator.ts';
import { TelegramInterfaceAdapter } from '../components/telegram-interface-adapter/telegram-interface-adapter.ts';
import { SystemOrchestrator } from '../components/system-orchestrator/system-orchestrator.ts';

// Types
import type { ComponentDependencies, SystemOrchestratorConfig } from '../components/system-orchestrator/types.ts';
import type { ErrorHandlerConfig } from '../components/error-handler/types.ts';
import type { ContextManagerConfig } from '../components/context-manager/types.ts';
import type { MessagePreProcessorConfig } from '../components/message-pre-processor/types.ts';
import type { DecisionEngineConfig } from '../components/decision-engine/types.ts';
import type { ResponseGeneratorConfig } from '../components/response-generator/types.ts';
import type { TelegramInterfaceAdapterConfig } from '../components/telegram-interface-adapter/types.ts';
import type { LLMConfig } from '../services/llm-service/llm-service.ts';
import { ErrorCategory } from '../interfaces/component-interfaces.ts';

/**
 * Create and configure the LLM service
 */
export async function createLLMService(): Promise<LlmService> {
  // For testing purposes, handle missing environment variables gracefully
  let config;
  try {
    config = await getConfig();
  } catch (error) {
    console.warn('[ComponentFactory] Environment config missing, using test defaults:', error.message);
    config = {
      openRouterApiKey: 'test-key-for-development',
      botToken: 'test-bot-token',
      webhookSecret: 'test-webhook-secret',
      botType: 'production' as const,
      logLevel: 'info' as const,
      environment: 'development' as const
    };
  }

  const llmConfig: LLMConfig = {
    apiKey: config.openRouterApiKey,
    model: 'deepseek/deepseek-r1-0528:free',
    temperature: 0.7,
    maxTokens: 2000
  };

  return new LlmService(llmConfig);
}

/**
 * Create and configure the Error Handler
 */
export function createErrorHandler(): ErrorHandler {
  const config: ErrorHandlerConfig = {
    retries: {
      enabled: true,
      strategies: {
        network: {
          maxAttempts: 3,
          backoffType: 'exponential',
          initialDelay: 1000,
          maxDelay: 10000,
          retryableErrors: [ErrorCategory.NETWORK_ERROR, ErrorCategory.NETWORK_TIMEOUT]
        },
        api: {
          maxAttempts: 2,
          backoffType: 'exponential',
          initialDelay: 2000,
          maxDelay: 15000,
          retryableErrors: [ErrorCategory.TEMPORARY_FAILURE, ErrorCategory.RATE_LIMIT]
        },
        database: {
          maxAttempts: 5,
          backoffType: 'exponential',
          initialDelay: 500,
          maxDelay: 5000,
          retryableErrors: [ErrorCategory.TEMPORARY_FAILURE, ErrorCategory.NETWORK_ERROR]
        },
        tool: {
          maxAttempts: 2,
          backoffType: 'linear',
          initialDelay: 1000,
          maxDelay: 8000,
          retryableErrors: [ErrorCategory.TEMPORARY_FAILURE]
        },
        system: {
          maxAttempts: 1,
          backoffType: 'fixed',
          initialDelay: 5000,
          maxDelay: 30000,
          retryableErrors: [ErrorCategory.INTERNAL_ERROR]
        }
      }
    },
    circuitBreaker: {
      enabled: true,
      failureThreshold: 5,
      recoveryTimeout: 60000,
      halfOpenMaxCalls: 3
    },
    reporting: {
      enabled: true,
      includeStackTrace: true,
      rateLimitPerMinute: 10
    },
    userMessages: {
      defaultErrorMessage: "An error occurred. Please try again.",
      categoryMessages: {
        [ErrorCategory.NETWORK_ERROR]: "Network connection issue. Please check your connection.",
        [ErrorCategory.NETWORK_TIMEOUT]: "Network connection timed out. Please try again.",
        [ErrorCategory.RATE_LIMIT]: "Too many requests. Please try again later.",
        [ErrorCategory.INVALID_INPUT]: "Invalid request. Please check your input.",
        [ErrorCategory.AUTHENTICATION]: "Authentication failed. Please try again.",
        [ErrorCategory.PERMISSION_DENIED]: "Permission denied. You don't have access to this feature.",
        [ErrorCategory.NOT_FOUND]: "The requested resource was not found.",
        [ErrorCategory.INTERNAL_ERROR]: "Internal server error. Please contact support.",
        [ErrorCategory.TEMPORARY_FAILURE]: "Service temporarily unavailable. Please try again later.",
        [ErrorCategory.PERMANENT_FAILURE]: "Service unavailable. Please contact support.",
        [ErrorCategory.UNKNOWN]: "An unexpected error occurred. Please try again."
      }
    }
  };

  return new ErrorHandler(config);
}

/**
 * Create and configure the Context Manager with KV storage
 */
export async function createContextManager(): Promise<ContextManager> {
  const storage = new KVContextStorage();
  await storage.initialize();

  const config: ContextManagerConfig = {
    storage: {
      type: 'deno-kv'
    },
    limits: {
      maxConversationAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      maxMessagesPerChat: 50,
      maxStorageSize: 100 * 1024 * 1024 // 100MB
    },
    cleanup: {
      enabled: true,
      interval: 3600000, // 1 hour
      batchSize: 100
    }
  };

  const contextManager = new ContextManager(config, storage);
  await contextManager.initialize();
  return contextManager;
}

/**
 * Create and configure the Message Pre-Processor
 */
export async function createMessagePreProcessor(llmService: LlmService): Promise<MessagePreProcessor> {
  // Check if we're in test mode (using test credentials)
  let isTestMode = false;
  try {
    await getConfig();
  } catch (error) {
    isTestMode = true;
  }

  const config: Partial<MessagePreProcessorConfig> = {
    maxCacheSize: 100,
    cacheTTL: 3600000, // 1 hour
    temperature: 0.3,
    verbose: true,
    confidenceThreshold: 0.6,
    skipLLMTest: isTestMode // Skip LLM test when using test credentials
  };

  const preProcessor = new MessagePreProcessor(llmService, config);
  await preProcessor.initialize();
  return preProcessor;
}

/**
 * Create and configure the Decision Engine
 */
export async function createDecisionEngine(
  contextManager: ContextManager,
  errorHandler: ErrorHandler
): Promise<DecisionEngine> {
  const config: Partial<DecisionEngineConfig> = {
    maxStateRetention: 1000,
    defaultTimeout: 30000,
    enableStatePersistence: true,
    debugMode: false,
    confidenceThreshold: 0.6
  };

  const decisionEngine = new DecisionEngine(contextManager, errorHandler, config);
  await decisionEngine.initialize();
  return decisionEngine;
}

/**
 * Create and configure the Response Generator
 */
export async function createResponseGenerator(llmService: LlmService): Promise<ResponseGenerator> {
  const config: Partial<ResponseGeneratorConfig> = {
    defaultModel: 'deepseek/deepseek-r1:free',
    temperature: 0.7,
    maxTokens: 1000,
    maxResponseLength: 4096,
    enableMarkdown: true,
    maxButtonsPerRow: 3,
    maxRows: 10
  };

  const responseGenerator = new ResponseGenerator(llmService, config);
  await responseGenerator.initialize();
  return responseGenerator;
}

/**
 * Create and configure the Telegram Interface Adapter
 */
export async function createTelegramInterfaceAdapter(): Promise<TelegramInterfaceAdapter> {
  // Handle test mode (missing environment variables)
  let appConfig;
  let isTestMode = false;
  try {
    appConfig = await getConfig();
  } catch (error) {
    isTestMode = true;
    appConfig = {
      botToken: 'test-bot-token',
      webhookSecret: 'test-webhook-secret',
      environment: 'development' as const
    };
  }

  const config: TelegramInterfaceAdapterConfig = {
    botToken: appConfig.botToken,
    webhookSecret: appConfig.webhookSecret,
    maxMessageLength: 4096,
    rateLimits: {
      maxMessagesPerSecond: 30,
      maxMessagesPerMinute: 20,
      maxMessagesPerHour: 1000
    },
    queueConfig: {
      maxQueueSize: 1000,
      processingInterval: 100,
      maxRetries: 3
    },
    testMode: isTestMode || appConfig.environment === 'development'
  };

  const adapter = new TelegramInterfaceAdapter(config);
  await adapter.initialize();
  return adapter;
}

/**
 * Create the complete System Orchestrator with all dependencies
 */
export async function createSystemOrchestrator(): Promise<SystemOrchestrator> {
  console.log('[ComponentFactory] Creating System Orchestrator and dependencies...');

  // Create shared services
  const llmService = await createLLMService();

  // Create core components
  const errorHandler = createErrorHandler();
  await errorHandler.initialize();

  const contextManager = await createContextManager();
  const messagePreProcessor = await createMessagePreProcessor(llmService);
  const decisionEngine = await createDecisionEngine(contextManager, errorHandler);
  const responseGenerator = await createResponseGenerator(llmService);
  const telegramAdapter = await createTelegramInterfaceAdapter();

  // Assemble component dependencies
  const dependencies: ComponentDependencies = {
    errorHandler,
    contextManager,
    messagePreProcessor,
    decisionEngine,
    responseGenerator,
    telegramAdapter
    // Optional components not included for now:
    // mcpToolManager,
    // selfModerationEngine
  };

  // Create system orchestrator configuration (handle test mode)
  let appConfig;
  try {
    appConfig = await getConfig();
  } catch (error) {
    appConfig = {
      botToken: 'test-bot-token',
      webhookSecret: 'test-webhook-secret',
      environment: 'development' as const
    };
  }

  const systemConfig: SystemOrchestratorConfig = {
    telegramConfig: {
      botToken: appConfig.botToken,
      webhookSecret: appConfig.webhookSecret
    },
    enableMCPTools: false, // Disable for now
    enableSelfModeration: false, // Disable for now
    enableErrorRecovery: true,
    requestTimeout: 30000,
    maxRetries: 3,
    logLevel: appConfig.logLevel as 'debug' | 'info' | 'warn' | 'error'
  };

  // DIAGNOSTIC: Add logging to validate constructor parameter mismatch hypothesis
  console.log('[ComponentFactory] DIAGNOSTIC - Dependencies object:', Object.keys(dependencies));
  console.log('[ComponentFactory] DIAGNOSTIC - About to create SystemOrchestrator...');

  // Create and initialize the system orchestrator
  const systemOrchestrator = new SystemOrchestrator(
    telegramAdapter,
    messagePreProcessor,
    decisionEngine,
    contextManager,
    responseGenerator,
    errorHandler
  );

  // DIAGNOSTIC: Check if decisionEngine is actually set
  console.log('[ComponentFactory] DIAGNOSTIC - SystemOrchestrator created');
  console.log('[ComponentFactory] DIAGNOSTIC - decisionEngine property:', (systemOrchestrator as any).decisionEngine ? 'EXISTS' : 'UNDEFINED');
  console.log('[ComponentFactory] DIAGNOSTIC - telegramAdapter property:', (systemOrchestrator as any).telegramAdapter ? 'EXISTS' : 'UNDEFINED');

  await systemOrchestrator.initialize(systemConfig);

  console.log('[ComponentFactory] System Orchestrator created successfully');
  return systemOrchestrator;
}