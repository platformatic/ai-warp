import { test } from 'node:test'
import assert from 'node:assert'
import { Ai } from '../src/lib/ai.ts'
import pino from 'pino'
import { createDummyClient, mockOpenAiStream } from './helper/helper.ts'

const apiKey = 'test'
const logger = pino({ level: 'silent' })

test('should resume stream from event ID', async () => {
  let callCount = 0
  const client = {
    ...createDummyClient(),
    stream: async () => {
      callCount++
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Hello' } }] },
        { choices: [{ delta: { content: ' world' } }] },
        { choices: [{ delta: { content: '!' }, finish_reason: 'stop' }] }
      ])
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      openai: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'openai',
      model: 'gpt-4o-mini'
    }]
  })
  await ai.init()

  // First, make a streaming request to populate history
  const originalResponse = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Say hello',
    options: { stream: true }
  })

  assert.ok(originalResponse instanceof ReadableStream)
  const originalSessionId = (originalResponse as any).sessionId
  assert.ok(originalSessionId)

  // Consume the original stream
  const reader = originalResponse.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }

  // Wait a bit for background processing to complete
  await new Promise(resolve => setTimeout(resolve, 100))

  // Get the history to find event IDs
  const history = await ai.history.range(originalSessionId)
  assert.ok(history.length > 0)

  // Find the first event ID
  const firstEventId = history[0].eventId
  assert.ok(firstEventId)

  // Now make another streaming request with the same sessionId - should auto-resume
  const resumedResponse = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Say hello again', // This will be ignored for resume
    options: {
      stream: true,
      sessionId: originalSessionId
    }
  })

  assert.ok(resumedResponse instanceof ReadableStream)
  assert.equal((resumedResponse as any).sessionId, originalSessionId)

  // Consume the resumed stream
  const resumeReader = resumedResponse.getReader()
  const resumeChunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await resumeReader.read()
    if (done) break
    if (value) resumeChunks.push(value)
  }

  // Should have received some chunks from the resume
  assert.ok(resumeChunks.length > 0)

  // Verify that we only made one call to the provider (the original request)
  // The resume should not call the provider again
  assert.equal(callCount, 1)
})

test('should make normal request when resume is disabled', async () => {
  let callCount = 0
  const client = {
    ...createDummyClient(),
    stream: async () => {
      callCount++
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Stream' } }] },
        { choices: [{ delta: { content: ' response' }, finish_reason: 'stop' }] }
      ])
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      openai: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'openai',
      model: 'gpt-4o-mini'
    }]
  })
  await ai.init()

  // First make a streaming request to create history
  const response1 = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello',
    options: { stream: true }
  })

  assert.ok(response1 instanceof ReadableStream)
  const sessionId = (response1 as any).sessionId

  // Consume first stream
  const reader1 = response1.getReader()
  while (true) {
    const { done } = await reader1.read()
    if (done) break
  }

  // Wait for background processing
  await new Promise(resolve => setTimeout(resolve, 50))

  // Make another streaming request with resume disabled - should make new provider call
  const response2 = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello again',
    options: {
      sessionId,
      stream: true
    },
    resume: false // Explicitly disable resume
  })

  assert.ok(response2 instanceof ReadableStream)
  assert.equal((response2 as any).sessionId, sessionId)

  // Should have made 2 provider calls since resume was disabled
  assert.equal(callCount, 2)
})
