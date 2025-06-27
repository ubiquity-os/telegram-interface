/**
 * Log Manager - Rotating log system with console override
 *
 * This utility provides:
 * 1. Console method override to append to latest.log
 * 2. Log rotation on system boot or new message
 * 3. Separate log files for each interaction session
 */

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

/**
 * Ensure logs directory exists
 */
async function ensureLogsDirectory(): Promise<void> {
  try {
    await Deno.stat(LOGS_DIR);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      await Deno.mkdir(LOGS_DIR, { recursive: true });
    } else {
      throw error;
    }
  }
}

/**
 * Move latest.log to timestamped file (POSIX timestamp format)
 */
export async function rotateLog(): Promise<string | null> {
  try {
    await ensureLogsDirectory();

    // Check if latest.log exists
    try {
      await Deno.stat(LATEST_LOG_FILE);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        // No existing log file to rotate
        return null;
      }
      throw error;
    }

    // Generate POSIX timestamp
    const timestamp = Math.floor(Date.now() / 1000);
    const timestampedFile = `${LOGS_DIR}/${timestamp}.log`;

    // Move latest.log to timestamped file synchronously to ensure no logs are mixed
    await Deno.rename(LATEST_LOG_FILE, timestampedFile);

    console.log(`[LogManager] Rotated log to: ${timestampedFile}`);
    return timestampedFile;
  } catch (error) {
    console.error('[LogManager] Failed to rotate log:', error);
    return null;
  }
}

/**
 * Write content to latest.log file
 */
async function writeToLog(content: string): Promise<void> {
  try {
    await ensureLogsDirectory();
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${content}\n`;

    // Use synchronous write to ensure logs don't get mixed
    await Deno.writeTextFile(LATEST_LOG_FILE, logEntry, { append: true });
  } catch (error) {
    // Silently fail to avoid infinite loops
    originalConsole.error('[LogManager] Failed to write to log:', error);
  }
}

/**
 * Create a console method wrapper that logs to both terminal and file
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

    // Write to log file asynchronously (but don't await to avoid blocking)
    writeToLog(`[${level.toUpperCase()}] ${formattedArgs}`).catch(() => {
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
  console.log('[LogManager] Console override enabled - logs will be written to latest.log');
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
  console.log('[LogManager] Console override disabled - logs will only appear in terminal');
}

/**
 * Initialize logging system: rotate existing log and enable console override
 */
export async function initializeLogging(): Promise<void> {
  try {
    // Rotate existing log if it exists
    const rotatedFile = await rotateLog();
    if (rotatedFile) {
      console.log(`[LogManager] Previous session log saved as: ${rotatedFile}`);
    }

    // Enable console override
    overrideConsole();

    console.log('[LogManager] Logging system initialized successfully');
  } catch (error) {
    console.error('[LogManager] Failed to initialize logging system:', error);
    throw error;
  }
}

/**
 * Get status of console override
 */
export function isConsoleOverrideActive(): boolean {
  return isConsoleOverridden;
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