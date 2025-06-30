#!/usr/bin/env deno run --allow-net --allow-env --allow-read --allow-write

/**
 * Simple CLI Chat Interface for the Core API Server
 *
 * This CLI client connects to the REST API server and allows
 * interactive chat sessions with the system.
 */

import { Platform } from "./core/protocol/ump-types.ts";
import { ApiGateway, ApiGatewayConfig, IncomingRequest } from "./core/api-gateway.ts";
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

  // Removed gateway initialization - CLI connects directly to API server

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
      // Check both response formats for session ID
      if (data.session?.id) {
        this.sessionId = data.session.id;
      } else if (data.id) {
        this.sessionId = data.id;
      } else {
        console.error('❌ Invalid session creation response:', data);
        return false;
      }
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

    try {
      // Send directly to API server (which has its own gateway)
      const response = await fetch(`${this.config.apiUrl}/api/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.config.apiKey,
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
      return data;
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
    console.log('🤖 UbiquityAI - CLI Chat');
    console.log('========================');

    // Check if server is running
    const isHealthy = await this.checkHealth();
    if (!isHealthy) {
      console.error('❌ Unified Server is not responding. Please make sure it\'s running on', this.config.apiUrl);
      console.log('\nTo start the unified server, run: deno task start');
      Deno.exit(1);
    }

    // Create session
    const sessionCreated = await this.createSession();
    if (!sessionCreated) {
      console.error('❌ Failed to create chat session');
      Deno.exit(1);
    }

    console.log('\nType your messages below. Use /quit to exit.');
    console.log('✅ Connected to API Server - messages will be processed through the AI system.\n');

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

  private async readInput(promptText: string): Promise<string> {
    // Write prompt to stdout
    await Deno.stdout.write(new TextEncoder().encode(promptText));

    // Read from stdin
    const buffer = new Uint8Array(1024);
    const bytesRead = await Deno.stdin.read(buffer);

    if (bytesRead === null) {
      return '';
    }

    // Convert bytes to string and trim whitespace
    const input = new TextDecoder().decode(buffer.subarray(0, bytesRead)).trim();
    return input;
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
  const apiUrl = Deno.env.get('API_URL') || 'http://localhost:8000';
  const apiKey = Deno.env.get('API_KEY') || 'default-api-key';
  const userId = Deno.env.get('USER_ID') || `cli-user-${Date.now()}`;

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
