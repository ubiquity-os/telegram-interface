/**
 * Rate Limiting Middleware - Phase 3.1
 *
 * Implements sliding window rate limiting per user/channel
 */

import { Middleware, MiddlewareResult, IncomingRequest, RateLimitConfig } from '../api-gateway.ts';

/**
 * Rate limit storage entry
 */
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * Rate limiting middleware implementation
 */
export class RateLimitMiddleware implements Middleware {
  name = 'RateLimit';
  order = 1; // First in pipeline
  enabled = true;

  private configs: Record<string, RateLimitConfig>;
  private store: Map<string, RateLimitEntry>;

  constructor(configs: Record<string, RateLimitConfig>, store: Map<string, RateLimitEntry>) {
    this.configs = configs;
    this.store = store;
  }

  /**
   * Execute rate limiting check
   */
  async execute(request: IncomingRequest): Promise<MiddlewareResult> {
    const config = this.configs[request.source];

    // Skip if rate limiting is disabled for this source
    if (!config || !config.enabled) {
      return { success: true };
    }

    const key = config.keyGenerator(request);
    const now = Date.now();

    // Get or create rate limit entry
    let entry = this.store.get(key);

    if (!entry || now > entry.resetTime) {
      // Create new window
      entry = {
        count: 1,
        resetTime: now + config.windowMs
      };
      this.store.set(key, entry);
      return { success: true };
    }

    // Check if limit exceeded
    if (entry.count >= config.maxRequests) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);

      return {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
          statusCode: 429
        },
        metadata: {
          limit: config.maxRequests,
          windowMs: config.windowMs,
          retryAfter,
          key
        }
      };
    }

    // Increment counter
    entry.count++;
    this.store.set(key, entry);

    return {
      success: true,
      metadata: {
        remainingRequests: config.maxRequests - entry.count,
        resetTime: entry.resetTime
      }
    };
  }

  /**
   * Update configuration for a specific interface
   */
  updateConfig(interfaceName: string, config: RateLimitConfig): void {
    this.configs[interfaceName] = config;
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetTime) {
        this.store.delete(key);
      }
    }
  }

  /**
   * Get current rate limit status for a key
   */
  getStatus(source: string, request: IncomingRequest): {
    allowed: boolean;
    limit: number;
    remaining: number;
    resetTime: number;
  } {
    const config = this.configs[source];
    if (!config || !config.enabled) {
      return {
        allowed: true,
        limit: 0,
        remaining: 0,
        resetTime: 0
      };
    }

    const key = config.keyGenerator(request);
    const entry = this.store.get(key);
    const now = Date.now();

    if (!entry || now > entry.resetTime) {
      return {
        allowed: true,
        limit: config.maxRequests,
        remaining: config.maxRequests - 1,
        resetTime: now + config.windowMs
      };
    }

    return {
      allowed: entry.count < config.maxRequests,
      limit: config.maxRequests,
      remaining: Math.max(0, config.maxRequests - entry.count),
      resetTime: entry.resetTime
    };
  }
}