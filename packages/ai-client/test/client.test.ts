import { test } from 'node:test'
import { deepStrictEqual, strictEqual, ok } from 'node:assert'
import { createServer } from 'node:http'
import { buildClient } from '../src/index.ts'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { pino } from 'pino'

// Silent logger for tests
const silentLogger = pino({ level: 'silent' })

test('buildClient creates a client with ask method', (_) => {
  const client = buildClient({
    url: 'http://localhost:3000',
    logger: silentLogger
  })

  ok(typeof client.ask === 'function')
})

test('client.ask sends correct request and handles streaming response', async (_) => {
  let capturedRequestBody: any = null
  let capturedHeaders: any = null

  const server = createServer((req, res) => {
    capturedHeaders = req.headers

    let body = ''
    req.on('data', chunk => {
      body += chunk.toString()
    })
    req.on('end', () => {
      capturedRequestBody = JSON.parse(body)

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })

      res.write('event: content\ndata: {"response": "Hello "}\n\n')
      res.write('event: content\ndata: {"response": "world!"}\n\n')
      res.write('event: end\ndata: {"response": {"content": "Hello world!", "model": "test", "sessionId": "123", "usage": {"totalTokens": 10}}}\n\n')
      res.end()
    })
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as AddressInfo).port

  const client = buildClient({
    url: `http://localhost:${port}`,
    headers: { Authorization: 'Bearer test' },
    logger: silentLogger
  })

  const stream = await client.ask({
    prompt: 'Hello AI',
    sessionId: 'user-123',
    temperature: 0.7,
    model: 'gpt-4',
    context: { key: 'value' }
  })

  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  strictEqual(capturedRequestBody?.prompt, 'Hello AI')
  strictEqual(capturedRequestBody?.sessionId, 'user-123')
  strictEqual(capturedRequestBody?.temperature, 0.7)
  strictEqual(capturedRequestBody?.model, 'gpt-4')
  deepStrictEqual(capturedRequestBody?.context, { key: 'value' })
  strictEqual(capturedRequestBody?.stream, true)

  ok(capturedHeaders['accept']?.includes('text/event-stream'))
  strictEqual(capturedHeaders['authorization'], 'Bearer test')

  strictEqual(messages.length, 3)
  deepStrictEqual(messages[0], { type: 'content', content: 'Hello ' })
  deepStrictEqual(messages[1], { type: 'content', content: 'world!' })
  deepStrictEqual(messages[2], {
    type: 'done',
    response: {
      content: 'Hello world!',
      model: 'test',
      sessionId: '123',
      usage: { totalTokens: 10 }
    }
  })

  server.close()
  await once(server, 'close')
})

test('client handles HTTP errors', async (_) => {
  const server = createServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end('Internal Server Error')
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`
  })

  try {
    await client.ask({ prompt: 'Hello' })
    throw new Error('Should have thrown an error')
  } catch (error) {
    ok(error instanceof Error)
    ok(error.message.includes('HTTP 500'))
    ok(error.message.includes('Internal Server Error'))
  }

  server.close()
  await once(server, 'close')
})

test('client handles timeout', async (_) => {
  const server = createServer((_req, _res) => {
    // Intentionally do not respond to trigger timeout
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`,
    timeout: 100,
    logger: silentLogger
  })

  try {
    await client.ask({ prompt: 'Hello' })
    throw new Error('Should have thrown an error')
  } catch (error: any) {
    ok(error instanceof Error)
    strictEqual(error.message, 'Request timeout')
  }

  server.close()
  await once(server, 'close')
})

test('client handles mixed JSON and plain text SSE data', async (_) => {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    res.write('event: content\ndata: {"response": "Valid"}\n\n')
    res.write('event: content\ndata: invalid-json\n\n')  // Plain text treated as content
    res.write('event: content\ndata: {"response": "After error"}\n\n')
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`
  })

  const stream = await client.ask({ prompt: 'Hello' })
  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  strictEqual(messages.length, 3)
  deepStrictEqual(messages[0], { type: 'content', content: 'Valid' })
  deepStrictEqual(messages[1], { type: 'content', content: 'invalid-json' })
  deepStrictEqual(messages[2], { type: 'content', content: 'After error' })

  server.close()
  await once(server, 'close')
})

test('client handles AI provider Server-Sent Events', async (_) => {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    // AI provider Server-Sent Events format
    res.write('event: content\ndata: {"response": "Content message"}\n\n')
    res.write('event: error\ndata: {"message": "Test error"}\n\n')
    res.write('event: end\ndata: {"response": {"content": "Final response", "model": "test"}}\n\n')
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`
  })

  const stream = await client.ask({ prompt: 'Hello' })
  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  strictEqual(messages.length, 3)
  deepStrictEqual(messages[0], { type: 'content', content: 'Content message' })
  deepStrictEqual(messages[1], { type: 'error', error: new Error('Test error') })
  deepStrictEqual(messages[2], { type: 'done', response: { content: 'Final response', model: 'test' } })

  server.close()
  await once(server, 'close')
})

test('client handles data-only SSE messages (no event field)', async (_) => {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    // Data-only messages (no event field)
    res.write('data: {"response": "First message"}\n\n')
    res.write('data: {"response": "Second message"}\n\n')
    res.write('data: {"content": "Third message with different structure"}\n\n')
    res.write('data: {"response": {"content": "Final", "model": "test-model", "usage": {"totalTokens": 10}}}\n\n')
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`
  })

  const stream = await client.ask({ prompt: 'Hello' })
  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  strictEqual(messages.length, 4)
  deepStrictEqual(messages[0], { type: 'content', content: 'First message' })
  deepStrictEqual(messages[1], { type: 'content', content: 'Second message' })
  deepStrictEqual(messages[2], { type: 'content', content: 'Third message with different structure' })
  deepStrictEqual(messages[3], {
    type: 'done',
    response: {
      content: 'Final',
      model: 'test-model',
      usage: { totalTokens: 10 }
    }
  })

  server.close()
  await once(server, 'close')
})

test('client handles mixed event and data-only SSE messages', async (_) => {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    // Mixed format messages
    res.write('event: content\ndata: {"response": "Event with data"}\n\n')
    res.write('data: {"response": "Data only message"}\n\n')
    res.write('event: content\ndata: {"response": "Another event with data"}\n\n')
    res.write('data: {"content": "Different structure"}\n\n')
    res.write('data: {"error": "Something went wrong"}\n\n')
    res.write('event: end\ndata: {"response": {"content": "Complete", "model": "test"}}\n\n')
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`
  })

  const stream = await client.ask({ prompt: 'Hello' })
  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  strictEqual(messages.length, 6)
  deepStrictEqual(messages[0], { type: 'content', content: 'Event with data' })
  deepStrictEqual(messages[1], { type: 'content', content: 'Data only message' })
  deepStrictEqual(messages[2], { type: 'content', content: 'Another event with data' })
  deepStrictEqual(messages[3], { type: 'content', content: 'Different structure' })
  deepStrictEqual(messages[4], { type: 'error', error: new Error('Something went wrong') })
  deepStrictEqual(messages[5], { type: 'done', response: { content: 'Complete', model: 'test' } })

  server.close()
  await once(server, 'close')
})

test('client handles data-only messages with various formats', async (_) => {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    // Various data-only formats
    res.write('data: {"response": {"content": "Nested response"}}\n\n')
    res.write('data: {"message": "Error-like but not error field"}\n\n')
    res.write('data: {"response": {"sessionId": "abc123", "model": "gpt-4"}}\n\n')
    res.write('data: {"unknown": "field"}\n\n')  // Unknown structure - should be ignored
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`
  })

  const stream = await client.ask({ prompt: 'Hello' })
  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  strictEqual(messages.length, 3)
  deepStrictEqual(messages[0], { type: 'content', content: 'Nested response' })
  deepStrictEqual(messages[1], { type: 'error', error: new Error('Error-like but not error field') })
  deepStrictEqual(messages[2], { type: 'done', response: { sessionId: 'abc123', model: 'gpt-4' } })

  server.close()
  await once(server, 'close')
})

test('client handles plain text data-only messages', async (_) => {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    // Plain text data messages (not JSON)
    res.write('data: Hello world\n\n')
    res.write('data: Some plain text\n\n')
    res.write('data: {"response": "Valid JSON"}\n\n')
    res.write('data: Another plain message\n\n')
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`
  })

  const stream = await client.ask({ prompt: 'Hello' })
  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  strictEqual(messages.length, 4)
  deepStrictEqual(messages[0], { type: 'content', content: 'Hello world' })
  deepStrictEqual(messages[1], { type: 'content', content: 'Some plain text' })
  deepStrictEqual(messages[2], { type: 'content', content: 'Valid JSON' })
  deepStrictEqual(messages[3], { type: 'content', content: 'Another plain message' })

  server.close()
  await once(server, 'close')
})

test('client handles null response body', async (_) => {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    // Simulate a response without body by ending immediately
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  // Mock fetch to return response with null body
  const originalFetch = global.fetch
  global.fetch = async () => {
    return {
      ok: true,
      body: null,
      text: async () => ''
    } as any
  }

  const client = buildClient({
    url: `http://localhost:${port}`
  })

  try {
    await client.ask({ prompt: 'Hello' })
    throw new Error('Should have thrown an error')
  } catch (error: any) {
    ok(error instanceof Error)
    strictEqual(error.message, 'Response body is null')
  } finally {
    global.fetch = originalFetch
  }

  server.close()
  await once(server, 'close')
})

test('client handles unknown error type', async (_) => {
  const server = createServer((req, res) => {
    res.writeHead(200)
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  // Mock fetch to throw a non-Error object
  const originalFetch = global.fetch
  global.fetch = async () => {
    // eslint-disable-next-line no-throw-literal
    throw 'String error' // Not an Error instance
  }

  const client = buildClient({
    url: `http://localhost:${port}`
  })

  try {
    await client.ask({ prompt: 'Hello' })
    throw new Error('Should have thrown an error')
  } catch (error: any) {
    ok(error instanceof Error)
    strictEqual(error.message, 'Unknown error occurred')
  } finally {
    global.fetch = originalFetch
  }

  server.close()
  await once(server, 'close')
})

test('client handles events with no data field', async (_) => {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    // Event without data field
    res.write('event: content\n\n')
    res.write('event: error\n\n')
    res.write('data: {"response": "Valid message"}\n\n')
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`
  })

  const stream = await client.ask({ prompt: 'Hello' })
  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  // Only the valid message should be processed
  strictEqual(messages.length, 1)
  deepStrictEqual(messages[0], { type: 'content', content: 'Valid message' })

  server.close()
  await once(server, 'close')
})

test('client handles unknown event types', async (_) => {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    res.write('event: unknown\ndata: {"response": "Unknown event"}\n\n')
    res.write('event: custom\ndata: {"something": "else"}\n\n')
    res.write('event: content\ndata: {"response": "Valid event"}\n\n')
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`
  })

  const stream = await client.ask({ prompt: 'Hello' })
  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  // Only the known event should be processed
  strictEqual(messages.length, 1)
  deepStrictEqual(messages[0], { type: 'content', content: 'Valid event' })

  server.close()
  await once(server, 'close')
})

test('client uses provided logger', async (_) => {
  const logs: Array<{ level: number; message: string; data?: any }> = []

  // Create a proper Pino logger with a custom stream to capture logs
  const mockLogger = pino({
    name: 'test-logger',
    level: 'debug'
  }, {
    write: (chunk: string) => {
      const logEntry = JSON.parse(chunk)
      logs.push({ level: logEntry.level, message: logEntry.msg, data: logEntry })
    }
  })

  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    res.write('data: {"response": "Test message"}\n\n')
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`,
    logger: mockLogger
  })

  const stream = await client.ask({ prompt: 'Hello' })
  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  strictEqual(messages.length, 1)
  deepStrictEqual(messages[0], { type: 'content', content: 'Test message' })

  // Verify logger was used
  ok(logs.length > 0, 'Logger should have been called')
  ok(logs.some(log => log.level === 20 && log.message === 'Making AI request'), 'Should log debug message for request')
  ok(logs.some(log => log.level === 30 && log.message === 'AI request successful'), 'Should log info message for success')

  server.close()
  await once(server, 'close')
})

test('client uses default logger when none provided', async (_) => {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    res.write('data: {"response": "Test message"}\n\n')
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  // Test without providing logger - should create default
  const client = buildClient({
    url: `http://localhost:${port}`
    // No logger provided - should use default
  })

  const stream = await client.ask({ prompt: 'Hello' })
  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  strictEqual(messages.length, 1)
  deepStrictEqual(messages[0], { type: 'content', content: 'Test message' })

  server.close()
  await once(server, 'close')
})

test('client uses loggerOptions when no logger provided', async (_) => {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    res.write('data: {"response": "Test message"}\n\n')
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  // Test with loggerOptions but no logger - should create logger with options
  const client = buildClient({
    url: `http://localhost:${port}`,
    loggerOptions: {
      level: 'silent' // This should create a silent pino logger
    }
  })

  const stream = await client.ask({ prompt: 'Hello' })
  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  strictEqual(messages.length, 1)
  deepStrictEqual(messages[0], { type: 'content', content: 'Test message' })

  server.close()
  await once(server, 'close')
})
