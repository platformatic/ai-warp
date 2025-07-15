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

test('client handles SSE parsing errors gracefully', async (_) => {
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    })

    res.write('event: content\ndata: {"response": "Valid"}\n\n')
    res.write('event: content\ndata: invalid-json\n\n')  // This should be skipped
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

  strictEqual(messages.length, 2)
  deepStrictEqual(messages[0], { type: 'content', content: 'Valid' })
  deepStrictEqual(messages[1], { type: 'content', content: 'After error' })

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
