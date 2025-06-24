import { OpenRouterMessage } from "../openrouter-types.ts";

export class AllLanguageModelsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllLanguageModelsUnavailableError";
  }
}

export type CallOpenRouterFn = (
  messages: OpenRouterMessage[],
  model: string,
  timeoutMs?: number
) => Promise<string>;

export interface LlmServiceParams {
  messages: OpenRouterMessage[];
}