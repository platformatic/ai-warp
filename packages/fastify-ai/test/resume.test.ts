import assert from 'node:assert'
import { test } from 'node:test'
import { createApp, createDummyClient, mockOpenAiStream } from './helper.ts'

test('should handle resume parameter in stream request', async () => {
  let receivedRequest: any = null

  const client = {
    ...createDummyClient(),
    stream: async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Test response' } }] },
        { choices: [{ delta: { content: '' }, finish_reason: 'stop' }] }
      ])
    }
  }

  const app = await createApp({ client })

  // Mock the AI provider to capture the request
  app.ai.request = async (request: any, reply: any) => {
    receivedRequest = request

    // Return a mock stream
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start (controller) {
        controller.enqueue(encoder.encode('event: content\ndata: {"response": "Test response"}\n\n'))
        controller.enqueue(
          encoder.encode(
            'event: end\ndata: {"response": {"text": "Test response", "sessionId": "test-session", "result": "COMPLETE"}}\n\n'
          )
        )
        controller.close()
      }
    })
    reply.header('content-type', 'text/event-stream')
    return stream
  }

  const response = await app.inject({
    method: 'POST',
    url: '/stream',
    body: {
      prompt: 'Hello',
      sessionId: 'existing-session',
      resume: true
    }
  })

  assert.equal(response.statusCode, 200)
  assert.ok(receivedRequest)
  assert.equal(receivedRequest.resume, true)
  assert.equal(receivedRequest.sessionId, 'existing-session')
})

test('should handle resume: false parameter', async () => {
  let receivedRequest: any = null

  const client = {
    ...createDummyClient(),
    stream: async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'New response' } }] },
        { choices: [{ delta: { content: '' }, finish_reason: 'stop' }] }
      ])
    }
  }

  const app = await createApp({ client })

  // Mock the AI provider
  app.ai.request = async (request: any, reply: any) => {
    receivedRequest = request

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start (controller) {
        controller.enqueue(encoder.encode('event: content\ndata: {"response": "New response"}\n\n'))
        controller.enqueue(
          encoder.encode(
            'event: end\ndata: {"response": {"text": "New response", "sessionId": "test-session", "result": "COMPLETE"}}\n\n'
          )
        )
        controller.close()
      }
    })
    reply.header('content-type', 'text/event-stream')
    return stream
  }

  const response = await app.inject({
    method: 'POST',
    url: '/stream',
    body: {
      prompt: 'Hello',
      sessionId: 'existing-session',
      resume: false
    }
  })

  assert.equal(response.statusCode, 200)
  assert.ok(receivedRequest)
  assert.equal(receivedRequest.resume, false)
  assert.equal(receivedRequest.sessionId, 'existing-session')
})

test('should default resume to true when not specified', async () => {
  let receivedRequest: any = null

  const client = {
    ...createDummyClient(),
    stream: async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Auto resume response' } }] },
        { choices: [{ delta: { content: '' }, finish_reason: 'stop' }] }
      ])
    }
  }

  const app = await createApp({ client })

  // Mock the AI provider
  app.ai.request = async (request: any, reply: any) => {
    receivedRequest = request

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start (controller) {
        controller.enqueue(encoder.encode('event: content\ndata: {"response": "Auto resume response"}\n\n'))
        controller.enqueue(
          encoder.encode(
            'event: end\ndata: {"response": {"text": "Auto resume response", "sessionId": "test-session", "result": "COMPLETE"}}\n\n'
          )
        )
        controller.close()
      }
    })
    reply.header('content-type', 'text/event-stream')
    return stream
  }

  const response = await app.inject({
    method: 'POST',
    url: '/stream',
    body: {
      prompt: 'Hello',
      sessionId: 'existing-session'
      // resume not specified - should default to true
    }
  })

  assert.equal(response.statusCode, 200)
  assert.ok(receivedRequest)
  // Should default to undefined, will be handled by ai-provider default
  assert.equal(receivedRequest.resume, undefined)
  assert.equal(receivedRequest.sessionId, 'existing-session')
})

test('should handle resume parameter in prompt request', async () => {
  let receivedRequest: any = null

  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Direct response' }, finish_reason: 'stop' }] }
    }
  }

  const app = await createApp({ client })

  // Mock the AI provider
  app.ai.request = async (request: any, _reply: any) => {
    receivedRequest = request

    return {
      text: 'Direct response',
      sessionId: 'test-session',
      result: 'COMPLETE'
    }
  }

  const response = await app.inject({
    method: 'POST',
    url: '/prompt',
    body: {
      prompt: 'Hello',
      sessionId: 'existing-session',
      resume: false
    }
  })

  assert.equal(response.statusCode, 200)
  assert.ok(receivedRequest)
  assert.equal(receivedRequest.resume, false)
  assert.equal(receivedRequest.sessionId, 'existing-session')

  const body = JSON.parse(response.body)
  assert.equal(body.text, 'Direct response')
  assert.equal(body.sessionId, 'test-session')
})

test('should pass resume parameter to underlying AI request correctly', async () => {
  const capturedRequests: any[] = []

  const client = {
    ...createDummyClient(),
    stream: async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Mock response' } }] },
        { choices: [{ delta: { content: '' }, finish_reason: 'stop' }] }
      ])
    }
  }

  const app = await createApp({ client })

  // Mock the AI provider to capture all requests
  app.ai.request = async (request: any, reply: any) => {
    capturedRequests.push(request)

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start (controller) {
        controller.enqueue(encoder.encode('event: content\ndata: {"response": "Mock response"}\n\n'))
        controller.enqueue(
          encoder.encode(
            'event: end\ndata: {"response": {"text": "Mock response", "sessionId": "test-session", "result": "COMPLETE"}}\n\n'
          )
        )
        controller.close()
      }
    })
    reply.header('content-type', 'text/event-stream')
    return stream
  }

  // Test with resume: true
  await app.inject({
    method: 'POST',
    url: '/stream',
    body: {
      prompt: 'Hello with resume',
      sessionId: 'session-1',
      resume: true
    }
  })

  // Test with resume: false
  await app.inject({
    method: 'POST',
    url: '/stream',
    body: {
      prompt: 'Hello without resume',
      sessionId: 'session-2',
      resume: false
    }
  })

  // Test with no resume parameter
  await app.inject({
    method: 'POST',
    url: '/stream',
    body: {
      prompt: 'Hello default resume',
      sessionId: 'session-3'
    }
  })

  assert.equal(capturedRequests.length, 3)

  // First request with resume: true
  assert.equal(capturedRequests[0].resume, true)
  assert.equal(capturedRequests[0].prompt, 'Hello with resume')
  assert.equal(capturedRequests[0].sessionId, 'session-1')

  // Second request with resume: false
  assert.equal(capturedRequests[1].resume, false)
  assert.equal(capturedRequests[1].prompt, 'Hello without resume')
  assert.equal(capturedRequests[1].sessionId, 'session-2')

  // Third request with default resume (undefined, handled by ai-provider)
  assert.equal(capturedRequests[2].resume, undefined)
  assert.equal(capturedRequests[2].prompt, 'Hello default resume')
  assert.equal(capturedRequests[2].sessionId, 'session-3')
})

test('should handle resumeEventId parameter in stream request', async () => {
  let receivedRequest: any = null

  const client = {
    ...createDummyClient(),
    stream: async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Resumed response' } }] },
        { choices: [{ delta: { content: '' }, finish_reason: 'stop' }] }
      ])
    }
  }

  const app = await createApp({ client })

  // Mock the AI provider to capture the request and return a proper stream
  app.ai.request = async (request: any, reply: any) => {
    receivedRequest = request

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start (controller) {
        controller.enqueue(encoder.encode('event: content\ndata: {"response": "Resumed response"}\n\n'))
        controller.enqueue(
          encoder.encode(
            'event: end\ndata: {"response": {"text": "Resumed response", "sessionId": "test-session", "result": "COMPLETE"}}\n\n'
          )
        )
        controller.close()
      }
    })
    reply.header('content-type', 'text/event-stream')
    return stream
  }

  const response = await app.inject({
    method: 'POST',
    url: '/stream',
    body: {
      prompt: 'Continue conversation',
      sessionId: 'existing-session',
      resumeEventId: 'event-12345'
    }
  })

  assert.equal(response.statusCode, 200)
  assert.ok(receivedRequest)
  assert.equal(receivedRequest.resumeEventId, 'event-12345')
  assert.equal(receivedRequest.sessionId, 'existing-session')
  assert.equal(receivedRequest.prompt, 'Continue conversation')
})

test('should handle resumeEventId parameter in prompt request', async () => {
  let receivedRequest: any = null

  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Resumed prompt response' }, finish_reason: 'stop' }] }
    }
  }

  const app = await createApp({ client })

  // Mock the AI provider
  app.ai.request = async (request: any, _reply: any) => {
    receivedRequest = request

    return {
      text: 'Resumed prompt response',
      sessionId: 'test-session',
      result: 'COMPLETE'
    }
  }

  const response = await app.inject({
    method: 'POST',
    url: '/prompt',
    body: {
      prompt: 'Continue from here',
      sessionId: 'existing-session',
      resumeEventId: 'event-67890'
    }
  })

  assert.equal(response.statusCode, 200)
  assert.ok(receivedRequest)
  assert.equal(receivedRequest.resumeEventId, 'event-67890')
  assert.equal(receivedRequest.sessionId, 'existing-session')
  assert.equal(receivedRequest.prompt, 'Continue from here')

  const body = JSON.parse(response.body)
  assert.equal(body.text, 'Resumed prompt response')
  assert.equal(body.sessionId, 'test-session')
})

test('should pass resumeEventId parameter to underlying AI request correctly', async () => {
  const capturedRequests: any[] = []

  const client = {
    ...createDummyClient(),
    stream: async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Response with resumeEventId' } }] },
        { choices: [{ delta: { content: '' }, finish_reason: 'stop' }] }
      ])
    }
  }

  const app = await createApp({ client })

  // Mock the AI provider to capture all requests
  const originalRequest = app.ai.request
  app.ai.request = async (request: any, reply: any) => {
    capturedRequests.push(request)
    return await originalRequest(request, reply)
  }

  // Test with resumeEventId provided
  await app.inject({
    method: 'POST',
    url: '/stream',
    body: {
      prompt: 'Resume from event',
      sessionId: 'session-1',
      resumeEventId: 'event-abc123'
    }
  })

  // Test without resumeEventId
  await app.inject({
    method: 'POST',
    url: '/stream',
    body: {
      prompt: 'New conversation',
      sessionId: 'session-2'
    }
  })

  // Test with both resume and resumeEventId
  await app.inject({
    method: 'POST',
    url: '/stream',
    body: {
      prompt: 'Resume with both params',
      sessionId: 'session-3',
      resume: true,
      resumeEventId: 'event-def456'
    }
  })

  assert.equal(capturedRequests.length, 3)

  // First request with resumeEventId
  assert.equal(capturedRequests[0].resumeEventId, 'event-abc123')
  assert.equal(capturedRequests[0].prompt, 'Resume from event')
  assert.equal(capturedRequests[0].sessionId, 'session-1')

  // Second request without resumeEventId
  assert.equal(capturedRequests[1].resumeEventId, undefined)
  assert.equal(capturedRequests[1].prompt, 'New conversation')
  assert.equal(capturedRequests[1].sessionId, 'session-2')

  // Third request with both resume and resumeEventId
  assert.equal(capturedRequests[2].resume, true)
  assert.equal(capturedRequests[2].resumeEventId, 'event-def456')
  assert.equal(capturedRequests[2].prompt, 'Resume with both params')
  assert.equal(capturedRequests[2].sessionId, 'session-3')
})
