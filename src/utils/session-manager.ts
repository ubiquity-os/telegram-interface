/**
 * Session Manager - Handles persistent session IDs for conversation continuity
 *
 * This utility provides:
 * 1. Persistent session IDs that stay constant for entire conversations
 * 2. Session lifecycle management
 * 3. Conversation-based session tracking
 */

const SESSIONS_STORAGE = new Map<string, string>(); // conversationId -> sessionId

/**
 * Generate a new session ID
 */
function generateSessionId(): string {
  const timestamp = Date.now();
  const suffix = Math.random().toString(36).substring(2, 11); // 9-character random string
  return `session_${timestamp}_${suffix}`;
}

/**
 * Generate a conversation ID from platform and user/chat identifiers
 */
function generateConversationId(platform: string, chatId: string | number, userId?: string | number): string {
  // For Telegram: use chatId as primary identifier (private chats use userId as chatId)
  // For REST API: combine chatId and userId if both available
  if (platform === 'telegram') {
    return `${platform}_${chatId}`;
  } else {
    const identifiers = [platform, chatId, userId].filter(id => id !== undefined && id !== null);
    return identifiers.join('_');
  }
}

/**
 * Get or create a session ID for a conversation
 * This ensures the same session ID is used for all messages in a conversation
 */
export function getOrCreateSessionId(platform: string, chatId: string | number, userId?: string | number): string {
  const conversationId = generateConversationId(platform, chatId, userId);

  // Check if we already have a session for this conversation
  let sessionId = SESSIONS_STORAGE.get(conversationId);

  if (!sessionId) {
    // Create new session for this conversation
    sessionId = generateSessionId();
    SESSIONS_STORAGE.set(conversationId, sessionId);
    console.log(`[SessionManager] Created new session ${sessionId} for conversation ${conversationId}`);
  }

  return sessionId;
}

/**
 * Get existing session ID for a conversation (returns null if not found)
 */
export function getExistingSessionId(platform: string, chatId: string | number, userId?: string | number): string | null {
  const conversationId = generateConversationId(platform, chatId, userId);
  return SESSIONS_STORAGE.get(conversationId) || null;
}

/**
 * End a session for a conversation (forces new session on next message)
 */
export function endSession(platform: string, chatId: string | number, userId?: string | number): boolean {
  const conversationId = generateConversationId(platform, chatId, userId);
  const existed = SESSIONS_STORAGE.has(conversationId);

  if (existed) {
    SESSIONS_STORAGE.delete(conversationId);
    console.log(`[SessionManager] Ended session for conversation ${conversationId}`);
  }

  return existed;
}

/**
 * Get all active sessions
 */
export function getActiveSessions(): Map<string, string> {
  return new Map(SESSIONS_STORAGE);
}

/**
 * Clear all sessions (for testing or reset purposes)
 */
export function clearAllSessions(): void {
  const count = SESSIONS_STORAGE.size;
  SESSIONS_STORAGE.clear();
  console.log(`[SessionManager] Cleared ${count} active sessions`);
}

/**
 * Extract session suffix from session ID
 * Session format: session_1751026088631_82j2ofsla
 * Returns the suffix part (e.g., "82j2ofsla")
 */
export function extractSessionSuffix(sessionId: string): string {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('[SessionManager] Invalid session ID provided - session ID is required');
  }

  // Match session format: session_{timestamp}_{suffix}
  const match = sessionId.match(/^session_\d+_([a-zA-Z0-9]+)$/);
  if (!match) {
    throw new Error(`[SessionManager] Invalid session ID format: ${sessionId}. Expected format: session_{timestamp}_{suffix}`);
  }

  return match[1];
}