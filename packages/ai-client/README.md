# @platformatic/ai-client

A TypeScript client for streaming AI responses from Platformatic AI services.

## Features

- 🚀 **Streaming support** - Real-time streaming of AI responses
- 🔧 **TypeScript first** - Full TypeScript support with type safety
- 📡 **Server-Sent Events** - Handles both event-based and data-only SSE messages
- 📄 **Flexible parsing** - Supports JSON and plain text data formats
- 🎯 **Simple API** - Easy to use with async/await and for-await-of

## Installation

```bash
npm install @platformatic/ai-client
```

## Usage

### Streaming Response (default)

```typescript
import { buildClient } from "@platformatic/ai-client";

// Create client instance
const client = buildClient({
  url: "http://localhost:3000",
  headers: {
    Authorization: "Bearer your-api-key",
  },
  timeout: 30000, // optional timeout in ms (default: 60000)
  logger: customLogger, // optional Logger instance
});

try {
  // Make a streaming request to the AI service
  const stream = await client.ask({
    prompt: "Hello AI, how are you today?",
    sessionId: "user-123",
    temperature: 0.7,
    models: [{ provider: "openai", model: "gpt-4" }],
    stream: true // optional, defaults to true
  });

  // Read the streaming response
  let fullResponse = "";

  for await (const message of stream) {
    switch (message.type) {
      case "content":
        // Accumulate content chunks
        fullResponse += message.content;
        console.log("Chunk:", message.content);
        break;
      case "error":
        console.error("Error:", message.error);
        break;
      case "done":
        if (message.response) {
          console.log("Final response:", message.response);
        }
        break;
    }
  }

  console.log("Full response:", fullResponse);
} catch (error) {
  console.error("Request failed:", error);
}
```

### Non-Streaming Response

```typescript
import { buildClient } from "@platformatic/ai-client";

const client = buildClient({
  url: "http://localhost:3000",
  headers: {
    Authorization: "Bearer your-api-key",
  },
});

try {
  // Make a non-streaming request to the AI service
  const response = await client.ask({
    prompt: "Hello AI, how are you today?",
    sessionId: "user-123",
    temperature: 0.7,
    models: [{ provider: "openai", model: "gpt-4" }],
    stream: false
  });

  console.log("Response:", response.content);
  console.log("Model:", response.model);
} catch (error) {
  console.error("Request failed:", error);
}
```

### Error Handling

The client provides multiple ways to handle errors:

```typescript
try {
  const stream = await client.ask({
    prompt: "Hello AI",
    sessionId: "user-123"
  });

  // Handle stream errors (connection issues, parsing errors, etc.)
  stream.on('error', (err) => {
    console.error('Stream error:', err);
  });

  for await (const message of stream) {
    if (message.type === 'error') {
      // Handle AI service errors
      console.error('AI service error:', message.error);
    }
    // ... handle other message types
  }
} catch (error) {
  // Handle request-level errors (HTTP errors, timeouts, etc.)
  console.error("Request failed:", error);
}
```

## Model Configuration

The client uses `AiModel` objects from `@platformatic/ai-provider` to specify AI models:

```typescript
const stream = await client.ask({
  prompt: "Hello AI",
  models: [{
    provider: "openai",
    model: "gpt-4"
  }]
});
```

### Multiple Models for Fallback

You can specify multiple models for fallback scenarios:

```typescript
const stream = await client.ask({
  prompt: "Hello AI",
  models: [
    { provider: "openai", model: "gpt-4" },
    { provider: "openai", model: "gpt-3.5-turbo" },
    { provider: "deepseek", model: "deepseek-chat" }
  ]
});
```

The AI service will try each model in order until one succeeds.

## API Reference

### `buildClient(options)`

Creates a new AI client instance.

#### Options

- `url` (string): The AI service URL
- `headers` (object, optional): HTTP headers to include with requests
- `timeout` (number, optional): Request timeout in milliseconds (default: 60000)
- `logger` (Logger, optional): Logger instance (uses abstract-logging if not provided)

#### Logger Support

You can configure logging by providing a logger instance:

```typescript
import type { Logger } from '@platformatic/ai-client'

const customLogger: Logger = {
  debug: (message: string, data?: any) => console.log('DEBUG:', message, data),
  info: (message: string, data?: any) => console.log('INFO:', message, data),
  warn: (message: string, data?: any) => console.warn('WARN:', message, data),
  error: (messageOrData: string | any, messageWhenData?: string) => {
    if (typeof messageOrData === 'string') {
      console.error('ERROR:', messageOrData, messageWhenData)
    } else {
      console.error('ERROR:', messageWhenData || 'Error', messageOrData)
    }
  }
}

const client = buildClient({
  url: "http://localhost:3000",
  logger: customLogger
})
```

If no `logger` is provided, the client will use `abstract-logging` (a no-op logger that is API-compatible with the Logger interface).

#### Returns

An `AIClient` instance.

### `client.ask(options)`

Makes a request to the AI service, returning either a stream or a complete response.

#### Options

- `prompt` (string): The prompt to send to the AI
- `sessionId` (string, optional): Session ID for conversation context
- `context` (string, optional): Additional context for the request
- `temperature` (number, optional): AI temperature parameter
- `models` (array, optional): Array of `AiModel` objects from `@platformatic/ai-provider`
- `history` (array, optional): Previous conversation history as `AiChatHistory` from `@platformatic/ai-provider`
- `stream` (boolean, optional): Enable streaming (default: true)

#### Returns

- When `stream: true` (default): `Promise<Readable>` - A Node.js Readable stream of messages
- When `stream: false`: `Promise<AskResponse>` - A complete response object

#### Response Object (Non-streaming)

```typescript
{
  content: string          // The AI's response content
  model?: string          // The model used to generate the response
  sessionId?: string      // Session ID if provided
}
```

### Stream Messages

The Readable stream yields `StreamMessage` objects with the following types:

#### Content Message

```typescript
{
  type: 'content',
  content: string
}
```

#### Error Message

```typescript
{
  type: 'error',
  error: Error
}
```

#### Done Message

```typescript
{
  type: 'done',
  response?: {
    content: string
    model?: string
    sessionId?: string
  }
}
```

## Server-Sent Events Support

The client supports various SSE message formats:

### Event-based Messages

```
event: content
data: {"response": "Hello world"}

event: end
data: {"response": {"content": "Complete", "model": "gpt-4"}}
```

### Data-only Messages

```
data: {"response": "JSON content"}

data: {"content": "Alternative JSON format"}

data: Plain text content
```
