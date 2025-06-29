/**
 * Cached Context Manager implementation
 * Extends the base ContextManager with LRU caching capabilities
 */

import { injectable, inject } from 'inversify';
import { TYPES } from '../../core/types.ts';
import { ContextManager } from './context-manager.ts';
import { LRUCache } from '../../services/context-cache/lru-cache.ts';
import type {
  IContextManager,
  ComponentStatus,
  ContextStats,
  IEventEmitter
} from '../../interfaces/component-interfaces.ts';
import {
  ConversationContext,
  UserPreferences,
  InternalMessage,
  EventType,
  SystemEvent
} from '../../interfaces/message-types.ts';
import type {
  ContextManagerConfig,
  IContextStorage
} from './types.ts';

export interface CachedContextManagerConfig extends ContextManagerConfig {
  cache?: {
    maxSize?: number;
    contextTTL?: number; // TTL for context cache in milliseconds
    preferencesTTL?: number; // TTL for user preferences cache in milliseconds
    enableMetrics?: boolean;
  };
}

export interface CacheMetrics {
  contextHits: number;
  contextMisses: number;
  preferencesHits: number;
  preferencesMisses: number;
  evictions: number;
  invalidations: number;
}

interface CacheConfig {
  maxSize: number;
  contextTTL: number;
  preferencesTTL: number;
  enableMetrics: boolean;
}

@injectable()
export class CachedContextManager extends ContextManager {
  private contextCache: LRUCache<number, ConversationContext>;
  private preferencesCache: LRUCache<number, UserPreferences>;
  private cacheConfig: CacheConfig;
  private metrics: CacheMetrics;
  private warmupSet: Set<number> = new Set();

  constructor(
    @inject(TYPES.ContextManagerConfig) config: CachedContextManagerConfig,
    @inject(TYPES.ContextStorage) storage: IContextStorage,
    @inject(TYPES.EventBus) eventEmitter?: IEventEmitter
  ) {
    super(config, storage, eventEmitter);

    // Set default cache configuration
    this.cacheConfig = {
      maxSize: config.cache?.maxSize || 100,
      contextTTL: config.cache?.contextTTL || 30 * 60 * 1000, // 30 minutes default
      preferencesTTL: config.cache?.preferencesTTL || 60 * 60 * 1000, // 1 hour default
      enableMetrics: config.cache?.enableMetrics !== false // default true
    };

    // Initialize caches
    this.contextCache = new LRUCache<number, ConversationContext>({
      maxSize: this.cacheConfig.maxSize,
      defaultTTL: this.cacheConfig.contextTTL
    });

    this.preferencesCache = new LRUCache<number, UserPreferences>({
      maxSize: Math.floor(this.cacheConfig.maxSize / 2), // Half size for preferences
      defaultTTL: this.cacheConfig.preferencesTTL
    });

    // Initialize metrics
    this.metrics = {
      contextHits: 0,
      contextMisses: 0,
      preferencesHits: 0,
      preferencesMisses: 0,
      evictions: 0,
      invalidations: 0
    };
  }

  /**
   * Override getContext to check cache first
   */
  async getContext(chatId: number, maxMessages?: number): Promise<ConversationContext> {
    // Check cache first
    const cached = this.contextCache.get(chatId);

    if (cached && !this.isStale(cached)) {
      if (this.cacheConfig.enableMetrics) {
        this.metrics.contextHits++;
      }

      this.logCacheEvent('cache.hit', {
        type: 'context',
        chatId,
        size: this.contextCache.size
      });

      // If maxMessages is specified and different from cached, we need to fetch
      if (maxMessages && cached.messages.length > maxMessages) {
        cached.messages = cached.messages.slice(-maxMessages);
      }

      return cached;
    }

    // Cache miss - fetch from storage
    if (this.cacheConfig.enableMetrics) {
      this.metrics.contextMisses++;
    }

    this.logCacheEvent('cache.miss', {
      type: 'context',
      chatId,
      size: this.contextCache.size
    });

    const context = await super.getContext(chatId, maxMessages);

    // Cache the result
    this.contextCache.set(chatId, context, this.cacheConfig.contextTTL);

    return context;
  }

  /**
   * Override addMessage to update cache
   */
  async addMessage(message: InternalMessage): Promise<void> {
    await super.addMessage(message);

    // Invalidate cache for this chat
    this.invalidateContext(message.chatId);
  }

  /**
   * Override clearContext to update cache
   */
  async clearContext(chatId: number): Promise<void> {
    await super.clearContext(chatId);

    // Remove from cache
    this.invalidateContext(chatId);
  }

  /**
   * Override getUserPreferences to use cache
   */
  async getUserPreferences(userId: number): Promise<UserPreferences> {
    // Check cache first
    const cached = this.preferencesCache.get(userId);

    if (cached) {
      if (this.cacheConfig.enableMetrics) {
        this.metrics.preferencesHits++;
      }

      this.logCacheEvent('cache.hit', {
        type: 'preferences',
        userId,
        size: this.preferencesCache.size
      });

      return cached;
    }

    // Cache miss
    if (this.cacheConfig.enableMetrics) {
      this.metrics.preferencesMisses++;
    }

    this.logCacheEvent('cache.miss', {
      type: 'preferences',
      userId,
      size: this.preferencesCache.size
    });

    const preferences = await super.getUserPreferences(userId);

    // Cache the result
    this.preferencesCache.set(userId, preferences, this.cacheConfig.preferencesTTL);

    return preferences;
  }

  /**
   * Override updateUserPreferences to update cache
   */
  async updateUserPreferences(userId: number, preferences: Partial<UserPreferences>): Promise<void> {
    await super.updateUserPreferences(userId, preferences);

    // Invalidate preferences cache
    this.invalidatePreferences(userId);
  }

  /**
   * Check if a cached context is stale
   */
  private isStale(context: ConversationContext): boolean {
    // Additional staleness checks beyond TTL can be added here
    // For example, check if the context is too old based on last update time
    const maxAge = this.cacheConfig.contextTTL;
    const age = Date.now() - context.metadata.lastUpdateTime.getTime();

    return age > maxAge;
  }

  /**
   * Invalidate context cache for a specific chat
   */
  invalidateContext(chatId: number): void {
    const deleted = this.contextCache.delete(chatId);

    if (deleted) {
      if (this.cacheConfig.enableMetrics) {
        this.metrics.invalidations++;
      }

      this.logCacheEvent('cache.invalidated', {
        type: 'context',
        chatId,
        size: this.contextCache.size
      });
    }
  }

  /**
   * Invalidate preferences cache for a specific user
   */
  invalidatePreferences(userId: number): void {
    const deleted = this.preferencesCache.delete(userId);

    if (deleted) {
      if (this.cacheConfig.enableMetrics) {
        this.metrics.invalidations++;
      }

      this.logCacheEvent('cache.invalidated', {
        type: 'preferences',
        userId,
        size: this.preferencesCache.size
      });
    }
  }

  /**
   * Invalidate all caches
   */
  invalidateAll(): void {
    const contextSize = this.contextCache.size;
    const prefsSize = this.preferencesCache.size;

    this.contextCache.clear();
    this.preferencesCache.clear();

    if (this.cacheConfig.enableMetrics) {
      this.metrics.invalidations += contextSize + prefsSize;
    }

    this.logCacheEvent('cache.cleared', {
      contextsCleared: contextSize,
      preferencesCleared: prefsSize
    });
  }

  /**
   * Warm up cache for frequently accessed contexts
   */
  async warmupCache(chatIds: number[]): Promise<void> {
    const warmupPromises = chatIds.map(async (chatId) => {
      try {
        if (!this.contextCache.has(chatId)) {
          const context = await super.getContext(chatId);
          this.contextCache.set(chatId, context, this.cacheConfig.contextTTL);
          this.warmupSet.add(chatId);
        }
      } catch (error) {
        console.error(`Failed to warm up cache for chat ${chatId}:`, error);
      }
    });

    await Promise.all(warmupPromises);

    this.logCacheEvent('cache.warmed', {
      count: warmupPromises.length,
      warmupSet: Array.from(this.warmupSet)
    });
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    metrics: CacheMetrics;
    contextCache: { size: number; maxSize: number };
    preferencesCache: { size: number; maxSize: number };
    config: CacheConfig;
  } {
    return {
      metrics: { ...this.metrics },
      contextCache: this.contextCache.stats(),
      preferencesCache: this.preferencesCache.stats(),
      config: { ...this.cacheConfig }
    };
  }

  /**
   * Reset cache metrics
   */
  resetMetrics(): void {
    this.metrics = {
      contextHits: 0,
      contextMisses: 0,
      preferencesHits: 0,
      preferencesMisses: 0,
      evictions: 0,
      invalidations: 0
    };
  }

  /**
   * Override getStatus to include cache information
   */
  getStatus(): ComponentStatus {
    const baseStatus = super.getStatus();

    return {
      ...baseStatus,
      metadata: {
        ...baseStatus.metadata,
        cache: {
          enabled: true,
          contextCacheSize: this.contextCache.size,
          preferencesCacheSize: this.preferencesCache.size,
          metrics: this.cacheConfig.enableMetrics ? this.metrics : undefined
        }
      }
    };
  }

  /**
   * Log cache events - using console.log since emitEvent is private in parent
   */
  private logCacheEvent(eventType: string, data: any): void {
    if (this.cacheConfig.enableMetrics) {
      console.log(`[CachedContextManager] ${eventType}:`, data);
    }
  }

  /**
   * Override shutdown to clear caches
   */
  async shutdown(): Promise<void> {
    this.invalidateAll();
    await super.shutdown();
  }
}
