import { Context } from "grammy";
import { getAIResponse } from "../services/get-ai-response.ts";

export async function messageHandler(ctx: Context) {
  try {
    const userMessage = ctx.message?.text;
    
    if (!userMessage) {
      console.log("Received message without text content");
      return;
    }

    console.log(`Processing message from user ${ctx.from?.id}: ${userMessage}`);

    // Send typing indicator
    await ctx.replyWithChatAction("typing");

    try {
      // Get AI response
      const aiResponse = await getAIResponse(userMessage);
      
      // Send AI response
      await ctx.reply(aiResponse);
      
      console.log(`Successfully sent AI response to user ${ctx.from?.id}`);
    } catch (aiError) {
      console.error("AI response error:", aiError);
      
      // Send error message to user
      await ctx.reply("I'm having trouble processing your message right now. Please try again later.");
    }
  } catch (error) {
    console.error("Failed to handle message:", error);
  }
}