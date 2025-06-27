/**
 * Dependency Injection Container Configuration
 *
 * Configures Inversify container with all component bindings
 * and manages the dependency graph for the application
 */

import 'npm:reflect-metadata@0.2.2';
import { Container } from 'npm:inversify@7.5.4';
import { TYPES } from './types.ts';

// Import interfaces
import {
  ITelegramInterfaceAdapter,
  IMessagePreProcessor,
  IDecisionEngine,
  IContextManager,
  IResponseGenerator,
  IErrorHandler
} from '../interfaces/component-interfaces.ts';

import { ISystemOrchestrator } from '../components/system-orchestrator/types.ts';

// Import implementations
import { SystemOrchestrator } from '../components/system-orchestrator/system-orchestrator.ts';
import { TelegramInterfaceAdapter } from '../components/telegram-interface-adapter/telegram-interface-adapter.ts';
import { MessagePreProcessor } from '../components/message-pre-processor/message-pre-processor.ts';
import { DecisionEngine } from '../components/decision-engine/decision-engine.ts';
import { CachedContextManager } from '../components/context-manager/cached-context-manager.ts';
import { ResponseGenerator } from '../components/response-generator/response-generator.ts';

// Import services
import { LlmService } from '../services/llm-service/llm-service.ts';
import { SimpleErrorHandler } from '../services/error-handler.ts';
import { LLMServiceAdapter } from '../components/message-pre-processor/llm-service-adapter.ts';
import { KVContextStorage } from '../components/context-manager/kv-context-storage.ts';

// Import configuration types
import { SystemOrchestratorConfig } from '../components/system-orchestrator/types.ts';
import { TelegramInterfaceAdapterConfig } from '../components/telegram-interface-adapter/types.ts';
import { MessagePreProcessorConfig } from '../components/message-pre-processor/types.ts';
import { DecisionEngineConfig } from '../components/decision-engine/types.ts';
import { ContextManagerConfig } from '../components/context-manager/types.ts';
import { CachedContextManagerConfig } from '../components/context-manager/cached-context-manager.ts';
import { ResponseGeneratorConfig } from '../components/response-generator/types.ts';

// Import utility services
import { deduplicationService } from '../services/deduplication.ts';
import { eventBus } from '../services/event-bus/index.ts';

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
      rateLimits: {
        maxMessagesPerSecond: 30,
        maxMessagesPerMinute: 20 * 60,
        maxMessagesPerHour: 1000 * 60
      },
      queueConfig: {
        maxQueueSize: 100,
        processingInterval: 100,
        maxRetries: 3
      }
    });

  container.bind<MessagePreProcessorConfig>(TYPES.MessagePreProcessorConfig)
    .toConstantValue({
      maxCacheSize: 1000,
      cacheTTL: 60 * 60 * 1000, // 1 hour
      temperature: 0.7,
      verbose: false,
      confidenceThreshold: 0.8
    });

  container.bind<DecisionEngineConfig>(TYPES.DecisionEngineConfig)
    .toConstantValue({
      maxStateRetention: 1000,
      defaultTimeout: 30000,
      enableStatePersistence: true,
      debugMode: false,
      confidenceThreshold: 0.8
    });

  container.bind<CachedContextManagerConfig>(TYPES.ContextManagerConfig)
    .toConstantValue({
      storage: {
        type: 'deno-kv',
        kvPath: undefined
      },
      limits: {
        maxConversationAge: 30 * 24 * 60 * 60 * 1000, // 30 days
        maxMessagesPerChat: 100,
        maxStorageSize: 1024 * 1024 * 1024 // 1GB
      },
      cleanup: {
        enabled: true,
        interval: 60 * 60 * 1000, // 1 hour
        batchSize: 10
      },
      cache: {
        maxSize: 100,
        contextTTL: 30 * 60 * 1000, // 30 minutes
        preferencesTTL: 60 * 60 * 1000, // 1 hour
        enableMetrics: true
      }
    });

  container.bind<ResponseGeneratorConfig>(TYPES.ResponseGeneratorConfig)
    .toConstantValue({
      maxResponseLength: 4000,
      enableMarkdown: true,
      temperature: 0.7,
      maxButtonsPerRow: 3,
      maxRows: 10
    });

  // Bind services
  container.bind<LlmService>(TYPES.LLMService)
    .to(LlmService)
    .inSingletonScope();

  container.bind(TYPES.LLMService)
    .to(LLMServiceAdapter)
    .inSingletonScope();

  container.bind(TYPES.ContextStorage)
    .to(KVContextStorage)
    .inSingletonScope();

  container.bind<IErrorHandler>(TYPES.ErrorHandler)
    .to(SimpleErrorHandler)
    .inSingletonScope();

  // Bind utility services
  container.bind(TYPES.DeduplicationService)
    .toConstantValue(deduplicationService);

  container.bind(TYPES.EventBus)
    .toConstantValue(eventBus);

  // Bind components
  container.bind<ITelegramInterfaceAdapter>(TYPES.TelegramInterfaceAdapter)
    .to(TelegramInterfaceAdapter)
    .inSingletonScope();

  container.bind<IMessagePreProcessor>(TYPES.MessagePreProcessor)
    .to(MessagePreProcessor)
    .inSingletonScope();

  container.bind<IDecisionEngine>(TYPES.DecisionEngine)
    .to(DecisionEngine)
    .inSingletonScope();

  container.bind<IContextManager>(TYPES.ContextManager)
    .to(CachedContextManager)
    .inSingletonScope();

  container.bind<IResponseGenerator>(TYPES.ResponseGenerator)
    .to(ResponseGenerator)
    .inSingletonScope();

  container.bind<ISystemOrchestrator>(TYPES.SystemOrchestrator)
    .to(SystemOrchestrator)
    .inSingletonScope();

  // Factory for creating configured LLM service instances
  container.bind<(config: any) => LlmService>(TYPES.LLMServiceFactory)
    .toFactory(() => {
      return (config: any) => {
        const service = new LlmService();
        // Configure service with provided config
        return service;
      };
    });

  return container;
}

/**
 * Update container with runtime configuration
 */
export function updateContainerConfig(container: Container, config: any): void {
  // Update Telegram config with bot token
  const telegramConfig = container.get<TelegramInterfaceAdapterConfig>(TYPES.TelegramInterfaceAdapterConfig);
  telegramConfig.botToken = config.botToken;

  // Update system orchestrator config
  const orchestratorConfig: SystemOrchestratorConfig = {
    telegramConfig: {
      botToken: config.botToken,
      webhookSecret: config.webhookSecret
    },
    enableMCPTools: true,
    enableSelfModeration: true,
    enableErrorRecovery: true,
    requestTimeout: 30000,
    maxRetries: 3,
    logLevel: 'info',
    messageQueue: {
      workerConfig: {
        minWorkers: 2,
        maxWorkers: 10,
        idleTimeout: 30000
      },
      retryConfig: {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 30000,
        multiplier: 2
      }
    }
  };

  container.bind<SystemOrchestratorConfig>(TYPES.SystemOrchestratorConfig)
    .toConstantValue(orchestratorConfig);

  // Bind runtime config
  container.bind(TYPES.Config)
    .toConstantValue(config);
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
  // Create container
  const container = createContainer();

  // Update with runtime config
  updateContainerConfig(container, config);

  // Get the system orchestrator
  const orchestrator = container.get<ISystemOrchestrator>(TYPES.SystemOrchestrator);

  // Initialize the orchestrator with config
  const orchestratorConfig = container.get<SystemOrchestratorConfig>(TYPES.SystemOrchestratorConfig);
  await orchestrator.initialize(orchestratorConfig);

  return { container, orchestrator };
}