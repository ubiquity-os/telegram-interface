/**
 * Dependency Injection Type Identifiers
 *
 * These symbols are used by Inversify to identify dependencies
 * and wire up the correct implementations at runtime
 */

export const TYPES = {
  // Core Components
  SystemOrchestrator: Symbol.for('SystemOrchestrator'),
  TelegramInterfaceAdapter: Symbol.for('TelegramInterfaceAdapter'),
  MessageInterface: Symbol.for('MessageInterface'),
  ApiResponseAdapter: Symbol.for('ApiResponseAdapter'),
  MessagePreProcessor: Symbol.for('MessagePreProcessor'),
  DecisionEngine: Symbol.for('DecisionEngine'),
  ContextManager: Symbol.for('ContextManager'),
  ResponseGenerator: Symbol.for('ResponseGenerator'),
  ErrorHandler: Symbol.for('ErrorHandler'),

  // MCP and Moderation Components
  MCPToolManager: Symbol.for('MCPToolManager'),
  SelfModerationEngine: Symbol.for('SelfModerationEngine'),

  // Services
  LLMService: Symbol.for('LLMService'),
  LLMServiceAdapter: Symbol.for('LLMServiceAdapter'),
  EventBus: Symbol.for('EventBus'),
  MessageQueue: Symbol.for('MessageQueue'),

  // Storage
  ContextStorage: Symbol.for('ContextStorage'),
  StatePersistence: Symbol.for('StatePersistence'),

  // Configuration
  Config: Symbol.for('Config'),
  SystemOrchestratorConfig: Symbol.for('SystemOrchestratorConfig'),
  TelegramInterfaceAdapterConfig: Symbol.for('TelegramInterfaceAdapterConfig'),
  ApiResponseAdapterConfig: Symbol.for('ApiResponseAdapterConfig'),
  MessagePreProcessorConfig: Symbol.for('MessagePreProcessorConfig'),
  DecisionEngineConfig: Symbol.for('DecisionEngineConfig'),
  ContextManagerConfig: Symbol.for('ContextManagerConfig'),
  ResponseGeneratorConfig: Symbol.for('ResponseGeneratorConfig'),

  // Factories
  LLMServiceFactory: Symbol.for('LLMServiceFactory'),
  EventEmitterFactory: Symbol.for('EventEmitterFactory'),

  // Utilities
  DeduplicationService: Symbol.for('DeduplicationService'),
  ConversationHistory: Symbol.for('ConversationHistory'),
  TokenCounter: Symbol.for('TokenCounter'),
  TelemetryService: Symbol.for('TelemetryService')
};
