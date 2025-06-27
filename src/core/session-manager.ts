/**
 * Session Manager - Handles session lifecycle and storage
 *
 * Manages user sessions across different platforms, providing
 * session persistence and state management
 */

import {
  Session,
  SessionState,
  SessionContext,
  Platform,
  PlatformConnection,
  UMPError,
  UMPErrorType
} from './protocol/ump-types.ts';

/**
 * Session creation request
 */
export interface CreateSessionRequest {
  userId: string;
  platform: Platform;
  metadata?: Record<string, any>;
  expirationMinutes?: number;
}

/**
 * Session update request
 */
export interface UpdateSessionRequest {
  lastActiveAt?: Date;
  context?: Partial<SessionContext>;
  state?: SessionState;
  metadata?: Record<string, any>;
}

/**
 * Session Manager Configuration
 */
export interface SessionManagerConfig {
  // Storage settings
  storage: {
    type: 'memory' | 'deno-kv';
    kvPath?: string;
  };

  // Session lifecycle
  defaultExpirationMinutes: number;
  maxSessionsPerUser: number;
  cleanupIntervalMinutes: number;

  // Security
  enableSessionEncryption: boolean;
  encryptionKey?: string;

  // Logging
  enableLogging: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Session storage interface
 */
interface SessionStorage {
  get(sessionId: string): Promise<Session | null>;
  set(sessionId: string, session: Session): Promise<void>;
  delete(sessionId: string): Promise<void>;
  list(userId?: string): Promise<Session[]>;
  cleanup(expiredBefore: Date): Promise<number>;
}

/**
 * Memory-based session storage
 */
class MemorySessionStorage implements SessionStorage {
  private sessions = new Map<string, Session>();

  async get(sessionId: string): Promise<Session | null> {
    return this.sessions.get(sessionId) || null;
  }

  async set(sessionId: string, session: Session): Promise<void> {
    this.sessions.set(sessionId, session);
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async list(userId?: string): Promise<Session[]> {
    const sessions = Array.from(this.sessions.values());
    return userId ? sessions.filter(s => s.userId === userId) : sessions;
  }

  async cleanup(expiredBefore: Date): Promise<number> {
    let cleaned = 0;
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt && session.expiresAt < expiredBefore) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }
    return cleaned;
  }
}

/**
 * Deno KV-based session storage
 */
class DenoKVSessionStorage implements SessionStorage {
  private kv: Deno.Kv | null = null;

  constructor(private kvPath?: string) {}

  async initialize(): Promise<void> {
    this.kv = await Deno.openKv(this.kvPath);
  }

  async get(sessionId: string): Promise<Session | null> {
    if (!this.kv) await this.initialize();
    const result = await this.kv!.get(['session', sessionId]);
    return result.value as Session | null;
  }

  async set(sessionId: string, session: Session): Promise<void> {
    if (!this.kv) await this.initialize();
    await this.kv!.set(['session', sessionId], session);

    // Also index by userId for efficient lookup
    await this.kv!.set(['session_by_user', session.userId, sessionId], true);
  }

  async delete(sessionId: string): Promise<void> {
    if (!this.kv) await this.initialize();

    // Get session first to remove user index
    const session = await this.get(sessionId);
    if (session) {
      await this.kv!.delete(['session_by_user', session.userId, sessionId]);
    }

    await this.kv!.delete(['session', sessionId]);
  }

  async list(userId?: string): Promise<Session[]> {
    if (!this.kv) await this.initialize();

    const sessions: Session[] = [];

    if (userId) {
      // Get sessions for specific user
      const iter = this.kv!.list({ prefix: ['session_by_user', userId] });
      for await (const entry of iter) {
        const sessionId = (entry.key as string[])[2];
        const session = await this.get(sessionId);
        if (session) sessions.push(session);
      }
    } else {
      // Get all sessions
      const iter = this.kv!.list({ prefix: ['session'] });
      for await (const entry of iter) {
        if (entry.value) sessions.push(entry.value as Session);
      }
    }

    return sessions;
  }

  async cleanup(expiredBefore: Date): Promise<number> {
    if (!this.kv) await this.initialize();

    let cleaned = 0;
    const iter = this.kv!.list({ prefix: ['session'] });

    for await (const entry of iter) {
      const session = entry.value as Session;
      if (session.expiresAt && session.expiresAt < expiredBefore) {
        await this.delete(session.id);
        cleaned++;
      }
    }

    return cleaned;
  }
}

/**
 * Main Session Manager class
 */
export class SessionManager {
  private config: SessionManagerConfig;
  private storage: SessionStorage;
  private cleanupTimer?: number;

  constructor(config: SessionManagerConfig) {
    this.config = config;

    // Initialize storage based on configuration
    if (config.storage.type === 'deno-kv') {
      this.storage = new DenoKVSessionStorage(config.storage.kvPath);
    } else {
      this.storage = new MemorySessionStorage();
    }
  }

  /**
   * Initialize the session manager
   */
  async initialize(): Promise<void> {
    // Initialize storage
    if (this.storage instanceof DenoKVSessionStorage) {
      await (this.storage as DenoKVSessionStorage).initialize();
    }

    // Start cleanup timer
    if (this.config.cleanupIntervalMinutes > 0) {
      this.startCleanupTimer();
    }

    this.log('info', 'Session Manager initialized');
  }

  /**
   * Shutdown the session manager
   */
  async shutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.log('info', 'Session Manager shutdown');
  }

  /**
   * Create a new session
   */
  async createSession(request: CreateSessionRequest): Promise<Session> {
    // Check for existing sessions for this user
    const existingSessions = await this.storage.list(request.userId);

    // Limit sessions per user
    if (existingSessions.length >= this.config.maxSessionsPerUser) {
      // Remove oldest session
      const oldestSession = existingSessions.sort((a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime()
      )[0];
      await this.storage.delete(oldestSession.id);
      this.log('info', `Removed oldest session ${oldestSession.id} for user ${request.userId}`);
    }

    // Create new session
    const sessionId = this.generateSessionId();
    const now = new Date();
    const expirationMinutes = request.expirationMinutes || this.config.defaultExpirationMinutes;
    const expiresAt = new Date(now.getTime() + expirationMinutes * 60 * 1000);

    const session: Session = {
      id: sessionId,
      userId: request.userId,
      platform: request.platform,
      createdAt: now,
      lastActiveAt: now,
      expiresAt,
      state: SessionState.ACTIVE,
      context: {
        messageCount: 0,
        lastMessageAt: now,
        preferences: request.metadata || {}
      },
      platformConnection: {
        platform: request.platform,
        connectionId: `${request.platform}_${request.userId}`,
        isConnected: true,
        metadata: request.platform === Platform.TELEGRAM ? {
          [Platform.TELEGRAM]: {
            chatId: parseInt(request.userId), // Simplified
            messageId: 0,
            updateId: 0,
            isBot: false,
            chatType: 'private'
          }
        } : request.platform === Platform.REST_API ? {
          [Platform.REST_API]: {
            endpoint: '/api/v1/messages',
            method: 'POST',
            headers: {},
            apiVersion: '1.0'
          }
        } : {}
      }
    };

    await this.storage.set(sessionId, session);

    this.log('info', `Created session ${sessionId} for user ${request.userId} on platform ${request.platform}`);

    return session;
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId: string): Promise<Session | null> {
    const session = await this.storage.get(sessionId);

    if (!session) {
      return null;
    }

    // Check if session is expired
    if (session.expiresAt && session.expiresAt < new Date()) {
      await this.storage.delete(sessionId);
      this.log('info', `Session ${sessionId} expired and removed`);
      return null;
    }

    return session;
  }

  /**
   * Update a session
   */
  async updateSession(sessionId: string, updates: UpdateSessionRequest): Promise<Session | null> {
    const session = await this.getSession(sessionId);

    if (!session) {
      throw new UMPError(
        `Session not found: ${sessionId}`,
        UMPErrorType.NOT_FOUND
      );
    }

    // Apply updates
    if (updates.lastActiveAt) {
      session.lastActiveAt = updates.lastActiveAt;
    }

    if (updates.state) {
      session.state = updates.state;
    }

    if (updates.context) {
      session.context = { ...session.context, ...updates.context };
    }

    if (updates.metadata) {
      session.context.preferences = { ...session.context.preferences, ...updates.metadata };
    }

    await this.storage.set(sessionId, session);

    this.log('debug', `Updated session ${sessionId}`);

    return session;
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    const session = await this.storage.get(sessionId);

    if (!session) {
      return false;
    }

    await this.storage.delete(sessionId);

    this.log('info', `Deleted session ${sessionId}`);

    return true;
  }

  /**
   * Get all sessions for a user
   */
  async getUserSessions(userId: string): Promise<Session[]> {
    const sessions = await this.storage.list(userId);

    // Filter out expired sessions
    const activeSessions: Session[] = [];
    const now = new Date();

    for (const session of sessions) {
      if (!session.expiresAt || session.expiresAt > now) {
        activeSessions.push(session);
      } else {
        // Clean up expired session
        await this.storage.delete(session.id);
      }
    }

    return activeSessions;
  }

  /**
   * Extend session expiration
   */
  async extendSession(sessionId: string, additionalMinutes: number): Promise<Session | null> {
    const session = await this.getSession(sessionId);

    if (!session) {
      return null;
    }

    if (session.expiresAt) {
      session.expiresAt = new Date(session.expiresAt.getTime() + additionalMinutes * 60 * 1000);
    } else {
      session.expiresAt = new Date(Date.now() + additionalMinutes * 60 * 1000);
    }

    session.lastActiveAt = new Date();

    await this.storage.set(sessionId, session);

    this.log('debug', `Extended session ${sessionId} by ${additionalMinutes} minutes`);

    return session;
  }

  /**
   * Touch session (update last active time)
   */
  async touchSession(sessionId: string): Promise<Session | null> {
    return this.updateSession(sessionId, { lastActiveAt: new Date() });
  }

  /**
   * Get session statistics
   */
  async getSessionStats(): Promise<{
    totalSessions: number;
    activeSessions: number;
    sessionsByPlatform: Record<Platform, number>;
    averageSessionAge: number;
  }> {
    const allSessions = await this.storage.list();
    const now = new Date();

    const stats = {
      totalSessions: allSessions.length,
      activeSessions: 0,
      sessionsByPlatform: {} as Record<Platform, number>,
      averageSessionAge: 0
    };

    let totalAge = 0;

    for (const session of allSessions) {
      // Count active sessions
      if (!session.expiresAt || session.expiresAt > now) {
        stats.activeSessions++;
      }

      // Count by platform
      stats.sessionsByPlatform[session.platform] =
        (stats.sessionsByPlatform[session.platform] || 0) + 1;

      // Calculate age
      totalAge += now.getTime() - session.createdAt.getTime();
    }

    if (allSessions.length > 0) {
      stats.averageSessionAge = totalAge / allSessions.length / (1000 * 60); // in minutes
    }

    return stats;
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions(): Promise<number> {
    const expiredBefore = new Date();
    const cleaned = await this.storage.cleanup(expiredBefore);

    if (cleaned > 0) {
      this.log('info', `Cleaned up ${cleaned} expired sessions`);
    }

    return cleaned;
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `session_${timestamp}_${random}`;
  }

  /**
   * Start cleanup timer
   */
  private startCleanupTimer(): void {
    const intervalMs = this.config.cleanupIntervalMinutes * 60 * 1000;

    this.cleanupTimer = setInterval(async () => {
      try {
        await this.cleanupExpiredSessions();
      } catch (error) {
        this.log('error', `Cleanup timer error: ${error.message}`);
      }
    }, intervalMs);

    this.log('info', `Started cleanup timer with interval ${this.config.cleanupIntervalMinutes} minutes`);
  }

  /**
   * Logging utility
   */
  private log(level: string, message: string): void {
    if (!this.config.enableLogging) {
      return;
    }

    const levels = ['debug', 'info', 'warn', 'error'];
    const configLevelIndex = levels.indexOf(this.config.logLevel);
    const messageLevelIndex = levels.indexOf(level);

    if (messageLevelIndex >= configLevelIndex) {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] [${level.toUpperCase()}] [SessionManager] ${message}`);
    }
  }
}

/**
 * Create default configuration for Session Manager
 */
export function createDefaultSessionManagerConfig(): SessionManagerConfig {
  return {
    storage: {
      type: 'deno-kv'
    },
    defaultExpirationMinutes: 30, // 30 minutes
    maxSessionsPerUser: 5,
    cleanupIntervalMinutes: 15, // Clean up every 15 minutes
    enableSessionEncryption: false,
    enableLogging: true,
    logLevel: 'info'
  };
}