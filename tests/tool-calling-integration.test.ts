import { assertEquals, assertStringIncludes, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { load } from "std/dotenv/mod.ts";
import { generateSystemPrompt } from "../src/services/system-prompt.ts";
import { parseAssistantMessage } from "../src/services/tool-parser.ts";
import { executeTool, formatExecutionResult } from "../src/services/tool-executor.ts";
import { mcpHub } from "../src/services/mcp-hub.ts";
import { getAIResponse } from "../src/services/get-ai-response.ts";
import { conversationHistory } from "../src/services/conversation-history.ts";
import { callOpenRouter } from "../src/services/call-openrouter.ts";
import { OpenRouterMessage } from "../src/services/openrouter-types.ts";

// Load .env file
await load({ export: true }).catch(() => {
  // Ignore error if .env doesn't exist
});

// Test configuration
const TEST_CHAT_ID = 999999;
const TIMEOUT_MS = 30000; // 30 seconds for AI calls

// Clean up test conversation before and after tests
async function cleanupTestConversation() {
  await conversationHistory.clearHistory(TEST_CHAT_ID);
}

Deno.test("Integration: System prompt includes all MCP tools", async () => {
  // Load MCP settings and connect
  await mcpHub.loadSettings();
  await mcpHub.connectAll();
  
  // Generate system prompt
  const systemPrompt = await generateSystemPrompt();
  
  // Verify core tools are included
  assertStringIncludes(systemPrompt, "ask_followup_question");
  assertStringIncludes(systemPrompt, "attempt_completion");
  assertStringIncludes(systemPrompt, "use_mcp_tool");
  
  // Verify MCP tools are included (weather example)
  const tools = mcpHub.getAllTools();
  assertExists(tools.find(t => t.serverName === "weather"));
  assertStringIncludes(systemPrompt, "weather");
  assertStringIncludes(systemPrompt, "get_weather");
  
  // Verify tool format instructions
  assertStringIncludes(systemPrompt, "<tool_name>");
  assertStringIncludes(systemPrompt, "Tool Use Guidelines");
  
  console.log(`✓ System prompt includes ${tools.length} MCP tools`);
});

Deno.test("Integration: Real AI response with tool calling", { sanitizeOps: false, sanitizeResources: false }, async () => {
  await cleanupTestConversation();
  
  try {
    // Test 1: Weather query that should trigger tool use
    console.log("\nTest 1: Weather query...");
    const weatherResponse = await getAIResponse(
      "What's the current weather in Tokyo? Please be specific.",
      TEST_CHAT_ID
    );
    
    console.log("Weather response:", weatherResponse);
    assertExists(weatherResponse);
    assert(weatherResponse.length > 10, "Response should be substantial");
    
    // The response should contain weather information about Tokyo
    const lowerResponse = weatherResponse.toLowerCase();
    assert(
      lowerResponse.includes("tokyo") || lowerResponse.includes("weather"),
      "Response should mention Tokyo or weather"
    );
    
    // Test 2: Follow-up question scenario
    console.log("\nTest 2: Ambiguous query that needs clarification...");
    const followupResponse = await getAIResponse(
      "Show me the weather",
      TEST_CHAT_ID
    );
    
    console.log("Follow-up response:", followupResponse);
    assertExists(followupResponse);
    
    // Should ask for clarification about which city
    assert(
      followupResponse.includes("?") || followupResponse.includes("which") || followupResponse.includes("city"),
      "Response should ask for clarification"
    );
    
  } finally {
    await cleanupTestConversation();
  }
});

Deno.test("Integration: Tool parsing with real LLM response", { sanitizeOps: false, sanitizeResources: false }, async () => {
  await mcpHub.loadSettings();
  await mcpHub.connectAll();
  
  // Get a real AI response that includes tool calls
  const systemPrompt = await generateSystemPrompt();
  const messages: OpenRouterMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: "What's the weather in San Francisco right now?" }
  ];
  
  console.log("\nCalling AI for tool-using response...");
  const aiResponse = await callOpenRouter(messages, "deepseek/deepseek-r1-0528:free");
  console.log("AI Response:", aiResponse.substring(0, 200) + "...");
  
  // Parse the response
  const contentBlocks = parseAssistantMessage(aiResponse);
  console.log(`Parsed ${contentBlocks.length} content blocks`);
  
  // Verify we got content blocks
  assert(contentBlocks.length > 0, "Should parse at least one content block");
  
  // Look for tool uses
  const toolUses = contentBlocks.filter(b => b.type === "tool_use");
  console.log(`Found ${toolUses.length} tool uses`);
  
  // If there are tool uses, verify they can be executed
  for (const toolUse of toolUses) {
    if (toolUse.tool) {
      console.log(`Executing tool: ${toolUse.tool.name}`);
      const result = await executeTool(toolUse.tool);
      console.log(`Tool result:`, result);
      
      assertExists(result);
      assert(typeof result.success === "boolean", "Result should have success property");
      
      if (result.success) {
        assertExists(result.result, "Successful result should have result property");
      } else {
        assertExists(result.error, "Failed result should have error property");
      }
    }
  }
});

Deno.test("Integration: Multiple tool calls in conversation", { sanitizeOps: false, sanitizeResources: false }, async () => {
  await cleanupTestConversation();
  await mcpHub.loadSettings();
  await mcpHub.connectAll();
  
  try {
    // Start a conversation that requires multiple tool calls
    console.log("\nStarting multi-tool conversation...");
    
    // First message: Get weather for multiple cities
    const response1 = await getAIResponse(
      "Compare the weather between Tokyo and London. Which one is warmer?",
      TEST_CHAT_ID
    );
    
    console.log("Response 1:", response1.substring(0, 200) + "...");
    assertExists(response1);
    assert(response1.length > 20, "Response should be detailed");
    
    // Verify conversation history is maintained
    const history = await conversationHistory.getHistory(TEST_CHAT_ID);
    assert(history.length >= 2, "Should have at least user message and assistant response");
    
    // Second message: Follow-up requiring context
    const response2 = await getAIResponse(
      "What about New York? How does it compare to those two?",
      TEST_CHAT_ID
    );
    
    console.log("Response 2:", response2.substring(0, 200) + "...");
    assertExists(response2);
    
    // Should reference previous cities or maintain context
    const lowerResponse = response2.toLowerCase();
    assert(
      lowerResponse.includes("tokyo") || lowerResponse.includes("london") || 
      lowerResponse.includes("compare") || lowerResponse.includes("new york"),
      "Response should maintain context"
    );
    
  } finally {
    await cleanupTestConversation();
  }
});

Deno.test("Integration: Tool execution with MCP servers", async () => {
  await mcpHub.loadSettings();
  await mcpHub.connectAll();
  
  // Test direct MCP tool execution
  const tools = mcpHub.getAllTools();
  const weatherTool = tools.find(t => t.serverName === "weather" && t.tool.name === "get_weather");
  
  assertExists(weatherTool, "Weather tool should be available");
  
  // Execute weather tool directly
  console.log("\nExecuting weather tool directly...");
  const result = await mcpHub.executeTool("weather", "get_weather", { city: "Paris" });
  
  console.log("Direct tool result:", result);
  assertExists(result);
  assertStringIncludes(JSON.stringify(result), "Paris");
  
  // Test through tool executor
  const toolCall = {
    type: "tool_use" as const,
    name: "use_mcp_tool",
    params: {
      server_name: "weather",
      tool_name: "get_weather",
      arguments: JSON.stringify({ city: "Berlin" })
    }
  };
  
  console.log("\nExecuting through tool executor...");
  const execResult = await executeTool(toolCall);
  
  console.log("Executor result:", execResult);
  assertEquals(execResult.success, true);
  assertExists(execResult.result);
  assertStringIncludes(execResult.result.text || "", "Berlin");
});

Deno.test("Integration: Error handling in tool execution", async () => {
  // Test 1: Invalid tool name
  console.log("\nTest 1: Invalid tool name...");
  const invalidTool = {
    type: "tool_use" as const,
    name: "invalid_tool_name",
    params: {}
  };
  
  const result1 = await executeTool(invalidTool);
  assertEquals(result1.success, false);
  assertExists(result1.error);
  assertStringIncludes(result1.error, "Unknown tool");
  
  // Test 2: Invalid JSON in MCP tool
  console.log("\nTest 2: Invalid JSON in arguments...");
  const invalidJsonTool = {
    type: "tool_use" as const,
    name: "use_mcp_tool",
    params: {
      server_name: "weather",
      tool_name: "get_weather",
      arguments: "{ invalid json }"
    }
  };
  
  const result2 = await executeTool(invalidJsonTool);
  assertEquals(result2.success, false);
  assertExists(result2.error);
  assertStringIncludes(result2.error, "Invalid JSON");
  
  // Test 3: Missing required parameters
  console.log("\nTest 3: Missing required parameters...");
  const incompleteTool = {
    type: "tool_use" as const,
    name: "ask_followup_question",
    params: {
      // Missing 'question' parameter
    }
  };
  
  const result3 = await executeTool(incompleteTool);
  assertEquals(result3.success, false);
  assertExists(result3.error);
  assertStringIncludes(result3.error, "Missing required parameter");
  
  // Test 4: Non-existent MCP server
  console.log("\nTest 4: Non-existent MCP server...");
  const nonExistentServer = {
    type: "tool_use" as const,
    name: "use_mcp_tool",
    params: {
      server_name: "non_existent_server",
      tool_name: "some_tool",
      arguments: "{}"
    }
  };
  
  const result4 = await executeTool(nonExistentServer);
  assertEquals(result4.success, false);
  assertExists(result4.error);
});

Deno.test("Integration: Conversation context with tool results", { sanitizeOps: false, sanitizeResources: false }, async () => {
  await cleanupTestConversation();
  
  try {
    // Send a message that triggers tool use
    console.log("\nSending weather query...");
    const response1 = await getAIResponse(
      "What's the weather in Sydney, Australia?",
      TEST_CHAT_ID
    );
    
    assertExists(response1);
    console.log("Response:", response1.substring(0, 150) + "...");
    
    // Check conversation history includes tool results
    const history = await conversationHistory.getHistory(TEST_CHAT_ID);
    console.log(`Conversation has ${history.length} messages`);
    
    // Look for tool result messages
    const toolResultMessages = history.filter(msg => 
      msg.content.includes("<tool_result>") || 
      msg.content.includes("use_mcp_tool")
    );
    
    console.log(`Found ${toolResultMessages.length} tool-related messages`);
    
    // Send follow-up that requires context
    const response2 = await getAIResponse(
      "Is it good weather for the beach?",
      TEST_CHAT_ID
    );
    
    assertExists(response2);
    console.log("Follow-up response:", response2.substring(0, 150) + "...");
    
    // Response should reference the weather context
    assert(
      response2.toLowerCase().includes("beach") || 
      response2.toLowerCase().includes("weather") ||
      response2.toLowerCase().includes("sydney"),
      "Follow-up should maintain context"
    );
    
  } finally {
    await cleanupTestConversation();
  }
});

Deno.test("Integration: Tool result formatting", async () => {
  // Test formatting for different tool results
  
  // Success result
  const successResult = {
    success: true,
    result: {
      type: "text" as const,
      text: "Weather in London: 15°C, Cloudy"
    }
  };
  
  const successFormatted = formatExecutionResult("use_mcp_tool", successResult);
  console.log("\nSuccess result formatted:", successFormatted);
  
  assertStringIncludes(successFormatted, "<tool_result>");
  assertStringIncludes(successFormatted, "<tool_name>use_mcp_tool</tool_name>");
  assertStringIncludes(successFormatted, "<status>success</status>");
  assertStringIncludes(successFormatted, "Weather in London");
  
  // Error result
  const errorResult = {
    success: false,
    error: "Connection timeout"
  };
  
  const errorFormatted = formatExecutionResult("use_mcp_tool", errorResult);
  console.log("\nError result formatted:", errorFormatted);
  
  assertStringIncludes(errorFormatted, "<status>error</status>");
  assertStringIncludes(errorFormatted, "Connection timeout");
  
  // Follow-up question result
  const followupResult = {
    success: true,
    requiresUserResponse: true,
    result: {
      type: "followup_question" as const,
      question: "Which city?",
      options: ["Tokyo", "London", "New York"]
    }
  };
  
  const followupFormatted = formatExecutionResult("ask_followup_question", followupResult);
  console.log("\nFollow-up result formatted:", followupFormatted);
  
  assertStringIncludes(followupFormatted, "requires_user_response");
});

// Helper function for assertions
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// Run cleanup after all tests
if (import.meta.main) {
  // Clean up any test data
  setTimeout(async () => {
    await cleanupTestConversation();
  }, 1000);
}