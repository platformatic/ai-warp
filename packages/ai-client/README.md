# @platformatic/ai-client

A TypeScript client for streaming AI responses from Platformatic AI services.

## Features

- 🚀 **Streaming support** - Real-time streaming of AI responses
- 🔧 **TypeScript first** - Full TypeScript support with type safety
- 📡 **Server-Sent Events** - Handles AI provider's SSE format
- 🎯 **Simple API** - Easy to use with async/await and for-await-of
- ⚡ **Node.js streams** - Built on robust Node.js streaming primitives
- 🛠️ **Error handling** - Comprehensive error handling for network and parsing errors

## Installation

```bash
npm install @platformatic/ai-client
```

## Usage

```typescript
import { buildClient } from '@platformatic/ai-client'

// Create client instance
const client = buildClient({
  url: 'http://localhost:3000',
  headers: {
    Authorization: 'Bearer your-api-key'
  }
})

try {
  // Make a request to the AI service
  const stream = await client.ask({
    prompt: 'Hello AI, how are you today?',
    sessionId: 'user-123',
    temperature: 0.7,
    model: 'gpt-4'
  })

  // Read the streaming response
  let fullResponse = ''

  for await (const message of stream) {
    switch (message.type) {
      case 'content':
        // Accumulate content chunks
        fullResponse += message.content
        console.log('Chunk:', message.content)
        break
      case 'error':
        console.error('Error:', message.error)
        break
      case 'done':
        if (message.response) {
          console.log('Final response:', message.response)
        }
        break
    }
  }

  console.log('Full response:', fullResponse)
} catch (error) {
  console.error('Request failed:', error)
} finally {
  await client.close()
}
```

## API Reference

### `buildClient(options)`

Creates a new AI client instance.

#### Options

- `url` (string): The AI service URL
- `headers` (object, optional): HTTP headers to include with requests
- `timeout` (number, optional): Request timeout in milliseconds (default: 60000)

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

A `Promise<AsyncIterable<StreamMessage>>` that resolves to a stream of messages.

### Stream Messages

The stream yields `StreamMessage` objects with the following types:

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

### `client.close()`

Closes the client and cleans up resources.

## Error Handling

The client handles various error conditions:

- **Network errors**: Connection failures, timeouts
- **HTTP errors**: Non-2xx status codes
- **Parsing errors**: Invalid Server-Sent Events format
- **Service errors**: AI service-specific errors

All errors are properly typed and can be caught with standard try/catch blocks.

## Requirements

- Node.js 22.16.0 or later
- TypeScript 5.8.2 or later (for TypeScript projects)

## License

Apache-2.0