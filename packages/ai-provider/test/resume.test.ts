import { test } from 'node:test'
import assert from 'node:assert'
import { Ai, type AiStreamResponse } from '../src/lib/ai.ts'
import pino from 'pino'
import { createDummyClient, mockOpenAiStream } from './helper/helper.ts'
import { isStream } from '../src/lib/utils.ts'

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
  }) as AiStreamResponse

  assert.ok(isStream(originalResponse), 'Response should be a stream-like object')
  const originalSessionId = (originalResponse as any).sessionId
  assert.ok(originalSessionId)

  const chunks: Uint8Array[] = []
  for await (const chunk of originalResponse) {
    chunks.push(chunk)
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
  }) as AiStreamResponse

  assert.ok(isStream(resumedResponse), 'Response should be a stream-like object')
  assert.equal((resumedResponse as any).sessionId, originalSessionId)

  // Consume the resumed stream
  const resumeChunks: Uint8Array[] = []
  for await (const chunk of resumedResponse) {
    resumeChunks.push(chunk)
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
  }) as AiStreamResponse

  assert.ok(isStream(response1), 'Response should be a stream-like object')
  const sessionId = (response1 as any).sessionId

  // Consume first stream
  for await (const _chunk of response1) {
    // Just consume the stream
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
  }) as AiStreamResponse

  assert.ok(isStream(response2), 'Response should be a stream-like object')
  assert.equal((response2 as any).sessionId, sessionId)

  // Should have made 2 provider calls since resume was disabled
  assert.equal(callCount, 2)
})

test('should resume from storage without calling provider API', async () => {
  let apiCallCount = 0
  const client = {
    ...createDummyClient(),
    stream: async () => {
      apiCallCount++
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Hello' } }] },
        { choices: [{ delta: { content: ' world' } }] },
        { choices: [{ delta: { content: '!' }, finish_reason: 'stop' }] }
      ])
    }
  }

  const ai = new Ai({
    logger: pino({ level: 'silent' }),
    providers: {
      openai: {
        apiKey: 'test',
        client
      }
    },
    models: [
      {
        provider: 'openai',
        model: 'gpt-4o-mini'
      }
    ]
  })

  await ai.init()

  // Step 1: Complete a streaming request to populate storage
  const originalResponse = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Say hello',
    options: { stream: true }
  }) as AiStreamResponse

  assert.ok(isStream(originalResponse), 'Response should be a stream-like object')
  const sessionId = (originalResponse as any).sessionId
  assert.ok(sessionId)

  // Consume the original stream completely
  const allChunks: Uint8Array[] = []
  for await (const chunk of originalResponse) {
    allChunks.push(chunk)
  }

  // Verify we have content stored
  assert.ok(allChunks.length > 0)
  assert.equal(apiCallCount, 1, 'Should have called API once for original request')

  // Wait for background processing to complete
  await new Promise(resolve => setTimeout(resolve, 100))

  // Step 2: Verify events are stored in history
  const storedHistory = await ai.history.range(sessionId)
  assert.ok(storedHistory.length > 0, 'Should have stored events in history')

  // Step 3: Make resume request - should get data from storage, NOT call API
  const resumeResponse = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Continue the conversation', // This should be ignored
    options: {
      stream: true,
      sessionId // Same sessionId triggers auto-resume
    }
  }) as AiStreamResponse

  assert.ok(isStream(resumeResponse), 'Response should be a stream-like object')
  assert.equal((resumeResponse as any).sessionId, sessionId)

  // Verify API was NOT called again (still only 1 call)
  assert.equal(apiCallCount, 1, 'Should NOT call API for resume - should use storage')

  // Consume the resume stream
  const resumeChunks: Uint8Array[] = []
  for await (const chunk of resumeResponse) {
    resumeChunks.push(chunk)
  }

  // Verify we received data from storage
  assert.ok(resumeChunks.length > 0, 'Should receive events from storage')

  const resumeContent = Buffer.concat(resumeChunks).toString()
  assert.ok(resumeContent.includes('Hello'), 'Should contain original content from storage')
  assert.ok(resumeContent.includes('world'), 'Should contain original content from storage')

  await ai.close()
})

test('should call API when resume fails and no stored events exist', async () => {
  let apiCallCount = 0
  const client = {
    ...createDummyClient(),
    stream: async () => {
      apiCallCount++
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Fresh' } }] },
        { choices: [{ delta: { content: ' response' }, finish_reason: 'stop' }] }
      ])
    }
  }

  const ai = new Ai({
    logger: pino({ level: 'silent' }),
    providers: {
      openai: {
        apiKey: 'test',
        client
      }
    },
    models: [
      {
        provider: 'openai',
        model: 'gpt-4o-mini'
      }
    ]
  })

  await ai.init()

  // Make normal request without sessionId (simulates no stored events)
  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello from nowhere',
    options: {
      stream: true
      // No sessionId provided - should make normal API call
    }
  }) as AiStreamResponse

  assert.ok(isStream(response), 'Response should be a stream-like object')

  // Should have called API since no stored events exist
  assert.equal(apiCallCount, 1, 'Should call API when no stored events exist')

  // Consume response to verify it's a fresh response
  const chunks: Uint8Array[] = []
  for await (const chunk of response) {
    chunks.push(chunk)
  }

  const content = Buffer.concat(chunks).toString()
  assert.ok(content.includes('Fresh'), 'Should contain fresh response from API')

  await ai.close()
})

test('should handle explicit resume disabled parameter', async () => {
  let apiCallCount = 0
  const client = {
    ...createDummyClient(),
    stream: async () => {
      apiCallCount++
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Original' } }] },
        { choices: [{ delta: { content: ' content' }, finish_reason: 'stop' }] }
      ])
    }
  }

  const ai = new Ai({
    logger: pino({ level: 'silent' }),
    providers: {
      openai: {
        apiKey: 'test',
        client
      }
    },
    models: [
      {
        provider: 'openai',
        model: 'gpt-4o-mini'
      }
    ]
  })

  await ai.init()

  // First, create a session with stored events
  const originalResponse = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello',
    options: { stream: true }
  }) as AiStreamResponse

  const sessionId = (originalResponse as any).sessionId
  for await (const _chunk of originalResponse) {
    // Just consume the stream
  }

  assert.equal(apiCallCount, 1, 'Should have made first API call')

  // Wait for background processing
  await new Promise(resolve => setTimeout(resolve, 50))

  // Now make request with same sessionId but resume disabled
  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'New request',
    options: {
      stream: true,
      sessionId
    },
    resume: false // Explicitly disable resume
  }) as AiStreamResponse

  assert.ok(isStream(response), 'Response should be a stream-like object')

  // Should have made second API call since resume was disabled
  assert.equal(apiCallCount, 2, 'Should call API again when resume is disabled')

  await ai.close()
})
