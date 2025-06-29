/**
 * Event-Based Log Manager - Each message/event gets its own timestamped log file
 *
 * This utility provides:
 * 1. Event-based logging: one file per message/event
 * 2. Filename format: {messageTimestamp}-{sessionId}.log
 * 3. messageTimestamp = POSIX timestamp when the message was received
 * 4. sessionId = consistent throughout entire conversation
 * 5. Piece together conversations by grouping files with same sessionId, sorted by timestamp
 */

import { getOrCreateSessionId } from './session-manager.ts';

const LOGS_DIR = 'logs';
const LATEST_LOG_FILE = `${LOGS_DIR}/latest.log`;

// Store original console methods
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info
};

let isConsoleOverridden = false;
let currentSessionId: string | null = null;
let currentEventTimestamp: number | null = null;

/**
 * Ensure logs directory exists
 */
async function ensureLogsDirectory(): Promise<void> {
  try {
    await Deno.stat(LOGS_DIR);
  } catch (error: any) {
    if (error instanceof Deno.errors.NotFound) {
      await Deno.mkdir(LOGS_DIR, { recursive: true });
    } else {
      throw error;
    }
  }
}

/**
 * Log a single event to its own timestamped file
 */
export async function logEvent(
  platform: string,
  chatId: string | number,
  eventType: string,
  eventData: any,
  userId?: string | number,
  customTimestamp?: number
): Promise<string> {
  await ensureLogsDirectory();

  // Get consistent session ID for this conversation
  const sessionId = getOrCreateSessionId(platform, chatId, userId);

  // Use provided timestamp or current time for this specific event
  const eventTimestamp = customTimestamp || Math.floor(Date.now() / 1000);

  // Extract session suffix (everything after last underscore)
  const sessionSuffix = sessionId.split('_').pop()!;

  // Create filename: {eventTimestamp}-{sessionSuffix}.log
  const filename = `${eventTimestamp}-${sessionSuffix}.log`;
  const logFilePath = `${LOGS_DIR}/${filename}`;

  // Build log entry
  const logEntry = {
    timestamp: eventTimestamp,
    isoTimestamp: new Date(eventTimestamp * 1000).toISOString(),
    sessionId,
    platform,
    chatId,
    userId,
    eventType,
    eventData
  };

  // Write event to its own file
  await Deno.writeTextFile(logFilePath, JSON.stringify(logEntry, null, 2));

  console.log(`[EventLogger] Logged ${eventType} to: ${filename} (session: ${sessionId})`);
  return logFilePath;
}

/**
 * Initialize event logging for a specific message/event
 * This sets up console override to capture logs for this specific event
 */
export function initializeEventLogging(
  platform: string,
  chatId: string | number,
  userId?: string | number,
  eventTimestamp?: number
): { sessionId: string; eventTimestamp: number } {
  // Get consistent session ID
  const sessionId = getOrCreateSessionId(platform, chatId, userId);
  const timestamp = eventTimestamp || Math.floor(Date.now() / 1000);

  // Set current context for console override
  currentSessionId = sessionId;
  currentEventTimestamp = timestamp;

  // Enable console override if not already active
  if (!isConsoleOverridden) {
    overrideConsole();
  }

  return { sessionId, eventTimestamp: timestamp };
}

/**
 * Write console output to both terminal and event-specific latest.log
 */
async function writeToLatestLog(content: string): Promise<void> {
  try {
    await ensureLogsDirectory();
    const timestamp = new Date().toISOString();
    const sessionInfo = currentSessionId ? ` [${currentSessionId}]` : '';
    const eventInfo = currentEventTimestamp ? ` [event:${currentEventTimestamp}]` : '';
    const logEntry = `[${timestamp}]${sessionInfo}${eventInfo} ${content}\n`;

    // Append to latest.log for real-time monitoring
    await Deno.writeTextFile(LATEST_LOG_FILE, logEntry, { append: true });
  } catch (error) {
    // Silently fail to avoid infinite loops
    originalConsole.error('[EventLogger] Failed to write to latest.log:', error);
  }
}

/**
 * Create a console method wrapper that logs to both terminal and latest.log
 */
function createConsoleWrapper(originalMethod: (...args: any[]) => void, level: string) {
  return (...args: any[]) => {
    // Call original method to maintain terminal output
    originalMethod.apply(console, args);

    // Format arguments for file logging
    const formattedArgs = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    // Write to latest.log asynchronously (but don't await to avoid blocking)
    writeToLatestLog(`[${level.toUpperCase()}] ${formattedArgs}`).catch(() => {
      // Silently ignore log write errors to avoid infinite loops
    });
  };
}

/**
 * Override console methods to append to latest.log
 */
export function overrideConsole(): void {
  if (isConsoleOverridden) {
    return; // Already overridden
  }

  console.log = createConsoleWrapper(originalConsole.log, 'log');
  console.error = createConsoleWrapper(originalConsole.error, 'error');
  console.warn = createConsoleWrapper(originalConsole.warn, 'warn');
  console.info = createConsoleWrapper(originalConsole.info, 'info');

  isConsoleOverridden = true;
  console.log('[EventLogger] Console override enabled - logs will be written to latest.log');
}

/**
 * Restore original console methods
 */
export function restoreConsole(): void {
  if (!isConsoleOverridden) {
    return; // Not overridden
  }

  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
  console.info = originalConsole.info;

  isConsoleOverridden = false;
  console.log('[EventLogger] Console override disabled - logs will only appear in terminal');
}

/**
 * Clear current event context (call after processing each event)
 */
export function clearEventContext(): void {
  currentSessionId = null;
  currentEventTimestamp = null;
}

/**
 * Get current event context
 */
export function getCurrentEventContext(): { sessionId: string | null; eventTimestamp: number | null } {
  return {
    sessionId: currentSessionId,
    eventTimestamp: currentEventTimestamp
  };
}

/**
 * Initialize logging system on startup
 */
export async function initializeLogging(): Promise<void> {
  try {
    await ensureLogsDirectory();
    console.log('[EventLogger] Event-based logging system initialized');
  } catch (error) {
    console.error('[EventLogger] Failed to initialize logging system:', error);
    throw error;
  }
}

/**
 * Finalize event logging - logs the event and clears context
 */
export async function finalizeEventLogging(
  eventType: string,
  eventData: any,
  platform: string,
  chatId: string | number,
  userId?: string | number
): Promise<string> {
  if (!currentSessionId || !currentEventTimestamp) {
    throw new Error('[EventLogger] No active event context - call initializeEventLogging first');
  }

  // Log the event to its own file
  const logFile = await logEvent(
    platform,
    chatId,
    eventType,
    eventData,
    userId,
    currentEventTimestamp
  );

  // Clear context for next event
  clearEventContext();

  return logFile;
}

/**
 * Get logs directory path
 */
export function getLogsDirectory(): string {
  return LOGS_DIR;
}

/**
 * Get latest log file path
 */
export function getLatestLogFile(): string {
  return LATEST_LOG_FILE;
}

/**
 * Check if console override is active
 */
export function isConsoleOverrideActive(): boolean {
  return isConsoleOverridden;
}
