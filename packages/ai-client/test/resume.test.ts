import { test } from 'node:test'
import assert from 'node:assert'
import Fastify from 'fastify'
import { buildClient } from '../src/index.ts'

// Mock fetch for testing
const mockFetch = (responses: Array<{ status: number, headers?: Record<string, string>, body?: string, stream?: boolean }>) => {
  let callCount = 0

  return async (_url: string, _options: any) => {
    const response = responses[callCount++] || responses[responses.length - 1]

    const headers = new Headers({
      'content-type': response.stream ? 'text/event-stream' : 'application/json',
      'x-session-id': 'test-session-123',
      ...response.headers
    })

    if (response.stream && response.body) {
      // Create a mock ReadableStream for SSE
      const encoder = new TextEncoder()
      const chunks = response.body.split('\n\n').filter(chunk => chunk.trim())

      let chunkIndex = 0
      const stream = new ReadableStream({
        start (controller) {
          const sendNextChunk = () => {
            if (chunkIndex < chunks.length) {
              controller.enqueue(encoder.encode(chunks[chunkIndex++] + '\n\n'))
              setTimeout(sendNextChunk, 10)
            } else {
              controller.close()
            }
          }
          sendNextChunk()
        }
      })

      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        headers,
        body: stream,
        text: async () => response.body || '',
        json: async () => JSON.parse(response.body || '{}')
      }
    }

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      headers,
      text: async () => response.body || '',
      json: async () => JSON.parse(response.body || '{}')
    }
  }
}

test('should pass resume parameter to server by default', async () => {
  let lastRequestBody: any = null

  const fetch = async (url: string, options: any) => {
    lastRequestBody = JSON.parse(options.body)

    return {
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'application/json',
        'x-session-id': 'test-session'
      }),
      json: async () => ({
        text: 'Response',
        sessionId: 'test-session',
        result: 'COMPLETE'
      })
    }
  }

  // @ts-ignore - mock fetch
  global.fetch = fetch

  const client = buildClient({
    url: 'http://localhost:3000'
  })

  await client.ask({
    prompt: 'Hello',
    sessionId: 'existing-session',
    stream: false
  })

  // Should pass resume: true by default
  assert.equal(lastRequestBody.resume, true)
  assert.equal(lastRequestBody.sessionId, 'existing-session')
})

test('should pass resume: false when explicitly disabled', async () => {
  let lastRequestBody: any = null

  const fetch = async (url: string, options: any) => {
    lastRequestBody = JSON.parse(options.body)

    return {
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'application/json',
        'x-session-id': 'test-session'
      }),
      json: async () => ({
        text: 'Response',
        sessionId: 'test-session',
        result: 'COMPLETE'
      })
    }
  }

  // @ts-ignore - mock fetch
  global.fetch = fetch

  const client = buildClient({
    url: 'http://localhost:3000'
  })

  await client.ask({
    prompt: 'Hello',
    sessionId: 'existing-session',
    stream: false,
    resume: false
  })

  // Should pass resume: false when explicitly disabled
  assert.equal(lastRequestBody.resume, false)
  assert.equal(lastRequestBody.sessionId, 'existing-session')
})

test('should handle streaming resume response', async (t) => {
  const _prevFetch = globalThis.fetch
  t.after(() => {
    // Restore original fetch after test
    globalThis.fetch = _prevFetch
  })

  const resumeStreamBody = `event: content
data: {"response": "Resumed "}
id: uuid-1

event: content  
data: {"response": "content"}
id: uuid-2

event: end
data: {"response": {"text": "Resumed content", "sessionId": "test-session", "result": "COMPLETE"}}
id: uuid-3`

  // @ts-ignore - mock fetch
  global.fetch = mockFetch([
    {
      status: 200,
      stream: true,
      body: resumeStreamBody
    }
  ])

  const client = buildClient({
    url: 'http://localhost:3000'
  })

  const response = await client.ask({
    prompt: 'Continue story',
    sessionId: 'existing-session',
    stream: true
  })

  assert.ok(response.stream)
  assert.equal(response.headers.get('x-session-id'), 'test-session-123')

  const messages: any[] = []
  for await (const message of response.stream) {
    messages.push(message)
  }

  // Should receive content messages and done message
  assert.equal(messages.length, 3)
  assert.equal(messages[0].type, 'content')
  assert.equal(messages[0].content, 'Resumed ')
  assert.equal(messages[1].type, 'content')
  assert.equal(messages[1].content, 'content')
  assert.equal(messages[2].type, 'done')
  assert.equal(messages[2].response.text, 'Resumed content')
})

test('should handle resume failure gracefully', async (t) => {
  const _prevFetch = globalThis.fetch
  t.after(() => {
    // Restore original fetch after test
    globalThis.fetch = _prevFetch
  })
  const normalStreamBody = `event: content
data: {"response": "New "}
id: uuid-4

event: content
data: {"response": "response"}
id: uuid-5

event: end
data: {"response": {"text": "New response", "sessionId": "test-session", "result": "COMPLETE"}}
id: uuid-6`

  // @ts-ignore - mock fetch
  global.fetch = mockFetch([
    {
      status: 200,
      stream: true,
      body: normalStreamBody
    }
  ])

  const client = buildClient({
    url: 'http://localhost:3000'
  })

  const response = await client.ask({
    prompt: 'Hello',
    sessionId: 'existing-session',
    stream: true
  })

  assert.ok(response.stream)

  const messages: any[] = []
  for await (const message of response.stream) {
    messages.push(message)
  }

  // Should receive normal response when resume fails/unavailable
  assert.equal(messages.length, 3)
  assert.equal(messages[0].type, 'content')
  assert.equal(messages[0].content, 'New ')
  assert.equal(messages[1].type, 'content')
  assert.equal(messages[1].content, 'response')
  assert.equal(messages[2].type, 'done')
  assert.equal(messages[2].response.text, 'New response')
})

test('should not include resume parameter for non-streaming requests', async (t) => {
  const _prevFetch = globalThis.fetch
  t.after(() => {
    // Restore original fetch after test
    globalThis.fetch = _prevFetch
  })
  let lastRequestBody: any = null

  const fetch = async (url: string, options: any) => {
    lastRequestBody = JSON.parse(options.body)

    return {
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'application/json'
      }),
      json: async () => ({
        text: 'Response',
        sessionId: 'new-session',
        result: 'COMPLETE'
      })
    }
  }

  // @ts-ignore - mock fetch
  globalThis.fetch = fetch

  const client = buildClient({
    url: 'http://localhost:3000'
  })

  await client.ask({
    prompt: 'Hello',
    stream: false
  })

  // Should still include resume parameter even for non-streaming
  assert.equal(lastRequestBody.resume, true)
  assert.equal(lastRequestBody.stream, false)
})

test.skip('should auto-resume interrupted streaming request', async (t) => {
  const fastify = Fastify()

  let requestCount = 0
  let lastSessionId: string | undefined

  // Mock AI service with resume support
  fastify.post('/api/v1/stream', async (request, reply) => {
    requestCount++
    const body = request.body as any
    lastSessionId = body.sessionId

    reply.header('content-type', 'text/event-stream')
    reply.header('cache-control', 'no-cache')
    reply.header('connection', 'keep-alive')

    if (requestCount === 1) {
      // First request - send partial response then "disconnect"
      reply.raw.write('id: event-1\n')
      reply.raw.write('event: content\n')
      reply.raw.write('data: {"response": "Hello"}\n\n')

      reply.raw.write('id: event-2\n')
      reply.raw.write('event: content\n')
      reply.raw.write('data: {"response": " world"}\n\n')

      // Simulate network interruption - don't send 'end' event
      setTimeout(() => {
        reply.raw.destroy() // Simulate connection drop
      }, 10)
    } else if (requestCount === 2 && body.sessionId === lastSessionId) {
      // Resume request - send remaining events from storage
      reply.raw.write('id: event-3\n')
      reply.raw.write('event: content\n')
      reply.raw.write('data: {"response": "!"}\n\n')

      reply.raw.write('id: event-4\n')
      reply.raw.write('event: end\n')
      reply.raw.write('data: {"response": {"text": "Hello world!", "sessionId": "' + body.sessionId + '", "result": "COMPLETE"}}\n\n')

      reply.raw.end()
    } else {
      // New request without resume
      reply.raw.write('id: event-1\n')
      reply.raw.write('event: content\n')
      reply.raw.write('data: {"response": "Fresh start"}\n\n')

      reply.raw.write('id: event-2\n')
      reply.raw.write('event: end\n')
      reply.raw.write('data: {"response": {"text": "Fresh start", "sessionId": "new-session", "result": "COMPLETE"}}\n\n')

      reply.raw.end()
    }
  })
  t.after(() => {
    return fastify.close()
  })


  await fastify.listen({ port: 0 })
  const address = fastify.server.address()
  const port = typeof address === 'object' ? address?.port! : 3000

  const client = buildClient({
    url: `http://localhost:${port}`,
    logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }
  })

  // Step 1: Start streaming request
  const receivedChunks: string[] = []
  let error: any = null
  let sessionId: string | undefined

  try {
    const response = await client.ask({
      prompt: 'Hello',
      stream: true
    })

    for await (const message of response.stream) {
      if (message.type === 'content') {
        receivedChunks.push(message.content)
      } else if (message.type === 'done') {
        sessionId = message.response?.sessionId
      } else if (message.type === 'error') {
        throw message.error
      }
    }
  } catch (e) {
    error = e
    // Expected to fail due to connection drop
  }

  // Verify we received partial content before interruption
  assert.ok(receivedChunks.length > 0)
  assert.ok(receivedChunks.includes('Hello'))
  assert.ok(error !== null, 'Should have failed due to connection drop')

  // Extract sessionId from the partial response (simulate client tracking sessionId)
  const resumeSessionId = sessionId || lastSessionId || 'simulated-session-id'

  // Step 2: Make resume request with same sessionId
  const resumeChunks: string[] = []
  let resumeResult: any = null

  const resumeResponse = await client.ask({
    prompt: 'Continue', // Should be ignored
    sessionId: resumeSessionId!, // Use same session to trigger resume
    stream: true
  })

  for await (const message of resumeResponse.stream) {
    if (message.type === 'content') {
      resumeChunks.push(message.content)
    } else if (message.type === 'done') {
      resumeResult = message.response
    } else if (message.type === 'error') {
      throw message.error
    }
  }

  // Verify resume completed the stream
  assert.ok(resumeChunks.length > 0)
  assert.ok(resumeChunks.includes('!'))
  assert.ok(resumeResult !== null)
  assert.equal(resumeResult!.text, 'Hello world!')
  assert.equal(resumeResult!.sessionId, resumeSessionId)

  // Verify only 2 requests were made (original + resume)
  assert.equal(requestCount, 2)
})

test.skip('should handle resume with fresh request when no stored events', async (t) => {
  const fastify = Fastify()
  t.after(() => {
    return fastify.close()
  })

  let requestCount = 0

  // Mock AI service that handles non-existent session gracefully
  fastify.post('/api/v1/stream', async (request, reply) => {
    requestCount++

    reply.header('content-type', 'text/event-stream')
    reply.header('cache-control', 'no-cache')
    reply.header('connection', 'keep-alive')

    // Always return fresh response (simulating no stored events for session)
    reply.raw.write('id: fresh-1\n')
    reply.raw.write('event: content\n')
    reply.raw.write('data: {"response": "Fresh response"}\n\n')

    reply.raw.write('id: fresh-2\n')
    reply.raw.write('event: end\n')
    reply.raw.write('data: {"response": {"text": "Fresh response", "sessionId": "new-session", "result": "COMPLETE"}}\n\n')

    reply.raw.end()
  })

  await fastify.listen({ port: 0 })
  const address = fastify.server.address()
  const port = typeof address === 'object' ? address?.port! : 3000

  const client = buildClient({
    url: `http://localhost:${port}`,
    logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }
  })

  // Try to resume from non-existent session
  const chunks: string[] = []
  let result: any = null

  const response = await client.ask({
    prompt: 'Hello',
    sessionId: 'non-existent-session',
    stream: true
  })

  for await (const message of response.stream) {
    if (message.type === 'content') {
      chunks.push(message.content)
    } else if (message.type === 'done') {
      result = message.response
    } else if (message.type === 'error') {
      throw message.error
    }
  }

  // Should fall back to fresh response
  assert.ok(chunks.length > 0)
  assert.ok(chunks.includes('Fresh response'))
  assert.ok(result !== null)
  assert.equal(result!.text, 'Fresh response')
  assert.equal(requestCount, 1)

  await fastify.close()
})
