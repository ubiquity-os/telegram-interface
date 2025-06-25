/**
 * Example usage of the Event Bus system for monitoring and extending the Telegram bot
 */

import { eventBus, SystemEventType } from '../services/event-bus/index.ts';
import { SystemEvent } from '../services/event-bus/types.ts';

/**
 * Example 1: Monitoring specific events
 */
export function setupSystemMonitoring() {
  // Subscribe to component initialization
  eventBus.on(SystemEventType.COMPONENT_INITIALIZED, async (event) => {
    if (event.type === SystemEventType.COMPONENT_INITIALIZED) {
      console.log(`[EVENT] Component initialized: ${event.payload.componentName}`, {
        timestamp: event.payload.timestamp.toISOString()
      });
    }
  });

  // Subscribe to errors
  eventBus.on(SystemEventType.COMPONENT_ERROR, async (event) => {
    if (event.type === SystemEventType.COMPONENT_ERROR) {
      console.error(`[EVENT] Component error in ${event.payload.componentName}:`,
        event.payload.error.message
      );
    }
  });

  // Subscribe to message events
  eventBus.on(SystemEventType.MESSAGE_RECEIVED, async (event) => {
    if (event.type === SystemEventType.MESSAGE_RECEIVED) {
      console.log(`[EVENT] Message received:`, {
        requestId: event.payload.requestId,
        chatId: event.payload.message.chatId,
        userId: event.payload.message.userId
      });
    }
  });

  console.log('System monitoring enabled for key events');
}

/**
 * Example 2: Performance monitoring
 */
export function setupPerformanceMonitoring() {
  const performanceMetrics = new Map<string, { start: number; stage: string }>();

  // Track message processing start
  eventBus.on(SystemEventType.MESSAGE_RECEIVED, async (event) => {
    if (event.type === SystemEventType.MESSAGE_RECEIVED) {
      performanceMetrics.set(event.payload.requestId, {
        start: Date.now(),
        stage: 'received'
      });
    }
  });

  // Track analysis completion
  eventBus.on(SystemEventType.MESSAGE_ANALYZED, async (event) => {
    if (event.type === SystemEventType.MESSAGE_ANALYZED) {
      const metric = performanceMetrics.get(event.payload.requestId);
      if (metric) {
        const duration = Date.now() - metric.start;
        console.log(`[PERFORMANCE] Analysis took ${duration}ms for request ${event.payload.requestId}`);
        metric.stage = 'analyzed';
      }
    }
  });

  // Track decision making
  eventBus.on(SystemEventType.DECISION_MADE, async (event) => {
    if (event.type === SystemEventType.DECISION_MADE) {
      const metric = performanceMetrics.get(event.payload.requestId);
      if (metric) {
        const duration = Date.now() - metric.start;
        console.log(`[PERFORMANCE] Decision made in ${duration}ms for request ${event.payload.requestId}`);
        metric.stage = 'decided';
      }
    }
  });

  // Track response generation
  eventBus.on(SystemEventType.RESPONSE_GENERATED, async (event) => {
    if (event.type === SystemEventType.RESPONSE_GENERATED) {
      const metric = performanceMetrics.get(event.payload.requestId);
      if (metric) {
        const duration = Date.now() - metric.start;
        console.log(`[PERFORMANCE] Total processing time: ${duration}ms for request ${event.payload.requestId}`);
        performanceMetrics.delete(event.payload.requestId);
      }
    }
  });

  console.log('Performance monitoring enabled');
}

/**
 * Example 3: Error alerting
 */
export function setupErrorAlerting(alertWebhookUrl?: string) {
  eventBus.on(SystemEventType.COMPONENT_ERROR, async (event) => {
    if (event.type === SystemEventType.COMPONENT_ERROR) {
      const { componentName, error } = event.payload;

      console.error(`[ALERT] Component error in ${componentName}:`, error.message);

      // Send alert to external service
      if (alertWebhookUrl) {
        try {
          await fetch(alertWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'component_error',
              component: componentName,
              error: error.message,
              stack: error.stack,
              timestamp: new Date().toISOString(),
              metadata: event.metadata
            })
          });
        } catch (err) {
          console.error('Failed to send alert:', err);
        }
      }
    }
  });

  console.log('Error alerting enabled');
}

/**
 * Example 4: Custom analytics
 */
export function setupAnalytics() {
  const analytics = {
    messagesReceived: 0,
    decisionsMode: new Map<string, number>(),
    componentsInitialized: new Set<string>(),
    errors: 0,
    errorsByComponent: new Map<string, number>()
  };

  // Track messages
  eventBus.on(SystemEventType.MESSAGE_RECEIVED, async () => {
    analytics.messagesReceived++;
  });

  // Track decisions
  eventBus.on(SystemEventType.DECISION_MADE, async (event) => {
    if (event.type === SystemEventType.DECISION_MADE) {
      const action = event.payload.decision.action;
      analytics.decisionsMode.set(action, (analytics.decisionsMode.get(action) || 0) + 1);
    }
  });

  // Track component initialization
  eventBus.on(SystemEventType.COMPONENT_INITIALIZED, async (event) => {
    if (event.type === SystemEventType.COMPONENT_INITIALIZED) {
      analytics.componentsInitialized.add(event.payload.componentName);
    }
  });

  // Track errors
  eventBus.on(SystemEventType.COMPONENT_ERROR, async (event) => {
    if (event.type === SystemEventType.COMPONENT_ERROR) {
      analytics.errors++;
      const component = event.payload.componentName;
      analytics.errorsByComponent.set(component, (analytics.errorsByComponent.get(component) || 0) + 1);
    }
  });

  // Periodic reporting
  setInterval(() => {
    console.log('[ANALYTICS REPORT]', {
      messagesReceived: analytics.messagesReceived,
      decisionsByType: Object.fromEntries(analytics.decisionsMode),
      componentsInitialized: Array.from(analytics.componentsInitialized),
      totalErrors: analytics.errors,
      errorsByComponent: Object.fromEntries(analytics.errorsByComponent)
    });
  }, 60000); // Report every minute

  console.log('Analytics tracking enabled');
}

/**
 * Example 5: Component health monitoring
 */
export function setupHealthMonitoring() {
  const componentHealth = new Map<string, {
    initialized: boolean;
    lastActivity: Date;
    errors: number;
  }>();

  // Track component initialization
  eventBus.on(SystemEventType.COMPONENT_INITIALIZED, async (event) => {
    if (event.type === SystemEventType.COMPONENT_INITIALIZED) {
      componentHealth.set(event.payload.componentName, {
        initialized: true,
        lastActivity: new Date(),
        errors: 0
      });
      console.log(`[HEALTH] Component ${event.payload.componentName} initialized`);
    }
  });

  // Track component errors
  eventBus.on(SystemEventType.COMPONENT_ERROR, async (event) => {
    if (event.type === SystemEventType.COMPONENT_ERROR) {
      const health = componentHealth.get(event.payload.componentName);
      if (health) {
        health.errors++;
        health.lastActivity = new Date();
      } else {
        componentHealth.set(event.payload.componentName, {
          initialized: false,
          lastActivity: new Date(),
          errors: 1
        });
      }
    }
  });

  // Track activity through various events
  const updateActivity = (componentName: string) => {
    const health = componentHealth.get(componentName);
    if (health) {
      health.lastActivity = new Date();
    }
  };

  eventBus.on(SystemEventType.MESSAGE_ANALYZED, async (event) => {
    if (event.type === SystemEventType.MESSAGE_ANALYZED) {
      updateActivity('MessagePreProcessor');
    }
  });

  eventBus.on(SystemEventType.DECISION_MADE, async (event) => {
    if (event.type === SystemEventType.DECISION_MADE) {
      updateActivity('DecisionEngine');
    }
  });

  eventBus.on(SystemEventType.RESPONSE_GENERATED, async (event) => {
    if (event.type === SystemEventType.RESPONSE_GENERATED) {
      updateActivity('ResponseGenerator');
    }
  });

  // Health check endpoint
  return {
    getHealth: () => {
      const report: Record<string, any> = {};
      const now = new Date();

      for (const [name, health] of componentHealth) {
        const timeSinceLastActivity = now.getTime() - health.lastActivity.getTime();
        const isStale = timeSinceLastActivity > 300000; // 5 minutes

        report[name] = {
          status: health.errors > 5 || isStale ? 'unhealthy' : 'healthy',
          initialized: health.initialized,
          lastActivity: health.lastActivity.toISOString(),
          timeSinceLastActivity: `${Math.floor(timeSinceLastActivity / 1000)}s`,
          errorCount: health.errors
        };
      }
      return report;
    }
  };
}

/**
 * Example 6: Message flow tracing
 */
export function setupMessageTracing() {
  const messageTrace = new Map<string, Array<{
    event: SystemEventType;
    timestamp: Date;
    details?: any;
  }>>();

  // Track message received
  eventBus.on(SystemEventType.MESSAGE_RECEIVED, async (event) => {
    if (event.type === SystemEventType.MESSAGE_RECEIVED) {
      const requestId = event.payload.requestId;
      messageTrace.set(requestId, [{
        event: SystemEventType.MESSAGE_RECEIVED,
        timestamp: new Date(),
        details: {
          chatId: event.payload.message.chatId,
          userId: event.payload.message.userId
        }
      }]);
    }
  });

  // Track message analyzed
  eventBus.on(SystemEventType.MESSAGE_ANALYZED, async (event) => {
    if (event.type === SystemEventType.MESSAGE_ANALYZED) {
      const trace = messageTrace.get(event.payload.requestId);
      if (trace) {
        trace.push({
          event: SystemEventType.MESSAGE_ANALYZED,
          timestamp: new Date(),
          details: {
            intent: event.payload.analysis.intent,
            confidence: event.payload.analysis.confidence
          }
        });
      }
    }
  });

  // Track decision made
  eventBus.on(SystemEventType.DECISION_MADE, async (event) => {
    if (event.type === SystemEventType.DECISION_MADE) {
      const trace = messageTrace.get(event.payload.requestId);
      if (trace) {
        trace.push({
          event: SystemEventType.DECISION_MADE,
          timestamp: new Date(),
          details: {
            action: event.payload.decision.action
          }
        });
      }
    }
  });

  // Track response generated
  eventBus.on(SystemEventType.RESPONSE_GENERATED, async (event) => {
    if (event.type === SystemEventType.RESPONSE_GENERATED) {
      const trace = messageTrace.get(event.payload.requestId);
      if (trace) {
        trace.push({
          event: SystemEventType.RESPONSE_GENERATED,
          timestamp: new Date()
        });

        // Log complete trace
        const firstEvent = trace[0];
        const totalDuration = new Date().getTime() - firstEvent.timestamp.getTime();

        console.log(`[TRACE] Message ${event.payload.requestId} flow (${totalDuration}ms):`);
        trace.forEach((t, index) => {
          const duration = index > 0 ?
            t.timestamp.getTime() - trace[index - 1].timestamp.getTime() : 0;
          console.log(`  - ${t.event} (+${duration}ms)`, t.details || '');
        });

        // Clean up old traces
        messageTrace.delete(event.payload.requestId);
      }
    }
  });

  console.log('Message flow tracing enabled');
}

/**
 * Example 7: Custom event filtering
 */
export function setupFilteredMonitoring() {
  // Monitor only specific components
  const componentsToMonitor = ['DecisionEngine', 'MessagePreProcessor'];

  eventBus.on(SystemEventType.COMPONENT_ERROR, async (event) => {
    if (event.type === SystemEventType.COMPONENT_ERROR &&
        componentsToMonitor.includes(event.payload.componentName)) {
      console.log(`[FILTERED] Error in monitored component ${event.payload.componentName}:`,
        event.payload.error.message);
    }
  });

  // Monitor high-confidence decisions only
  eventBus.on(SystemEventType.DECISION_MADE, async (event) => {
    if (event.type === SystemEventType.DECISION_MADE) {
      // Access confidence from metadata if available
      const confidence = event.metadata?.confidence as number;
      if (confidence && confidence > 0.8) {
        console.log(`[FILTERED] High confidence decision:`, {
          action: event.payload.decision.action,
          confidence,
          requestId: event.payload.requestId
        });
      }
    }
  });

  console.log('Filtered monitoring enabled');
}

/**
 * Main function to demonstrate all examples
 */
export async function runExamples() {
  console.log('Setting up Event Bus monitoring examples...\n');

  // Enable different monitoring features
  setupSystemMonitoring();
  setupPerformanceMonitoring();
  setupErrorAlerting(); // Pass webhook URL for external alerts
  setupAnalytics();
  const healthMonitor = setupHealthMonitoring();
  setupMessageTracing();
  setupFilteredMonitoring();

  console.log('\nAll monitoring features enabled!');
  console.log('The system will now track and report on various events.');

  // Example: Check health after some time
  setTimeout(() => {
    console.log('\n[HEALTH CHECK]', healthMonitor.getHealth());
  }, 5000);
}

// Run examples if this file is executed directly
if (import.meta.main) {
  runExamples();
}