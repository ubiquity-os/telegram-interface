interface Config {
  botToken: string;
  webhookSecret: string;
  botType: "production" | "preview" | "local";
  logLevel: "debug" | "info" | "error";
  environment: "development" | "production";
  openRouterApiKey: string;
  deploymentUrl?: string;
  debug: DebugConfig;
}

export interface DebugConfig {
  enabled: boolean;
  verboseLogging: boolean;
  logPrompts: boolean;
  logResponses: boolean;
  logToolInputs: boolean;
  logToolOutputs: boolean;
  logStateTransitions: boolean;
  performanceTiming: boolean;
  logCircuitBreakerEvents: boolean;
}

export async function getConfig(): Promise<Config> {
  // Load .env file manually for Deno
  try {
    const envFile = await Deno.readTextFile('.env');
    const envLines = envFile.split('\n');
    for (const line of envLines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...valueParts] = trimmed.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').replace(/^["']|["']$/g, '');
          Deno.env.set(key, value);
        }
      }
    }
  } catch (error) {
    console.log('No .env file found or error reading it:', error.message);
  }

  // Determine bot type - defaults to production for backward compatibility
  const botType = (Deno.env.get("BOT_TYPE") ?? "local") as "production" | "preview" | "local";

  // Get appropriate bot token based on bot type
  let botToken: string;
  if (botType === "preview") {
    botToken = Deno.env.get("PREVIEW_BOT_TOKEN") || "";
    if (!botToken) throw new Error("PREVIEW_BOT_TOKEN is required when BOT_TYPE=preview");
  } else if (botType === "production") {
    botToken = Deno.env.get("BOT_TOKEN") || "";
    if (!botToken) throw new Error("BOT_TOKEN is required when BOT_TYPE=production");
  } else {
    botToken = Deno.env.get("BOT_TOKEN") || "";
  }

  // Get webhook secret
  const webhookSecret = botType === "preview"
    ? Deno.env.get("WEBHOOK_SECRET_PREVIEW") || ""
    : Deno.env.get("WEBHOOK_SECRET_PRODUCTION") || "";

  // Get OpenRouter API key
  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY") || "";
  if (!openRouterApiKey) throw new Error("OPENROUTER_API_KEY is required");

  // Build debug configuration from environment variables
  const debug: DebugConfig = {
    enabled: Deno.env.get("DEBUG_MODE") === "true",
    verboseLogging: Deno.env.get("DEBUG_VERBOSE") === "true",
    logPrompts: Deno.env.get("DEBUG_LOG_PROMPTS") === "true",
    logResponses: Deno.env.get("DEBUG_LOG_RESPONSES") === "true",
    logToolInputs: Deno.env.get("DEBUG_LOG_TOOL_INPUTS") === "true",
    logToolOutputs: Deno.env.get("DEBUG_LOG_TOOL_OUTPUTS") === "true",
    logStateTransitions: Deno.env.get("DEBUG_LOG_STATE_TRANSITIONS") === "true",
    performanceTiming: Deno.env.get("DEBUG_PERFORMANCE_TIMING") === "true",
    logCircuitBreakerEvents: Deno.env.get("DEBUG_LOG_CIRCUIT_BREAKER") === "true",
  };

  return {
    botToken,
    botType,
    webhookSecret,
    logLevel: (Deno.env.get("LOG_LEVEL") || "info") as Config["logLevel"],
    environment: (Deno.env.get("ENVIRONMENT") || "development") as Config["environment"],
    openRouterApiKey,
    deploymentUrl: Deno.env.get("DEPLOYMENT_URL"),
    debug,
  };
}
