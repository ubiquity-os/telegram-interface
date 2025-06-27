/**
 * LLM Service Adapter
 *
 * Adapts the existing LLM service to the ILLMService interface
 * required by the MessagePreProcessor
 */

import { injectable } from 'npm:inversify@7.5.4';
import type { ILLMService } from './types.ts';
import { llmService } from '../../services/llm-service/llm-service.ts';
import { OpenRouterMessage } from '../../services/openrouter-types.ts';

@injectable()
export class LLMServiceAdapter implements ILLMService {
  async getAiResponse(params: {
    messages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
    }>;
  }): Promise<string> {
    // Convert to OpenRouterMessage format
    const openRouterMessages: OpenRouterMessage[] = params.messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // Call the actual LLM service
    return await llmService.getAiResponse({
      messages: openRouterMessages
    });
  }
}