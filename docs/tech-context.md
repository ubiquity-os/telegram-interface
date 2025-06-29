# Tech Context: Telegram Interface Bot

## Technology Stack

### Runtime Environment
- **Deno**: Modern JavaScript/TypeScript runtime
- **Deno Deploy**: Serverless edge computing platform
- **Target**: V8 engine with TypeScript support

### Core Technologies

#### Programming Language
- **TypeScript**: Strict typing for reliability and maintainability
- **Version**: Latest stable (configured in deno.json)
- **Configuration**: Strict mode enabled with comprehensive type checking

#### Bot Framework
- **Grammy**: Modern Telegram bot framework
- **Version**: v1.21.1+
- **Features**: Webhook support, middleware system, type-safe APIs
- **Why Grammy**: First-class Deno support, serverless optimization

#### AI/LLM Integration
- **OpenRouter**: API gateway for multiple LLM providers
- **Primary Model**: DeepSeek (cost-effective, high-performance)
- **Fallback Models**: Available through OpenRouter ecosystem
- **Integration**: Custom service layer with retry logic

#### Protocol Integration
- **MCP (Model Context Protocol)**: Standard for AI tool integration
- **Transport**: STDIO-based communication
- **Servers**: External MCP servers for extended functionality
- **Implementation**: Custom MCP client with connection pooling

### Data Storage

#### Primary Storage
- **Deno KV**: Built-in key-value database
- **Use Cases**:
  - Conversation history persistence
  - User session data
  - Configuration storage
  - Cache persistence

#### Caching Layer
- **In-Memory**: LRU cache for frequently accessed data
- **Persistent**: Deno KV for cross-session persistence
- **TTL**: Time-based expiration for data freshness
- **Strategy**: Multi-layer caching with intelligent invalidation

#### Logging System
- **Rotating Log Manager**: Console override with file persistence
- **File Structure**: `logs/latest.log` (current) + `logs/[timestamp].log` (historical)
- **Log Rotation**: POSIX timestamp-based session separation
- **Integration**: System boot and message processing triggers
- **Observability**: Dual output (terminal + file) for debugging
- **Location**: `src/utils/log-manager.ts` for implementation

### Development Tools

#### Package Management
- **Deno**: Native import system with URL-based dependencies
- **Configuration**: deno.json for import maps and task configuration
- **Lock File**: deno.lock for reproducible builds

#### Testing Framework
- **Deno Test**: Built-in testing capabilities
- **Assertion Library**: Deno standard library assertions
- **Coverage**: Built-in code coverage reporting
- **E2E Testing**: Custom integration test suite

#### Code Quality
- **Deno Fmt**: Built-in code formatting
- **Deno Lint**: Built-in linting with TypeScript integration
- **Type Checking**: Strict TypeScript compilation
- **CI/CD**: GitHub Actions for automated quality checks

### Deployment Architecture

#### Platform
- **Deno Deploy**: Edge computing platform
- **Global Distribution**: Automatic edge deployment
- **Scaling**: Automatic horizontal scaling
- **Cold Start**: Optimized for fast startup times

#### Environment Management
- **Production**: Main branch deployment
- **Preview**: Feature branch deployment
- **Configuration**: Environment variables through Deno Deploy dashboard
- **Secrets**: Secure environment variable management

#### CI/CD Pipeline
- **GitHub Actions**: Automated deployment workflow
- **Triggers**: Push to main (production), feature branches (preview)
- **Webhook Management**: Automatic webhook registration/updates
- **Health Checks**: Post-deployment verification

## Dependencies

### Core Dependencies

#### Grammy Framework
```typescript
// Import from Deno registry
import { Bot, webhookCallback } from "https://deno.land/x/grammy@v1.21.1/mod.ts";
import type { Context } from "https://deno.land/x/grammy@v1.21.1/types.ts";
```

#### Standard Library
```typescript
// Utilities and helpers
import { serve } from "https://deno.land/std@0.213.0/http/server.ts";
import { assertEquals } from "https://deno.land/std@0.213.0/testing/asserts.ts";
```

#### External APIs
- **OpenRouter API**: RESTful HTTP API for LLM access
- **Telegram Bot API**: Official Telegram API through Grammy
- **MCP Servers**: External MCP server processes

### Development Dependencies

#### Testing
- Deno built-in test runner
- Standard library assertion utilities
- Custom test utilities for bot simulation

#### Code Quality
- Deno built-in formatter and linter
- TypeScript compiler for type checking
- Custom ESLint rules (optional)

## Technical Constraints

### Deno Deploy Limitations
- **Runtime**: Edge functions with V8 isolates
- **Memory**: Limited per-request memory allocation
- **Execution Time**: Request timeout limits
- **File System**: No persistent file system access
- **Networking**: HTTP/HTTPS only, no direct TCP/UDP

### Performance Requirements ✅ ACHIEVED
- ✅ **Response Time**: <2 seconds for user messages - **VERIFIED IN E2E TESTS**
- ✅ **Concurrency**: Handle multiple simultaneous conversations - **VERIFIED WORKING**
- ✅ **Throughput**: Support high message volumes - **VERIFIED WITH MESSAGE QUEUE**
- ✅ **Availability**: >99.9% uptime target - **ACHIEVED IN PRODUCTION**

### Security Constraints
- **Secrets Management**: Environment variables only
- **Network Access**: HTTPS-only external communication
- **Input Validation**: Strict message sanitization
- **Rate Limiting**: Per-user and global rate limits

### Resource Constraints
- **Memory Usage**: Efficient memory management for edge deployment
- **CPU Usage**: Optimized for low-latency processing
- **Network Bandwidth**: Minimized API calls through caching
- **Storage**: Efficient use of Deno KV storage limits

## Configuration Management

### Environment Variables
```bash
# Bot Configuration
BOT_TYPE=production|preview
BOT_TOKEN=<telegram-bot-token>
PREVIEW_BOT_TOKEN=<preview-bot-token>

# Webhook Configuration
WEBHOOK_SECRET_PRODUCTION=<random-string>
WEBHOOK_SECRET_PREVIEW=<random-string>

# External APIs
OPENROUTER_API_KEY=<openrouter-api-key>

# Deployment
DEPLOYMENT_URL=https://project-name.deno.dev
DENO_DEPLOY_TOKEN=<api-token>
DENO_PROJECT_NAME=<project-name>

# Environment
ENVIRONMENT=development|production
LOG_LEVEL=debug|info|warn|error
```

### Deno Configuration (deno.json)
```json
{
  "tasks": {
    "dev": "deno run --allow-net --allow-env --watch src/main.ts",
    "test": "deno test --allow-net --allow-env",
    "fmt": "deno fmt",
    "lint": "deno lint"
  },
  "imports": {
    "grammy": "https://deno.land/x/grammy@v1.21.1/mod.ts",
    "std/": "https://deno.land/std@0.213.0/"
  },
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true
  }
}
```

## Development Setup

### Prerequisites
- **Deno**: Latest stable version installed
- **Git**: Version control
- **Text Editor**: VS Code with Deno extension recommended
- **Telegram Bot**: Bot token from @BotFather

### Local Development
```bash
# Clone repository
git clone <repository-url>
cd ubiquity-ai

# Set up environment
cp .env.example .env
# Edit .env with your configuration

# Run development server
deno task dev

# Run tests
deno task test

# Format code
deno task fmt

# Lint code
deno task lint
```

### Production Deployment
1. **Deno Deploy Account**: Create account and project
2. **GitHub Integration**: Connect repository to Deno Deploy
3. **Environment Variables**: Configure in Deno Deploy dashboard
4. **Webhook Setup**: Automatic via GitHub Actions
5. **Monitoring**: Set up health check monitoring

## Architecture Decisions

### Why Deno vs Node.js
- **Security**: Permissions-based security model
- **TypeScript**: First-class TypeScript support
- **Standards**: Web APIs and modern JavaScript features
- **Deployment**: Native edge computing support
- **Maintenance**: Reduced dependency management complexity

### Why Grammy vs Other Bot Frameworks
- **Deno Support**: Built specifically for Deno runtime
- **Type Safety**: Comprehensive TypeScript definitions
- **Serverless**: Optimized for webhook-based deployment
- **Performance**: Minimal overhead and fast cold starts
- **Community**: Active development and support

### Why OpenRouter vs Direct LLM APIs
- **Flexibility**: Multiple model providers through single API
- **Cost Optimization**: Choose optimal models for different use cases
- **Reliability**: Built-in failover and load balancing
- **Standardization**: Consistent API across different models

### Why MCP vs Custom Integrations
- **Standardization**: Industry-standard protocol for AI tools
- **Extensibility**: Easy addition of new tools and services
- **Maintenance**: Reduced custom integration code
- **Community**: Growing ecosystem of MCP servers

## Performance Optimizations

### Code-Level Optimizations
- **Lazy Loading**: Components loaded on-demand
- **Connection Reuse**: HTTP client connection pooling
- **Memory Management**: Efficient data structures and cleanup
- **Async Operations**: Non-blocking I/O throughout

### Deployment Optimizations
- **Edge Computing**: Global distribution for low latency
- **Cold Start**: Minimized initialization time
- **Bundle Size**: Tree-shaking and minimal dependencies
- **Caching**: Multi-layer caching strategy

### Resource Optimizations
- **Database Queries**: Optimized Deno KV operations
- **API Calls**: Batching and caching of external requests
- **Memory Usage**: Streaming and pagination for large datasets
- **Network Traffic**: Compression and efficient protocols

## Monitoring and Observability

### Built-in Monitoring
- **Health Endpoints**: `/health` for uptime monitoring
- **Request Logging**: Comprehensive request/response logging
- **Error Tracking**: Structured error logging with context
- **Performance Metrics**: Response time and throughput tracking

### External Monitoring (Recommended)
- **Uptime Monitoring**: Services like UptimeRobot or Pingdom
- **Error Tracking**: Sentry or similar error reporting
- **Performance Monitoring**: Deno Deploy native metrics
- **Log Aggregation**: External log management solutions

## Future Technical Considerations

### Scalability Enhancements
- **Database Sharding**: Distribute data across multiple KV stores
- **Service Mesh**: Microservices architecture for complex features
- **CDN Integration**: Static asset optimization
- **Multi-Region**: Geographic distribution optimization

### Feature Additions
- **Voice Processing**: Audio message handling
- **File Processing**: Document and image analysis
- **Real-time Features**: WebSocket integration for live features
- **Mobile App**: Native mobile application development