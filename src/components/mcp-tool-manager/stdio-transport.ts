/**
 * Stdio Transport for MCP Communication
 *
 * Handles reading and writing JSON-RPC messages over stdio
 */

export interface StdioMessage {
  jsonrpc: "2.0";
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class StdioTransport {
  protected reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  protected writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  protected decoder = new TextDecoder();
  protected encoder = new TextEncoder();
  protected buffer = '';
  private messageHandlers = new Map<string, (message: StdioMessage) => void>();
  private isReading = false;
  protected messageCallback: ((message: StdioMessage) => void) | null = null;

  constructor(
    private stdout: ReadableStream<Uint8Array>,
    private stdin: WritableStream<Uint8Array>
  ) {}

  /**
   * Set the message callback
   */
  setMessageHandler(callback: (message: StdioMessage) => void): void {
    this.messageCallback = callback;
  }

  /**
   * Set the error callback
   */
  setErrorHandler(callback: (error: Error) => void): void {
    this.onError = callback;
  }

  private onError?: (error: Error) => void;

  /**
   * Start the transport
   */
  async start(): Promise<void> {
    this.reader = this.stdout.getReader();
    this.writer = this.stdin.getWriter();
    this.isReading = true;

    // Start reading messages
    this.readLoop().catch(error => {
      console.error('[StdioTransport] Read loop error:', error);
      this.onError?.(error);
    });
  }

  /**
   * Stop the transport
   */
  async stop(): Promise<void> {
    this.isReading = false;

    if (this.reader) {
      await this.reader.cancel();
      this.reader = null;
    }

    if (this.writer) {
      await this.writer.close();
      this.writer = null;
    }

    this.messageHandlers.clear();
  }

  /**
   * Send a message
   */
  async send(message: StdioMessage): Promise<void> {
    if (!this.writer) {
      throw new Error('Transport not started');
    }

    const text = JSON.stringify(message) + '\n';
    const bytes = this.encoder.encode(text);

    try {
      await this.writer.write(bytes);
    } catch (error) {
      console.error('[StdioTransport] Write error:', error);
      throw error;
    }
  }

  /**
   * Read messages from stdout
   */
  private async readLoop(): Promise<void> {
    if (!this.reader) return;

    try {
      while (this.isReading) {
        const { value, done } = await this.reader.read();

        if (done) {
          console.log('[StdioTransport] Stream ended');
          break;
        }

        if (value) {
          const chunk = this.decoder.decode(value, { stream: true });
          this.buffer += chunk;
          this.processBuffer();
        }
      }
    } catch (error) {
      if (this.isReading) {
        console.error('[StdioTransport] Read error:', error);
        this.onError?.(error as Error);
      }
    }
  }

  /**
   * Process buffered data for complete messages
   */
  protected processBuffer(): void {
    let newlineIndex: number;

    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line) {
        try {
          const message = JSON.parse(line) as StdioMessage;
          if (this.messageCallback) {
            this.messageCallback(message);
          }
        } catch (error) {
          console.error('[StdioTransport] Failed to parse message:', error, 'Line:', line);
        }
      }
    }
  }

  /**
   * Check if transport is active
   */
  isActive(): boolean {
    return this.isReading && this.reader !== null && this.writer !== null;
  }
}

/**
 * Message framing utilities for Content-Length header format
 * Some MCP servers may use this format instead of newline-delimited
 */
export class ContentLengthTransport extends StdioTransport {
  private contentLengthBuffer = '';
  private expectedLength = 0;
  private readingHeaders = true;

  constructor(
    stdout: ReadableStream<Uint8Array>,
    stdin: WritableStream<Uint8Array>
  ) {
    super(stdout, stdin);
  }

  protected processBuffer(): void {
    while (this.buffer.length > 0) {
      if (this.readingHeaders) {
        const headerEnd = this.buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return; // Need more data

        const headers = this.buffer.slice(0, headerEnd);
        this.buffer = this.buffer.slice(headerEnd + 4);

        const match = headers.match(/Content-Length: (\d+)/i);
        if (match) {
          this.expectedLength = parseInt(match[1], 10);
          this.readingHeaders = false;
        }
      } else {
        if (this.buffer.length < this.expectedLength) return; // Need more data

        const messageText = this.buffer.slice(0, this.expectedLength);
        this.buffer = this.buffer.slice(this.expectedLength);

        try {
          const message = JSON.parse(messageText) as StdioMessage;
          if (this.messageCallback) {
            this.messageCallback(message);
          }
        } catch (error) {
          console.error('[ContentLengthTransport] Failed to parse message:', error);
        }

        this.readingHeaders = true;
        this.expectedLength = 0;
      }
    }
  }

  async send(message: StdioMessage): Promise<void> {
    if (!this.writer) {
      throw new Error('Transport not started');
    }

    const messageText = JSON.stringify(message);
    const contentLength = new TextEncoder().encode(messageText).length;
    const frame = `Content-Length: ${contentLength}\r\n\r\n${messageText}`;
    const bytes = this.encoder.encode(frame);

    try {
      await this.writer.write(bytes);
    } catch (error) {
      console.error('[ContentLengthTransport] Write error:', error);
      throw error;
    }
  }
}