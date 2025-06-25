/**
 * Process Manager for MCP Servers
 *
 * Handles spawning and managing MCP server processes
 */

import { MCPServerConfig } from './types.ts';

export interface ProcessHandle {
  id: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  process: Deno.ChildProcess;
  stdin: WritableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  status: Promise<Deno.CommandStatus>;
  startTime: Date;
}

export class ProcessManager {
  private processes = new Map<string, ProcessHandle>();
  private processIdCounter = 0;

  /**
   * Spawn a new MCP server process
   */
  async spawnProcess(
    serverId: string,
    config: MCPServerConfig
  ): Promise<ProcessHandle> {
    console.log(`[ProcessManager] Spawning process for ${serverId}`);

    // Create command with environment variables
    const command = new Deno.Command(config.command, {
      args: config.args || [],
      env: {
        ...Deno.env.toObject(),
        ...config.env
      },
      stdin: 'piped',
      stdout: 'piped',
      stderr: 'piped'
    });

    const process = command.spawn();
    const processId = `${serverId}-${++this.processIdCounter}`;

    const handle: ProcessHandle = {
      id: processId,
      command: config.command,
      args: config.args || [],
      env: config.env,
      process,
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      status: process.status,
      startTime: new Date()
    };

    this.processes.set(serverId, handle);

    // Monitor process status
    process.status.then((status) => {
      console.log(`[ProcessManager] Process ${processId} exited with code ${status.code}`);
      if (this.processes.get(serverId)?.id === processId) {
        this.processes.delete(serverId);
      }
    });

    // Log stderr for debugging
    this.monitorStderr(serverId, handle);

    return handle;
  }

  /**
   * Get process handle for a server
   */
  getProcess(serverId: string): ProcessHandle | undefined {
    return this.processes.get(serverId);
  }

  /**
   * Kill a specific process
   */
  async killProcess(serverId: string): Promise<void> {
    const handle = this.processes.get(serverId);
    if (!handle) {
      console.log(`[ProcessManager] No process found for ${serverId}`);
      return;
    }

    console.log(`[ProcessManager] Killing process ${handle.id}`);

    try {
      // Close stdin first
      await handle.stdin.close();

      // Kill the process
      handle.process.kill('SIGTERM');

      // Wait for process to exit (with timeout)
      const timeout = setTimeout(() => {
        console.log(`[ProcessManager] Force killing process ${handle.id}`);
        handle.process.kill('SIGKILL');
      }, 5000);

      await handle.status;
      clearTimeout(timeout);

      this.processes.delete(serverId);
      console.log(`[ProcessManager] Process ${handle.id} terminated`);
    } catch (error) {
      console.error(`[ProcessManager] Error killing process ${handle.id}:`, error);
      this.processes.delete(serverId);
    }
  }

  /**
   * Kill all processes
   */
  async killAll(): Promise<void> {
    console.log(`[ProcessManager] Killing all ${this.processes.size} processes`);

    const killPromises = Array.from(this.processes.keys()).map(serverId =>
      this.killProcess(serverId)
    );

    await Promise.allSettled(killPromises);
    this.processes.clear();
  }

  /**
   * Check if a process is running
   */
  isProcessRunning(serverId: string): boolean {
    return this.processes.has(serverId);
  }

  /**
   * Get all running processes
   */
  getRunningProcesses(): Map<string, ProcessHandle> {
    return new Map(this.processes);
  }

  /**
   * Monitor stderr for debugging
   */
  private async monitorStderr(serverId: string, handle: ProcessHandle): Promise<void> {
    const reader = handle.stderr.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        console.error(`[ProcessManager] ${serverId} stderr:`, text);
      }
    } catch (error) {
      console.error(`[ProcessManager] Error reading stderr for ${serverId}:`, error);
    } finally {
      reader.releaseLock();
    }
  }
}