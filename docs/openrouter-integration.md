# OpenRouter AI Integration

## Overview

The Telegram bot now uses OpenRouter.ai's DeepSeek models to provide intelligent responses instead of just replying "ok" to all messages.

## Configuration

### Environment Variables

Add the following to your `.env` file:

```bash
OPENROUTER_API_KEY=your_openrouter_api_key_here
DEPLOYMENT_URL=https://your-deployment-url.deno.dev
```

### Models Used

1. **Primary Model**: `deepseek/deepseek-r1-0528:free`
   - Advanced reasoning capabilities
   - Free tier available
   
2. **Fallback Model**: `deepseek/deepseek-chat-v3-0324:free`
   - Used when primary model fails or times out
   - Also on free tier

## Architecture

### Service Structure

```
src/services/
├── openrouter-types.ts    # TypeScript interfaces for OpenRouter API
├── call-openrouter.ts     # Core API call function with timeout handling
└── get-ai-response.ts     # High-level function with fallback logic
```

### Request Flow

1. User sends message to Telegram bot
2. [`messageHandler`](../src/handlers/message.ts:4) receives the message
3. Handler calls [`getAIResponse`](../src/services/get-ai-response.ts:7) with user's message
4. Primary model is tried first via [`callOpenRouter`](../src/services/call-openrouter.ts:6)
5. If primary fails, fallback model is automatically tried
6. AI response is sent back to user

### Error Handling

- **Timeout**: 30-second timeout for each API call
- **Fallback**: Automatic fallback to secondary model
- **User Feedback**: Error message sent to user if both models fail
- **Logging**: All errors are logged for debugging

## API Integration Details

### Headers Required

```typescript
{
  "Authorization": `Bearer ${apiKey}`,
  "HTTP-Referer": deploymentUrl,
  "X-Title": "Telegram Bot",
  "Content-Type": "application/json"
}
```

### System Prompt

The AI is instructed to:
- Be a helpful AI assistant in a Telegram bot
- Provide concise, helpful responses
- Keep responses under 4000 characters (Telegram's limit)

## Testing

### Local Testing

1. Ensure `.env` file has `OPENROUTER_API_KEY` set
2. Run the bot locally: `deno run --allow-net --allow-env --allow-read src/main.ts`
3. Send test webhook request to test AI responses

### Production Testing

1. Deploy to Deno Deploy
2. Set environment variables in Deno Deploy dashboard
3. Send message to bot on Telegram
4. Check Deno Deploy logs for any errors

## Cost Considerations

Both models are currently on the free tier, but monitor usage to ensure you stay within limits.

## Troubleshooting

### Common Issues

1. **"Both AI models failed to respond"**
   - Check API key is valid
   - Verify OpenRouter service is operational
   - Check Deno Deploy logs for specific errors

2. **Timeout errors**
   - May indicate high load on OpenRouter
   - Consider increasing timeout in [`call-openrouter.ts`](../src/services/call-openrouter.ts:4)

3. **Empty responses**
   - Check if response format from OpenRouter has changed
   - Verify models are still available on free tier