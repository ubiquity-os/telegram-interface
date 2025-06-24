import { callOpenRouter as defaultCallOpenRouter } from "./call-openrouter.ts";
import { AllLanguageModelsUnavailableError, LlmServiceParams, CallOpenRouterFn } from "./types.ts";

export class LlmService {
  private callOpenRouter: CallOpenRouterFn;

  private static readonly PREFERRED_MODELS: string[] = [
    "deepseek/deepseek-r1-0528:free",
    "deepseek/deepseek-r1:free",
    "deepseek/deepseek-chat-v3-0324:free",
    "deepseek/deepseek-chat:free",
    "google/gemini-2.0-flash-exp:free",
  ];

  constructor(callOpenRouterFn: CallOpenRouterFn = defaultCallOpenRouter) {
    this.callOpenRouter = callOpenRouterFn;
  }

  public async getAiResponse(params: LlmServiceParams): Promise<string> {
    const errors: Record<string, Error> = {};

    for (const model of LlmService.PREFERRED_MODELS) {
      try {
        const response = await this.callOpenRouter(params.messages, model);
        return response;
      } catch (error) {
        console.error(`Model ${model} failed:`, error.message);
        errors[model] = error;
      }
    }

    const errorMessages = Object.entries(errors)
      .map(([model, error]) => `${model}: ${error.message}`)
      .join("\n");

    throw new AllLanguageModelsUnavailableError(
      `All language models failed to respond. Errors:\n${errorMessages}`
    );
  }
}

export const llmService = new LlmService();