# @platformatic/ai-provider

Core implementation for AI communication with multiple providers, offering unified access to OpenAI, DeepSeek, and Google Gemini with advanced features like automatic fallback, session management, and intelligent rate limiting.

## 🚀 Features

- **Multi-Provider Support**: OpenAI, DeepSeek, and Google Gemini
- **Automatic Fallback**: Seamless switching between providers when one fails
- **Session Management**: Persistent conversation history with multiple storage backends
- **Auto-Resume**: Seamless stream resumption from interruption points using event IDs
- **Hash-Based Storage**: Efficient O(1) event access with Redis hash operations
- **Rate Limiting**: Per-model rate limiting with automatic restoration
- **Streaming Support**: Real-time response streaming with event identification
- **Error Recovery**: Intelligent error handling with configurable retry policies

## 📦 Installation

```bash
npm install @platformatic/ai-provider
```

## 🔧 Basic Usage

```javascript
import { Ai } from '@platformatic/ai-provider'
import pino from 'pino'

const ai = new Ai({
  logger: pino({ level: 'info' }),
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
  models: [
    { provider: 'openai', model: 'gpt-4o-mini' },
    { provider: 'openai', model: 'gpt-4o' },
    { provider: 'deepseek', model: 'deepseek-chat' },
    { provider: 'gemini', model: 'gemini-2.5-flash' }
  ]
})

await ai.init()

// Simple request
const response = await ai.request({
  prompt: 'Hello, how are you today?',
  options: {
    temperature: 0.7,
    maxTokens: 150
  }
})

// Response
console.log(response.text)
console.log(response.sessionId)

// Streaming request
const streamResponse = await ai.request({
  prompt: 'Tell me a story',
  options: {
    stream: true,
    temperature: 0.8
  }
})

// Process stream response
try {
  for await (const chunk of streamResponse) {
    console.log('Chunk:', chunk.toString())
  }
  console.log('Stream finished')
} catch (err) {
  console.error('Stream error:', err)
}

await ai.close()
```

## ⚙️ Configuration Options

Configuration file settings are grouped as follows:

### AI Options

Main configuration object for the AI class:

- `logger` (Logger, required): Pino logger instance
- `providers` (object, required): Provider configurations with API keys and optional custom clients
- `models` (array, required): Model definitions with providers and optional limits
- `storage` (object, optional): Session storage configuration (default: `{type: 'memory'}`)
- `limits` (object, optional): Global limits and timeouts applied to all models
- `restore` (object, optional): Error recovery settings for automatic restoration

### providers

Configure AI provider settings:

- `openai` (object, optional): OpenAI provider configuration
  - `apiKey` (string, required): OpenAI API key
  - `client` (object, optional): Custom HTTP client for advanced configurations
- `deepseek` (object, optional): DeepSeek provider configuration  
  - `apiKey` (string, required): DeepSeek API key
  - `client` (object, optional): Custom HTTP client for advanced configurations
- `gemini` (object, optional): Google Gemini provider configuration
  - `apiKey` (string, required): Gemini API key
  - `client` (object, optional): Custom HTTP client for advanced configurations

### models

Define AI models with custom limits and restoration policies:

- `provider` (string, required): Provider name ('openai', 'deepseek', or 'gemini')
- `model` (string, required): Model name string
- `limits` (object, optional): Rate limiting and token limits for this model
  - `maxTokens` (number, optional): Maximum tokens per request
  - `rate` (object, optional): Rate limiting configuration
    - `max` (number, required): Maximum requests per time window
    - `timeWindow` (string|number, required): Time window ('1m', '30s', or milliseconds)
- `restore` (object, optional): Model-specific recovery settings

### storage

Configure session storage backend:

- `type` (string, required): Storage type ('memory' or 'valkey', default: 'memory')
- `valkey` (object, optional): Valkey/Redis configuration when type is 'valkey'
  - `host` (string, optional): Server host (default: 'localhost')
  - `port` (number, optional): Server port (default: 6379)
  - `username` (string, optional): Username for authentication
  - `password` (string, optional): Password for authentication
  - `database` (number, optional): Database number (default: 0)

### limits

Set default limits applied to all models:

- `maxTokens` (number, optional): Default max tokens per request
- `rate` (object, optional): Default rate limiting configuration
  - `max` (number, optional): Maximum requests (default: 200)
  - `timeWindow` (string|number, optional): Time window (default: '30s')
- `requestTimeout` (number, optional): Request timeout in milliseconds (default: 30000)
- `retry` (object, optional): Retry configuration
  - `max` (number, optional): Max retry attempts (default: 1)
  - `interval` (number, optional): Retry interval in milliseconds (default: 1000)
- `historyExpiration` (string|number, optional): Session history expiration (default: '1d')

### restore

Configure how failed models are restored:

- `rateLimit` (string|number, optional): Rate limit error recovery time (default: '1m')
- `retry` (string|number, optional): Retry error recovery time (default: '1m')
- `timeout` (string|number, optional): Timeout error recovery time (default: '1m')
- `providerCommunicationError` (string|number, optional): Communication error recovery time (default: '1m')
- `providerExceededError` (string|number, optional): Quota exceeded error recovery time (default: '10m')

### Time Windows

Time windows can be specified as:
- **String**: `'30s'`, `'5m'`, `'1h'`, `'2d'`
- **Number**: Milliseconds (e.g., `30000` for 30 seconds)

## 📚 API Reference

### Core Methods

#### `ai.init()`
Initialize the AI instance, storage, and providers. Must be called before making requests.

#### `ai.request(request)`
Make an AI request with automatic fallback and session management.

**Options:**
- `prompt` (string, required): User input prompt
- `models` (array, optional): Specific models to use for this request
- `options` (object, optional): Request configuration options
  - `context` (string, optional): System context/instructions
  - `temperature` (number, optional): Model temperature (0-1)
  - `maxTokens` (number, optional): Maximum tokens to generate
  - `stream` (boolean, optional): Enable streaming responses (default: false)
  - `sessionId` (string, optional): Session identifier for conversation history; `sessionId` and `history` can't be provided at the same time
  - `history` (array, optional): Previous conversation history; `sessionId` and `history` can't be provided at the same time
  - `resumeEventId` (string, optional): Specific event ID to resume from for stream continuation
  - `response` (string, optional, default `content`): Indicate the response will contains only the response content from AI provider (default) or will include or also the session history including prompts (`session`). Values are `content` (default) and `session`. The `session` mode is preferred working with `resumeEventId`, see #ResumeResponse for a longer explaination

#### `ai.close()`
Close all provider connections and storage.

### Session Management

Sessions are automatically created and managed:

```javascript
// Automatic session creation
const response = await ai.request({
  prompt: 'Hello, I am Alice'
})
console.log(response.sessionId) // Auto-generated session ID

// Continue conversation with session ID
const followUp = await ai.request({
  prompt: 'What is my name?',
  options: { sessionId: response.sessionId }
})
```

### Response Types

#### Content Response (Non-streaming)

```javascript
{
  text: "Generated text",                    // Generated text
  result: "COMPLETE",                        // 'COMPLETE' | 'INCOMPLETE_MAX_TOKENS' | 'INCOMPLETE_UNKNOWN'
  sessionId: "session-id-string"             // Session identifier
}
```

#### Stream Response (Streaming)

Node.js Readable stream with attached `sessionId` property for session management.

```javascript
// Process streaming response with for await loop
try {
  for await (const chunk of streamResponse) {
    const data = chunk.toString()
    // Process chunk (may contain multiple SSE events)
    console.log('Received:', data)
  }
  console.log('Stream completed')
} catch (err) {
  console.error('Stream error:', err)
}
}
```

## 🔄 Auto-Resume Functionality

The AI provider includes advanced auto-resume capabilities that automatically recover interrupted streaming conversations by streaming stored events from the configured storage backend:

### Stream Resumption with Storage

When a streaming request includes a `resumeEventId`, the system retrieves and streams stored events without calling the AI model again:

```javascript
// First streaming request - events are automatically stored
const stream1 = await ai.request({
  prompt: 'Write a long story about space exploration',
  options: {
    stream: true,
    sessionId: 'conversation-123'
  }
})

// If interrupted after receiving some events, resume from specific event ID
const stream2 = await ai.request({
  prompt: 'Continue the story', // This prompt is ignored for resume
  options: {
    stream: true,
    sessionId: 'conversation-123',
    resumeEventId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' // Resume from this event
  }
})

// Only events after the resumeEventId will be streamed from storage
```

### Storage-Based Stream Response

When `resumeEventId` is provided, the response stream is entirely generated from storage:

1. **Event Retrieval**: The provider queries the storage backend for all events in the session after the specified event ID
2. **Storage Streaming**: Events are streamed directly from storage (memory/Valkey) in chronological order
3. **No AI Model Call**: The AI model is not called - all content comes from previously stored events
4. **Real-time Delivery**: Events are delivered as Server-Sent Events just like a fresh AI response

```javascript
// Example: Resume streaming retrieves stored events
const resumeStream = await ai.request({
  prompt: 'Any prompt', // Ignored for resume
  options: {
    stream: true,
    sessionId: 'session-123',
    resumeEventId: 'event-uuid-123'
  }
})

// This stream contains events from storage, not from AI model
for await (const chunk of resumeStream) {
  const data = chunk.toString()
  // Contains SSE events retrieved from storage:
  // id: event-uuid-124
  // event: content
  // data: {"response": "stored content"}
  console.log('Stored event:', data)
}
```

### Event ID Identification

All streaming events include unique identifiers for precise resumption:

```javascript
// Streaming events include IDs for resumption tracking
const reader = streamResponse.getReader()
const decoder = new TextDecoder()

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  
  const chunk = decoder.decode(value)
  // Example SSE format with unique ID:
  // id: f47ac10b-58cc-4372-a567-0e02b2c3d479
  // event: content
  // data: {"response": "Text chunk"}
  
  // Client can track last received event ID for resume
}
```

### Resume Response

TODO

When working with resume, it's better to have a response type `session` to identify the content in the history.
For example

TODO

Getting the content only can be confusing

---

## 🗄️ Storage Architecture

### Hash-Based Event Storage

The new storage system uses Redis hash operations for O(1) event access:

```javascript
// Storage structure: sessionId -> { eventUUID: eventData }
{
  "session-123": {
    "f47ac10b-58cc-4372-a567-0e02b2c3d479": {
      "timestamp": 1642789200000,
      "type": "content",
      "data": "First chunk"
    },
    "6ba7b810-9dad-11d1-80b4-00c04fd430c8": {
      "timestamp": 1642789201000,
      "type": "content", 
      "data": "Second chunk"
    }
  }
}
```

### Storage Backends

#### Memory Storage (Default)

Uses EventEmitter for pub/sub operations:

```javascript
const ai = new Ai({
  // ... other options
  storage: {
    type: 'memory'  // Default storage type
  }
})
```

#### Valkey/Redis Storage

Production-ready with Redis hash commands and dedicated pub/sub:

```javascript
const ai = new Ai({
  // ... other options
  storage: {
    type: 'valkey',
    valkey: {
      host: 'localhost',
      port: 6379,
      username: 'default',
      password: 'your-password',
      database: 0
    }
  }
})
```

## 🔄 Advanced Features

### Custom Provider Client

Implement custom HTTP client for providers:

```javascript
import { Pool } from 'undici'

const customClient = {
  pool: new Pool('https://api.openai.com', {
    pipelining: 4,
    connections: 10
  })
}

const ai = new Ai({
  // ... other options
  providers: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      client: customClient
    }
  }
})
```

### Error Handling

The library provides detailed error types:

```javascript
try {
  const response = await ai.request({ prompt: 'Hello' })
} catch (error) {
  switch (error.code) {
    case 'PROVIDER_RATE_LIMIT_ERROR':
      console.log(`Rate limited, retry in ${error.retryAfter}s`)
      break
    case 'PROVIDER_REQUEST_TIMEOUT_ERROR':
      console.log(`Request timed out after ${error.timeout}ms`)
      break
    case 'PROVIDER_NO_MODELS_AVAILABLE_ERROR':
      console.log('All models are currently unavailable')
      break
    default:
      console.error('Unexpected error:', error.message)
  }
}
```

### Model Selection Strategy

Models are selected in the order defined, with automatic fallback:

```javascript
const models = [
  { provider: 'openai', model: 'gpt-4o-mini' },    // Try this first
  { provider: 'gemini', model: 'gemini-2.5-flash' }, // Fallback to this
  { provider: 'deepseek', model: 'deepseek-chat' }   // Final fallback
]
```

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
