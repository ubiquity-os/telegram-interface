import { Context } from "grammy";
import { getAIResponse, getLastToolResult } from "../services/get-ai-response.ts";

export async function callbackQueryHandler(ctx: Context) {
  console.log("=== CALLBACK QUERY HANDLER CALLED ===");
  
  try {
    const data = ctx.callbackQuery?.data;
    const chatId = ctx.chat?.id;
    
    if (!data || !chatId) {
      console.log("Missing callback data or chat ID");
      await ctx.answerCallbackQuery();
      return;
    }
    
    console.log(`Processing callback query: ${data} from chat ${chatId}`);
    
    // Parse the callback data format: option_{chatId}_{index}
    if (data.startsWith("option_")) {
      const parts = data.split("_");
      const callbackChatId = parseInt(parts[1]);
      const optionIndex = parseInt(parts[2]);
      
      // Verify this callback is for the correct chat
      if (callbackChatId !== chatId) {
        console.log("Callback chat ID mismatch");
        await ctx.answerCallbackQuery("This button is not for you.");
        return;
      }
      
      // Get the last tool result to find the selected option
      const lastToolResult = getLastToolResult();
      if (lastToolResult?.type === "followup_question" && lastToolResult.options) {
        const selectedOption = lastToolResult.options[optionIndex];
        
        if (selectedOption) {
          // Answer the callback query to remove the loading state
          await ctx.answerCallbackQuery();
          
          // Update the message to show the selected option
          await ctx.editMessageText(`${lastToolResult.question}\n\n✅ You selected: ${selectedOption}`);
          
          // Send typing indicator
          await ctx.replyWithChatAction("typing");
          
          // Process the selected option as the user's response
          console.log(`User selected option: ${selectedOption}`);
          const aiResponse = await getAIResponse(selectedOption, chatId);
          
          // Send the AI's response
          await ctx.reply(aiResponse);
          
          console.log(`Successfully processed callback query for chat ${chatId}`);
        } else {
          await ctx.answerCallbackQuery("Invalid option selected.");
        }
      } else {
        await ctx.answerCallbackQuery("This selection is no longer valid.");
      }
    } else {
      await ctx.answerCallbackQuery();
    }
  } catch (error) {
    console.error("Failed to handle callback query:", error);
    await ctx.answerCallbackQuery("An error occurred processing your selection.");
  }
}
