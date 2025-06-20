import { callOpenRouter } from "./call-openrouter.ts";
import { OpenRouterMessage } from "./openrouter-types.ts";

const PRIMARY_MODEL = "deepseek/deepseek-r1-0528:free";
const FALLBACK_MODEL = "deepseek/deepseek-chat-v3-0324:free";

export async function getAIResponse(userMessage: string): Promise<string> {
  const messages: OpenRouterMessage[] = [
    {
      role: "system",
      content: "You are a helpful AI assistant in a Telegram bot. Provide concise, helpful responses to user messages. Keep responses under 4000 characters to fit Telegram's message limits."
    },
    {
      role: "user",
      content: userMessage,
    },
  ];

  try {
    // Try primary model first
    console.log(`Calling OpenRouter with primary model: ${PRIMARY_MODEL}`);
    return await callOpenRouter(messages, PRIMARY_MODEL);
  } catch (primaryError) {
    console.error("Primary model failed:", primaryError);
    
    // Fallback to secondary model
    try {
      console.log(`Falling back to secondary model: ${FALLBACK_MODEL}`);
      return await callOpenRouter(messages, FALLBACK_MODEL);
    } catch (fallbackError) {
      console.error("Fallback model also failed:", fallbackError);
      throw new Error("Both AI models failed to respond");
    }
  }
}