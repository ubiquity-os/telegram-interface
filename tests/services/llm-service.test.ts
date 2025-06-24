import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.167.0/testing/asserts.ts";
import { spy, stub } from "https://deno.land/std@0.167.0/testing/mock.ts";
import { LlmService, AllLanguageModelsUnavailableError, CallOpenRouterFn } from "../../src/services/llm-service/index.ts";

Deno.test("LlmService", async (t) => {
  await t.step("should return response from the first model if it succeeds", async () => {
    const mockCallOpenRouter: CallOpenRouterFn = () => Promise.resolve("Success response");
    const llmService = new LlmService(mockCallOpenRouter);
    const response = await llmService.getAiResponse({ messages: [] });
    assertEquals(response, "Success response");
  });

  await t.step("should fall back to the second model if the first one fails", async () => {
    let callCount = 0;
    const mockCallOpenRouter: CallOpenRouterFn = () => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error("First model failed"));
      }
      return Promise.resolve("Success from second model");
    };
    const llmService = new LlmService(mockCallOpenRouter);
    const response = await llmService.getAiResponse({ messages: [] });
    assertEquals(response, "Success from second model");
    assertEquals(callCount, 2);
  });

  await t.step("should throw AllLanguageModelsUnavailableError if all models fail", async () => {
    const mockCallOpenRouter: CallOpenRouterFn = () => Promise.reject(new Error("Model failed"));
    const llmService = new LlmService(mockCallOpenRouter);
    await assertRejects(
      () => llmService.getAiResponse({ messages: [] }),
      AllLanguageModelsUnavailableError,
      "All language models failed to respond."
    );
  });
});