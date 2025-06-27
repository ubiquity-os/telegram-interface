/**
 * Test the new OpenRouter LLM Service
 */

import { OpenRouterLlmService } from '../src/services/llm-service/openrouter-llm-service.ts';

async function testOpenRouterLlmService(): Promise<void> {
  console.log('🧪 Testing OpenRouter LLM Service\n');

  try {
    const service = new OpenRouterLlmService();
    await service.init();

    console.log('✅ Service initialized successfully');
    console.log('📋 Available models:', service.getAvailableModels().join(', '));

    const response = await service.generateResponse([
      { role: 'user', content: 'What is 2+2? Just give me the number.' }
    ]);

    console.log('✅ Response received:');
    console.log(`   Content: ${response.content.substring(0, 100)}...`);
    console.log(`   Model: ${response.model}`);
    console.log(`   Time: ${response.processingTime}ms`);
    console.log(`   Tokens: ${response.usage?.totalTokens}`);

    console.log('\n🎯 OpenRouter LLM Service is working correctly!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  testOpenRouterLlmService();
}