/**
 * System Orchestrator Implementation
 *
 * Central orchestration system that wires together all components
 * and manages the message flow through the system
 */

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

import {
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

export class SystemOrchestrator implements ISystemOrchestrator {
  private config!: SystemOrchestratorConfig;
  private components: Map<string, ManagedComponent> = new Map();
  private metrics: SystemMetrics;
  private flowTrackers: Map<string, FlowTracker> = new Map();
  private startTime: Date;
  private isInitialized = false;
  private eventEmitter = createEventEmitter('SystemOrchestrator');

  // Component references - will be injected
  private telegramAdapter!: ITelegramInterfaceAdapter;
  private decisionEngine!: IDecisionEngine;
  private contextManager!: IContextManager;
  private errorHandler!: IErrorHandler;
  private messagePreProcessor!: IMessagePreProcessor;
  private responseGenerator!: IResponseGenerator;
  private mcpToolManager?: IMCPToolManager;
  private selfModerationEngine?: ISelfModerationEngine;

  // Message queue
  private messageQueue?: MessageQueue;

  constructor(private dependencies: ComponentDependencies) {
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

  async initialize(config: SystemOrchestratorConfig): Promise<void> {
    if (this.isInitialized) {
      throw new Error('SystemOrchestrator is already initialized');
    }

    console.log('[SystemOrchestrator] Initializing...');
    this.config = config;

    try {
      // Initialize components from dependencies
      await this.initializeComponents();

      // Subscribe to system events
      await this.subscribeToEvents();

      // Set up component event handlers
      await this.setupComponentHandlers();

      // Initialize message queue if configured
      await this.initializeMessageQueue();

      this.isInitialized = true;

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
      await this.shutdown();
      throw error;
    }
  }

  private async initializeComponents(): Promise<void> {
    console.log('[SystemOrchestrator] Initializing components...');

    // Use injected dependencies
    this.errorHandler = this.dependencies.errorHandler;
    this.contextManager = this.dependencies.contextManager;
    this.messagePreProcessor = this.dependencies.messagePreProcessor;
    this.decisionEngine = this.dependencies.decisionEngine;
    this.responseGenerator = this.dependencies.responseGenerator;
    this.telegramAdapter = this.dependencies.telegramAdapter;
    this.mcpToolManager = this.dependencies.mcpToolManager;
    this.selfModerationEngine = this.dependencies.selfModerationEngine;

    // Register core components that implement IComponent
    const componentsToRegister = [
      { name: 'ErrorHandler', component: this.errorHandler, required: true, order: 1 },
      { name: 'ContextManager', component: this.contextManager, required: true, order: 2 },
      { name: 'MessagePreProcessor', component: this.messagePreProcessor, required: true, order: 3 },
      { name: 'DecisionEngine', component: this.decisionEngine, required: true, order: 4 },
      { name: 'ResponseGenerator', component: this.responseGenerator, required: true, order: 5 },
      { name: 'TelegramAdapter', component: this.telegramAdapter, required: true, order: 6 },
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

      // Emit component initialized event
      await this.eventEmitter.emit<ComponentInitializedEvent>({
        type: SystemEventType.COMPONENT_INITIALIZED,
        payload: {
          componentName: name,
          timestamp: new Date()
        }
      });
    }

    console.log('[SystemOrchestrator] All components initialized');
  }

  private async setupComponentHandlers(): Promise<void> {
    console.log('[SystemOrchestrator] Setting up component handlers...');

    // Subscribe to updates from telegram adapter
    // Note: We'll need to add this method to the ITelegramInterfaceAdapter interface
    if ('subscribe' in this.telegramAdapter) {
      (this.telegramAdapter as any).subscribe(async (update: TelegramUpdate) => {
        await this.handleUpdate(update);
      });
    }

    console.log('[SystemOrchestrator] Component handlers configured');
  }

  /**
   * Initialize the message queue
   */
  private async initializeMessageQueue(): Promise<void> {
    if (!this.config.messageQueue) {
      console.log('[SystemOrchestrator] Message queue not configured, using direct processing');
      return;
    }

    console.log('[SystemOrchestrator] Initializing message queue...');

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
      // The dead letter queue will handle retry logic
    });

    this.messageQueue.on(QueueEventTypeEnum.QUEUE_FULL, (event: QueueEvent) => {
      console.warn('[SystemOrchestrator] Message queue is full:', event.data);
    });

    // Start the queue with our message processor
    await this.messageQueue.start(this.processQueuedMessage.bind(this));

    console.log('[SystemOrchestrator] Message queue initialized and started');
  }

  /**
   * Process a message from the queue
   */
  private async processQueuedMessage(queuedMessage: QueuedMessage): Promise<void> {
    const { update, metadata } = queuedMessage;
    const requestId = queuedMessage.id;

    // Process the update with existing logic
    await this.processUpdate(update, requestId);
  }

  /**
   * Determine message priority based on content and context
   */
  private determineMessagePriority(update: TelegramUpdate): MessagePriority {
    // Check if it's a command
    if (update.message?.text?.startsWith('/')) {
      return MessagePriorityEnum.HIGH;
    }

    // Check for system messages or errors
    if (update.message?.text?.toLowerCase().includes('error') ||
        update.message?.text?.toLowerCase().includes('help')) {
      return MessagePriorityEnum.HIGH;
    }

    // Check for callback queries (button presses)
    if (update.callback_query) {
      return MessagePriorityEnum.HIGH;
    }

    // Default to normal priority
    return MessagePriorityEnum.NORMAL;
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    // If message queue is enabled, enqueue the message
    if (this.messageQueue) {
      try {
        const priority = this.determineMessagePriority(update);
        const messageId = await this.messageQueue.enqueue(update, priority);
        console.log(`[SystemOrchestrator] Message enqueued with ID: ${messageId}, priority: ${MessagePriorityEnum[priority]}`);
      } catch (error) {
        console.error('[SystemOrchestrator] Failed to enqueue message:', error);
        // Fall back to direct processing
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await this.processUpdate(update, requestId);
      }
    } else {
      // Direct processing without queue
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await this.processUpdate(update, requestId);
    }
  }

  /**
   * Process an update (either directly or from the queue)
   */
  private async processUpdate(update: TelegramUpdate, requestId: string): Promise<void> {
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

    try {
      // Stage 1: Receiving message
      if (!update.message || !update.message.text) {
        console.log(`[SystemOrchestrator] Ignoring non-text update ${requestId}`);
        return;
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

      // Stage 4: Message Pre-Processing
      this.updateFlowStage(requestId, MessageFlowStage.PREPROCESSING);

      // Analyze the message using MessagePreProcessor
      const analysis = await this.messagePreProcessor.analyzeMessage(
        messageText,
        conversationContext
      );

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

      const decisionContext: DecisionContext = {
        message: telegramMessage,
        analysis,
        conversationState: conversationContext,
        availableTools: this.mcpToolManager ? await this.mcpToolManager.getAvailableTools() : []
      };

      const decision = await this.decisionEngine.makeDecision(decisionContext);

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
        toolResults = await this.mcpToolManager.executeMultipleTools(decision.toolCalls);

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

      while (!finalResponse && moderationAttempts < maxModerationAttempts) {
        this.updateFlowStage(requestId, MessageFlowStage.RESPONSE_GENERATION);

        const responseContext: ResponseContext = {
          originalMessage: messageText,
          analysis,
          toolResults: toolResults.length > 0 ? toolResults : undefined,
          conversationHistory: conversationContext.messages,
          constraints: {
            maxLength: 4096,
            allowMarkdown: true,
            requireInlineKeyboard: false
          },
          // Add moderation feedback from previous attempt if any
          ...(moderationAttempts > 0 ? {
            moderationFeedback: `Previous response was rejected. Please address these issues: ${requestContext.metadata.lastModerationIssues}`
          } : {})
        };

        const generatedResponse = await this.responseGenerator.generateResponse(responseContext);

        // Emit response generated event
        await this.eventEmitter.emit<ResponseGeneratedEvent>({
          type: SystemEventType.RESPONSE_GENERATED,
          payload: {
            response: generatedResponse,
            originalMessage: messageText,
            requestId
          }
        });

        // Stage 8: Self-moderation (if enabled)
        if (this.selfModerationEngine) {
          this.updateFlowStage(requestId, MessageFlowStage.MODERATION);

          // Emit moderation started event
          await this.eventEmitter.emit<ModerationStartedEvent>({
            type: SystemEventType.MODERATION_STARTED,
            payload: {
              response: generatedResponse,
              requestId
            }
          });

          try {
            const moderationResult: ModerationResult = await this.selfModerationEngine.moderateResponse(
              generatedResponse,
              responseContext
            );

            if (moderationResult.approved) {
              // Response approved
              finalResponse = generatedResponse;

              await this.eventEmitter.emit<ModerationApprovedEvent>({
                type: SystemEventType.MODERATION_APPROVED,
                payload: {
                  response: generatedResponse,
                  confidence: moderationResult.confidence,
                  requestId
                }
              });
            } else if (moderationResult.moderatedResponse) {
              // Response was modified
              finalResponse = moderationResult.moderatedResponse;

              await this.eventEmitter.emit<ModerationModifiedEvent>({
                type: SystemEventType.MODERATION_MODIFIED,
                payload: {
                  originalResponse: generatedResponse,
                  modifiedResponse: moderationResult.moderatedResponse,
                  requestId
                }
              });
            } else {
              // Response rejected, need to retry
              moderationAttempts++;

              // Store moderation issues for feedback
              const issueDescriptions = moderationResult.issues?.map(issue => issue.description).join(', ') || 'Unknown issues';
              requestContext.metadata.lastModerationIssues = issueDescriptions;

              await this.eventEmitter.emit<ModerationRejectedEvent>({
                type: SystemEventType.MODERATION_REJECTED,
                payload: {
                  response: generatedResponse,
                  reasons: moderationResult.issues?.map(issue => ({
                    type: issue.type.toString(),
                    severity: issue.severity,
                    description: issue.description
                  })) || [],
                  requestId
                }
              });

              if (moderationAttempts >= maxModerationAttempts) {
                throw new Error(`Failed to generate acceptable response after ${maxModerationAttempts} attempts`);
              }

              console.log(`[SystemOrchestrator] Response rejected, retrying (attempt ${moderationAttempts + 1}/${maxModerationAttempts})`);
            }

            // Emit moderation complete event
            await this.eventEmitter.emit<ModerationCompleteEvent>({
              type: SystemEventType.MODERATION_COMPLETE,
              payload: {
                originalResponse: generatedResponse,
                moderatedResponse: finalResponse || generatedResponse,
                passed: moderationResult.approved,
                requestId
              }
            });

          } catch (error) {
            console.error('[SystemOrchestrator] Moderation failed:', error);

            await this.eventEmitter.emit<ModerationFailedEvent>({
              type: SystemEventType.MODERATION_FAILED,
              payload: {
                response: generatedResponse,
                error: error as Error,
                requestId
              }
            });

            // Use original response if moderation fails
            finalResponse = generatedResponse;
          }
        } else {
          // No moderation, use generated response
          finalResponse = generatedResponse;
        }
      }

      if (!finalResponse) {
        throw new Error('Failed to generate an acceptable response');
      }

      // Stage 9: Send response
      this.updateFlowStage(requestId, MessageFlowStage.SENDING_RESPONSE);

      // Store response in context
      const responseMessage: InternalMessage = {
        id: `resp_${requestId}`,
        chatId: telegramMessage.chatId,
        userId: 0, // System response
        content: finalResponse.content,
        timestamp: new Date(),
        metadata: {
          source: 'system',
          requestId,
          ...finalResponse.metadata
        }
      };
      await this.contextManager.addMessage(responseMessage);

      // Send response through Telegram adapter
      const telegramResponse: TelegramResponse = {
        chatId: telegramMessage.chatId,
        text: finalResponse.content,
        parseMode: 'Markdown'
      };

      await this.telegramAdapter.sendResponse(telegramResponse);

      // Update metrics
      this.updateFlowStage(requestId, MessageFlowStage.COMPLETED);
      requestContext.endTime = new Date();
      this.updateMetrics(requestContext);
      this.metrics.successfulRequests++;

      console.log(`[SystemOrchestrator] Completed processing update ${requestId}`);

    } catch (error) {
      console.error(`[SystemOrchestrator] Error processing update:`, error);

      // Emit error event
      await this.eventEmitter.emit<ErrorOccurredEvent>({
        type: SystemEventType.ERROR_OCCURRED,
        payload: {
          error: error as Error,
          context: {
            operation: 'handleUpdate',
            component: 'SystemOrchestrator',
            chatId: requestContext.update.message?.chat?.id,
            metadata: { requestId }
          },
          requestId
        }
      });

      this.updateFlowStage(requestId, MessageFlowStage.ERROR);
      this.metrics.failedRequests++;

      // Try to send error response to user
      if (requestContext.update.message?.chat?.id) {
        try {
          const errorResponse: TelegramResponse = {
            chatId: requestContext.update.message.chat.id,
            text: this.errorHandler.getUserFriendlyMessage(error as Error)
          };
          await this.telegramAdapter.sendResponse(errorResponse);
        } catch (sendError) {
          console.error('[SystemOrchestrator] Failed to send error response:', sendError);
        }
      }
    } finally {
      this.metrics.activeRequests--;
      this.flowTrackers.delete(requestId);
    }
  }

  /**
   * Subscribe to system events
   */
  private async subscribeToEvents(): Promise<void> {
    console.log('[SystemOrchestrator] Subscribing to system events');

    // Subscribe to error events from all components
    eventBus.on(SystemEventType.ERROR_OCCURRED, async (event: ErrorOccurredEvent) => {
      console.error(`[SystemOrchestrator] Error event from ${event.source}:`, event.payload.error);

      // Handle critical errors
      if (event.payload.context.component && this.components.has(event.payload.context.component)) {
        const component = this.components.get(event.payload.context.component)!;
        component.state = ComponentState.ERROR;
        component.lastError = event.payload.error;

        // Attempt to restart critical components
        if (component.required && component.restartCount < 3) {
          console.log(`[SystemOrchestrator] Attempting to restart ${component.name}`);
          setTimeout(() => {
            this.restartComponent(component.name).catch(err =>
              console.error(`[SystemOrchestrator] Failed to restart ${component.name}:`, err)
            );
          }, 5000);
        }
      }
    });

    // Subscribe to component lifecycle events
    eventBus.on(SystemEventType.COMPONENT_INITIALIZED, async (event: ComponentInitializedEvent) => {
      console.log(`[SystemOrchestrator] Component initialized: ${event.payload.componentName}`);
    });

    eventBus.on(SystemEventType.COMPONENT_SHUTDOWN, async (event: ComponentShutdownEvent) => {
      console.log(`[SystemOrchestrator] Component shutdown: ${event.payload.componentName}`);
    });

    eventBus.on(SystemEventType.COMPONENT_ERROR, async (event: ComponentErrorEvent) => {
      console.error(`[SystemOrchestrator] Component error in ${event.payload.componentName}:`, event.payload.error);
    });
  }

  private updateFlowStage(requestId: string, stage: MessageFlowStage): void {
    const tracker = this.flowTrackers.get(requestId);
    if (!tracker) return;

    const now = new Date();
    if (tracker.stages.length > 0) {
      const lastStage = tracker.stages[tracker.stages.length - 1];
      lastStage.duration = now.getTime() - lastStage.timestamp.getTime();
    }

    tracker.currentStage = stage;
    tracker.stages.push({
      stage,
      timestamp: now
    });
  }

  private updateMetrics(context: RequestContext): void {
    const duration = Date.now() - context.startTime.getTime();
    const currentAvg = this.metrics.averageResponseTime;
    const totalRequests = this.metrics.successfulRequests + this.metrics.failedRequests;

    this.metrics.averageResponseTime = (currentAvg * (totalRequests - 1) + duration) / totalRequests;
    this.metrics.errorRate = this.metrics.failedRequests / this.metrics.totalRequests;
  }

  async getHealthStatus(): Promise<SystemHealthStatus> {
    const componentStatuses = await this.checkComponentHealth();

    let overall: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    let unhealthyCount = 0;
    let degradedCount = 0;

    componentStatuses.forEach((status) => {
      if (status.status === 'unhealthy') unhealthyCount++;
      if (status.status === 'degraded') degradedCount++;
    });

    if (unhealthyCount > 0) {
      overall = 'unhealthy';
    } else if (degradedCount > 0) {
      overall = 'degraded';
    }

    const uptime = Date.now() - this.startTime.getTime();

    // Include message queue stats if queue is enabled
    const metrics = { ...this.metrics };
    if (this.messageQueue) {
      const queueStats = this.messageQueue.getStats();
      metrics.queueStats = {
        totalMessages: queueStats.totalMessages,
        queueDepth: queueStats.queueDepth,
        processingRate: queueStats.processingRate,
        averageWaitTime: queueStats.averageWaitTime,
        activeWorkers: queueStats.activeWorkers,
        messagesByPriority: Object.fromEntries(
          Object.entries(queueStats.messagesByPriority).map(([key, value]) => [
            MessagePriorityEnum[parseInt(key)] || key,
            value
          ])
        )
      };
    }

    return {
      overall,
      components: componentStatuses,
      lastHealthCheck: new Date(),
      uptime,
      metrics
    };
  }

  async checkComponentHealth(): Promise<Map<string, ComponentStatus>> {
    const statuses = new Map<string, ComponentStatus>();

    for (const [name, managed] of this.components) {
      if (managed.state === ComponentState.READY && managed.component.getStatus) {
        try {
          const status = managed.component.getStatus();
          statuses.set(name, status);
        } catch (error) {
          statuses.set(name, {
            name,
            status: 'unhealthy',
            lastHealthCheck: new Date(),
            metadata: { error: (error as Error).message }
          });
        }
      } else {
        statuses.set(name, {
          name,
          status: managed.state === ComponentState.READY ? 'healthy' : 'unhealthy',
          lastHealthCheck: new Date(),
          metadata: { state: managed.state }
        });
      }
    }

    return statuses;
  }

  getComponent<T>(componentName: string): T | undefined {
    const managed = this.components.get(componentName);
    return managed?.component as T;
  }

  async restartComponent(componentName: string): Promise<void> {
    const managed = this.components.get(componentName);
    if (!managed) {
      throw new Error(`Component ${componentName} not found`);
    }

    console.log(`[SystemOrchestrator] Restarting component: ${componentName}`);

    // Shutdown component
    if (managed.component.shutdown) {
      managed.state = ComponentState.STOPPING;
      await managed.component.shutdown();
      managed.state = ComponentState.STOPPED;
    }

    // Reinitialize component
    managed.state = ComponentState.INITIALIZING;
    managed.restartCount++;

    try {
      await managed.component.initialize();
      managed.state = ComponentState.READY;
      managed.lastError = undefined;
      console.log(`[SystemOrchestrator] Component ${componentName} restarted successfully`);
    } catch (error) {
      managed.state = ComponentState.ERROR;
      managed.lastError = error as Error;
      throw error;
    }
  }

  getMetrics(): SystemMetrics {
    return { ...this.metrics };
  }

  resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      activeRequests: this.metrics.activeRequests, // Keep active requests
      errorRate: 0
    };
  }

  async shutdown(): Promise<void> {
    console.log('[SystemOrchestrator] Shutting down...');

    // Emit system shutdown event
    await this.eventEmitter.emit<SystemShutdownEvent>({
      type: SystemEventType.SYSTEM_SHUTDOWN,
      payload: {
        reason: 'System shutdown requested'
      }
    });

    // Stop message queue if running
    if (this.messageQueue) {
      console.log('[SystemOrchestrator] Stopping message queue...');
      await this.messageQueue.stop();
    }

    // Shutdown components in reverse order
    const sortedComponents = Array.from(this.components.values())
      .sort((a, b) => b.initOrder - a.initOrder);

    for (const managed of sortedComponents) {
      if (managed.state === ComponentState.READY && managed.component.shutdown) {
        try {
          console.log(`[SystemOrchestrator] Shutting down component: ${managed.name}`);
          managed.state = ComponentState.STOPPING;
          await managed.component.shutdown();
          managed.state = ComponentState.STOPPED;

          // Emit component shutdown event
          await this.eventEmitter.emit<ComponentShutdownEvent>({
            type: SystemEventType.COMPONENT_SHUTDOWN,
            payload: {
              componentName: managed.name
            }
          });
        } catch (error) {
          console.error(`[SystemOrchestrator] Error shutting down ${managed.name}:`, error);
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
}