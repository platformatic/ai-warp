import { test } from 'node:test'
import assert from 'node:assert'
import Fastify from 'fastify'
import { buildClient } from '../src/index.ts'

test('should auto-resume interrupted streaming request', async () => {
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

  await fastify.close()
})

test('should handle resume with fresh request when no stored events', async () => {
  const fastify = Fastify()
  
  let requestCount = 0
  
  // Mock AI service that handles non-existent session gracefully
  fastify.post('/api/v1/stream', async (request, reply) => {
    requestCount++
    const body = request.body as any
    
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
