export interface Config {
  botToken: string;
  botId: string;
  previewBotToken?: string;
  previewBotId?: string;
  webhookSecret: string;
  logLevel: "debug" | "info" | "error";
  environment: "development" | "production";
  openRouterApiKey: string;
  deploymentUrl?: string;
}

// Type declarations for global variables
declare global {
  var Deno: any;
  var process: any;
}

// Helper function to get environment variable that works in both Deno and Bun
function getEnvVar(key: string): string | undefined {
  // Try Deno first
  if (typeof globalThis.Deno !== 'undefined' && globalThis.Deno.env) {
    return globalThis.Deno.env.get(key);
  }
  // Fall back to process.env for Bun/Node
  if (typeof globalThis.process !== 'undefined' && globalThis.process.env) {
    return globalThis.process.env[key];
  }
  return undefined;
}

// Load .env file for local development
async function loadEnvFile() {
  // For Deno runtime
  if (typeof globalThis.Deno !== 'undefined') {
    try {
      // @ts-ignore - Deno standard library module
      const { load } = await import("std/dotenv/mod.ts");
      await load({ export: true });
    } catch {
      // Ignore if module not found or .env doesn't exist
    }
  }
  // Bun automatically loads .env files, so we don't need to do anything
}

// Initialize env loading
await loadEnvFile();

export function getConfig(): Config {
  const botToken = getEnvVar("BOT_TOKEN");
  if (!botToken) {
    throw new Error("BOT_TOKEN is required");
  }

  // Parse bot ID from token
  const botId = botToken.split(":")[0];
  if (!botId) {
    throw new Error("Invalid BOT_TOKEN format");
  }

  const previewBotToken = getEnvVar("PREVIEW_BOT_TOKEN");
  const previewBotId = previewBotToken ? previewBotToken.split(":")[0] : undefined;

  const openRouterApiKey = getEnvVar("OPENROUTER_API_KEY");
  console.log("OPENROUTER_API_KEY exists:", !!openRouterApiKey);
  
  if (!openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is required");
  }

  return {
    botToken,
    botId,
    previewBotToken,
    previewBotId,
    webhookSecret: getEnvVar("WEBHOOK_SECRET") || crypto.randomUUID(),
    logLevel: (getEnvVar("LOG_LEVEL") || "info") as Config["logLevel"],
    environment: (getEnvVar("ENVIRONMENT") || "development") as Config["environment"],
    openRouterApiKey,
    deploymentUrl: getEnvVar("DEPLOYMENT_URL"),
  };
}
