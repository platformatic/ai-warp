import { test } from 'node:test'
import { deepStrictEqual, strictEqual, ok } from 'node:assert'
import { createServer } from 'node:http'
import { buildClient } from '../src/index.ts'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { setTimeout } from 'node:timers/promises'
import type { Logger } from '../src/types.ts'

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
}

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
      res.write('event: end\ndata: {"response": {"content": "Hello world!", "model": "test", "sessionId": "123"}}\n\n')
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

  const response = await client.ask({
    prompt: 'Hello AI',
    sessionId: 'user-123',
    temperature: 0.7,
    models: [{ provider: 'openai', model: 'gpt-4' }],
    context: { key: 'value' },
    stream: true
  })

  const messages = []
  for await (const message of response.stream) {
    messages.push(message)
  }

  strictEqual(capturedRequestBody?.prompt, 'Hello AI')
  strictEqual(capturedRequestBody?.sessionId, 'user-123')
  strictEqual(capturedRequestBody?.temperature, 0.7)
  deepStrictEqual(capturedRequestBody?.models, [{ provider: 'openai', model: 'gpt-4' }])
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
      sessionId: '123'
    }
  })

  server.close()
  await once(server, 'close')
})

test('client handles models as object format', async (_) => {
  let capturedRequestBody: any = null

  const server = createServer((req, res) => {
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

      res.write('event: content\ndata: {"response": "Hello"}\n\n')
      res.write('event: end\ndata: {"response": {"content": "Hello", "model": "gpt-4"}}\n\n')
      res.end()
    })
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as AddressInfo).port

  const client = buildClient({
    url: `http://localhost:${port}`,
    logger: silentLogger
  })

  const stream = await client.ask({
    prompt: 'Hello AI',
    models: [{ provider: 'openai', model: 'gpt-4' }],
    stream: true
  })

  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  deepStrictEqual(capturedRequestBody?.models, [{ provider: 'openai', model: 'gpt-4' }])
  strictEqual(messages.length, 2)

  server.close()
  await once(server, 'close')
})

test('client handles models as string format', async (_) => {
  let capturedRequestBody: any = null

  const server = createServer((req, res) => {
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

      res.write('event: content\ndata: {"response": "Hello"}\n\n')
      res.write('event: end\ndata: {"response": {"content": "Hello", "model": "gpt-4"}}\n\n')
      res.end()
    })
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as AddressInfo).port

  const client = buildClient({
    url: `http://localhost:${port}`,
    logger: silentLogger
  })

  const stream = await client.ask({
    prompt: 'Hello AI',
    models: ['openai:gpt-4'],
    stream: true
  })

  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  deepStrictEqual(capturedRequestBody?.models, ['openai:gpt-4'])
  strictEqual(messages.length, 2)

  server.close()
  await once(server, 'close')
})

test('client handles mixed model formats', async (_) => {
  let capturedRequestBody: any = null

  const server = createServer((req, res) => {
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

      res.write('event: content\ndata: {"response": "Hello"}\n\n')
      res.write('event: end\ndata: {"response": {"content": "Hello", "model": "gpt-4"}}\n\n')
      res.end()
    })
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as AddressInfo).port

  const client = buildClient({
    url: `http://localhost:${port}`,
    logger: silentLogger
  })

  const stream = await client.ask({
    prompt: 'Hello AI',
    models: [
      'openai:gpt-4',
      { provider: 'deepseek', model: 'deepseek-chat' },
      'gemini:gemini-2.5-flash'
    ],
    stream: true
  })

  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  deepStrictEqual(capturedRequestBody?.models, [
    'openai:gpt-4',
    { provider: 'deepseek', model: 'deepseek-chat' },
    'gemini:gemini-2.5-flash'
  ])
  strictEqual(messages.length, 2)

  server.close()
  await once(server, 'close')
})

test('client handles multiple models', async (_) => {
  let capturedRequestBody: any = null

  const server = createServer((req, res) => {
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

      res.write('event: content\ndata: {"response": "Hello"}\n\n')
      res.write('event: end\ndata: {"response": {"content": "Hello", "model": "gpt-4"}}\n\n')
      res.end()
    })
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as AddressInfo).port

  const client = buildClient({
    url: `http://localhost:${port}`,
    logger: silentLogger
  })

  const stream = await client.ask({
    prompt: 'Hello AI',
    models: [
      { provider: 'openai', model: 'gpt-4' },
      { provider: 'openai', model: 'gpt-3.5-turbo' },
      { provider: 'deepseek', model: 'deepseek-chat' }
    ],
    stream: true
  })

  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  deepStrictEqual(capturedRequestBody?.models, [
    { provider: 'openai', model: 'gpt-4' },
    { provider: 'openai', model: 'gpt-3.5-turbo' },
    { provider: 'deepseek', model: 'deepseek-chat' }
  ])
  strictEqual(messages.length, 2)

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
    await client.ask({ prompt: 'Hello', stream: true })
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
    await client.ask({ prompt: 'Hello', stream: true })
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
    res.write('event: content\ndata: invalid-json\n\n')
    res.write('event: content\ndata: {"response": "After error"}\n\n')
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`
  })

  const stream = await client.ask({ prompt: 'Hello', stream: true })
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

  const stream = await client.ask({ prompt: 'Hello', stream: true })
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

    res.write('data: {"response": "First message"}\n\n')
    res.write('data: {"response": "Second message"}\n\n')
    res.write('data: {"content": "Third message with different structure"}\n\n')
    res.write('data: {"response": {"content": "Final", "model": "test-model"}}\n\n')
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`
  })

  const stream = await client.ask({ prompt: 'Hello', stream: true })
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
      model: 'test-model'
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

  const stream = await client.ask({ prompt: 'Hello', stream: true })
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

    res.write('data: {"response": {"content": "Nested response"}}\n\n')
    res.write('data: {"message": "Error-like but not error field"}\n\n')
    res.write('data: {"response": {"sessionId": "abc123", "model": "gpt-4"}}\n\n')
    res.write('data: {"unknown": "field"}\n\n')
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`
  })

  const stream = await client.ask({ prompt: 'Hello', stream: true })
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

  const stream = await client.ask({ prompt: 'Hello', stream: true })
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
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

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
    await client.ask({ prompt: 'Hello', stream: true })
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

  const originalFetch = global.fetch
  global.fetch = async () => {
    // eslint-disable-next-line no-throw-literal
    throw 'String error'
  }

  const client = buildClient({
    url: `http://localhost:${port}`
  })

  try {
    await client.ask({ prompt: 'Hello', stream: true })
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

  const stream = await client.ask({ prompt: 'Hello', stream: true })
  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

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

  const stream = await client.ask({ prompt: 'Hello', stream: true })
  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  strictEqual(messages.length, 1)
  deepStrictEqual(messages[0], { type: 'content', content: 'Valid event' })

  server.close()
  await once(server, 'close')
})

test('client uses provided logger', async (_) => {
  const logs: Array<{ level: string; message: string; data?: any }> = []

  const mockLogger: Logger = {
    debug: (message: string, data?: any) => {
      logs.push({ level: 'debug', message, data })
    },
    info: (message: string, data?: any) => {
      logs.push({ level: 'info', message, data })
    },
    warn: (message: string, data?: any) => {
      logs.push({ level: 'warn', message, data })
    },
    error: (messageOrData: string | any, messageWhenData?: string) => {
      if (typeof messageOrData === 'string') {
        logs.push({ level: 'error', message: messageOrData, data: messageWhenData })
      } else {
        logs.push({ level: 'error', message: messageWhenData || 'Error', data: messageOrData })
      }
    }
  }

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

  const stream = await client.ask({ prompt: 'Hello', stream: true })
  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  strictEqual(messages.length, 1)
  deepStrictEqual(messages[0], { type: 'content', content: 'Test message' })

  ok(logs.length > 0, 'Logger should have been called')
  ok(logs.some(log => log.level === 'debug' && log.message === 'Making AI request'), 'Should log debug message for request')
  ok(logs.some(log => log.level === 'info' && log.message === 'AI request successful'), 'Should log info message for success')

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

  const client = buildClient({
    url: `http://localhost:${port}`
  })

  const stream = await client.ask({ prompt: 'Hello', stream: true })
  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  strictEqual(messages.length, 1)
  deepStrictEqual(messages[0], { type: 'content', content: 'Test message' })

  server.close()
  await once(server, 'close')
})

test('client uses abstract-logging when no logger provided', async (_) => {
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
    url: `http://localhost:${port}`
  })

  const stream = await client.ask({ prompt: 'Hello', stream: true })
  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  strictEqual(messages.length, 1)
  deepStrictEqual(messages[0], { type: 'content', content: 'Test message' })

  server.close()
  await once(server, 'close')
})

test('client handles non-streaming response', async (_) => {
  let capturedRequestBody: any = null

  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk.toString()
    })
    req.on('end', () => {
      capturedRequestBody = JSON.parse(body)

      res.writeHead(200, {
        'Content-Type': 'application/json'
      })

      res.end(JSON.stringify({
        content: 'Hello world!',
        model: 'gpt-4',
        sessionId: 'user-123'
      }))
    })
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as AddressInfo).port

  const client = buildClient({
    url: `http://localhost:${port}`,
    logger: silentLogger
  })

  const response = await client.ask({
    prompt: 'Hello AI',
    sessionId: 'user-123',
    models: [{ provider: 'openai', model: 'gpt-4' }],
    stream: false
  })

  strictEqual(capturedRequestBody?.prompt, 'Hello AI')
  strictEqual(capturedRequestBody?.sessionId, 'user-123')
  strictEqual(capturedRequestBody?.stream, false)
  deepStrictEqual(capturedRequestBody?.models, [{ provider: 'openai', model: 'gpt-4' }])

  deepStrictEqual(response, {
    content: 'Hello world!',
    model: 'gpt-4',
    sessionId: 'user-123'
  })

  server.close()
  await once(server, 'close')
})

test('client handles non-streaming response with error', async (_) => {
  const server = createServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Internal server error' }))
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`,
    logger: silentLogger
  })

  try {
    await client.ask({
      prompt: 'Hello AI',
      stream: false
    })
    throw new Error('Should have thrown an error')
  } catch (error) {
    ok(error instanceof Error)
    ok(error.message.includes('HTTP 500'))
  }

  server.close()
  await once(server, 'close')
})

test('client defaults to streaming when stream option not specified', async (_) => {
  let capturedRequestBody: any = null

  const server = createServer((req, res) => {
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

      res.write('event: content\ndata: {"response": "Hello"}\n\n')
      res.write('event: end\ndata: {"response": {"content": "Hello", "model": "gpt-4"}}\n\n')
      res.end()
    })
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as AddressInfo).port

  const client = buildClient({
    url: `http://localhost:${port}`,
    logger: silentLogger
  })

  const stream = await client.ask({
    prompt: 'Hello AI'
  })

  strictEqual(capturedRequestBody?.stream, true)
  ok(stream && typeof (stream as any).on === 'function', 'Should return a stream')

  server.close()
  await once(server, 'close')
})

test('client handles URL without trailing slash', async (_) => {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })
    res.write('event: content\ndata: {"response": "Hello"}\n\n')
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as AddressInfo).port

  const client = buildClient({
    url: `http://localhost:${port}`,
    logger: silentLogger
  })

  const stream = await client.ask({
    prompt: 'Hello AI',
    stream: true
  })

  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  strictEqual(messages.length, 1)
  deepStrictEqual(messages[0], { type: 'content', content: 'Hello' })

  server.close()
  await once(server, 'close')
})

test('client handles data with error field instead of message', async (_) => {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    res.write('data: {"error": "Something went wrong"}\n\n')
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`,
    logger: silentLogger
  })

  const stream = await client.ask({ prompt: 'Hello', stream: true })
  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  strictEqual(messages.length, 1)
  deepStrictEqual(messages[0], { type: 'error', error: new Error('Something went wrong') })

  server.close()
  await once(server, 'close')
})

test('client handles response object with content property', async (_) => {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    res.write('data: {"response": {"content": "Hello from content"}}\n\n')
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`,
    logger: silentLogger
  })

  const stream = await client.ask({ prompt: 'Hello', stream: true })
  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  strictEqual(messages.length, 1)
  deepStrictEqual(messages[0], { type: 'content', content: 'Hello from content' })

  server.close()
  await once(server, 'close')
})

test('client handles response object without model or sessionId', async (_) => {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    res.write('data: {"response": {"content": "Just content"}}\n\n')
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`,
    logger: silentLogger
  })

  const stream = await client.ask({ prompt: 'Hello', stream: true })
  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  strictEqual(messages.length, 1)
  deepStrictEqual(messages[0], { type: 'content', content: 'Just content' })

  server.close()
  await once(server, 'close')
})

test('client handles empty chunks in stream', async (_) => {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    res.write('\n\n')
    res.write('data: {"response": "Hello"}\n\n')
    res.write('   \n\n')
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`,
    logger: silentLogger
  })

  const stream = await client.ask({ prompt: 'Hello', stream: true })
  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  strictEqual(messages.length, 1)
  deepStrictEqual(messages[0], { type: 'content', content: 'Hello' })

  server.close()
  await once(server, 'close')
})

test('client handles response with unknown structure', async (_) => {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    res.write('data: {"unknown": "structure"}\n\n')
    res.end()
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`,
    logger: silentLogger
  })

  const stream = await client.ask({ prompt: 'Hello', stream: true })
  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  strictEqual(messages.length, 0)

  server.close()
  await once(server, 'close')
})

test('client stream handles error events', async (_) => {
  const server = createServer(async (_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    res.write('data: {"response": "First message"}\n\n')

    await setTimeout(50)
    res.destroy(new Error('Connection lost'))
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`,
    logger: silentLogger
  })

  const stream = await client.ask({ prompt: 'Hello', stream: true })
  const messages = []
  let streamError: Error | null = null

  stream.on('error', (err) => {
    streamError = err
  })

  try {
    for await (const message of stream) {
      messages.push(message)
    }
  } catch {
  }

  strictEqual(messages.length, 1)
  deepStrictEqual(messages[0], { type: 'content', content: 'First message' })

  ok(streamError !== null)
  ok((streamError as any) instanceof Error)

  server.close()
  await once(server, 'close')
})
