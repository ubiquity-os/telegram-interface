import { Context } from "grammy";

export async function messageHandler(ctx: Context) {
  try {
    await ctx.reply("ok");
  } catch (error) {
    console.error("Failed to send reply:", error);
  }
}