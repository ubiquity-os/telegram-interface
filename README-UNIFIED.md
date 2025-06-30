# 🚀 Unified Multi-Platform AI Server

**Problem Solved**: No more managing two separate backend services!

The new **Unified Server** consolidates everything into a single, powerful multi-platform AI service that handles REST API, Telegram, GitHub, Google Drive, and future MCP integrations.

## 🎯 **Quick Start**

### **Single Command Setup**
```bash
# Start the unified server (handles everything)
deno task start
```

That's it! Your AI bot is now running on **port 8000** with:
- ✅ **REST API** endpoints
- ✅ **Telegram Bot** webhooks
- 🚧 **GitHub Integration** (ready for implementation)
- 🚧 **Google Drive Integration** (ready for implementation)
- 🔮 **MCP Protocol** support (future)

## 📡 **Available Endpoints**

### **REST API**
- `POST /api/v1/messages` - Send message to AI
- `POST /api/v1/sessions` - Create session
- `GET /api/v1/sessions/:id` - Get session
- `GET /api/v1/health` - API health check
- `GET /api/v1/tools` - Available tools

### **Telegram**
- `POST /webhook/{secret}` - Telegram webhook

### **Internal Tools**
- `GET /health` - Server health
- `POST /test/message` - E2E testing
- `GET /conversations` - View conversations

## 🧪 **Test Your AI System**

### **Quick API Test**
```bash
curl -X POST http://localhost:8000/api/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Hello! Tell me a joke about programming",
    "sessionId": "test-session-123",
    "userId": "test-user"
  }'
```

### **E2E Test with Real AI**
```bash
curl -X POST http://localhost:8000/test/message \
  -H "Content-Type: application/json" \
  -d '{
    "text": "What is TypeScript?",
    "chatId": "123456789",
    "userId": "987654321"
  }'
```

## 🏗️ **Architecture Overview**

```
┌─────────────────────────────────────────────────────────────┐
│                 🌟 Unified Multi-Platform Server            │
├─────────────────────────────────────────────────────────────┤
│                         Port 8000                          │
├─────────────────────────────────────────────────────────────┤
│  📡 Ingress Points:                                        │
│  • REST API (/api/v1/*)                    ✅ ACTIVE      │
│  • Telegram Webhooks (/webhook/*)          ✅ ACTIVE      │
│  • GitHub Webhooks (/webhook/github)       🚧 PLANNED     │
│  • Google Drive (/webhook/google-drive)    🚧 PLANNED     │
│  • MCP Protocol Handlers                   🔮 FUTURE      │
├─────────────────────────────────────────────────────────────┤
│  🔄 Processing Pipeline:                                   │
│  API Gateway → SystemOrchestrator → AI Components         │
├─────────────────────────────────────────────────────────────┤
│  🧠 AI System:                                            │
│  • MessagePreProcessor (LLM Analysis)                     │
│  • ContextManager (Conversation History)                  │
│  • DecisionEngine (Routing Logic)                         │
│  • ResponseGenerator (Real LLM Responses)                 │
│  • Tool Integration (MCP Tools)                           │
└─────────────────────────────────────────────────────────────┘
```

## 💪 **Benefits Over Dual-Service Setup**

### **Before (2 Services)**
```bash
# Terminal 1: API Server
deno task api-server:watch  # Port 8001

# Terminal 2: Main Bot
deno task dev              # Port 8002
```

### **After (1 Service)**
```bash
# Single Terminal: Everything
deno task start            # Port 8000
```

## 🔧 **Development Commands**

```bash
# 🚀 Production
deno task start              # Start unified server
deno task unified           # Same as start

# 🛠️ Development
deno task unified:watch     # Auto-reload on changes

# 🧪 Legacy (still available)
deno task api-server       # Separate API server (port 8001)
deno task dev              # Separate bot service (port 8002)

# 🔍 Testing
deno task test             # Run all tests
deno task test:e2e         # E2E API tests
```

## 🌐 **Multi-Platform Roadmap**

### **Phase 1: ✅ COMPLETE**
- [x] REST API endpoints
- [x] Telegram Bot integration
- [x] Single service architecture
- [x] Real AI responses (OpenRouter + DeepSeek)

### **Phase 2: 🚧 IN PROGRESS**
- [ ] GitHub Integration
  - Issues, PRs, Comments
  - AI-powered code reviews
  - Automated responses
- [ ] Google Drive Integration
  - Document comments
  - AI assistance in docs

### **Phase 3: 🔮 FUTURE**
- [ ] MCP Protocol support
- [ ] Slack integration
- [ ] Discord integration
- [ ] Custom webhook handlers

## ⚙️ **Configuration**

### **Environment Variables**
```env
# Required
TELEGRAM_BOT_TOKEN=your_telegram_token
OPENROUTER_API_KEY=your_openrouter_key

# Optional
UNIFIED_SERVER_PORT=8000              # Default: 8000
API_KEYS=key1,key2,key3              # For API authentication
GITHUB_WEBHOOK_SECRET=github_secret   # For future GitHub integration
GOOGLE_DRIVE_WEBHOOK_SECRET=gd_secret # For future Google Drive
```

### **Feature Toggles**
All features are configured in `src/unified-server.ts`:
```typescript
features: {
  restApi: true,                    // ✅ REST API endpoints
  telegramBot: true,               // ✅ Telegram webhooks
  githubIntegration: false,        // 🚧 GitHub (planned)
  googleDriveIntegration: false,   // 🚧 Google Drive (planned)
  mcpProtocol: false              // 🔮 MCP (future)
}
```

## 🎉 **Success! You Now Have:**

✅ **Single Command Startup** - No more managing multiple terminals
✅ **Real AI Responses** - Powered by OpenRouter + DeepSeek
✅ **Multi-Platform Ready** - Easy to add GitHub, Google Drive, etc.
✅ **Production Architecture** - Unified, scalable, maintainable
✅ **Developer Friendly** - Hot reload, comprehensive logging

Your AI bot is now **simpler**, **more powerful**, and **ready for the future**! 🚀✨
