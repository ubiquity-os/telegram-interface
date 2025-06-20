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

export function getBotForUpdate(update: any): Bot {
  const config = getConfig();
  
  // Try to detect which bot this update is for
  // Check various fields that might contain bot information
  
  // For messages with bot commands
  if (update.message?.text?.includes("@")) {
    const match = update.message.text.match(/@(\w+)bot/i);
    if (match) {
      const username = match[1];
      // You could match username, but for now we'll use other methods
    }
  }
  
  // For inline queries, callback queries, etc., we might have bot info
  // But the most reliable way is to check which deployment received the webhook
  
  // Since we can't easily determine from the update alone,
  // we'll need to pass additional context from the webhook handler
  // For now, return the default bot
  return createBot(config.botToken);
}

// Helper to determine which bot token to use based on deployment
export function getBotTokenForDeployment(hostname?: string): string {
  const config = getConfig();
  
  console.log(`Determining bot for hostname: ${hostname}`);
  console.log(`Production bot ID: ${config.botId}`);
  console.log(`Preview bot ID: ${config.previewBotId || "not configured"}`);
  
  // If we have a hostname, check if it's a preview deployment
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
