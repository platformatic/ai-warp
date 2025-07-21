import { test } from 'node:test'
import assert from 'node:assert'
import pino from 'pino'
import { Ai } from '../src/index.ts'
import { createDummyClient, mockOpenAiStream } from './helper/helper.ts'

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
  })

  assert.ok(originalResponse instanceof ReadableStream)
  const sessionId = (originalResponse as any).sessionId
  assert.ok(sessionId)

  // Consume the original stream completely
  const reader = originalResponse.getReader()
  const allChunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) allChunks.push(value)
    }
  } finally {
    reader.releaseLock()
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
      sessionId: sessionId // Same sessionId triggers auto-resume
    }
  })

  assert.ok(resumeResponse instanceof ReadableStream)
  assert.equal((resumeResponse as any).sessionId, sessionId)

  // Verify API was NOT called again (still only 1 call)
  assert.equal(apiCallCount, 1, 'Should NOT call API for resume - should use storage')

  // Consume the resume stream
  const resumeReader = resumeResponse.getReader()
  const resumeChunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await resumeReader.read()
      if (done) break
      if (value) resumeChunks.push(value)
    }
  } finally {
    resumeReader.releaseLock()
  }

  // Verify we received data from storage
  assert.ok(resumeChunks.length > 0, 'Should receive events from storage')

  // Decode and verify content matches stored data
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
  })

  assert.ok(response instanceof ReadableStream)

  // Should have called API since no stored events exist
  assert.equal(apiCallCount, 1, 'Should call API when no stored events exist')

  // Consume response to verify it's a fresh response
  const reader = response.getReader()
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
  } finally {
    reader.releaseLock()
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
  })

  const sessionId = (originalResponse as any).sessionId
  const reader = (originalResponse as ReadableStream).getReader()
  try {
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }
  } finally {
    reader.releaseLock()
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
      sessionId: sessionId
    },
    resume: false // Explicitly disable resume
  })

  assert.ok(response instanceof ReadableStream)

  // Should have made second API call since resume was disabled
  assert.equal(apiCallCount, 2, 'Should call API again when resume is disabled')

  await ai.close()
})
