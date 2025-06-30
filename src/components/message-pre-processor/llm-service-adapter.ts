/**
 * LLM Service Adapter
 *
 * Adapts the existing LLM service to the ILLMService interface
 * required by the MessagePreProcessor
 */

import { injectable, inject } from 'inversify';
import type { ILLMService } from './types.ts';
import { OpenRouterLlmService, LLMMessage } from '../../services/llm-service/openrouter-llm-service.ts';
import { TYPES } from '../../core/types.ts';

@injectable()
export class LLMServiceAdapter implements ILLMService {
  private llmService: OpenRouterLlmService;

  constructor(
    @inject(TYPES.LLMService) private llmServiceFactory: () => OpenRouterLlmService
  ) {
    this.llmService = this.llmServiceFactory();
  }

  async getAiResponse(params: {
    messages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
    }>;
  }): Promise<string> {
    // The type is already compatible, so no conversion is needed.
    const llmMessages: LLMMessage[] = params.messages;

    // Call the actual LLM service
    return await this.llmService.getAiResponse({
      messages: llmMessages
    });
  }
}
