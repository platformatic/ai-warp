# Platformatic AI Warp

`Platformatic AI Warp` is the Platformatic solution to interact with AI model providers through a unified, scalable interface.

`@platformatic/ai-warp` offers out of the box an efficient gateway to interact with the main AI Providers through a unified interface, handling different models with fallback strategy.

## 📦 Packages

- **`@platformatic/ai-provider`** - Core implementation for AI communication with multiple providers
- **`@platformatic/fastify-ai`** - Fastify plugin for integrating AI capabilities into `fastify`
- **`@platformatic/ai-client`** - TypeScript client to interact with `@platformatic/ai-warp` services
- **`@platformatic/ai-warp`** - The AI service ready to run

## 🚀 Quick Start

### Installation

Run `@platformatic/ai-warp` with `wattpm`

```bash
mkdir warp
cd warp
npx wattpm@latest create
```

```txt
Hello Alice, welcome to Watt 2.71.0!
? Where would you like to create your project? warp-service
? Which package manager do you want to use? pnpm
? Which kind of service do you want to create? @platformatic/ai-warp
? What is the name of the service? ai
? What AI providers would you like to use? OpenAI, Gemini
? What is your OpenAI API key? [hidden]
? What is your Gemini API key? [hidden]
? Do you want to create another service? no
? Do you want to use TypeScript? no
? What port do you want to use? 3042
```

Start the service

```bash
cd warp-service
pnpm start
```

Then make requests to warp service

```bash
curl -X POST -H "Content-type: application/json" http://127.0.0.1:3042/api/v1/prompt -d '{"prompt":"Please give me the first 10 prime numbers"}'
```

```txt
{"text":"The first 10 prime numbers are:\n\n1. 2\n2. 3\n3. 5\n4. 7\n5. 11\n6. 13\n7. 17\n8. 19\n9. 23\n10. 29","result":"COMPLETE","sessionId":"40ffaedc-bc26-4561-bc11-2e0ae2a839c1"}
```

Or use `@platformatic/ai-client`

```typescript
import { buildClient } from '@platformatic/ai-client'

const client = buildClient({
  url: 'http://localhost:3042'
})

const response = await client.ask({
  prompt: 'Hello AI, how are you today?'
})

console.log(response)
```

TODO return headers
TODO print response

---

## ✨ Features

### AI Models Provider Gateway
TODO In a unified interface

### 🔄 Automatic Fallback
When a model fails, the system automatically tries the next available model in the configuration order.
Request limits
Retry, Timeout TODO
Configurable retry mechanisms with exponential backoff for transient failures.
Restoring

### 💾 Session Management
Persistent conversation history with configurable storage backends (memory, Valkey).

### 🌊 Streaming Support
Real-time streaming responses using Server-Sent Events (SSE).

### 📈 Scalability
Designed for high-throughput scenarios with efficient connection pooling and resource management.
Takes advantages of `undici` pipelining
Shared model state, history, shared storage

### 🔌 Supported Providers

- OpenAI
- DeepSeek
- Google Gemini

--- 

## 🔧 Configuration Options

TODO


## 🏗️ Architecture Overview

TODO image 

The Platformatic AI Warp architecture is designed for scalability and reliability:

### Request Flow
1. **Client Request** → AI Warp Service
2. **Model Selection** → Automatic fallback chain
3. **Provider Communication** → Optimized HTTP connections
4. **Response Processing** → Streaming or batch responses
5. **Session Management** → Persistent conversation history

### Scalability Features
- **Connection Pooling**: Efficient HTTP connection management
- **Shared State**: Distributed session storage with Valkey/Redis
- **Load Balancing**: Multiple provider instances for high availability
- **Resource Limits**: Configurable rate limits and timeouts

### Error Recovery
- **Automatic Retries**: Exponential backoff for transient failures
- **Provider Fallback**: Seamless switching between AI providers
- **Circuit Breaker**: Temporary provider disabling after repeated failures
- **Graceful Degradation**: Fallback to simpler models when needed

