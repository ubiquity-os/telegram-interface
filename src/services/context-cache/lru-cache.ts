/**
 * Generic LRU (Least Recently Used) Cache implementation with TTL support
 */

export interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl?: number;
}

export interface LRUCacheOptions {
  maxSize: number;
  defaultTTL?: number;
}

export class LRUCache<K, V> {
  private cache: Map<K, CacheEntry<V>>;
  private readonly maxSize: number;
  private readonly defaultTTL?: number;

  constructor(options: LRUCacheOptions) {
    this.cache = new Map();
    this.maxSize = options.maxSize;
    this.defaultTTL = options.defaultTTL;
  }

  /**
   * Get a value from the cache
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    // Check if entry has expired
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * Set a value in the cache
   */
  set(key: K, value: V, ttl?: number): void {
    // Remove if already exists to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Check if we need to evict
    if (this.cache.size >= this.maxSize) {
      // Delete the least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    // Add new entry
    const entry: CacheEntry<V> = {
      value,
      timestamp: Date.now(),
      ttl: ttl || this.defaultTTL
    };

    this.cache.set(key, entry);
  }

  /**
   * Check if cache has a key
   */
  has(key: K): boolean {
    const entry = this.cache.get(key);

    if (!entry) {
      return false;
    }

    // Check expiration
    if (this.isExpired(entry)) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a key from the cache
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the current size of the cache
   */
  get size(): number {
    // Clean up expired entries first
    this.evictExpired();
    return this.cache.size;
  }

  /**
   * Get all keys in the cache (in LRU order)
   */
  keys(): IterableIterator<K> {
    this.evictExpired();
    return this.cache.keys();
  }

  /**
   * Get all values in the cache (in LRU order)
   */
  values(): IterableIterator<V> {
    this.evictExpired();
    const values: V[] = [];
    for (const entry of this.cache.values()) {
      values.push(entry.value);
    }
    return values[Symbol.iterator]();
  }

  /**
   * Get cache statistics
   */
  stats(): { size: number; maxSize: number; hitRate?: number } {
    return {
      size: this.size,
      maxSize: this.maxSize
    };
  }

  /**
   * Check if an entry has expired
   */
  private isExpired(entry: CacheEntry<V>): boolean {
    if (!entry.ttl) {
      return false;
    }

    return Date.now() - entry.timestamp > entry.ttl;
  }

  /**
   * Remove all expired entries
   */
  private evictExpired(): void {
    const keysToDelete: K[] = [];

    for (const [key, entry] of this.cache.entries()) {
      if (this.isExpired(entry)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.cache.delete(key);
    }
  }
}