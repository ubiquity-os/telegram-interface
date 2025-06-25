/**
 * Deduplication Service
 * Prevents processing duplicate webhook updates
 */

export interface DeduplicationService {
  hasProcessed(updateId: number): boolean;
  markAsProcessed(updateId: number): void;
  getSize(): number;
  cleanup(): void;
}

class SimpleDeduplicationService implements DeduplicationService {
  private processedUpdates = new Set<number>();
  private readonly maxSize = 10000;

  hasProcessed(updateId: number): boolean {
    return this.processedUpdates.has(updateId);
  }

  markAsProcessed(updateId: number): void {
    this.processedUpdates.add(updateId);

    // Clean up old entries if we exceed max size
    if (this.processedUpdates.size > this.maxSize) {
      this.cleanup();
    }
  }

  getSize(): number {
    return this.processedUpdates.size;
  }

  cleanup(): void {
    // Remove oldest entries (simple approach - clear half when full)
    const entries = Array.from(this.processedUpdates);
    const toKeep = entries.slice(-Math.floor(this.maxSize / 2));
    this.processedUpdates.clear();
    toKeep.forEach(id => this.processedUpdates.add(id));
  }
}

export const deduplicationService = new SimpleDeduplicationService();