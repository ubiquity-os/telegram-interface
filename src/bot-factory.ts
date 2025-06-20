import { Bot } from "grammy";
import { getConfig } from "./utils/config.ts";
import { messageHandler } from "./handlers/message.ts";
import { callbackQueryHandler } from "./handlers/callback-query.ts";
import { loggerMiddleware } from "./middleware/logger.ts";

// Cache for bot instances
const botCache = new Map<string, Bot>();

export function createBot(botToken: string): Bot {
  // Check if we already have this bot instance
  const cachedBot = botCache.get(botToken);
  if (cachedBot) {
    return cachedBot;
  }

  // Create new bot instance
  const bot = new Bot(botToken);

  // Middleware
  bot.use(loggerMiddleware);

  // Handlers
  bot.on("message", messageHandler);
  bot.on("callback_query:data", callbackQueryHandler);

  // Cache the bot instance
  botCache.set(botToken, bot);

  return bot;
}

// Determine which bot to use based on which webhook received the update
export function getBotForWebhook(webhookPath: string): Bot {
  const config = getConfig();
  
  // The key insight: each bot has its own webhook registered
  // So we know which bot based on which webhook endpoint received the request
  
  // Since both deployments use the same webhook path structure,
  // we need to know which deployment received it
  // This is why we need to check the hostname
  
  // But actually, the better approach is to have different webhook secrets
  // or to encode the bot info in the webhook path itself
  
  // For now, we'll need the hostname to determine which bot to use
  return createBot(config.botToken);
}

// Helper to determine which bot token to use based on deployment
// This is needed because Telegram doesn't send bot info in the update
export function getBotTokenForDeployment(hostname?: string): string {
  const config = getConfig();
  
  console.log(`Determining bot for hostname: ${hostname}`);
  console.log(`Production bot ID: ${config.botId}`);
  console.log(`Preview bot ID: ${config.previewBotId || "not configured"}`);
  
  // Check if this is a preview deployment
  if (hostname && !hostname.includes("telegram-interface.deno.dev")) {
    // This is a preview deployment
    if (config.previewBotToken) {
      console.log(`✅ Using PREVIEW bot (ID: ${config.previewBotId}) for deployment: ${hostname}`);
      return config.previewBotToken;
    } else {
      console.log(`⚠️  Preview bot token not configured, falling back to production bot`);
    }
  }
  
  // Default to production bot
  console.log(`✅ Using PRODUCTION bot (ID: ${config.botId}) for deployment: ${hostname || "unknown"}`);
  return config.botToken;
}
