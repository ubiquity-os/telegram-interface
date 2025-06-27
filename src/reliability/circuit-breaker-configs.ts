/**
 * Circuit Breaker Configuration Presets
 *
 * Pre-configured circuit breaker settings for different service types
 * based on their characteristics and expected behavior.
 */

import { CircuitBreakerConfig } from './circuit-breaker.ts';

/**
 * Configuration for LLM services (OpenRouter, etc.)
 * - Higher thresholds due to expected variability in response times
 * - Longer reset timeout to account for API rate limits
 * - More tolerant of slow calls due to complex processing
 */
export const LLM_SERVICE_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,              // 5 failures before opening
  resetTimeout: 60000,              // 1 minute before trying half-open
  monitoringPeriod: 60000,          // 1 minute window for counting failures
  minimumRequests: 10,              // Need at least 10 calls before opening
  slowCallThreshold: 5000,          // 5 seconds considered slow for LLM
  slowCallRateThreshold: 0.5        // 50% slow calls trigger opening
};

/**
 * Configuration for Telegram API calls
 * - Lower thresholds due to expected reliability
 * - Shorter reset timeout for faster recovery
 * - Less tolerant of slow calls due to user experience impact
 */
export const TELEGRAM_API_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,              // 3 failures before opening
  resetTimeout: 30000,              // 30 seconds before trying half-open
  monitoringPeriod: 30000,          // 30 second window for counting failures
  minimumRequests: 5,               // Need at least 5 calls before opening
  slowCallThreshold: 2000,          // 2 seconds considered slow for Telegram
  slowCallRateThreshold: 0.3        // 30% slow calls trigger opening
};

/**
 * Configuration for MCP tool execution
 * - Medium thresholds due to varied tool complexity
 * - Moderate reset timeout accounting for tool initialization
 * - Balanced slow call tolerance for different tool types
 */
export const MCP_TOOLS_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 4,              // 4 failures before opening
  resetTimeout: 45000,              // 45 seconds before trying half-open
  monitoringPeriod: 45000,          // 45 second window for counting failures
  minimumRequests: 8,               // Need at least 8 calls before opening
  slowCallThreshold: 10000,         // 10 seconds considered slow for tools
  slowCallRateThreshold: 0.4        // 40% slow calls trigger opening
};

/**
 * Configuration for database operations (Deno KV)
 * - Very low thresholds due to expected high reliability
 * - Short reset timeout for quick recovery
 * - Low tolerance for slow calls due to performance impact
 */
export const DATABASE_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 2,              // 2 failures before opening
  resetTimeout: 15000,              // 15 seconds before trying half-open
  monitoringPeriod: 30000,          // 30 second window for counting failures
  minimumRequests: 5,               // Need at least 5 calls before opening
  slowCallThreshold: 1000,          // 1 second considered slow for DB
  slowCallRateThreshold: 0.2        // 20% slow calls trigger opening
};

/**
 * Configuration for external HTTP APIs (general)
 * - Balanced settings for typical web service characteristics
 * - Standard timeouts and thresholds
 * - Moderate tolerance for variability
 */
export const HTTP_API_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,              // 3 failures before opening
  resetTimeout: 30000,              // 30 seconds before trying half-open
  monitoringPeriod: 30000,          // 30 second window for counting failures
  minimumRequests: 6,               // Need at least 6 calls before opening
  slowCallThreshold: 3000,          // 3 seconds considered slow for HTTP
  slowCallRateThreshold: 0.35       // 35% slow calls trigger opening
};

/**
 * Get configuration by service type
 */
export function getCircuitBreakerConfig(serviceType: string): CircuitBreakerConfig {
  switch (serviceType.toLowerCase()) {
    case 'llm':
    case 'llm-service':
    case 'openrouter':
      return LLM_SERVICE_CONFIG;

    case 'telegram':
    case 'telegram-api':
      return TELEGRAM_API_CONFIG;

    case 'mcp':
    case 'mcp-tools':
    case 'tools':
      return MCP_TOOLS_CONFIG;

    case 'database':
    case 'db':
    case 'kv':
    case 'deno-kv':
      return DATABASE_CONFIG;

    case 'http':
    case 'api':
    case 'http-api':
      return HTTP_API_CONFIG;

    default:
      console.warn(`[CircuitBreakerConfig] Unknown service type: ${serviceType}, using HTTP_API_CONFIG as default`);
      return HTTP_API_CONFIG;
  }
}

/**
 * Create a custom configuration with overrides
 */
export function createCustomConfig(
  baseServiceType: string,
  overrides: Partial<CircuitBreakerConfig>
): CircuitBreakerConfig {
  const baseConfig = getCircuitBreakerConfig(baseServiceType);
  return { ...baseConfig, ...overrides };
}