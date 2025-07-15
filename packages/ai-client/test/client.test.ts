import { test } from 'node:test'
import { deepStrictEqual, strictEqual } from 'node:assert'
import { buildClient } from '../src/index.ts'
import { createServer } from 'node:http'
import { once } from 'node:events'

test('buildClient creates a client with ask method', async (_) => {
  const client = buildClient({
    url: 'http://localhost:3000',
    headers: { Authorization: 'Bearer token' }
  })

  strictEqual(typeof client.ask, 'function')
  strictEqual(typeof client.close, 'function')
})

test('client.ask sends correct request and handles streaming response', async (_) => {
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/ai') {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        const parsed = JSON.parse(body)
        deepStrictEqual(parsed, {
          prompt: 'Hello AI',
          sessionId: 'test-session',
          stream: true
        })

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        })

        res.write('event: content\ndata: {"response": "Hello"}\n\n')
        res.write('event: content\ndata: {"response": " from"}\n\n')
        res.write('event: content\ndata: {"response": " AI"}\n\n')
        res.write('event: end\ndata: {"response": {"content": "Hello from AI", "model": "test-model"}}\n\n')
        res.end()
      })
    } else {
      res.writeHead(404)
      res.end()
    }
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`
  })

  const stream = await client.ask({
    prompt: 'Hello AI',
    sessionId: 'test-session'
  })

  const messages = []
  for await (const message of stream) {
    messages.push(message)
  }

  strictEqual(messages.length, 4)
  deepStrictEqual(messages[0], { type: 'content', content: 'Hello' })
  deepStrictEqual(messages[1], { type: 'content', content: ' from' })
  deepStrictEqual(messages[2], { type: 'content', content: ' AI' })
  deepStrictEqual(messages[3], {
    type: 'done',
    response: {
      content: 'Hello from AI',
      model: 'test-model'
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
    throw new Error('Should have thrown')
  } catch (error) {
    strictEqual((error as Error).message, 'HTTP 500: Internal Server Error')
  }

  server.close()
  await once(server, 'close')
})

test('client handles timeout', async (_) => {
  const server = createServer((_, __) => {
    // Don't respond, causing a timeout
  })

  server.listen(0)
  await once(server, 'listening')
  const port = (server.address() as any).port

  const client = buildClient({
    url: `http://localhost:${port}`,
    timeout: 100
  })

  try {
    await client.ask({ prompt: 'Hello' })
    throw new Error('Should have thrown')
  } catch (error) {
    strictEqual((error as Error).message, 'Request timeout')
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

    // Various data-only message formats
    res.write('data: {"response": "Simple string response"}\n\n')
    res.write('data: {"content": "Using content field"}\n\n')
    res.write('data: {"response": {"content": "Nested content"}}\n\n')
    res.write('data: {"message": "Error message format"}\n\n')
    res.write('data: {"error": "Direct error field"}\n\n')
    res.write('data: {"unknown": "Should be ignored"}\n\n')
    res.write('data: invalid json\n\n')  // Plain text treated as content
    res.write('data: {"response": {"content": "Done", "model": "gpt-4", "sessionId": "123"}}\n\n')
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

  strictEqual(messages.length, 7)
  deepStrictEqual(messages[0], { type: 'content', content: 'Simple string response' })
  deepStrictEqual(messages[1], { type: 'content', content: 'Using content field' })
  deepStrictEqual(messages[2], { type: 'content', content: 'Nested content' })
  deepStrictEqual(messages[3], { type: 'error', error: new Error('Error message format') })
  deepStrictEqual(messages[4], { type: 'error', error: new Error('Direct error field') })
  deepStrictEqual(messages[5], { type: 'content', content: 'invalid json' })
  deepStrictEqual(messages[6], {
    type: 'done',
    response: {
      content: 'Done',
      model: 'gpt-4',
      sessionId: '123'
    }
  })

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
