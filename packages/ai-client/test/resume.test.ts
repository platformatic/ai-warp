import { test } from 'node:test'
import assert from 'node:assert'
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

test('should handle streaming resume response', async () => {
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

test('should handle resume failure gracefully', async () => {
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

test('should not include resume parameter for non-streaming requests', async () => {
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
  global.fetch = fetch

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
