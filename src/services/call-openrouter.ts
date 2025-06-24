import { getConfig } from "../utils/config.ts";
import { OpenRouterMessage, OpenRouterResponse } from "./openrouter-types.ts";

const TIMEOUT_MS = 30000; // 30 seconds

export async function callOpenRouter(
  messages: OpenRouterMessage[],
  model: string,
  timeoutMs: number = TIMEOUT_MS
): Promise<string> {
  const config = await getConfig();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.openRouterApiKey}`,
        "HTTP-Referer": config.deploymentUrl || "https://telegram-interface.deno.dev",
        "X-Title": "Telegram Bot",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as OpenRouterResponse;

    if (!data.choices?.[0]?.message?.content) {
      throw new Error("No response content from OpenRouter");
    }

    return data.choices[0].message.content;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === "AbortError") {
      throw new Error(`OpenRouter request timed out after ${timeoutMs}ms`);
    }

    throw error;
  }
}
