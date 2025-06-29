/**
 * System Orchestrator Implementation
 *
 * Central orchestration system that wires together all components
 * and manages the message flow through the system
 */

import { injectable, inject } from 'inversify';
import { TYPES } from '../../core/types.ts';
import {
  SystemOrchestratorConfig,
  ComponentDependencies,
  SystemHealthStatus,
  SystemMetrics,
  RequestContext,
  ISystemOrchestrator,
  ComponentState,
  ManagedComponent,
  MessageFlowStage,
  FlowTracker
} from './types.ts';

import type {
  TelegramUpdate,
  ComponentStatus,
  ITelegramInterfaceAdapter,
  IDecisionEngine,
  IContextManager,
  IErrorHandler,
  IMessagePreProcessor,
  IResponseGenerator,
  ErrorContext,
  DecisionContext,
  Decision,
  ToolResult,
  ResponseContext
} from '../../interfaces/component-interfaces.ts';

import type { IMessageInterface, GenericResponse } from '../../interfaces/message-interface.ts';

import {
  TelegramMessage,
  TelegramResponse,
  InternalMessage,
  GeneratedResponse,
  ConversationContext,
  MessageAnalysis,
  EventType,
  SystemEvent,
  UserPreferences
} from '../../interfaces/message-types.ts';

import { IMCPToolManager } from '../mcp-tool-manager/types.ts';
import { ISelfModerationEngine } from '../self-moderation-engine/types.ts';

// Import Telemetry Service
import { TelemetryService, LogLevel, initializeTelemetry } from '../../services/telemetry/index.ts';

// Import Event Bus
import {
  eventBus,
  SystemEventType,
  MessageReceivedEvent,
  MessageAnalyzedEvent,
  DecisionMadeEvent,
  ToolExecutedEvent,
  ResponseGeneratedEvent,
  ModerationStartedEvent,
  ModerationApprovedEvent,
  ModerationRejectedEvent,
  ModerationModifiedEvent,
  ModerationFailedEvent,
  ModerationCompleteEvent,
  ErrorOccurredEvent,
  SystemReadyEvent,
  SystemShutdownEvent,
  ComponentInitializedEvent,
  ComponentShutdownEvent,
  ComponentErrorEvent,
  createEventEmitter
} from '../../services/event-bus/index.ts';

import { ModerationResult, ModerationIssue } from '../self-moderation-engine/types.ts';

// Import Message Queue
import {
  MessageQueue,
  MessagePriority,
  MessagePriorityEnum,
  QueuedMessage,
  MessageQueueConfig,
  QueueEventType,
  QueueEventTypeEnum,
  QueueEvent
} from '../../services/message-queue/index.ts';

// Import session-based logging system (removed finalizeEventLogging - handled by MessageRouter)

@injectable()
export class SystemOrchestrator implements ISystemOrchestrator {
  private config!: SystemOrchestratorConfig;
  private components: Map<string, ManagedComponent> = new Map();
  private metrics: SystemMetrics;
  private flowTrackers: Map<string, FlowTracker> = new Map();
  private startTime: Date;
  private isInitialized = false;
  private eventEmitter = createEventEmitter('SystemOrchestrator');

  // Message queue
  private messageQueue?: MessageQueue;

  // Telemetry service
  private telemetry?: TelemetryService;

  // Component references - injected via constructor
  private messageInterface: IMessageInterface;
  private decisionEngine: IDecisionEngine;
  private contextManager: IContextManager;
  private errorHandler: IErrorHandler;
  private messagePreProcessor: IMessagePreProcessor;
  private responseGenerator: IResponseGenerator;
  private mcpToolManager?: IMCPToolManager;
  private selfModerationEngine?: ISelfModerationEngine;

  constructor(
    @inject(TYPES.TelegramInterfaceAdapter) messageInterface: IMessageInterface,
    @inject(TYPES.MessagePreProcessor) messagePreProcessor: IMessagePreProcessor,
    @inject(TYPES.DecisionEngine) decisionEngine: IDecisionEngine,
    @inject(TYPES.ContextManager) contextManager: IContextManager,
    @inject(TYPES.ResponseGenerator) responseGenerator: IResponseGenerator,
    @inject(TYPES.ErrorHandler) errorHandler: IErrorHandler
  ) {
    this.messageInterface = messageInterface;
    this.messagePreProcessor = messagePreProcessor;
    this.decisionEngine = decisionEngine;
    this.contextManager = contextManager;
    this.responseGenerator = responseGenerator;
    this.errorHandler = errorHandler;

    this.startTime = new Date();
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      activeRequests: 0,
      errorRate: 0
    };
  }

  /**
   * Set telemetry service and propagate to child components
   */
  setTelemetry(telemetry: TelemetryService): void {
    this.telemetry = telemetry;

    // Propagate telemetry to child components that support it
    if (this.decisionEngine && 'setTelemetry' in this.decisionEngine) {
      (this.decisionEngine as any).setTelemetry(telemetry);
    }

    if (this.mcpToolManager && 'setTelemetry' in this.mcpToolManager) {
      (this.mcpToolManager as any).setTelemetry(telemetry);
    }

    if (this.responseGenerator && 'setTelemetry' in this.responseGenerator) {
      (this.responseGenerator as any).setTelemetry(telemetry);
    }

    if (this.contextManager && 'setTelemetry' in this.contextManager) {
      (this.contextManager as any).setTelemetry(telemetry);
    }

    if (this.messagePreProcessor && 'setTelemetry' in this.messagePreProcessor) {
      (this.messagePreProcessor as any).setTelemetry(telemetry);
    }

    if (this.errorHandler && 'setTelemetry' in this.errorHandler) {
      (this.errorHandler as any).setTelemetry(telemetry);
    }

    if (this.selfModerationEngine && 'setTelemetry' in this.selfModerationEngine) {
      (this.selfModerationEngine as any).setTelemetry(telemetry);
    }
  }

  async initialize(config: SystemOrchestratorConfig): Promise<void> {
    if (this.isInitialized) {
      throw new Error('SystemOrchestrator is already initialized');
    }

    console.log('[SystemOrchestrator] Initializing...');
    this.config = config;

    try {
      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'SystemOrchestrator',
        phase: 'initialization_start',
        message: 'Starting SystemOrchestrator initialization',
        metadata: {
          hasMessageQueue: !!config.messageQueue,
          messageQueueConfig: config.messageQueue ? {
            workerCount: config.messageQueue.workerConfig.maxWorkers,
            retryConfig: config.messageQueue.retryConfig
          } : undefined
        }
      });

      // Initialize components from dependencies
      await this.initializeComponents();

      // Subscribe to system events
      await this.subscribeToEvents();

      // Set up component event handlers
      await this.setupComponentHandlers();

      // Initialize message queue if configured
      await this.initializeMessageQueue();

      // Initialize telemetry service
      await this.initializeTelemetry();

      this.isInitialized = true;

      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'SystemOrchestrator',
        phase: 'initialization_complete',
        message: 'SystemOrchestrator initialization completed',
        metadata: {
          componentCount: this.components.size,
          uptime: Date.now() - this.startTime.getTime(),
          telemetryEnabled: !!this.telemetry,
          messageQueueEnabled: !!this.messageQueue
        }
      });

      // Emit system ready event
      await this.eventEmitter.emit<SystemReadyEvent>({
        type: SystemEventType.SYSTEM_READY,
        payload: {
          components: Array.from(this.components.keys()),
          timestamp: new Date()
        }
      });

      console.log('[SystemOrchestrator] Initialization complete');
    } catch (error) {
      console.error('[SystemOrchestrator] Initialization failed:', error);

      this.telemetry?.logStructured({
        level: LogLevel.ERROR,
        component: 'SystemOrchestrator',
        phase: 'initialization_error',
        message: 'SystemOrchestrator initialization failed',
        metadata: {
          errorMessage: error.message,
          errorType: error.constructor.name
        },
        error: error as Error
      });

      await this.shutdown();
      throw error;
    }
  }

  private async initializeComponents(): Promise<void> {
    console.log('[SystemOrchestrator] Initializing components...');

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'SystemOrchestrator',
      phase: 'component_initialization_start',
      message: 'Starting component initialization',
      metadata: {}
    });

    // Register core components that implement IComponent
    const componentsToRegister = [
      { name: 'ErrorHandler', component: this.errorHandler, required: true, order: 1 },
      { name: 'ContextManager', component: this.contextManager, required: true, order: 2 },
      { name: 'MessagePreProcessor', component: this.messagePreProcessor, required: true, order: 3 },
      { name: 'DecisionEngine', component: this.decisionEngine, required: true, order: 4 },
      { name: 'ResponseGenerator', component: this.responseGenerator, required: true, order: 5 },
      { name: 'MessageInterface', component: this.messageInterface, required: true, order: 6 },
    ];

    // Register each component
    for (const { name, component, required, order } of componentsToRegister) {
      this.components.set(name, {
        name,
        component,
        state: ComponentState.READY,
        required,
        initOrder: order,
        restartCount: 0
      });

      this.telemetry?.logStructured({
        level: LogLevel.DEBUG,
        component: 'SystemOrchestrator',
        phase: 'component_registered',
        message: 'Component registered successfully',
        metadata: {
          componentName: name,
          required,
          initOrder: order
        }
      });

      // Emit component initialized event
      await this.eventEmitter.emit<ComponentInitializedEvent>({
        type: SystemEventType.COMPONENT_INITIALIZED,
        payload: {
          componentName: name,
          timestamp: new Date()
        }
      });
    }

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'SystemOrchestrator',
      phase: 'component_initialization_complete',
      message: 'All components initialized successfully',
      metadata: {
        totalComponents: componentsToRegister.length,
        requiredComponents: componentsToRegister.filter(c => c.required).length
      }
    });

    console.log('[SystemOrchestrator] All components initialized');
  }

  private async setupComponentHandlers(): Promise<void> {
    console.log('[SystemOrchestrator] Setting up component handlers...');

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'SystemOrchestrator',
      phase: 'handler_setup_start',
      message: 'Setting up component handlers',
      metadata: {}
    });

    // Subscribe to updates from message interface
    // Note: Platform-specific adapters handle their own subscription logic
    // The SystemOrchestrator now works generically with any message interface
    if ('subscribe' in this.messageInterface) {
      (this.messageInterface as any).subscribe(async (update: TelegramUpdate) => {
        await this.handleUpdate(update);
      });

      this.telemetry?.logStructured({
        level: LogLevel.DEBUG,
        component: 'SystemOrchestrator',
        phase: 'message_interface_subscribed',
        message: 'Subscribed to message interface updates',
        metadata: {}
      });
    }

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'SystemOrchestrator',
      phase: 'handler_setup_complete',
      message: 'Component handlers configured successfully',
      metadata: {}
    });

    console.log('[SystemOrchestrator] Component handlers configured');
  }

  /**
   * Initialize the message queue
   */
  private async initializeMessageQueue(): Promise<void> {
    if (!this.config.messageQueue) {
      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'SystemOrchestrator',
        phase: 'message_queue_skip',
        message: 'Message queue not configured, using direct processing',
        metadata: {}
      });

      console.log('[SystemOrchestrator] Message queue not configured, using direct processing');
      return;
    }

    console.log('[SystemOrchestrator] Initializing message queue...');

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'SystemOrchestrator',
      phase: 'message_queue_init_start',
      message: 'Starting message queue initialization',
      metadata: {
        minWorkers: this.config.messageQueue.workerConfig.minWorkers,
        maxWorkers: this.config.messageQueue.workerConfig.maxWorkers,
        maxRetries: this.config.messageQueue.retryConfig.maxRetries
      }
    });

    try {
      // Create message queue configuration
      const queueConfig: MessageQueueConfig = {
        maxQueueSize: 1000,
        workerPool: {
          minWorkers: this.config.messageQueue.workerConfig.minWorkers,
          maxWorkers: this.config.messageQueue.workerConfig.maxWorkers,
          workerIdleTimeout: this.config.messageQueue.workerConfig.idleTimeout,
          autoscale: true,
          scalingThreshold: 50
        },
        priorityBoost: {
          commands: true,
          adminUsers: [],
          keywords: ['help', 'start', 'stop']
        },
        deadLetterQueue: {
          enabled: true,
          maxRetries: this.config.messageQueue.retryConfig.maxRetries
        }
      };

      // Create message queue
      this.messageQueue = new MessageQueue(queueConfig);

      // Subscribe to queue events
      this.messageQueue.on(QueueEventTypeEnum.MESSAGE_FAILED, (event: QueueEvent) => {
        console.error('[SystemOrchestrator] Message processing failed:', event.data);

        this.telemetry?.logStructured({
          level: LogLevel.ERROR,
          component: 'SystemOrchestrator',
          phase: 'queue_message_failed',
          message: 'Message processing failed in queue',
          metadata: {
            eventData: event.data,
            messageId: event.data?.messageId
          }
        });
      });

      this.messageQueue.on(QueueEventTypeEnum.QUEUE_FULL, (event: QueueEvent) => {
        console.warn('[SystemOrchestrator] Message queue is full:', event.data);

        this.telemetry?.logStructured({
          level: LogLevel.WARN,
          component: 'SystemOrchestrator',
          phase: 'queue_full',
          message: 'Message queue is at capacity',
          metadata: {
            queueSize: event.data?.queueSize,
            maxSize: event.data?.maxSize
          }
        });
      });

      // Start the queue with our message processor
      await this.messageQueue.start(this.processQueuedMessage.bind(this));

      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'SystemOrchestrator',
        phase: 'message_queue_init_complete',
        message: 'Message queue initialized and started successfully',
        metadata: {
          maxQueueSize: queueConfig.maxQueueSize,
          workerPoolConfig: queueConfig.workerPool
        }
      });

      console.log('[SystemOrchestrator] Message queue initialized and started');
    } catch (error) {
      this.telemetry?.logStructured({
        level: LogLevel.ERROR,
        component: 'SystemOrchestrator',
        phase: 'message_queue_init_error',
        message: 'Failed to initialize message queue',
        metadata: {
          errorMessage: error.message
        },
        error: error as Error
      });
      throw error;
    }
  }

  /**
   * Initialize the telemetry service
   */
  private async initializeTelemetry(): Promise<void> {
    console.log('[SystemOrchestrator] Initializing telemetry service...');

    try {
      if (!this.telemetry) {
        this.telemetry = await initializeTelemetry({
          enableDebugLogs: true,
          enableConsoleOutput: true
        });

        // Propagate telemetry to child components after initialization
        this.setTelemetry(this.telemetry);
      }

      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'SystemOrchestrator',
        phase: 'telemetry_init_complete',
        message: 'Telemetry service initialized successfully',
        metadata: {
          enableDebugLogs: true,
          enableConsoleOutput: true
        }
      });

      console.log('[SystemOrchestrator] Telemetry service initialized');
    } catch (error) {
      console.error('[SystemOrchestrator] Failed to initialize telemetry service:', error);
      // Don't fail the entire initialization - telemetry is observability, not critical functionality
    }
  }

  /**
   * Process a message from the queue
   */
  private async processQueuedMessage(queuedMessage: QueuedMessage): Promise<void> {
    const { update, metadata } = queuedMessage;
    const requestId = queuedMessage.id;

    this.telemetry?.logStructured({
      level: LogLevel.DEBUG,
      component: 'SystemOrchestrator',
      phase: 'queue_message_processing_start',
      message: 'Processing queued message',
      metadata: {
        messageId: requestId,
        priority: metadata?.priority,
        queueWaitTime: Date.now() - queuedMessage.timestamp.getTime()
      }
    });

    // Process the update with existing logic
    await this.processUpdate(update, requestId);
  }

  /**
   * Determine message priority based on content and context
   */
  private determineMessagePriority(update: TelegramUpdate): MessagePriority {
    let priority = MessagePriorityEnum.NORMAL;

    // Check if it's a command
    if (update.message?.text?.startsWith('/')) {
      priority = MessagePriorityEnum.HIGH;
    }
    // Check for system messages or errors
    else if (update.message?.text?.toLowerCase().includes('error') ||
        update.message?.text?.toLowerCase().includes('help')) {
      priority = MessagePriorityEnum.HIGH;
    }
    // Check for callback queries (button presses)
    else if (update.callback_query) {
      priority = MessagePriorityEnum.HIGH;
    }

    this.telemetry?.logStructured({
      level: LogLevel.DEBUG,
      component: 'SystemOrchestrator',
      phase: 'message_priority_determined',
      message: 'Message priority determined',
      metadata: {
        priority: MessagePriorityEnum[priority],
        isCommand: update.message?.text?.startsWith('/') || false,
        hasCallbackQuery: !!update.callback_query,
        messageText: update.message?.text?.substring(0, 50)
      }
    });

    return priority;
  }

  async handleUpdate(update: TelegramUpdate): Promise<string> {
    const startTime = Date.now();

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'SystemOrchestrator',
      phase: 'update_received',
      message: 'New update received for processing',
      metadata: {
        hasMessage: !!update.message,
        hasCallbackQuery: !!update.callback_query,
        chatId: update.message?.chat?.id,
        messageType: update.message?.text ? 'text' : 'other'
      }
    });

    // If message queue is enabled, enqueue the message
    if (this.messageQueue) {
      try {
        const priority = this.determineMessagePriority(update);
        const messageId = await this.messageQueue.enqueue(update, priority);

        this.telemetry?.logStructured({
          level: LogLevel.INFO,
          component: 'SystemOrchestrator',
          phase: 'message_enqueued',
          message: 'Message enqueued for processing',
          metadata: {
            messageId,
            priority: MessagePriorityEnum[priority],
            queueDepth: this.messageQueue.getStats().queueDepth
          }
        });

        console.log(`[SystemOrchestrator] Message enqueued with ID: ${messageId}, priority: ${MessagePriorityEnum[priority]}`);
        return "Message queued for processing";
      } catch (error) {
        console.error('[SystemOrchestrator] Failed to enqueue message:', error);

        this.telemetry?.logStructured({
          level: LogLevel.ERROR,
          component: 'SystemOrchestrator',
          phase: 'message_enqueue_error',
          message: 'Failed to enqueue message, falling back to direct processing',
          metadata: {
            errorMessage: error.message,
            fallbackToDirect: true
          },
          error: error as Error
        });

        // Fall back to direct processing
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        return await this.processUpdate(update, requestId);
      }
    } else {
      // Direct processing without queue
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      this.telemetry?.logStructured({
        level: LogLevel.DEBUG,
        component: 'SystemOrchestrator',
        phase: 'direct_processing',
        message: 'Processing message directly (no queue)',
        metadata: {
          requestId,
          processingTime: Date.now() - startTime
        }
      });

      return await this.processUpdate(update, requestId);
    }
  }

  /**
   * Process an update (either directly or from the queue)
   */
  private async processUpdate(update: TelegramUpdate, requestId: string): Promise<string> {
    console.log(`=== ORCHESTRATOR CALLED ===`);
    console.log(`[SystemOrchestrator] Processing update ${requestId}`);
    console.log(`[SystemOrchestrator] Update content:`, JSON.stringify(update, null, 2));

    // Start telemetry trace if available
    if (this.telemetry) {
      return await this.telemetry.withTrace(
        'SystemOrchestrator.processUpdate',
        async () => await this.processUpdateWithTelemetry(update, requestId),
        {
          component: 'SystemOrchestrator',
          requestId,
          chatId: update.message?.chat?.id,
          userId: update.message?.from?.id,
          messageType: update.message?.text ? 'text' : 'other'
        }
      );
    } else {
      // Fallback without telemetry
      return await this.processUpdateWithTelemetry(update, requestId);
    }
  }

  /**
   * Process update with telemetry integration
   */
  private async processUpdateWithTelemetry(update: TelegramUpdate, requestId: string): Promise<string> {
    const requestContext: RequestContext = {
      requestId,
      update,
      startTime: new Date(),
      metadata: {}
    };

    // Initialize flow tracker
    const flowTracker: FlowTracker = {
      requestId,
      startTime: new Date(),
      currentStage: MessageFlowStage.RECEIVING,
      stages: [{
        stage: MessageFlowStage.RECEIVING,
        timestamp: new Date()
      }]
    };
    this.flowTrackers.set(requestId, flowTracker);

    this.metrics.totalRequests++;
    this.metrics.activeRequests++;

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'SystemOrchestrator',
      phase: 'message_processing_start',
      message: 'Starting message processing pipeline',
      metadata: {
        requestId,
        chatId: update.message?.chat?.id,
        userId: update.message?.from?.id,
        messageText: update.message?.text?.substring(0, 100),
        totalRequests: this.metrics.totalRequests,
        activeRequests: this.metrics.activeRequests
      }
    });

    try {
      // Stage 1: Receiving message
      if (!update.message || !update.message.text) {
        console.log(`[SystemOrchestrator] Ignoring non-text update ${requestId}`);

        this.telemetry?.logStructured({
          level: LogLevel.WARN,
          component: 'SystemOrchestrator',
          phase: 'non_text_message_ignored',
          message: 'Non-text message ignored',
          metadata: {
            requestId,
            hasMessage: !!update.message,
            hasText: !!update.message?.text,
            messageType: update.callback_query ? 'callback_query' : 'other'
          }
        });

        return "Non-text message ignored";
      }

      console.log(`[SystemOrchestrator] Processing text message: "${update.message.text}"`);

      // DIAGNOSTIC: Check DecisionEngine state before processing
      const chatId = update.message.chat.id;
      console.log(`[SystemOrchestrator] DIAGNOSTIC - Chat ID: ${chatId} (type: ${typeof chatId})`);
      console.log(`[SystemOrchestrator] DIAGNOSTIC - DecisionEngine object:`, this.decisionEngine ? 'EXISTS' : 'UNDEFINED');

      // FIX: Add await since getCurrentState returns Promise<DecisionState>
      if (this.decisionEngine && typeof this.decisionEngine.getCurrentState === 'function') {
        const initialState = await this.decisionEngine.getCurrentState(chatId);
        console.log(`[SystemOrchestrator] DIAGNOSTIC - DecisionEngine initial state for chat ${chatId}: ${initialState}`);

        this.telemetry?.logStructured({
          level: LogLevel.DEBUG,
          component: 'SystemOrchestrator',
          phase: 'decision_engine_state_check',
          message: 'DecisionEngine initial state checked',
          metadata: {
            requestId,
            chatId,
            initialState
          }
        });
      } else {
        console.error(`[SystemOrchestrator] CRITICAL ERROR - DecisionEngine getCurrentState method not available`);
        console.error(`[SystemOrchestrator] DecisionEngine methods:`, Object.getOwnPropertyNames(this.decisionEngine || {}));

        this.telemetry?.logStructured({
          level: LogLevel.ERROR,
          component: 'SystemOrchestrator',
          phase: 'decision_engine_missing',
          message: 'DecisionEngine getCurrentState method not available',
          metadata: {
            requestId,
            decisionEngineExists: !!this.decisionEngine,
            availableMethods: Object.getOwnPropertyNames(this.decisionEngine || {})
          }
        });
      }

      // Text is guaranteed to exist after the check above
      const messageText = update.message.text;

      const telegramMessage: TelegramMessage = {
        messageId: update.message.message_id,
        chatId: update.message.chat.id,
        userId: update.message.from.id,
        text: messageText,
        timestamp: new Date(update.message.date * 1000),
        username: update.message.from.username,
        firstName: update.message.from.first_name,
        lastName: update.message.from.last_name
      };

      this.telemetry?.logStructured({
        level: LogLevel.DEBUG,
        component: 'SystemOrchestrator',
        phase: 'telegram_message_parsed',
        message: 'Telegram message parsed successfully',
        metadata: {
          requestId,
          messageId: telegramMessage.messageId,
          chatId: telegramMessage.chatId,
          userId: telegramMessage.userId,
          messageLength: messageText.length,
          username: telegramMessage.username
        }
      });

      // Emit message received event
      await this.eventEmitter.emit<MessageReceivedEvent>({
        type: SystemEventType.MESSAGE_RECEIVED,
        payload: {
          message: telegramMessage,
          requestId
        }
      });

      // Stage 2: Store message in context
      this.updateFlowStage(requestId, MessageFlowStage.STORING_CONTEXT);

      this.telemetry?.logStructured({
        level: LogLevel.DEBUG,
        component: 'SystemOrchestrator',
        phase: 'context_storage_start',
        message: 'Starting context storage',
        metadata: {
          requestId,
          chatId: telegramMessage.chatId
        }
      });

      const internalMessage: InternalMessage = {
        id: `msg_${requestId}`,
        chatId: telegramMessage.chatId,
        userId: telegramMessage.userId,
        content: messageText,
        timestamp: telegramMessage.timestamp,
        metadata: {
          source: 'telegram',
          requestId,
          username: telegramMessage.username
        }
      };
      await this.contextManager.addMessage(internalMessage);

      // Stage 3: Get conversation context
      const conversationContext = await this.contextManager.getContext(telegramMessage.chatId);

      this.telemetry?.logStructured({
        level: LogLevel.DEBUG,
        component: 'SystemOrchestrator',
        phase: 'context_retrieved',
        message: 'Conversation context retrieved',
        metadata: {
          requestId,
          chatId: telegramMessage.chatId,
          messageCount: conversationContext.messages.length,
          hasUserPreferences: !!conversationContext.userPreferences
        }
      });

      // Stage 4: Message Pre-Processing
      this.updateFlowStage(requestId, MessageFlowStage.PREPROCESSING);
      console.log(`[SystemOrchestrator] Stage 4: Calling MessagePreProcessor.analyzeMessage()`);

      this.telemetry?.logStructured({
        level: LogLevel.DEBUG,
        component: 'SystemOrchestrator',
        phase: 'preprocessing_start',
        message: 'Starting message preprocessing',
        metadata: {
          requestId,
          messageText: messageText.substring(0, 100),
          contextMessageCount: conversationContext.messages.length
        }
      });

      // Analyze the message using MessagePreProcessor
      const analysis = await this.messagePreProcessor.analyzeMessage(
        messageText,
        conversationContext
      );

      console.log(`[SystemOrchestrator] MessagePreProcessor analysis result:`, JSON.stringify(analysis, null, 2));

      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'SystemOrchestrator',
        phase: 'preprocessing_complete',
        message: 'Message preprocessing completed',
        metadata: {
          requestId,
          analysisType: analysis.type,
          intent: analysis.intent,
          confidence: analysis.confidence,
          entityCount: analysis.entities?.length || 0,
          requiresTools: analysis.requiresTools
        }
      });

      // Emit message analyzed event
      await this.eventEmitter.emit<MessageAnalyzedEvent>({
        type: SystemEventType.MESSAGE_ANALYZED,
        payload: {
          message: telegramMessage,
          analysis,
          requestId
        }
      });

      // Stage 5: Decision making
      this.updateFlowStage(requestId, MessageFlowStage.DECISION_MAKING);

      this.telemetry?.logStructured({
        level: LogLevel.DEBUG,
        component: 'SystemOrchestrator',
        phase: 'decision_making_start',
        message: 'Starting decision making process',
        metadata: {
          requestId,
          analysisType: analysis.type,
          availableToolCount: this.mcpToolManager ? (await this.mcpToolManager.getAvailableTools()).length : 0
        }
      });

      const decisionContext: DecisionContext = {
        message: telegramMessage,
        analysis,
        conversationState: conversationContext,
        availableTools: this.mcpToolManager ? await this.mcpToolManager.getAvailableTools() : []
      };

      const decision = await this.decisionEngine.makeDecision(decisionContext);

      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'SystemOrchestrator',
        phase: 'decision_made',
        message: 'Decision made',
        metadata: {
          requestId,
          action: decision.action,
          toolCallCount: decision.toolCalls?.length || 0,
          reasoning: decision.reasoning?.substring(0, 200)
        }
      });

      // Emit decision made event
      await this.eventEmitter.emit<DecisionMadeEvent>({
        type: SystemEventType.DECISION_MADE,
        payload: {
          decision,
          context: decisionContext,
          requestId
        }
      });

      // Stage 6: Execute tools if needed
      let toolResults: ToolResult[] = [];
      if (decision.action === 'execute_tools' && decision.toolCalls && this.mcpToolManager) {
        this.updateFlowStage(requestId, MessageFlowStage.TOOL_EXECUTION);

        this.telemetry?.logStructured({
          level: LogLevel.INFO,
          component: 'SystemOrchestrator',
          phase: 'tool_execution_start',
          message: 'Starting tool execution',
          metadata: {
            requestId,
            toolCount: decision.toolCalls.length,
            tools: decision.toolCalls.map(tc => ({ toolId: tc.toolId, serverId: tc.serverId }))
          }
        });

        const toolExecutionStart = Date.now();
        toolResults = await this.mcpToolManager.executeMultipleTools(decision.toolCalls);
        const toolExecutionTime = Date.now() - toolExecutionStart;

        this.telemetry?.logStructured({
          level: LogLevel.INFO,
          component: 'SystemOrchestrator',
          phase: 'tool_execution_complete',
          message: 'Tool execution completed',
          metadata: {
            requestId,
            toolCount: toolResults.length,
            successCount: toolResults.filter(r => r.success).length,
            errorCount: toolResults.filter(r => !r.success).length,
            executionTime: toolExecutionTime
          },
          duration: toolExecutionTime
        });

        // Emit tool executed events
        for (const result of toolResults) {
          await this.eventEmitter.emit<ToolExecutedEvent>({
            type: SystemEventType.TOOL_EXECUTED,
            payload: {
              toolId: result.toolId,
              result,
              requestId
            }
          });
        }

        // Process tool results through decision engine
        const processedDecision = await this.decisionEngine.processToolResults(toolResults);
        if (processedDecision.action !== 'respond') {
          throw new Error('Unexpected decision after tool execution');
        }
      }

      // Stage 7: Generate response with moderation and retry logic
      let finalResponse: GeneratedResponse | null = null;
      let moderationAttempts = 0;
      const maxModerationAttempts = 3;

      this.telemetry?.logStructured({
        level: LogLevel.DEBUG,
        component: 'SystemOrchestrator',
        phase: 'response_generation_init',
        message: 'Initializing response generation with moderation',
        metadata: {
          requestId,
          maxModerationAttempts,
          hasToolResults: toolResults.length > 0,
          selfModerationEnabled: !!this.selfModerationEngine
        }
      });

      while (moderationAttempts < maxModerationAttempts && !finalResponse) {
        moderationAttempts++;
        this.updateFlowStage(requestId, MessageFlowStage.RESPONSE_GENERATION);

        this.telemetry?.logStructured({
          level: LogLevel.DEBUG,
          component: 'SystemOrchestrator',
          phase: 'response_generation_start',
          message: 'Starting response generation',
          metadata: {
            requestId,
            attempt: moderationAttempts,
            hasToolResults: toolResults.length > 0
          }
        });

        const responseContext: ResponseContext = {
          message: telegramMessage,
          analysis,
          decision,
          toolResults,
          conversationState: conversationContext
        };

        const generatedResponse = await this.responseGenerator.generateResponse(responseContext);

        this.telemetry?.logStructured({
          level: LogLevel.INFO,
          component: 'SystemOrchestrator',
          phase: 'response_generated',
          message: 'Response generated',
          metadata: {
            requestId,
            attempt: moderationAttempts,
            responseLength: generatedResponse.content.length,
            hasAttachments: !!generatedResponse.attachments?.length
          }
        });

        // Stage 8: Self-moderation (if enabled)
        if (this.selfModerationEngine) {
          this.updateFlowStage(requestId, MessageFlowStage.MODERATION);

          this.telemetry?.logStructured({
            level: LogLevel.DEBUG,
            component: 'SystemOrchestrator',
            phase: 'moderation_start',
            message: 'Starting self-moderation',
            metadata: {
              requestId,
              attempt: moderationAttempts,
              responseLength: generatedResponse.content.length
            }
          });

          const moderationResult = await this.selfModerationEngine.moderateResponse(
            generatedResponse,
            conversationContext
          );

          this.telemetry?.logStructured({
            level: LogLevel.INFO,
            component: 'SystemOrchestrator',
            phase: 'moderation_complete',
            message: 'Self-moderation completed',
            metadata: {
              requestId,
              attempt: moderationAttempts,
              approved: moderationResult.approved,
              confidence: moderationResult.confidence,
              issueCount: moderationResult.issues?.length || 0,
              hasModifications: !!moderationResult.modifiedResponse
            }
          });

          if (moderationResult.approved) {
            finalResponse = moderationResult.modifiedResponse || generatedResponse;
          } else {
            // Log moderation rejection and retry
            this.telemetry?.logStructured({
              level: LogLevel.WARN,
              component: 'SystemOrchestrator',
              phase: 'moderation_rejected',
              message: 'Response rejected by moderation, retrying',
              metadata: {
                requestId,
                attempt: moderationAttempts,
                issues: moderationResult.issues?.map(i => i.type),
                maxAttempts: maxModerationAttempts
              }
            });
          }
        } else {
          // No moderation, accept response
          finalResponse = generatedResponse;
        }
      }

      if (!finalResponse) {
        throw new Error(`Failed to generate acceptable response after ${maxModerationAttempts} attempts`);
      }

      // Stage 9: Send response
      this.updateFlowStage(requestId, MessageFlowStage.SENDING_RESPONSE);

      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'SystemOrchestrator',
        phase: 'response_sending',
        message: 'Sending final response',
        metadata: {
          requestId,
          responseLength: finalResponse.content.length,
          moderationAttempts,
          hasAttachments: !!finalResponse.attachments?.length
        }
      });

      const telegramResponse: TelegramResponse = {
        chatId: telegramMessage.chatId,
        text: finalResponse.content,
        replyToMessageId: telegramMessage.messageId,
        attachments: finalResponse.attachments
      };

      const sentMessage = await this.messageInterface.sendMessage(telegramResponse);

      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'SystemOrchestrator',
        phase: 'response_sent',
        message: 'Response sent successfully',
        metadata: {
          requestId,
          messageId: sentMessage.messageId,
          processingTime: Date.now() - requestContext.startTime.getTime()
        },
        duration: Date.now() - requestContext.startTime.getTime()
      });

      // Emit response generated event
      await this.eventEmitter.emit<ResponseGeneratedEvent>({
        type: SystemEventType.RESPONSE_GENERATED,
        payload: {
          response: finalResponse,
          sentMessage,
          requestId
        }
      });

      // Update metrics
      this.metrics.successfulRequests++;
      this.metrics.activeRequests--;

      // Clean up flow tracker
      this.flowTrackers.delete(requestId);

      return sentMessage.messageId;

    } catch (error) {
      console.error(`[SystemOrchestrator] Error processing update ${requestId}:`, error);

      this.telemetry?.logStructured({
        level: LogLevel.ERROR,
        component: 'SystemOrchestrator',
        phase: 'processing_error',
        message: 'Error occurred during message processing',
        metadata: {
          requestId,
          errorMessage: error.message,
          errorType: error.constructor.name,
          processingTime: Date.now() - requestContext.startTime.getTime()
        },
        error: error as Error,
        duration: Date.now() - requestContext.startTime.getTime()
      });

      // Update metrics
      this.metrics.failedRequests++;
      this.metrics.activeRequests--;
      this.metrics.errorRate = this.metrics.failedRequests / this.metrics.totalRequests;

      // Clean up flow tracker
      this.flowTrackers.delete(requestId);

      // Emit error event
      await this.eventEmitter.emit<ErrorOccurredEvent>({
        type: SystemEventType.ERROR_OCCURRED,
        payload: {
          error: error as Error,
          context: { requestId, chatId: update.message?.chat?.id },
          component: 'SystemOrchestrator'
        }
      });

      throw error;
    }
  }

  /**
   * Update flow stage tracker
   */
  private updateFlowStage(requestId: string, stage: MessageFlowStage): void {
    const tracker = this.flowTrackers.get(requestId);
    if (tracker) {
      tracker.currentStage = stage;
      tracker.stages.push({
        stage,
        timestamp: new Date()
      });

      this.telemetry?.logStructured({
        level: LogLevel.DEBUG,
        component: 'SystemOrchestrator',
        phase: 'flow_stage_updated',
        message: 'Message flow stage updated',
        metadata: {
          requestId,
          stage: MessageFlowStage[stage],
          totalStages: tracker.stages.length,
          elapsedTime: Date.now() - tracker.startTime.getTime()
        }
      });
    }
  }

  /**
   * Subscribe to system events
   */
  private async subscribeToEvents(): Promise<void> {
    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'SystemOrchestrator',
      phase: 'event_subscription_start',
      message: 'Subscribing to system events',
      metadata: {}
    });

    // Subscribe to system-wide events
    eventBus.subscribe(SystemEventType.ERROR_OCCURRED, async (event: ErrorOccurredEvent) => {
      console.error('[SystemOrchestrator] System error occurred:', event.payload.error);

      this.telemetry?.logStructured({
        level: LogLevel.ERROR,
        component: 'SystemOrchestrator',
        phase: 'system_error_received',
        message: 'System error event received',
        metadata: {
          errorComponent: event.payload.component,
          errorMessage: event.payload.error.message,
          context: event.payload.context
        },
        error: event.payload.error
      });
    });

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'SystemOrchestrator',
      phase: 'event_subscription_complete',
      message: 'System event subscriptions configured',
      metadata: {}
    });
  }

  /**
   * Get system health status
   */
  getHealthStatus(): SystemHealthStatus {
    const componentStatuses: Record<string, ComponentStatus> = {};

    for (const [name, managed] of this.components.entries()) {
      componentStatuses[name] = {
        name: managed.name,
        status: managed.state === ComponentState.READY ? 'operational' : 'error',
        lastError: undefined, // Could be enhanced to track errors
        restartCount: managed.restartCount
      };
    }

    const healthStatus: SystemHealthStatus = {
      overall: this.isInitialized ? 'operational' : 'error',
      components: componentStatuses,
      uptime: Date.now() - this.startTime.getTime(),
      metrics: this.metrics
    };

    this.telemetry?.logStructured({
      level: LogLevel.DEBUG,
      component: 'SystemOrchestrator',
      phase: 'health_check',
      message: 'System health status checked',
      metadata: {
        overall: healthStatus.overall,
        componentCount: Object.keys(componentStatuses).length,
        uptime: healthStatus.uptime,
        totalRequests: this.metrics.totalRequests,
        errorRate: this.metrics.errorRate
      }
    });

    return healthStatus;
  }

  /**
   * Get system metrics
   */
  getMetrics(): SystemMetrics {
    this.telemetry?.logStructured({
      level: LogLevel.DEBUG,
      component: 'SystemOrchestrator',
      phase: 'metrics_retrieved',
      message: 'System metrics retrieved',
      metadata: {
        totalRequests: this.metrics.totalRequests,
        successfulRequests: this.metrics.successfulRequests,
        failedRequests: this.metrics.failedRequests,
        errorRate: this.metrics.errorRate,
        activeRequests: this.metrics.activeRequests
      }
    });

    return { ...this.metrics };
  }

  /**
   * Shutdown the orchestrator and all managed components
   */
  async shutdown(): Promise<void> {
    console.log('[SystemOrchestrator] Shutting down...');

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'SystemOrchestrator',
      phase: 'shutdown_start',
      message: 'Starting SystemOrchestrator shutdown',
      metadata: {
        componentCount: this.components.size,
        activeRequests: this.metrics.activeRequests,
        uptime: Date.now() - this.startTime.getTime()
      }
    });

    // Stop message queue first
    if (this.messageQueue) {
      try {
        await this.messageQueue.stop();
        console.log('[SystemOrchestrator] Message queue stopped');

        this.telemetry?.logStructured({
          level: LogLevel.INFO,
          component: 'SystemOrchestrator',
          phase: 'message_queue_stopped',
          message: 'Message queue stopped successfully',
          metadata: {}
        });
      } catch (error) {
        console.error('[SystemOrchestrator] Error stopping message queue:', error);

        this.telemetry?.logStructured({
          level: LogLevel.ERROR,
          component: 'SystemOrchestrator',
          phase: 'message_queue_stop_error',
          message: 'Error stopping message queue',
          metadata: {
            errorMessage: error.message
          },
          error: error as Error
        });
      }
    }

    // Shutdown components in reverse order
    const sortedComponents = Array.from(this.components.values())
      .sort((a, b) => b.initOrder - a.initOrder);

    for (const managed of sortedComponents) {
      if (managed.component && typeof managed.component.shutdown === 'function') {
        try {
          console.log(`[SystemOrchestrator] Shutting down component: ${managed.name}`);
          managed.state = ComponentState.STOPPING;
          await managed.component.shutdown();
          managed.state = ComponentState.STOPPED;

          this.telemetry?.logStructured({
            level: LogLevel.INFO,
            component: 'SystemOrchestrator',
            phase: 'component_shutdown_success',
            message: 'Component shutdown successfully',
            metadata: {
              componentName: managed.name,
              initOrder: managed.initOrder
            }
          });

          // Emit component shutdown event
          await this.eventEmitter.emit<ComponentShutdownEvent>({
            type: SystemEventType.COMPONENT_SHUTDOWN,
            payload: {
              componentName: managed.name
            }
          });
        } catch (error) {
          console.error(`[SystemOrchestrator] Error shutting down ${managed.name}:`, error);

          this.telemetry?.logStructured({
            level: LogLevel.ERROR,
            component: 'SystemOrchestrator',
            phase: 'component_shutdown_error',
            message: 'Error shutting down component',
            metadata: {
              componentName: managed.name,
              errorMessage: error.message
            },
            error: error as Error
          });
        }
      }
    }

    this.components.clear();
    this.flowTrackers.clear();
    this.isInitialized = false;
    console.log('[SystemOrchestrator] Shutdown complete');
  }

  async restart(): Promise<void> {
    console.log('[SystemOrchestrator] Restarting...');
    await this.shutdown();
    await this.initialize(this.config);
  }

  /**
   * Determine if state should be reset based on message content
   */
  private shouldResetState(message: TelegramMessage): boolean {
    const content = message.text?.toLowerCase() || '';

    // Reset on explicit commands
    if (content === '/reset' || content === '/clear' || content === '/start') {
      return true;
    }

    // Don't reset for normal messages
    return false;
  }

  /**
   * Determine if an error is critical enough to require state reset
   */
  private isCriticalError(error: unknown): boolean {
    if (error instanceof Error) {
      // Critical errors that could corrupt state
      const criticalPatterns = [
        'state machine',
        'invalid state',
        'corrupted',
        'inconsistent',
        'deadlock'
      ];

      const errorMessage = error.message.toLowerCase();
      return criticalPatterns.some(pattern => errorMessage.includes(pattern));
    }

    return false;
  }
}