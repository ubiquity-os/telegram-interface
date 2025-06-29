#!/usr/bin/env bun

/**
 * Simple CLI Chat Interface for the Core API Server
 *
 * This CLI client connects to the REST API server and allows
 * interactive chat sessions with the system.
 */

import { Platform } from "./core/protocol/ump-types.ts";
import { ApiGateway, GatewayConfig, GatewayRequest } from "./core/api-gateway.ts";
import { TelemetryService, createDefaultTelemetryConfig, initializeTelemetry } from "./services/telemetry/index.ts";

interface ChatConfig {
  apiUrl: string;
  apiKey: string;
  userId: string;
  sessionId?: string;
}

interface ChatResponse {
  success: boolean;
  data?: {
    message: string;
    actions?: any[];
    attachments?: any[];
    metadata?: {
      sessionId: string;
      [key: string]: any;
    };
  };
  error?: string;
}

class CLIChat {
  private config: ChatConfig;
  private sessionId?: string;
  private gateway?: ApiGateway;

  constructor(config: ChatConfig) {
    this.config = config;
    this.sessionId = config.sessionId;
  }

  async initializeGateway(): Promise<void> {
    console.log('Initializing API Gateway for CLI...');

    // Initialize telemetry service for gateway
    const telemetryConfig = createDefaultTelemetryConfig();
    const telemetry = await initializeTelemetry(telemetryConfig);

    // Initialize API Gateway with CLI-optimized configuration
    const gatewayConfig: GatewayConfig = {
      rateLimiting: {
        enabled: true,
        windowMs: 60000, // 1 minute
        maxRequests: {
          telegram: 30,
          http: 60,
          cli: 100 // Higher limit for CLI
        },
        cleanupInterval: 300000 // 5 minutes
      },
      middleware: {
        enableLogging: true,
        enableValidation: true,
        enableTransformation: true,
        enableAuthentication: false, // Disable auth for CLI
        enableRateLimit: true
      },
      security: {
        maxContentLength: 50000, // Higher limit for CLI
        allowedCharacterPattern: /^[\s\S]*$/,
        blockedPatterns: [
          /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
          /javascript:/gi,
          /vbscript:/gi
        ]
      }
    };

    this.gateway = new ApiGateway(gatewayConfig, telemetry);
    await this.gateway.initialize();
    console.log('Gateway initialized for CLI');
  }

  async createSession(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.apiUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey,
        },
        body: JSON.stringify({
          platform: Platform.REST_API,
          userId: this.config.userId,
          preferences: {}
        })
      });

      if (!response.ok) {
        console.error(`Failed to create session: ${response.status} ${response.statusText}`);
        return false;
      }

      const data = await response.json();
      this.sessionId = data.session.id;
      console.log(`✅ Session created: ${this.sessionId}`);
      return true;
    } catch (error) {
      console.error('Error creating session:', error);
      return false;
    }
  }

  async sendMessage(message: string): Promise<ChatResponse> {
    if (!this.sessionId) {
      return { success: false, error: 'No active session' };
    }

    if (!this.gateway) {
      return { success: false, error: 'Gateway not initialized' };
    }

    try {
      // Process through gateway first
      const gatewayRequest: GatewayRequest = {
        id: `cli_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        source: 'cli' as const,
        timestamp: Date.now(),
        userId: this.config.userId,
        content: message,
        metadata: {
          sessionId: this.sessionId,
          interface: 'cli',
          version: '1.0.0'
        },
        originalRequest: new Request('http://localhost/cli', {
          method: 'POST',
          body: JSON.stringify({ message, userId: this.config.userId, sessionId: this.sessionId })
        })
      };

      const gatewayResponse = await this.gateway.processRequest(gatewayRequest);

      if (!gatewayResponse.success) {
        return {
          success: false,
          error: `Gateway rejected request: ${gatewayResponse.error}`,
          gatewayMetrics: gatewayResponse.metrics
        };
      }

      // Now send to API server with gateway approval
      const response = await fetch(`${this.config.apiUrl}/api/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey,
          'X-Gateway-Request-Id': gatewayRequest.id,
        },
        body: JSON.stringify({
          message: message,
          userId: this.config.userId,
          sessionId: this.sessionId
        })
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }

      const data = await response.json();

      // Include gateway metrics in response
      return {
        ...data,
        gatewayProcessed: true,
        gatewayMetrics: gatewayResponse.metrics
      };
    } catch (error) {
      return {
        success: false,
        error: `Network error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.apiUrl}/api/v1/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async startChat(): Promise<void> {
    console.log('🤖 UbiquityAI - CLI Chat with API Gateway');
    console.log('==========================================');

    // Initialize gateway
    try {
      await this.initializeGateway();
    } catch (error) {
      console.error('❌ Failed to initialize API Gateway:', error.message);
      Deno.exit(1);
    }

    // Check if server is running
    const isHealthy = await this.checkHealth();
    if (!isHealthy) {
      console.error('❌ API Server is not responding. Please make sure it\'s running on', this.config.apiUrl);
      console.log('\nTo start the server, run: bun run src/core/api-server.ts');
      Deno.exit(1);
    }

    // Create session
    const sessionCreated = await this.createSession();
    if (!sessionCreated) {
      console.error('❌ Failed to create chat session');
      Deno.exit(1);
    }

    console.log('\nType your messages below. Use /quit to exit.');
    console.log('✅ API Gateway is active - requests will be validated, rate-limited, and logged.\n');

    // Start interactive chat loop
    await this.runChatLoop();
  }

  private async runChatLoop(): Promise<void> {
    while (true) {
      // Read user input
      const input = await this.readInput('💬 You: ');
      const message = input.trim();

      if (message === '/quit' || message === '/exit') {
        console.log('\n👋 Goodbye!');
        Deno.exit(0);
      }

      if (message === '/help') {
        this.showHelp();
        continue;
      }

      if (message === '') {
        continue;
      }

      // Send message to API
      console.log('⏳ Sending...');
      const response = await this.sendMessage(message);

      if (!response.success) {
        console.log(`❌ Error: ${response.error}`);
      } else if (response.data) {
        console.log(`🤖 Bot: ${response.data.message}`);

        // Show actions if available
        if (response.data.actions && response.data.actions.length > 0) {
          console.log('   Available actions:', response.data.actions.length);
        }
      }

      console.log(''); // Empty line for spacing
    }
  }

  private async readInput(prompt: string): Promise<string> {
    // Write prompt to stdout
    await Deno.stdout.write(new TextEncoder().encode(prompt));

    // Read from stdin
    const buffer = new Uint8Array(1024);
    const n = await Deno.stdin.read(buffer) ?? 0;

    // Convert to string and trim newline
    return new TextDecoder().decode(buffer.subarray(0, n)).replace(/\r?\n$/, '');
  }

  private showHelp(): void {
    console.log('\n📋 Available Commands:');
    console.log('  /help  - Show this help message');
    console.log('  /quit  - Exit the chat');
    console.log('  /exit  - Exit the chat');
    console.log('\nJust type any message to chat with the bot!\n');
  }
}

// Configuration
function getConfig(): ChatConfig {
  const apiUrl = process.env('API_URL') || 'http://localhost:8001';
  const apiKey = process.env('API_KEY') || 'default-api-key';
  const userId = process.env('USER_ID') || `cli-user-${Date.now()}`;

  return {
    apiUrl,
    apiKey,
    userId
  };
}

// Main execution
async function main() {
  try {
    const config = getConfig();
    const chat = new CLIChat(config);
    await chat.startChat();
  } catch (error) {
    console.error('💥 Fatal error:', error);
    Deno.exit(1);
  }
}

// Run if this file is executed directly
if (import.meta.main) {
  main();
}