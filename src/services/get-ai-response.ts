import { callOpenRouter } from "./call-openrouter.ts";
import { OpenRouterMessage } from "./openrouter-types.ts";
import { conversationHistory } from "./conversation-history.ts";
import { countTokens } from "../utils/token-counter.ts";
import { parseAssistantMessage } from "./tool-parser.ts";
import { executeTool, formatExecutionResult } from "./tool-executor.ts";
import { generateSystemPrompt } from "./system-prompt.ts";
import { mcpHub } from "./mcp-hub.ts";
import { isValidResponse, generateInvalidResponseError } from "./response-validation.ts";

const MODEL = "deepseek/deepseek-r1-0528:free";
const MAX_CONTEXT_TOKENS = 64000; // 64k tokens for context, leaving plenty for response
const MAX_TOOL_ITERATIONS = 5; // Prevent infinite tool loops
const MAX_RETRY_ATTEMPTS = 3; // Max retries for forcing proper response format

export async function getAIResponse(userMessage: string, chatId: number): Promise<string> {
  // Initialize MCP hub if not already done
  await mcpHub.loadSettings();
  await mcpHub.connectAll();

  // Generate system prompt with MCP tools
  const systemPrompt: OpenRouterMessage = {
    role: "system",
    content: await generateSystemPrompt()
  };

  const userMessageObj: OpenRouterMessage = {
    role: "user",
    content: userMessage,
  };

  // Build initial context with conversation history
  let messages = await conversationHistory.buildContext(
    chatId,
    userMessageObj,
    systemPrompt,
    MAX_CONTEXT_TOKENS,
    countTokens
  );

  console.log(`Built context with ${messages.length} messages for chat ${chatId}`);
  
  // Store user message in conversation history
  await conversationHistory.addMessage(chatId, userMessageObj);

  let retryAttempts = 0;
  
  // Main retry loop - applies to EVERY message
  while (retryAttempts < MAX_RETRY_ATTEMPTS) {
    let finalResponse = "";
    let toolIterations = 0;
    let lastAssistantMessage = "";
    let hasValidResponse = false;

    // Tool calling loop
    while (toolIterations < MAX_TOOL_ITERATIONS) {
      console.log(`Calling OpenRouter with model: ${MODEL} (iteration ${toolIterations + 1}, retry ${retryAttempts})`);
      
      const response = await callOpenRouter(messages, MODEL);
      lastAssistantMessage = response;
      
      // Parse the assistant's response
      const contentBlocks = parseAssistantMessage(response);
      
      // Check if the response is valid (has content or tool calls)
      hasValidResponse = isValidResponse(contentBlocks);
      
      if (!hasValidResponse && retryAttempts < MAX_RETRY_ATTEMPTS - 1) {
        // Invalid response format, break inner loop to retry
        console.log("Invalid response format detected, will retry...");
        break;
      }
      
      let hasToolCall = false;
      let pendingUserResponse = false;
      
      for (const block of contentBlocks) {
        if (block.type === "text" && block.content) {
          finalResponse += block.content;
        } else if (block.type === "tool_use" && block.tool) {
          hasToolCall = true;
          
          // Execute the tool
          const result = await executeTool(block.tool);
          
          if (result.requiresUserResponse) {
            // For tools like ask_followup_question, we need to return immediately
            pendingUserResponse = true;
            
            if (result.result?.type === "followup_question") {
              // Format the question for the user
              let questionText = result.result.question;
              if (result.result.options && result.result.options.length > 0) {
                questionText += "\n\nOptions:\n";
                result.result.options.forEach((option: string, index: number) => {
                  questionText += `${index + 1}. ${option}\n`;
                });
              }
              finalResponse = questionText;
            }
            break;
          }
          
          // Format the tool result and add it to the conversation
          const toolResultMessage = formatExecutionResult(block.tool.name, result);
          
          // Add assistant message with tool call to messages
          messages.push({
            role: "assistant",
            content: response
          });
          
          // Add tool result as user message
          messages.push({
            role: "user",
            content: toolResultMessage
          });
          
          // Store in conversation history
          await conversationHistory.addMessage(chatId, {
            role: "assistant",
            content: response
          });
          await conversationHistory.addMessage(chatId, {
            role: "user",
            content: toolResultMessage
          });
        }
      }
      
      if (pendingUserResponse) {
        // Return immediately for user response
        return finalResponse;
      }
      
      if (!hasToolCall) {
        // No more tool calls, we're done with iterations
        break;
      }
      
      toolIterations++;
    }
    
    // Check if we need to retry due to invalid response format
    if (!hasValidResponse && retryAttempts < MAX_RETRY_ATTEMPTS - 1) {
      console.log(`Invalid response format. Retrying... (attempt ${retryAttempts + 1})`);
      
      // Add error message to force proper response
      const errorMessage: OpenRouterMessage = {
        role: "user",
        content: generateInvalidResponseError()
      };
      
      messages.push({
        role: "assistant",
        content: lastAssistantMessage
      });
      messages.push(errorMessage);
      
      // Store the failed attempt in history
      await conversationHistory.addMessage(chatId, {
        role: "assistant",
        content: lastAssistantMessage
      });
      await conversationHistory.addMessage(chatId, errorMessage);
      
      retryAttempts++;
      continue; // Retry the whole process
    }
    
    // If we have a valid response, store and return it
    if (hasValidResponse) {
      // Store final assistant message if not already stored
      if (!finalResponse.includes("<tool_result>")) {
        await conversationHistory.addMessage(chatId, {
          role: "assistant",
          content: lastAssistantMessage,
        });
      }
      
      // Clean up any remaining XML tags from the response
      finalResponse = finalResponse.replace(/<\/?[^>]+(>|$)/g, "").trim();
      
      return finalResponse || "I apologize, but I couldn't generate a proper response. Please try again.";
    }
    
    // If still no valid response after all retries, break
    break;
  }
  
  // If we've exhausted retries, return a fallback message
  return "I apologize, but I'm having trouble generating a proper response. Please try again.";
}
