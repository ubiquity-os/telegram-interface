import { Container } from 'inversify';
import { injectable } from 'inversify';
import 'reflect-metadata';

@injectable()
class TestService {
  constructor() {
    console.log('TestService created');
  }
}

const container = new Container();
const TYPES = { TestService: Symbol.for('TestService') };

try {
  console.log('Testing basic DI container binding...');
  container.bind(TYPES.TestService).to(TestService).inSingletonScope();
  const service = container.get(TYPES.TestService);
  console.log('SUCCESS: Basic service binding works!', service.constructor.name);

  // Now try with OpenRouterLlmService but skip constructor dependencies
  console.log('Testing OpenRouterLlmService...');
  const { OpenRouterLlmService } = await import('./src/services/llm-service/openrouter-llm-service.ts');

  // Create service with empty config to avoid API key requirement
  const serviceInstance = new OpenRouterLlmService({
    apiKey: 'test-key',
    debugMode: true
  });
  console.log('SUCCESS: OpenRouterLlmService can be instantiated manually:', serviceInstance.constructor.name);

} catch (error) {
  console.error('ERROR:', error.message);
  console.error('Stack:', error.stack);
}
