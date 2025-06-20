// Simple in-memory cache for tracking processed update IDs
// This prevents duplicate processing when Telegram retries webhooks

class DeduplicationService {
  private processedUpdates: Set<number>;
  private maxCacheSize: number;
  
  constructor(maxCacheSize = 10000) {
    this.processedUpdates = new Set();
    this.maxCacheSize = maxCacheSize;
  }
  
  // Check if an update has already been processed
  hasProcessed(updateId: number): boolean {
    return this.processedUpdates.has(updateId);
  }
  
  // Mark an update as processed
  markAsProcessed(updateId: number): void {
    this.processedUpdates.add(updateId);
    
    // Prevent memory leak by removing old entries when cache gets too large
    if (this.processedUpdates.size > this.maxCacheSize) {
      // Remove the oldest entries (first half of the set)
      const entriesToKeep = Array.from(this.processedUpdates).slice(-this.maxCacheSize / 2);
      this.processedUpdates = new Set(entriesToKeep);
    }
  }
  
  // Clear the cache (useful for testing)
  clear(): void {
    this.processedUpdates.clear();
  }
  
  // Get current cache size
  getSize(): number {
    return this.processedUpdates.size;
  }
}

// Export singleton instance
export const deduplicationService = new DeduplicationService();