import { Bot } from "grammy";
import { getConfig } from "./utils/config.ts";
import { messageHandler } from "./handlers/message.ts";
import { loggerMiddleware } from "./middleware/logger.ts";

export function createBot() {
  const config = getConfig();
  const bot = new Bot(config.botToken);

  // Middleware
  bot.use(loggerMiddleware);

  // Handlers
  bot.on("message", messageHandler);

  return bot;
}