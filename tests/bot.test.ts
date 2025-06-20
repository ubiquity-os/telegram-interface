import { assertEquals } from "std/assert/mod.ts";
import { createBot } from "../src/bot.ts";

Deno.test("Bot creation", () => {
  const bot = createBot();
  assertEquals(typeof bot.handleUpdate, "function");
});

Deno.test("Config validation", async () => {
  // Mock environment
  Deno.env.set("BOT_TOKEN", "test-token");
  
  const { getConfig } = await import("../src/utils/config.ts");
  const config = getConfig();
  
  assertEquals(config.botToken, "test-token");
  assertEquals(config.environment, "development");
});