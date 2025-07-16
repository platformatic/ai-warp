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

```typescript
import { buildClient } from "@platformatic/ai-client";

// Create client instance
const client = buildClient({
  url: "http://localhost:3000",
  headers: {
    Authorization: "Bearer your-api-key",
  },
  timeout: 30000, // optional timeout in ms (default: 60000)
  logger: customLogger, // optional Pino logger instance
  loggerOptions: { level: 'debug' }, // optional Pino options (used when no logger provided)
});

try {
  // Make a request to the AI service
  const stream = await client.ask({
    prompt: "Hello AI, how are you today?",
    sessionId: "user-123",
    temperature: 0.7,
    model: "gpt-4",
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

## API Reference

### `buildClient(options)`

Creates a new AI client instance.

#### Options

- `url` (string): The AI service URL
- `headers` (object, optional): HTTP headers to include with requests
- `timeout` (number, optional): Request timeout in milliseconds (default: 60000)
- `logger` (BaseLogger, optional): Pino logger instance
- `loggerOptions` (LoggerOptions, optional): Pino options for creating default logger

#### Logger Support

You can configure logging in two ways:

1. **Provide a logger instance**:
```typescript
import { pino } from 'pino'

const customLogger = pino({
  level: 'info',
  transport: {
    target: 'pino-pretty'
  }
})

const client = buildClient({
  url: "http://localhost:3000",
  logger: customLogger
})
```

2. **Provide logger options** (used only when no logger is provided):
```typescript
const client = buildClient({
  url: "http://localhost:3000",
  loggerOptions: {
    level: 'debug',
    transport: {
      target: 'pino-pretty'
    }
  }
})
```

If neither `logger` nor `loggerOptions` are provided, a default Pino logger will be created with `{ name: 'ai-client' }`.

#### Returns

An `AIClient` instance.

### `client.ask(options)`

Makes a streaming request to the AI service.

#### Options

- `prompt` (string): The prompt to send to the AI
- `sessionId` (string, optional): Session ID for conversation context
- `context` (string, optional): Additional context for the request
- `temperature` (number, optional): AI temperature parameter
- `model` (string, optional): AI model to use
- `messages` (array, optional): Previous conversation messages
- `stream` (boolean, optional): Enable streaming (default: true)

#### Returns

A `Promise<Readable>` that resolves to a Node.js Readable stream of messages.

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
    usage?: {
      promptTokens: number
      completionTokens: number
      totalTokens: number
    }
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
