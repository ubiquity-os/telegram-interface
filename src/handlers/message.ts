import { Context } from "grammy";
import { getAIResponse } from "../services/get-ai-response.ts";

export async function messageHandler(ctx: Context) {
  console.log("=== MESSAGE HANDLER CALLED ===");
  console.log("Handler version: AI-integrated with conversation context");
  console.log(`Update ID: ${ctx.update.update_id}`);
  
  try {
    const userMessage = ctx.message?.text;
    const chatId = ctx.chat?.id;
    
    if (!userMessage) {
      console.log("Received message without text content");
      return;
    }

    if (!chatId) {
      console.log("Could not determine chat ID");
      return;
    }

    console.log(`Processing message from user ${ctx.from?.id} in chat ${chatId}: ${userMessage}`);

    // Send typing indicator
    await ctx.replyWithChatAction("typing");

    try {
      console.log("Attempting to get AI response with conversation context...");
      // Get AI response with conversation context
      const aiResponse = await getAIResponse(userMessage, chatId);
      console.log("AI response received:", aiResponse?.substring(0, 100) + "...");
      
      // Send AI response
      await ctx.reply(aiResponse);
      
      console.log(`Successfully sent AI response to user ${ctx.from?.id} in chat ${chatId}`);
    } catch (aiError) {
      console.error("AI response error details:", {
        name: aiError.name,
        message: aiError.message,
        stack: aiError.stack
      });
      
      // Send error message to user
      await ctx.reply("I'm having trouble processing your message right now. Please try again later.");
    }
  } catch (error) {
    console.error("Failed to handle message:", error);
  }
}