# @platformatic/fastify-ai

Fastify plugin for integrating AI capabilities into your Fastify applications, providing seamless access to multiple AI providers with automatic fallback, session management, and streaming support.

## 🚀 Features

`@platformatic/fastify-ai` relays on `@platformatic/ai-provider` to provide AI capability as a `fastify` plugin

- **Fastify Integration**: Native Fastify plugin with full TypeScript support
- **Multi-Provider Support**: OpenAI, DeepSeek, and Google Gemini
- **Automatic Fallback**: Seamless switching between providers when one fails
- **Session Management**: Built-in conversation history with configurable storage
- **Streaming Responses**: Real-time AI response streaming with Server-Sent Events
- **Request Integration**: Easy access to Fastify request context
- **Custom Headers**: Configurable session ID header names

## 📦 Installation

```bash
npm install @platformatic/fastify-ai
```

## 🔧 Basic Usage

```javascript
import fastify from 'fastify'
import { ai } from '@platformatic/fastify-ai'

const app = fastify({ logger: true })

await app.register(ai, {
  providers: {
    openai: { apiKey: process.env.OPENAI_API_KEY },
    deepseek: { apiKey: process.env.DEEPSEEK_API_KEY },
    gemini: { apiKey: process.env.GEMINI_API_KEY }
  },
  models: [
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'deepseek', model: 'deepseek-chat' },
    { provider: 'gemini', model: 'gemini-2.5-flash' }
  ]
})

app.post('/chat', async (request, reply) => {
  const { prompt, sessionId } = request.body

  const response = await app.ai.request({
    request,
    prompt,
    sessionId,
    context: 'You are a helpful assistant.',
    temperature: 0.7,
    stream: false
  }, reply)

  return response
})

app.post('/chat-stream', async (request, reply) => {
  const { prompt, sessionId } = request.body

  return await app.ai.request({
    request,
    prompt,
    sessionId,
    context: 'You are a helpful assistant.',
    temperature: 0.7,
    stream: true
  }, reply)
})

await app.listen({ port: 3000 })
```

## ⚙️ Configuration Options

Configuration file settings are grouped as follows:

### AiPluginOptions

Plugin configuration for Fastify AI integration:

- `providers` (object, required): Provider configurations with API keys and optional custom clients
- `models` (array, required): Model definitions with providers and optional limits
- `storage` (object, optional): Session storage configuration (default: `{type: 'memory'}`)
- `limits` (object, optional): Global limits and timeouts applied to all models
- `restore` (object, optional): Error recovery settings for automatic restoration
- `headerSessionIdName` (string, optional): Custom session ID header name (default: 'x-session-id')

### Provider Configuration

Configure AI providers with API keys:

```javascript
const pluginOptions = {
  providers: {
    openai: { 
      apiKey: process.env.OPENAI_API_KEY,
      client: customUndiciClient  // Optional custom client
    },
    deepseek: { 
      apiKey: process.env.DEEPSEEK_API_KEY 
    },
    gemini: { 
      apiKey: process.env.GEMINI_API_KEY 
    }
  },
  models: [
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'gemini', model: 'gemini-2.5-flash' }
  ]
}
```

### Model Configuration with Limits

Define models with custom rate limits and recovery policies:

```javascript
const pluginOptions = {
  providers: {
    openai: { apiKey: process.env.OPENAI_API_KEY }
  },
  models: [
    {
      provider: 'openai',
      model: 'gpt-4o-mini',
      limits: {
        maxTokens: 1000,
        rate: { 
          max: 100, 
          timeWindow: '1m' 
        }
      },
      restore: {
        rateLimit: '2m',
        providerCommunicationError: '30s'
      }
    },
    {
      provider: 'openai',
      model: 'gpt-4o',
      limits: {
        maxTokens: 2000,
        rate: { 
          max: 50, 
          timeWindow: '1m' 
        }
      }
    }
  ]
}
```

### Storage Configuration

Configure session storage backend:

```javascript
// Memory storage (default)
const pluginOptions = {
  // ... providers and models
  storage: { 
    type: 'memory' 
  }
}

// Valkey/Redis storage
const pluginOptions = {
  // ... providers and models
  storage: {
    type: 'valkey',
    valkey: {
      host: 'localhost',
      port: 6379,
      password: 'your-password',
      database: 0
    }
  }
}
```

### Global Limits and Recovery

Set default limits and recovery policies:

```javascript
const pluginOptions = {
  // ... providers and models
  limits: {
    maxTokens: 1500,
    rate: {
      max: 200,
      timeWindow: '30s'
    },
    requestTimeout: 30000,
    retry: {
      max: 2,
      interval: 1000
    },
    historyExpiration: '24h'
  },
  restore: {
    rateLimit: '1m',
    retry: '1m',
    timeout: '1m',
    providerCommunicationError: '30s',
    providerExceededError: '10m'
  }
}
```

### Custom Session ID Header

```javascript
const pluginOptions = {
  // ... other options
  headerSessionIdName: 'x-custom-session-id'  // Default: 'x-session-id'
}
```

## 📚 API Reference

### FastifyInstance.ai

The plugin decorates your Fastify instance with an `ai` object containing the following methods:

#### `app.ai.request(options, reply)`
Make AI requests with automatic fallback and session management.

**Options:**
- `request` (FastifyRequest, required): Fastify request object
- `prompt` (string, required): User input prompt
- `context` (string, optional): System context/instructions
- `temperature` (number, optional): Model temperature (0-1)
- `models` (array, optional): Specific models to use for this request
- `stream` (boolean, optional): Enable streaming responses (default: false)
- `history` (array, optional): Previous conversation history
- `sessionId` (string, optional): Session identifier for conversation history

#### `app.ai.retrieveHistory(sessionId)`
Retrieve conversation history for a specific session.

**Options:**
- `sessionId` (string, required): Session identifier

## 🔄 Usage Examples

### Basic Chat Endpoint

```javascript
app.post('/chat', async (request, reply) => {
  const { prompt, context, temperature } = request.body

  try {
    const response = await app.ai.request({
      request,
      prompt,
      context: context || 'You are a helpful assistant.',
      temperature: temperature || 0.7,
      stream: false
    }, reply)

    return response
  } catch (error) {
    reply.code(500).send({ error: error.message })
  }
})
```

### Streaming Chat Endpoint

```javascript
app.post('/chat-stream', async (request, reply) => {
  const { prompt, sessionId, context } = request.body

  reply.header('content-type', 'text/event-stream')
  reply.header('cache-control', 'no-cache')
  reply.header('connection', 'keep-alive')

  return await app.ai.request({
    request,
    prompt,
    sessionId,
    context: context || 'You are a helpful AI assistant.',
    stream: true,
    temperature: 0.8
  }, reply)
})
```

### Session-based Conversation

```javascript
app.post('/conversation', async (request, reply) => {
  const { prompt, sessionId: providedSessionId } = request.body

  const response = await app.ai.request({
    request,
    prompt,
    sessionId: providedSessionId,  // Use existing or let it auto-generate
    context: 'You are a helpful assistant with memory of our conversation.',
    stream: false
  }, reply)

  return {
    ...response,
    sessionId: response.sessionId  // Return for client to use in next request
  }
})

// Get conversation history
app.get('/conversation/:sessionId/history', async (request, reply) => {
  const { sessionId } = request.params

  try {
    const history = await app.ai.retrieveHistory(sessionId)
    return { history }
  } catch (error) {
    reply.code(404).send({ error: 'Session not found' })
  }
})
```

### Model-specific Requests

```javascript
app.post('/chat-openai', async (request, reply) => {
  const { prompt } = request.body

  const response = await app.ai.request({
    request,
    prompt,
    models: [
      { provider: 'openai', model: 'gpt-4o-mini' },
      { provider: 'openai', model: 'gpt-4o' }
    ],
    stream: false
  }, reply)

  return response
})

// String format for models
app.post('/chat-gemini', async (request, reply) => {
  const { prompt } = request.body

  const response = await app.ai.request({
    request,
    prompt,
    models: ['gemini:gemini-2.5-flash'],
    temperature: 0.9,
    stream: false
  }, reply)

  return response
})
```

### Custom Headers and Error Handling

```javascript
// Plugin registration with custom header
await app.register(ai, {
  // ... other options
  headerSessionIdName: 'x-chat-session'
})

app.post('/chat', async (request, reply) => {
  try {
    const response = await app.ai.request({
      request,
      prompt: request.body.prompt,
      stream: false
    }, reply)

    // Session ID is automatically set in 'x-chat-session' header
    return response
  } catch (error) {
    app.log.error({ error }, 'AI request failed')
    
    if (error.code === 'PROVIDER_RATE_LIMIT_ERROR') {
      reply.code(429).send({ 
        error: 'Rate limit exceeded',
        retryAfter: error.retryAfter 
      })
    } else if (error.code === 'PROVIDER_NO_MODELS_AVAILABLE_ERROR') {
      reply.code(503).send({ 
        error: 'AI services temporarily unavailable' 
      })
    } else {
      reply.code(500).send({ 
        error: 'Internal server error' 
      })
    }
  }
})
```

### Processing Streaming Responses on Client Side

```javascript
// Client-side JavaScript for consuming streaming endpoint
async function streamChat(prompt, sessionId) {
  const response = await fetch('/chat-stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prompt, sessionId })
  })

  const sessionIdHeader = response.headers.get('x-session-id')
  console.log('Session ID:', sessionIdHeader)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value)
    const lines = chunk.split('\n')
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6)
        if (data === '[DONE]') {
          console.log('Stream complete')
          break
        }
        try {
          const parsed = JSON.parse(data)
          console.log('Chunk:', parsed.choices[0].delta.content)
        } catch (e) {
          // Handle parsing errors
        }
      }
    }
  }
}
```

## 🔧 Advanced Configuration

### Complete Configuration Example

```javascript
import fastify from 'fastify'
import { ai } from '@platformatic/fastify-ai'

const app = fastify({ 
  logger: { level: 'info' }
})

await app.register(ai, {
  // Provider configuration
  providers: {
    openai: { 
      apiKey: process.env.OPENAI_API_KEY 
    },
    deepseek: { 
      apiKey: process.env.DEEPSEEK_API_KEY 
    },
    gemini: { 
      apiKey: process.env.GEMINI_API_KEY 
    }
  },

  // Model definitions with custom limits
  models: [
    {
      provider: 'openai',
      model: 'gpt-4o-mini',
      limits: {
        maxTokens: 1000,
        rate: { max: 100, timeWindow: '1m' }
      },
      restore: {
        rateLimit: '2m',
        providerCommunicationError: '30s'
      }
    },
    {
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      limits: {
        maxTokens: 1500,
        rate: { max: 80, timeWindow: '1m' }
      }
    },
    {
      provider: 'deepseek',
      model: 'deepseek-chat',
      limits: {
        maxTokens: 2000,
        rate: { max: 60, timeWindow: '1m' }
      }
    }
  ],

  // Global limits
  limits: {
    maxTokens: 1200,
    rate: {
      max: 200,
      timeWindow: '30s'
    },
    requestTimeout: 30000,
    retry: {
      max: 2,
      interval: 1000
    },
    historyExpiration: '24h'
  },

  // Recovery configuration
  restore: {
    rateLimit: '1m',
    retry: '30s',
    timeout: '1m',
    providerCommunicationError: '30s',
    providerExceededError: '5m'
  },

  // Storage configuration
  storage: {
    type: 'valkey',
    valkey: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      database: 0
    }
  },

  // Custom session header
  headerSessionIdName: 'x-ai-session-id'
})
```

## 🔗 Plugin Lifecycle

The plugin handles the complete lifecycle:

```javascript
// Automatic initialization
await app.register(ai, options)  // Initializes providers and storage

// Automatic cleanup
app.addHook('onClose', async () => {
  // Plugin automatically closes all connections
})
```

## 📋 Default Values

- **Session ID Header**: `'x-session-id'`
- **Content Type (streaming)**: `'text/event-stream'`  
- **Content Type (non-streaming)**: `'application/json'`

All other defaults inherit from `@platformatic/ai-provider`.

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type check
npm run typecheck

# Build
npm run build

# Lint
npm run lint

# Fix linting issues
npm run lint:fix

# Full check (lint + typecheck + test + build)
npm run check
```

## License

Apache-2.0
