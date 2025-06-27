/**
 * Circuit Breaker Monitor
 *
 * Provides basic monitoring and logging for circuit breaker states
 * across all services in the system.
 */

import { CircuitBreakerStatus } from './circuit-breaker.ts';

export interface CircuitBreakerMonitoringData {
  serviceName: string;
  status: CircuitBreakerStatus;
  timestamp: Date;
}

export interface ServiceCircuitBreakerProvider {
  getServiceName(): string;
  getCircuitBreakerStatus(): CircuitBreakerStatus;
}

export class CircuitBreakerMonitor {
  private registeredServices = new Map<string, ServiceCircuitBreakerProvider>();
  private stateChangeHistory: CircuitBreakerMonitoringData[] = [];
  private readonly maxHistorySize = 1000;

  constructor() {
    console.log('[CircuitBreakerMonitor] Initialized');
  }

  /**
   * Register a service for monitoring
   */
  registerService(service: ServiceCircuitBreakerProvider): void {
    const serviceName = service.getServiceName();
    this.registeredServices.set(serviceName, service);
    console.log(`[CircuitBreakerMonitor] Registered service: ${serviceName}`);
  }

  /**
   * Unregister a service from monitoring
   */
  unregisterService(serviceName: string): void {
    this.registeredServices.delete(serviceName);
    console.log(`[CircuitBreakerMonitor] Unregistered service: ${serviceName}`);
  }

  /**
   * Get current status of all circuit breakers
   */
  getAllCircuitBreakerStatuses(): CircuitBreakerMonitoringData[] {
    const statuses: CircuitBreakerMonitoringData[] = [];

    for (const [serviceName, service] of this.registeredServices) {
      try {
        const status = service.getCircuitBreakerStatus();
        statuses.push({
          serviceName,
          status,
          timestamp: new Date()
        });
      } catch (error) {
        console.error(`[CircuitBreakerMonitor] Failed to get status for ${serviceName}:`, error);
      }
    }

    return statuses;
  }

  /**
   * Get status for a specific service
   */
  getServiceStatus(serviceName: string): CircuitBreakerMonitoringData | null {
    const service = this.registeredServices.get(serviceName);
    if (!service) {
      return null;
    }

    try {
      const status = service.getCircuitBreakerStatus();
      return {
        serviceName,
        status,
        timestamp: new Date()
      };
    } catch (error) {
      console.error(`[CircuitBreakerMonitor] Failed to get status for ${serviceName}:`, error);
      return null;
    }
  }

  /**
   * Check for state changes and log them
   */
  performHealthCheck(): CircuitBreakerMonitoringData[] {
    const currentStatuses = this.getAllCircuitBreakerStatuses();

    // Log state changes
    for (const currentStatus of currentStatuses) {
      const lastStatus = this.getLastStatusForService(currentStatus.serviceName);

      if (!lastStatus || lastStatus.status.state !== currentStatus.status.state) {
        console.log(`[CircuitBreakerMonitor] State change detected for ${currentStatus.serviceName}: ${lastStatus?.status.state || 'unknown'} -> ${currentStatus.status.state}`);
        this.logStateChange(currentStatus);
      }
    }

    return currentStatuses;
  }

  /**
   * Get monitoring summary
   */
  getMonitoringSummary(): {
    totalServices: number;
    openCircuits: number;
    halfOpenCircuits: number;
    closedCircuits: number;
    services: CircuitBreakerMonitoringData[];
  } {
    const statuses = this.getAllCircuitBreakerStatuses();

    return {
      totalServices: statuses.length,
      openCircuits: statuses.filter(s => s.status.state === 'open').length,
      halfOpenCircuits: statuses.filter(s => s.status.state === 'half-open').length,
      closedCircuits: statuses.filter(s => s.status.state === 'closed').length,
      services: statuses
    };
  }

  /**
   * Get state change history
   */
  getStateChangeHistory(serviceName?: string): CircuitBreakerMonitoringData[] {
    if (serviceName) {
      return this.stateChangeHistory.filter(entry => entry.serviceName === serviceName);
    }
    return [...this.stateChangeHistory];
  }

  /**
   * Reset circuit breaker for a specific service
   */
  resetServiceCircuitBreaker(serviceName: string): boolean {
    const service = this.registeredServices.get(serviceName);
    if (!service) {
      console.error(`[CircuitBreakerMonitor] Service not found: ${serviceName}`);
      return false;
    }

    try {
      // Check if service has a reset method
      if ('resetCircuitBreaker' in service && typeof service.resetCircuitBreaker === 'function') {
        (service as any).resetCircuitBreaker();
        console.log(`[CircuitBreakerMonitor] Reset circuit breaker for ${serviceName}`);
        return true;
      } else {
        console.warn(`[CircuitBreakerMonitor] Service ${serviceName} does not support circuit breaker reset`);
        return false;
      }
    } catch (error) {
      console.error(`[CircuitBreakerMonitor] Failed to reset circuit breaker for ${serviceName}:`, error);
      return false;
    }
  }

  /**
   * Generate health report
   */
  generateHealthReport(): string {
    const summary = this.getMonitoringSummary();
    const lines: string[] = [];

    lines.push('=== Circuit Breaker Health Report ===');
    lines.push(`Total Services: ${summary.totalServices}`);
    lines.push(`Open Circuits: ${summary.openCircuits}`);
    lines.push(`Half-Open Circuits: ${summary.halfOpenCircuits}`);
    lines.push(`Closed Circuits: ${summary.closedCircuits}`);
    lines.push('');

    if (summary.services.length > 0) {
      lines.push('Service Details:');
      for (const service of summary.services) {
        const metrics = service.status.metrics;
        lines.push(`  ${service.serviceName}:`);
        lines.push(`    State: ${service.status.state}`);
        lines.push(`    Failure Rate: ${(service.status.failureRate * 100).toFixed(1)}%`);
        lines.push(`    Slow Call Rate: ${(service.status.slowCallRate * 100).toFixed(1)}%`);
        lines.push(`    Total Calls: ${metrics.totalCalls}`);
        lines.push(`    Failed Calls: ${metrics.failedCalls}`);
        lines.push(`    Last Check: ${service.timestamp.toISOString()}`);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  private getLastStatusForService(serviceName: string): CircuitBreakerMonitoringData | null {
    for (let i = this.stateChangeHistory.length - 1; i >= 0; i--) {
      if (this.stateChangeHistory[i].serviceName === serviceName) {
        return this.stateChangeHistory[i];
      }
    }
    return null;
  }

  private logStateChange(status: CircuitBreakerMonitoringData): void {
    this.stateChangeHistory.push(status);

    // Maintain history size limit
    if (this.stateChangeHistory.length > this.maxHistorySize) {
      this.stateChangeHistory.splice(0, this.stateChangeHistory.length - this.maxHistorySize);
    }
  }
}

// Export a singleton instance
export const circuitBreakerMonitor = new CircuitBreakerMonitor();