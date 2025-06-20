import { assertEquals } from "std/assert/mod.ts";
import { parseAssistantMessage, formatToolResult } from "../src/services/tool-parser.ts";

Deno.test("parseAssistantMessage - text only", () => {
  const message = "This is a simple text response without any tools.";
  const result = parseAssistantMessage(message);
  
  assertEquals(result.length, 1);
  assertEquals(result[0].type, "text");
  assertEquals(result[0].content, message);
});

Deno.test("parseAssistantMessage - single tool call", () => {
  const message = `I'll check the weather for you.

<use_mcp_tool>
<server_name>weather</server_name>
<tool_name>get_weather</tool_name>
<arguments>
{
  "city": "San Francisco"
}
</arguments>
</use_mcp_tool>`;

  const result = parseAssistantMessage(message);
  
  assertEquals(result.length, 2);
  assertEquals(result[0].type, "text");
  assertEquals(result[0].content, "I'll check the weather for you.\n\n");
  
  assertEquals(result[1].type, "tool_use");
  assertEquals(result[1].tool?.name, "use_mcp_tool");
  assertEquals(result[1].tool?.params.server_name, "weather");
  assertEquals(result[1].tool?.params.tool_name, "get_weather");
  assertEquals(result[1].tool?.params.arguments.trim(), `{
  "city": "San Francisco"
}`);
});

Deno.test("parseAssistantMessage - multiple tool calls", () => {
  const message = `Let me help you with that.

<ask_followup_question>
<question>Which city?</question>
<options>["New York", "London"]</options>
</ask_followup_question>

After that, I'll check the weather.

<use_mcp_tool>
<server_name>weather</server_name>
<tool_name>get_weather</tool_name>
<arguments>{"city": "Paris"}</arguments>
</use_mcp_tool>`;

  const result = parseAssistantMessage(message);
  
  assertEquals(result.length, 4);
  assertEquals(result[0].type, "text");
  assertEquals(result[1].type, "tool_use");
  assertEquals(result[1].tool?.name, "ask_followup_question");
  assertEquals(result[2].type, "text");
  assertEquals(result[3].type, "tool_use");
  assertEquals(result[3].tool?.name, "use_mcp_tool");
});

Deno.test("parseAssistantMessage - partial tool call", () => {
  const message = `I'll check that for you.

<use_mcp_tool>
<server_name>weather</server_name>
<tool_name>get_wea`;

  const result = parseAssistantMessage(message);
  
  assertEquals(result.length, 2);
  assertEquals(result[0].type, "text");
  assertEquals(result[1].type, "tool_use");
  assertEquals(result[1].tool?.partial, true);
  assertEquals(result[1].tool?.params.server_name, "weather");
  assertEquals(result[1].tool?.params.tool_name, "get_wea");
});

Deno.test("formatToolResult - success", () => {
  const result = formatToolResult("get_weather", {
    temperature: 22,
    condition: "Sunny"
  });
  
  const expected = `<tool_result>
<tool_name>get_weather</tool_name>
<status>success</status>
<output>{
  "temperature": 22,
  "condition": "Sunny"
}</output>
</tool_result>`;
  
  assertEquals(result, expected);
});

Deno.test("formatToolResult - error", () => {
  const result = formatToolResult("get_weather", null, "City not found");
  
  const expected = `<tool_result>
<tool_name>get_weather</tool_name>
<status>error</status>
<error>City not found</error>
</tool_result>`;
  
  assertEquals(result, expected);
});

Deno.test("parseAssistantMessage - completion tool", () => {
  const message = `<attempt_completion>
<result>
I've successfully retrieved the weather information. San Francisco is currently sunny with a temperature of 22°C.
</result>
</attempt_completion>`;

  const result = parseAssistantMessage(message);
  
  assertEquals(result.length, 1);
  assertEquals(result[0].type, "tool_use");
  assertEquals(result[0].tool?.name, "attempt_completion");
  assertEquals(result[0].tool?.params.result.trim(), 
    "I've successfully retrieved the weather information. San Francisco is currently sunny with a temperature of 22°C.");
});
