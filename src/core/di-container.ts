/**
 * Dependency Injection Container Configuration
 *
 * Configures Inversify container with all component bindings
 * and manages the dependency graph for the application.
 * This version includes a factory for selecting the correct
 * message interface adapter based on the platform.
 */

import 'reflect-metadata';
import { Container, interfaces } from 'inversify';
import { TYPES } from './types.ts';

// Import interfaces
import {
  ITelegramInterfaceAdapter,
  IMessagePreProcessor,
  IDecisionEngine,
  IContextManager,
  IResponseGenerator,
  IErrorHandler,
} from '../interfaces/component-interfaces.ts';

import { IMessageInterface } from '../interfaces/message-interface.ts';
import { ISystemOrchestrator } from '../components/system-orchestrator/types.ts';

// Import implementations
import { SystemOrchestrator } from '../components/system-orchestrator/system-orchestrator.ts';
import { TelegramInterfaceAdapter } from '../components/telegram-interface-adapter/telegram-interface-adapter.ts';
import { ApiResponseAdapter } from '../adapters/api-response-adapter.ts';
import { MessagePreProcessor } from '../components/message-pre-processor/message-pre-processor.ts';
import { DecisionEngine } from '../components/decision-engine/decision-engine.ts';
import { CachedContextManager } from '../components/context-manager/cached-context-manager.ts';
import { ResponseGenerator } from '../components/response-generator/response-generator.ts';

// Import services
import { OpenRouterLlmService } from '../services/llm-service/openrouter-llm-service.ts';
import { SimpleErrorHandler } from '../services/error-handler.ts';
import { LLMServiceAdapter } from '../components/message-pre-processor/llm-service-adapter.ts';
import { KVContextStorage } from '../components/context-manager/kv-context-storage.ts';

// Import configuration types
import { SystemOrchestratorConfig } from '../components/system-orchestrator/types.ts';
import { TelegramInterfaceAdapterConfig } from '../components/telegram-interface-adapter/types.ts';
import { ApiResponseAdapterConfig } from '../adapters/api-response-adapter.ts';
import { MessagePreProcessorConfig } from '../components/message-pre-processor/types.ts';
import { DecisionEngineConfig } from '../components/decision-engine/types.ts';
import { CachedContextManagerConfig } from '../components/context-manager/cached-context-manager.ts';
import { ResponseGeneratorConfig } from '../components/response-generator/types.ts';

// Import utility services
import { deduplicationService } from '../services/deduplication.ts';
import { eventBus } from '../services/event-bus/index.ts';
import { TelemetryService, createDefaultTelemetryConfig, initializeTelemetry } from '../services/telemetry/index.ts';
import { Platform } from '../core/protocol/ump-types.ts';

/**
 * Create and configure the DI container
 */
export function createContainer(): Container {
  const container = new Container();

  // Bind configuration objects
  container.bind<TelegramInterfaceAdapterConfig>(TYPES.TelegramInterfaceAdapterConfig)
    .toConstantValue({
      botToken: '', // Will be set during initialization
      maxMessageLength: 4096,
      testMode: false,
      rateLimits: { maxMessagesPerSecond: 30, maxMessagesPerMinute: 1200, maxMessagesPerHour: 60000 },
      queueConfig: { maxQueueSize: 100, processingInterval: 100, maxRetries: 3 },
    });

  container.bind<ApiResponseAdapterConfig>(TYPES.ApiResponseAdapterConfig)
    .toConstantValue({
      enableLogging: true,
      logLevel: 'info',
      responseFormat: 'json',
      includeMetadata: true,
    });

  container.bind<MessagePreProcessorConfig>(TYPES.MessagePreProcessorConfig)
    .toConstantValue({
      maxCacheSize: 1000,
      cacheTTL: 60 * 60 * 1000, // 1 hour
      temperature: 0.7,
      verbose: false,
      confidenceThreshold: 0.8,
    });

  container.bind<DecisionEngineConfig>(TYPES.DecisionEngineConfig)
    .toConstantValue({
      maxStateRetention: 1000,
      defaultTimeout: 30000,
      enableStatePersistence: true,
      debugMode: false,
      confidenceThreshold: 0.8,
    });

  container.bind<CachedContextManagerConfig>(TYPES.ContextManagerConfig)
    .toConstantValue({
      storage: { type: 'deno-kv', kvPath: undefined },
      limits: { maxConversationAge: 30 * 24 * 60 * 60 * 1000, maxMessagesPerChat: 100, maxStorageSize: 1024 * 1024 * 1024 },
      cleanup: { enabled: true, interval: 60 * 60 * 1000, batchSize: 10 },
      cache: { maxSize: 100, contextTTL: 30 * 60 * 1000, preferencesTTL: 60 * 60 * 1000, enableMetrics: true },
    });

  container.bind<ResponseGeneratorConfig>(TYPES.ResponseGeneratorConfig)
    .toConstantValue({
      maxResponseLength: 4000,
      enableMarkdown: true,
      temperature: 0.7,
      maxButtonsPerRow: 3,
      maxRows: 10,
    });

  // ========== Service & Adapter Bindings ==========

  // Bind LLM Service
  container.bind<OpenRouterLlmService>(TYPES.LLMService)
    .toDynamicValue(() => new OpenRouterLlmService({ apiKey: Deno.env.get('OPENROUTER_API_KEY') || '', debugMode: false }))
    .inSingletonScope();

  // Bind other services
  container.bind(TYPES.LLMServiceAdapter).to(LLMServiceAdapter).inSingletonScope();
  container.bind(TYPES.ContextStorage).toConstantValue(new KVContextStorage());
  container.bind<IErrorHandler>(TYPES.ErrorHandler).to(SimpleErrorHandler).inSingletonScope();
  container.bind(TYPES.DeduplicationService).toConstantValue(deduplicationService);
  container.bind(TYPES.EventBus).toConstantValue(eventBus);

  // Bind specific adapters to their own types
  container.bind<ITelegramInterfaceAdapter>(TYPES.TelegramInterfaceAdapter).to(TelegramInterfaceAdapter).inSingletonScope();
  container.bind<ApiResponseAdapter>(TYPES.ApiResponseAdapter).to(ApiResponseAdapter).inSingletonScope();

  // **FIXED BINDING**: Bind a factory for IMessageInterface
  // This allows runtime selection of the correct adapter based on the platform.
  container.bind<interfaces.Factory<IMessageInterface>>(TYPES.MessageInterfaceFactory)
    .toFactory<IMessageInterface>((context: interfaces.Context) => {
      return (platform: Platform) => {
        if (platform === Platform.REST_API) {
          return context.container.get<ApiResponseAdapter>(TYPES.ApiResponseAdapter);
        }
        // Default to Telegram
        return context.container.get<ITelegramInterfaceAdapter>(TYPES.TelegramInterfaceAdapter);
      };
    });

  // Bind main components
  container.bind<IMessagePreProcessor>(TYPES.MessagePreProcessor).to(MessagePreProcessor).inSingletonScope();
  container.bind<IDecisionEngine>(TYPES.DecisionEngine).to(DecisionEngine).inSingletonScope();
  container.bind<IContextManager>(TYPES.ContextManager).to(CachedContextManager).inSingletonScope();
  container.bind<IResponseGenerator>(TYPES.ResponseGenerator).to(ResponseGenerator).inSingletonScope();
  container.bind<ISystemOrchestrator>(TYPES.SystemOrchestrator).to(SystemOrchestrator).inSingletonScope();

  return container;
}

/**
 * Update container with runtime configuration
 */
export function updateContainerConfig(container: Container, config: any): void {
  // Rebind the TelegramInterfaceAdapterConfig with the actual bot token
  container.rebind<TelegramInterfaceAdapterConfig>(TYPES.TelegramInterfaceAdapterConfig)
    .toConstantValue({
      botToken: config.botToken,
      maxMessageLength: 4096,
      testMode: false,
      rateLimits: { maxMessagesPerSecond: 30, maxMessagesPerMinute: 1200, maxMessagesPerHour: 60000 },
      queueConfig: { maxQueueSize: 100, processingInterval: 100, maxRetries: 3 },
    });

  const orchestratorConfig: SystemOrchestratorConfig = {
    telegramConfig: { botToken: config.botToken, webhookSecret: config.webhookSecret },
    enableMCPTools: true,
    enableSelfModeration: true,
    enableErrorRecovery: true,
    requestTimeout: 30000,
    maxRetries: 3,
    logLevel: 'info',
    messageQueue: {
      workerConfig: { minWorkers: 2, maxWorkers: 10, idleTimeout: 30000 },
      retryConfig: { maxRetries: 3, initialDelay: 1000, maxDelay: 30000, multiplier: 2 },
    },
  };

  container.bind<SystemOrchestratorConfig>(TYPES.SystemOrchestratorConfig).toConstantValue(orchestratorConfig);
  container.bind(TYPES.Config).toConstantValue(config);
}

/**
 * Bootstrap the system with dependency injection
 */
export async function bootstrap(config: {
  botToken: string;
  webhookSecret: string;
}): Promise<{
  container: Container;
  orchestrator: ISystemOrchestrator;
}> {
  const container = createContainer();

  const telemetryConfig = createDefaultTelemetryConfig();
  const telemetryService = await initializeTelemetry(telemetryConfig);
  container.bind<TelemetryService>(TYPES.TelemetryService).toConstantValue(telemetryService);

  updateContainerConfig(container, config);

  // Get orchestrator first (doesn't need adapters yet)
  const orchestrator = container.get<ISystemOrchestrator>(TYPES.SystemOrchestrator);

  const llmService = container.get<OpenRouterLlmService>(TYPES.LLMService);
  await llmService.init();

  // Unbind and rebind the TelegramInterfaceAdapter to ensure it's created with correct config
  container.unbind(TYPES.TelegramInterfaceAdapter);
  container.bind<ITelegramInterfaceAdapter>(TYPES.TelegramInterfaceAdapter).to(TelegramInterfaceAdapter).inSingletonScope();

  // Now get components after the adapter is properly configured
  const messagePreProcessor = container.get<IMessagePreProcessor>(TYPES.MessagePreProcessor);
  const contextManager = container.get<IContextManager>(TYPES.ContextManager);
  const decisionEngine = container.get<IDecisionEngine>(TYPES.DecisionEngine);
  const responseGenerator = container.get<IResponseGenerator>(TYPES.ResponseGenerator);
  const telegramAdapter = container.get<ITelegramInterfaceAdapter>(TYPES.TelegramInterfaceAdapter);
  const apiAdapter = container.get<ApiResponseAdapter>(TYPES.ApiResponseAdapter);

  // Register components with the orchestrator
  orchestrator.registerComponent('MessagePreProcessor', messagePreProcessor);
  orchestrator.registerComponent('ContextManager', contextManager);
  orchestrator.registerComponent('DecisionEngine', decisionEngine);
  orchestrator.registerComponent('ResponseGenerator', responseGenerator);
  orchestrator.registerComponent('TelegramAdapter', telegramAdapter);
  orchestrator.registerComponent('ApiResponseAdapter', apiAdapter);

  const orchestratorConfig = container.get<SystemOrchestratorConfig>(TYPES.SystemOrchestratorConfig);
  await orchestrator.initialize(orchestratorConfig);

  // Initialize individual components
  const contextStorage = container.get(TYPES.ContextStorage) as KVContextStorage;
  await contextStorage.initialize();

  await messagePreProcessor.initialize();
  await contextManager.initialize();
  await telegramAdapter.initialize();
  await apiAdapter.initialize();

  return { container, orchestrator };
}
