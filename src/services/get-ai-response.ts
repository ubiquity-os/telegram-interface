import { callOpenRouter } from "./call-openrouter.ts";
import { OpenRouterMessage } from "./openrouter-types.ts";
import { conversationHistory } from "./conversation-history.ts";
import { countTokens } from "../utils/token-counter.ts";

const MODEL = "deepseek/deepseek-r1-0528:free";
const MAX_CONTEXT_TOKENS = 64000; // 64k tokens for context, leaving plenty for response

export async function getAIResponse(userMessage: string, chatId: number): Promise<string> {
  const systemPrompt: OpenRouterMessage = {
    role: "system",
    content: "You are a helpful AI assistant in a Telegram bot. Provide concise, helpful responses to user messages. Keep responses under 4000 characters to fit Telegram's message limits."
  };

  const userMessageObj: OpenRouterMessage = {
    role: "user",
    content: userMessage,
  };

  // Build context with conversation history
  const messages = conversationHistory.buildContext(
    chatId,
    userMessageObj,
    systemPrompt,
    MAX_CONTEXT_TOKENS,
    countTokens
  );

  console.log(`Built context with ${messages.length} messages for chat ${chatId}`);
  console.log(`Calling OpenRouter with model: ${MODEL}`);
  
  const response = await callOpenRouter(messages, MODEL);
  
  // Store user message and AI response in conversation history
  conversationHistory.addMessage(chatId, userMessageObj);
  conversationHistory.addMessage(chatId, {
    role: "assistant",
    content: response,
  });
  
  return response;
}