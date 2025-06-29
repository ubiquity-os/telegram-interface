/**
 * Test OpenRouter's Built-in Model Routing
 *
 * This test validates OpenRouter's native model routing with the `models` parameter
 * for automatic fallbacks, rate limiting handling, and model selection.
 *
 * If successful, this approach can replace our complex sequential racing system.
 */

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterRequest {
  models: string[]; // Array of models for automatic fallbacks
  messages: OpenRouterMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

interface OpenRouterResponse {
  id: string;
  object: string;
  created: number;
  model: string; // The model that was actually used
  choices: Array<{
    index: number;
    message: OpenRouterMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

class OpenRouterRoutingTester {
  private readonly apiKey: string;
  private readonly baseURL = 'https://openrouter.ai/api/v1/chat/completions';

  // DeepSeek free models for testing (max 3 due to OpenRouter limitation)
  private readonly deepseekModels = [
    "deepseek/deepseek-r1-0528:free",
    "deepseek/deepseek-r1:free",
    "deepseek/deepseek-chat:free"
  ];

  constructor() {
    this.apiKey = Deno.env.get('OPENROUTER_API_KEY') || '';
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY environment variable is required');
    }
  }

  /**
   * Test OpenRouter's built-in model routing
   */
  async testOpenRouterRouting(): Promise<void> {
    console.log('\n🧪 Testing OpenRouter Built-in Model Routing\n');
    console.log(`📋 Models for fallback testing: ${this.deepseekModels.length} DeepSeek free models (OpenRouter max: 3)`);
    this.deepseekModels.forEach((model, index) => {
      console.log(`  ${index + 1}. ${model}`);
    });
    console.log('');

    const testCases = [
      { name: 'Simple Query', content: 'What is 2+2?' },
      { name: 'Complex Query', content: 'Explain the difference between machine learning and deep learning in detail.' },
      { name: 'Creative Query', content: 'Write a short poem about programming.' },
      { name: 'Reasoning Query', content: 'If I have 5 apples and give away 2, then buy 3 more, how many do I have? Show your work.' },
      { name: 'Rate Limit Test', content: 'Just respond with "OK" to test rate limiting.' }
    ];

    const results: Array<{
      testName: string;
      success: boolean;
      modelUsed?: string;
      responseTime: number;
      error?: string;
      responseLength?: number;
    }> = [];

    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      console.log(`🔄 Test ${i + 1}/${testCases.length}: ${testCase.name}`);

      const startTime = Date.now();

      try {
        const response = await this.makeOpenRouterRequest(testCase.content);
        const responseTime = Date.now() - startTime;

        console.log(`✅ SUCCESS: Model used: ${response.model}, Time: ${responseTime}ms`);
        console.log(`📊 Usage: ${response.usage.prompt_tokens} prompt + ${response.usage.completion_tokens} completion = ${response.usage.total_tokens} total tokens`);
        console.log(`📝 Response preview: "${response.choices[0].message.content.substring(0, 100)}..."`);

        results.push({
          testName: testCase.name,
          success: true,
          modelUsed: response.model,
          responseTime,
          responseLength: response.choices[0].message.content.length
        });

      } catch (error) {
        const responseTime = Date.now() - startTime;
        console.log(`❌ FAILED: ${error.message}, Time: ${responseTime}ms`);

        results.push({
          testName: testCase.name,
          success: false,
          responseTime,
          error: error.message
        });
      }

      console.log('');

      // Add a small delay between requests to avoid overwhelming the API
      if (i < testCases.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    this.printTestResults(results);
  }

  /**
   * Make a request using OpenRouter's built-in model routing
   */
  private async makeOpenRouterRequest(content: string): Promise<OpenRouterResponse> {
    const requestBody: OpenRouterRequest = {
      models: this.deepseekModels, // Let OpenRouter handle the fallbacks
      messages: [
        { role: 'user', content }
      ],
      temperature: 0.7,
      max_tokens: 500,
      stream: false
    };

    const response = await fetch(this.baseURL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/ubiquity-os/ubiquity-ai',
        'X-Title': 'Telegram Interface Bot - OpenRouter Routing Test'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    if (!data.choices || data.choices.length === 0) {
      throw new Error('No response choices returned');
    }

    if (!data.choices[0].message || !data.choices[0].message.content) {
      throw new Error('Invalid response format');
    }

    return data;
  }

  /**
   * Test rapid requests to see how OpenRouter handles rate limiting
   */
  async testRateLimitHandling(): Promise<void> {
    console.log('\n🚀 Testing Rate Limit Handling with Rapid Requests\n');

    const rapidRequests = 10;
    const promises: Promise<any>[] = [];

    console.log(`🔥 Sending ${rapidRequests} simultaneous requests...`);

    const startTime = Date.now();

    for (let i = 0; i < rapidRequests; i++) {
      promises.push(
        this.makeOpenRouterRequest(`Request #${i + 1}: What is ${i + 1} * ${i + 1}?`)
          .then(response => ({ success: true, model: response.model, requestId: i + 1 }))
          .catch(error => ({ success: false, error: error.message, requestId: i + 1 }))
      );
    }

    const results = await Promise.all(promises);
    const totalTime = Date.now() - startTime;

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`📊 Results after ${totalTime}ms:`);
    console.log(`✅ Successful: ${successful.length}/${rapidRequests}`);
    console.log(`❌ Failed: ${failed.length}/${rapidRequests}`);

    if (successful.length > 0) {
      const modelUsage = successful.reduce((acc, result) => {
        acc[result.model] = (acc[result.model] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log('\n📈 Model usage distribution:');
      Object.entries(modelUsage).forEach(([model, count]) => {
        console.log(`  ${model}: ${count} requests`);
      });
    }

    if (failed.length > 0) {
      console.log('\n❌ Failure analysis:');
      failed.forEach(result => {
        console.log(`  Request #${result.requestId}: ${result.error}`);
      });
    }
  }

  /**
   * Test additional scenarios
   */
  async testAdditionalScenarios(): Promise<void> {
    console.log('\n🔬 Testing Additional Scenarios\n');

    // Test with different model orders
    console.log('1️⃣ Testing model priority order...');
    const reversedModels = [...this.deepseekModels].reverse();

    try {
      const response = await this.makeOpenRouterRequestWithModels(
        'What is 1+1?',
        reversedModels
      );
      console.log(`✅ Reversed order: ${response.model} responded`);
    } catch (error) {
      console.log(`❌ Reversed order failed: ${error.message}`);
    }

    // Test with single model
    console.log('\n2️⃣ Testing single model...');
    try {
      const response = await this.makeOpenRouterRequestWithModels(
        'What is 2+2?',
        [this.deepseekModels[0]]
      );
      console.log(`✅ Single model: ${response.model} responded`);
    } catch (error) {
      console.log(`❌ Single model failed: ${error.message}`);
    }

    // Test longer content
    console.log('\n3️⃣ Testing longer content generation...');
    try {
      const response = await this.makeOpenRouterRequestWithModels(
        'Write a detailed explanation of how HTTP works, including request/response cycle, headers, and status codes.',
        this.deepseekModels
      );
      console.log(`✅ Long content: ${response.model} responded with ${response.choices[0].message.content.length} characters`);
    } catch (error) {
      console.log(`❌ Long content failed: ${error.message}`);
    }
  }

  /**
   * Make a request with specific models array
   */
  private async makeOpenRouterRequestWithModels(content: string, models: string[]): Promise<OpenRouterResponse> {
    const requestBody: OpenRouterRequest = {
      models: models,
      messages: [
        { role: 'user', content }
      ],
      temperature: 0.7,
      max_tokens: 1000,
      stream: false
    };

    const response = await fetch(this.baseURL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/ubiquity-os/ubiquity-ai',
        'X-Title': 'Telegram Interface Bot - OpenRouter Routing Test'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Print formatted test results
   */
  private printTestResults(results: Array<{
    testName: string;
    success: boolean;
    modelUsed?: string;
    responseTime: number;
    error?: string;
    responseLength?: number;
  }>): void {
    console.log('📋 Test Results Summary\n');

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log(`✅ Successful: ${successful.length}/${results.length}`);
    console.log(`❌ Failed: ${failed.length}/${results.length}`);

    if (successful.length > 0) {
      const avgTime = successful.reduce((sum, r) => sum + r.responseTime, 0) / successful.length;
      console.log(`⏱️  Average response time: ${Math.round(avgTime)}ms`);

      const modelUsage = successful.reduce((acc, result) => {
        const model = result.modelUsed || 'unknown';
        acc[model] = (acc[model] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      console.log('\n📊 Model selection distribution:');
      Object.entries(modelUsage).forEach(([model, count]) => {
        const percentage = (count / successful.length) * 100;
        console.log(`  ${model}: ${count} times (${Math.round(percentage)}%)`);
      });
    }

    if (failed.length > 0) {
      console.log('\n❌ Failed tests:');
      failed.forEach(result => {
        console.log(`  ${result.testName}: ${result.error}`);
      });
    }

    console.log('\n🎯 Analysis:');
    if (successful.length === results.length) {
      console.log('✅ OpenRouter routing handled all requests successfully!');
      console.log('✅ Automatic fallback system is working properly!');
      console.log('✅ No manual sequential racing or performance tracking needed!');
      console.log('\n💡 Recommendation: Replace current sequential racing with OpenRouter routing');
    } else if (successful.length > 0) {
      console.log('⚠️  OpenRouter routing partially successful');
      console.log('⚠️  Some requests failed - needs investigation');
    } else {
      console.log('❌ OpenRouter routing failed completely');
      console.log('❌ Current sequential racing approach may be better');
    }
  }
}

// Main test runner
async function runOpenRouterRoutingTests(): Promise<void> {
  try {
    console.log('🚀 OpenRouter Model Routing Test Suite');
    console.log('=====================================');

    const tester = new OpenRouterRoutingTester();

    // Test 1: Basic routing functionality
    await tester.testOpenRouterRouting();

    // Test 2: Rate limit handling
    await tester.testRateLimitHandling();

    // Test 3: Additional scenarios
    await tester.testAdditionalScenarios();

    console.log('\n🏁 All tests completed!');

  } catch (error) {
    console.error('💥 Test suite failed:', error);
    Deno.exit(1);
  }
}

// Run tests if this file is executed directly
if (import.meta.main) {
  runOpenRouterRoutingTests();
}

export { OpenRouterRoutingTester, runOpenRouterRoutingTests };