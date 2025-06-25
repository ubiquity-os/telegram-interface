/**
 * MCP Protocol Handler
 *
 * Implements the MCP protocol specification for JSON-RPC communication
 */

import { MCPRequest, MCPResponse } from './types.ts';
import { StdioTransport, StdioMessage } from './stdio-transport.ts';

export interface ProtocolCapabilities {
  tools?: {
    listTools?: boolean;
    callTool?: boolean;
  };
  resources?: {
    list?: boolean;
    read?: boolean;
  };
  prompts?: {
    list?: boolean;
    get?: boolean;
  };
  logging?: {
    setLevel?: boolean;
  };
}

export interface ProtocolInfo {
  protocolVersion: string;
  capabilities: ProtocolCapabilities;
  serverInfo: {
    name: string;
    version: string;
  };
}

export class ProtocolHandler {
  private transport: StdioTransport | null = null;
  private pendingRequests = new Map<string | number, {
    resolve: (response: MCPResponse) => void;
    reject: (error: Error) => void;
    method: string;
    timeout: number;
  }>();
  private protocolInfo: ProtocolInfo | null = null;
  private requestIdCounter = 0;

  constructor(
    private onNotification?: (method: string, params: any) => void,
    private onRequest?: (method: string, params: any) => Promise<any>
  ) {}

  /**
   * Start the protocol handler with a transport
   */
  async start(transport: StdioTransport): Promise<void> {
    this.transport = transport;

    // Set up message handling
    transport.setMessageHandler(this.handleMessage.bind(this));

    await transport.start();
  }

  /**
   * Stop the protocol handler
   */
  async stop(): Promise<void> {
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error('Protocol handler stopped'));
      clearTimeout(pending.timeout);
    }
    this.pendingRequests.clear();

    if (this.transport) {
      await this.transport.stop();
      this.transport = null;
    }

    this.protocolInfo = null;
  }

  /**
   * Send initialize request
   */
  async initialize(): Promise<ProtocolInfo> {
    const response = await this.sendRequest({
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {
          roots: {
            listRoots: false
          },
          sampling: {}
        },
        clientInfo: {
          name: "telegram-interface",
          version: "1.0.0"
        }
      },
      id: this.generateRequestId()
    });

    if (response.error) {
      throw new Error(`Initialize failed: ${response.error.message}`);
    }

    this.protocolInfo = response.result as ProtocolInfo;

    // Send initialized notification
    await this.sendNotification("notifications/initialized", {});

    return this.protocolInfo;
  }

  /**
   * List available tools
   */
  async listTools(): Promise<any[]> {
    const response = await this.sendRequest({
      jsonrpc: "2.0",
      method: "tools/list",
      params: {},
      id: this.generateRequestId()
    });

    if (response.error) {
      throw new Error(`List tools failed: ${response.error.message}`);
    }

    return response.result?.tools || [];
  }

  /**
   * Call a tool
   */
  async callTool(name: string, arguments_: any): Promise<any> {
    const response = await this.sendRequest({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name,
        arguments: arguments_
      },
      id: this.generateRequestId()
    });

    if (response.error) {
      throw new Error(`Tool call failed: ${response.error.message}`);
    }

    return response.result;
  }

  /**
   * Send a request and wait for response
   */
  async sendRequest(request: MCPRequest, timeoutMs = 30000): Promise<MCPResponse> {
    if (!this.transport || !this.transport.isActive()) {
      throw new Error('Transport not active');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error(`Request timeout: ${request.method}`));
      }, timeoutMs);

      this.pendingRequests.set(request.id, {
        resolve,
        reject,
        method: request.method,
        timeout
      });

      this.transport!.send(request as StdioMessage).catch(error => {
        this.pendingRequests.delete(request.id);
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Send a notification (no response expected)
   */
  async sendNotification(method: string, params: any): Promise<void> {
    if (!this.transport || !this.transport.isActive()) {
      throw new Error('Transport not active');
    }

    const notification: StdioMessage = {
      jsonrpc: "2.0",
      method,
      params
    };

    await this.transport.send(notification);
  }

  /**
   * Handle incoming message
   */
  private handleMessage(message: StdioMessage): void {
    // Handle response to our request
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.id);
        pending.resolve(message as MCPResponse);
      }
      return;
    }

    // Handle notification
    if (message.method && message.id === undefined) {
      this.onNotification?.(message.method, message.params);
      return;
    }

    // Handle request from server
    if (message.method && message.id !== undefined) {
      this.handleIncomingRequest(message);
      return;
    }
  }

  /**
   * Handle incoming request from server
   */
  private async handleIncomingRequest(message: StdioMessage): Promise<void> {
    if (!this.onRequest) {
      // Send error response
      await this.transport!.send({
        jsonrpc: "2.0",
        error: {
          code: -32601,
          message: "Method not found"
        },
        id: message.id
      });
      return;
    }

    try {
      const result = await this.onRequest(message.method!, message.params);
      await this.transport!.send({
        jsonrpc: "2.0",
        result,
        id: message.id
      });
    } catch (error) {
      await this.transport!.send({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error'
        },
        id: message.id
      });
    }
  }

  /**
   * Generate request ID
   */
  private generateRequestId(): string | number {
    return ++this.requestIdCounter;
  }

  /**
   * Get protocol info
   */
  getProtocolInfo(): ProtocolInfo | null {
    return this.protocolInfo;
  }

  /**
   * Check if handler is active
   */
  isActive(): boolean {
    return this.transport !== null && this.transport.isActive();
  }
}