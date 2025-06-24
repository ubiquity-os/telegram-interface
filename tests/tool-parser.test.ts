/// <reference types="bun-types" />
import { parseAssistantMessage, formatToolResult } from "../src/services/tool-parser.ts";
import { it, expect } from "bun:test";

it("parseAssistantMessage - text only", () => {
  const message = "This is a test message.";
  const result = parseAssistantMessage(message);
  expect(result.length).toBe(1);
  expect(result[0].type).toBe("text");
  expect(result[0].content).toBe(message);
});

it("parseAssistantMessage - single tool call", () => {
  const message = `<test><foo>bar</foo></test>`;
  const result = parseAssistantMessage(message);
  expect(result.length).toBe(1);
  expect(result[0].type).toBe("tool_use");
  expect(result[0].tool?.name).toBe("test");
  expect(result[0].tool?.params).toEqual({ foo: "bar" });
});

it("parseAssistantMessage - multiple tool calls", () => {
  const message = `<test1><a>1</a></test1><test2><b>2</b></test2>`;
  const result = parseAssistantMessage(message);
  expect(result.length).toBe(2);
  expect(result[0].tool?.name).toBe("test1");
  expect(result[1].tool?.name).toBe("test2");
});

it("parseAssistantMessage - partial tool call", () => {
  const message = `I will call a tool.\n<weather>`;
  const result = parseAssistantMessage(message);
  expect(result.length).toBe(2);
  expect(result[0].type).toBe("text");
  expect(result[0].content).toBe("I will call a tool.");
  expect(result[1].type).toBe("tool_use");
  expect(result[1].tool?.name).toBe("weather");
  expect(result[1].tool?.partial).toBe(true);
});

it("formatToolResult - success", () => {
  const formatted = formatToolResult("test", "Success!");
  expect(formatted).toContain("<tool_result>");
  expect(formatted).toContain(`<tool_name>test</tool_name>`);
  expect(formatted).toContain(`<output>Success!</output>`);
});

it("formatToolResult - error", () => {
  const formatted = formatToolResult("test", null, "Failure!");
  expect(formatted).toContain("<tool_result>");
  expect(formatted).toContain(`<tool_name>test</tool_name>`);
  expect(formatted).toContain(`<error>Failure!</error>`);
});

it("parseAssistantMessage - attempt_completion tool", () => {
  const message = "<attempt_completion>All done!</attempt_completion>";
  const result = parseAssistantMessage(message);
  expect(result.length).toBe(1);
  expect(result[0].type).toBe("tool_use");
  expect(result[0].tool?.name).toBe("attempt_completion");
  expect(result[0].tool?.params).toEqual({});
});
