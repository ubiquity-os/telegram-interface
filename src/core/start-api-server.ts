/**
 * API Server Startup Script
 *
 * Updated to use real SystemOrchestrator instead of mock
 */

import { load } from "std/dotenv/mod.ts";
import { CoreApiServer, createDefaultCoreApiServerConfig } from './api-server.ts';
import { MessageRouter, createDefaultMessageRouterConfig } from './message-router.ts';
import { SessionManager, createDefaultSessionManagerConfig } from './session-manager.ts';
import { createSystemOrchestrator } from './component-factory.ts';

// Load .env file at startup
await load({ export: true });
console.log('[StartupScript] .env file loaded');

/**
 * Main startup function
 */
async function startApiServer(): Promise<void> {
  console.log('[StartupScript] Starting Core API Server with Real SystemOrchestrator...');

  try {
    // Create real SystemOrchestrator with all components
    console.log('[StartupScript] Creating Real SystemOrchestrator...');
    const systemOrchestrator = await createSystemOrchestrator();

    // Create MessageRouter with real orchestrator
    console.log('[StartupScript] Creating MessageRouter...');
    const messageRouterConfig = createDefaultMessageRouterConfig();
    const messageRouter = new MessageRouter(messageRouterConfig, systemOrchestrator as any);

    // Create SessionManager
    console.log('[StartupScript] Creating SessionManager...');
    const sessionManagerConfig = createDefaultSessionManagerConfig();
    const sessionManager = new SessionManager(sessionManagerConfig);
    await sessionManager.initialize();

    // Create CoreApiServer configuration
    console.log('[StartupScript] Creating CoreApiServer...');
    const apiServerConfig = createDefaultCoreApiServerConfig();

    // Override authentication for development (disable by default)
    apiServerConfig.authentication.required = false;
    console.log('[StartupScript] Authentication disabled for development');

    // Set environment-based API keys if available
    const apiKeysEnv = Deno.env.get('API_KEYS');
    if (apiKeysEnv) {
      apiServerConfig.authentication.validApiKeys = apiKeysEnv.split(',').map(key => key.trim());
      apiServerConfig.authentication.required = true;
      console.log('[StartupScript] Authentication enabled with environment API keys');
    }

    // Override port if specified in environment
    const portEnv = Deno.env.get('API_SERVER_PORT');
    if (portEnv) {
      const port = parseInt(portEnv, 10);
      if (!isNaN(port) && port > 0 && port <= 65535) {
        apiServerConfig.port = port;
        console.log(`[StartupScript] Using custom port from environment: ${port}`);
      }
    }

    console.log(`[StartupScript] API Server will listen on ${apiServerConfig.host}:${apiServerConfig.port}`);

    // Create and start the API server
    const apiServer = new CoreApiServer(apiServerConfig, messageRouter, sessionManager);

    console.log('[StartupScript] Starting API Server...');
    await apiServer.start();

    // Set up graceful shutdown handling
    const shutdown = async (signal: string) => {
      console.log(`[StartupScript] Received ${signal}, shutting down gracefully...`);

      try {
        await apiServer.stop();
        await sessionManager.shutdown();
        await systemOrchestrator.shutdown();
        console.log('[StartupScript] Graceful shutdown completed');
        Deno.exit(0);
      } catch (error) {
        console.error('[StartupScript] Error during shutdown:', error);
        Deno.exit(1);
      }
    };

    // Handle shutdown signals
    Deno.addSignalListener("SIGINT", () => shutdown("SIGINT"));
    Deno.addSignalListener("SIGTERM", () => shutdown("SIGTERM"));

    console.log('[StartupScript] ✅ API Server startup completed successfully');
    console.log('[StartupScript] 🚀 Server is ready to accept requests with REAL AI RESPONSES');
    console.log('[StartupScript] 📚 Available endpoints:');
    console.log('[StartupScript]   - GET  /api/v1/health');
    console.log('[StartupScript]   - POST /api/v1/messages');
    console.log('[StartupScript]   - POST /api/v1/sessions');
    console.log('[StartupScript]   - GET  /api/v1/sessions/:id');
    console.log('[StartupScript]   - GET  /api/v1/tools');
    console.log('[StartupScript] 🧠 AI System: ENABLED - Real LLM responses via SystemOrchestrator');
    console.log('[StartupScript] 🛑 Press Ctrl+C to gracefully shutdown');

  } catch (error) {
    console.error('[StartupScript] ❌ Failed to start API Server:', error);

    // Log more details for debugging
    if (error instanceof Error) {
      console.error('[StartupScript] Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
    }

    Deno.exit(1);
  }
}

// Only run if this file is being executed directly
if (import.meta.main) {
  console.log('[StartupScript] 🌟 Core API Server startup script starting...');
  console.log('[StartupScript] 🧠 Phase 2+: Real AI System with SystemOrchestrator');
  await startApiServer();
}