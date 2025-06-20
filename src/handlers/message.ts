import { Context, InlineKeyboard } from "grammy";
import { getAIResponse, getLastToolResult } from "../services/get-ai-response.ts";
import { getRandomProcessingMessage, getLongProcessingMessage } from "../services/processing-messages.ts";

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
    
    // Send a processing message immediately for better UX
    const processingMessage = await ctx.reply(getRandomProcessingMessage());
    
    // Set up a timer to send a "taking longer" message if needed
    const longProcessingTimer = setTimeout(async () => {
      try {
        await ctx.api.editMessageText(
          chatId,
          processingMessage.message_id,
          getLongProcessingMessage()
        );
      } catch (error) {
        console.log("Could not update processing message:", error);
      }
    }, 5000); // Update after 5 seconds

    try {
      console.log("Attempting to get AI response with conversation context...");
      // Get AI response with conversation context
      const aiResponse = await getAIResponse(userMessage, chatId);
      console.log("AI response received:", aiResponse?.substring(0, 100) + "...");
      
      // Clear the long processing timer
      clearTimeout(longProcessingTimer);
      
      // Delete the processing message
      try {
        await ctx.api.deleteMessage(chatId, processingMessage.message_id);
      } catch (error) {
        console.log("Could not delete processing message:", error);
      }
      
      // Check if this is a followup question with options
      const lastToolResult = getLastToolResult();
      if (lastToolResult?.type === "followup_question" && lastToolResult.options) {
        // Create inline keyboard with options
        const keyboard = new InlineKeyboard();
        lastToolResult.options.forEach((option: string, index: number) => {
          keyboard.text(option, `option_${chatId}_${index}`).row();
        });
        
        // Send message with inline keyboard
        await ctx.reply(aiResponse, {
          reply_markup: keyboard,
        });
      } else {
        // Send regular text response
        await ctx.reply(aiResponse);
      }
      
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
