/**
 * LLM Service Adapter
 *
 * Adapts the existing LLM service to the ILLMService interface
 * required by the MessagePreProcessor
 */

import { injectable, inject } from 'npm:inversify@7.5.4';
import type { ILLMService } from './types.ts';
import { LlmService, LLMMessage } from '../../services/llm-service/index.ts';
import { TYPES } from '../../core/types.ts';

@injectable()
export class LLMServiceAdapter implements ILLMService {
  constructor(
    @inject(TYPES.LLMService) private llmService: LlmService
  ) {}

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
