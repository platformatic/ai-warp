import { mock, test } from 'node:test'
import assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { Ai, type AiStreamResponse } from '../src/lib/ai.ts'
import { consumeStream, createAi, createDummyClient, mockOpenAiStream } from './helper/helper.ts'
import { isStream } from '../src/lib/utils.ts'

const apiKey = 'test'
const logger = pino({ level: 'silent' })

test('should resume stream from first event ID', async (t) => {
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Hello' } }] },
        { choices: [{ delta: { content: ' world' } }] },
        { choices: [{ delta: { content: '!' }, finish_reason: 'stop' }] }
      ])
    })
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
  t.after(() => ai.close())

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
  const firstEventId = history[0].id
  assert.ok(firstEventId)

  // Now make another streaming request with the same sessionId - should auto-resume
  const resumedResponse = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Say hello again', // This will be ignored for resume
    options: {
      stream: true,
      sessionId: originalSessionId,
      resumeEventId: firstEventId
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
  assert.equal(resumeChunks.length, 1)

  // Verify that we only made one call to the provider (the original request)
  // The resume should not call the provider again
  assert.equal(client.stream.mock.calls.length, 1, 'Should have made one call to the provider')
})

test('should make normal request when resume is disabled', async (t) => {
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
  t.after(() => ai.close())

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
      resumeEventId: undefined, // Explicitly disable resume
      stream: true
    },
  }) as AiStreamResponse

  assert.ok(isStream(response2), 'Response should be a stream-like object')
  assert.equal((response2 as any).sessionId, sessionId)

  // Should have made 2 provider calls since resume was disabled
  assert.equal(callCount, 2)
})

test('should call API when resume fails and no stored events exist', async (t) => {
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
  t.after(() => ai.close())

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

test('should resume the whole session by the first resume event id', async (t) => {
  const historyExpiration = 10_000
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => { return [] })
  }
  const ai = await createAi({ t, client })

  const sessionId = randomUUID()
  const resumeEventId = randomUUID()
  await ai.history.push(sessionId, resumeEventId, {
    event: 'content',
    data: { prompt: 'Prompt 1' },
    type: 'prompt'
  }, historyExpiration)

  await ai.history.push(sessionId, randomUUID(), {
    event: 'content',
    data: { response: 'Response 1' },
    type: 'response'
  }, historyExpiration)

  await ai.history.push(sessionId, randomUUID(), {
    event: 'end',
    data: { response: 'COMPLETE' }
  }, historyExpiration)

  const response = await ai.request({
    prompt: 'Prompt 2',
    options: { stream: true, sessionId, resumeEventId }
  }) as AiStreamResponse

  const { content } = await consumeStream(response)

  assert.equal(client.stream.mock.calls.length, 0, 'Should have no request call')
  assert.equal(content.join(''), 'Response 1')
})

test('should resume the rest of the session by a specific resume event id', async (t) => {
  const historyExpiration = 10_000
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => { return [] })
  }
  const ai = await createAi({ t, client })

  const sessionId = randomUUID()
  const resumeEventIds = [randomUUID(), randomUUID(), randomUUID()]
  const responseContents = ['Response 1', 'Response 2']

  // First prompt-response
  await ai.history.push(sessionId, resumeEventIds[0], {
    event: 'content',
    data: { prompt: 'Prompt 1' },
    type: 'prompt'
  }, historyExpiration)

  await ai.history.push(sessionId, resumeEventIds[1], {
    event: 'content',
    data: { response: responseContents[0] },
    type: 'response'
  }, historyExpiration)

  await ai.history.push(sessionId, resumeEventIds[2], {
    event: 'end',
    data: { response: 'COMPLETE' }
  }, historyExpiration)

  // Second prompt-response
  await ai.history.push(sessionId, resumeEventIds[3], {
    event: 'content',
    data: { prompt: 'Prompt 2' },
    type: 'prompt'
  }, historyExpiration)

  await ai.history.push(sessionId, resumeEventIds[4], {
    event: 'content',
    data: { response: responseContents[1] },
    type: 'response'
  }, historyExpiration)

  await ai.history.push(sessionId, resumeEventIds[5], {
    event: 'end',
    data: { response: 'COMPLETE' }
  }, historyExpiration)

  for (let i = 0; i < resumeEventIds.length; i++) {
    const response = await ai.request({
      prompt: 'Prompt 3',
      options: { stream: true, sessionId, resumeEventId: resumeEventIds[i] }
    }) as AiStreamResponse

    const { content } = await consumeStream(response)
    assert.equal(client.stream.mock.calls.length, 0, 'Should have no request call')
    console.log(i, content.join(''), '==', responseContents.slice(0, i+1).join(''))
    assert.equal(content.join(''), responseContents.slice(0, i+1).join(''))
  }
})

test('should resume the second response by resume event id on an incomplete response', async (t) => {
  const historyExpiration = 10_000
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => { return [] })
  }
  const ai = await createAi({ t, client })

  const sessionId = randomUUID()
  await ai.history.push(sessionId, randomUUID(), {
    event: 'content',
    data: { prompt: 'Prompt 1' },
    type: 'prompt'
  }, historyExpiration)

  await ai.history.push(sessionId, randomUUID(), {
    event: 'content',
    data: { response: 'Response 1' },
    type: 'response'
  }, historyExpiration)

  await ai.history.push(sessionId, randomUUID(), {
    event: 'end',
    data: { response: 'COMPLETE' }
  }, historyExpiration)

  // Second response
  const resumeEventId = randomUUID()
  await ai.history.push(sessionId, resumeEventId, {
    event: 'content',
    data: { prompt: 'Prompt 2' },
    type: 'prompt'
  }, historyExpiration)

  await ai.history.push(sessionId, randomUUID(), {
    event: 'content',
    data: { response: 'Response 2' },
    type: 'response'
  }, historyExpiration)

  await ai.history.push(sessionId, randomUUID(), {
    event: 'end',
    data: { response: 'COMPLETE' }
  }, historyExpiration)

  // Third incomplete response
  await ai.history.push(sessionId, randomUUID(), {
    event: 'content',
    data: { response: 'Resp...' },
    type: 'response'
  }, historyExpiration)

  const response = await ai.request({
    prompt: 'Prompt 3',
    options: { stream: true, sessionId, resumeEventId }
  }) as AiStreamResponse

  const { content } = await consumeStream(response)

  assert.equal(client.stream.mock.calls.length, 0, 'Should have no request call')
  assert.equal(content.join(''), 'Response 2')
})

test('should not resume a error response by resume event id but make a new request', async (t) => {
  const historyExpiration = 10_000
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Response' } }] },
        { choices: [{ delta: { content: ' 3' }, finish_reason: 'stop' }] }
      ])
    })
  }
  const ai = await createAi({ t, client })

  const sessionId = randomUUID()
  await ai.history.push(sessionId, randomUUID(), {
    event: 'content',
    data: { prompt: 'Prompt 1' },
    type: 'prompt'
  }, historyExpiration)

  await ai.history.push(sessionId, randomUUID(), {
    event: 'content',
    data: { response: 'Response 1' },
    type: 'response'
  }, historyExpiration)

  await ai.history.push(sessionId, randomUUID(), {
    event: 'end',
    data: { response: 'COMPLETE' }
  }, historyExpiration)

  // Second response
  const resumeEventId = randomUUID()
  await ai.history.push(sessionId, resumeEventId, {
    event: 'content',
    data: { prompt: 'Prompt 2' },
    type: 'prompt'
  }, historyExpiration)

  await ai.history.push(sessionId, randomUUID(), {
    event: 'content',
    data: { response: 'Response 2' },
    type: 'response'
  }, historyExpiration)

  await ai.history.push(sessionId, randomUUID(), {
    event: 'error',
    data: { code: 'PROVIDER_ERROR', message: 'Connection failed' },
  }, historyExpiration)

  const response = await ai.request({
    prompt: 'Prompt 3',
    options: { stream: true, sessionId, resumeEventId }
  }) as AiStreamResponse

  const { content } = await consumeStream(response)

  assert.equal(client.stream.mock.calls.length, 1, 'Should have one request call')
  // @ts-ignore
  assert.deepEqual(client.stream.mock.calls[0].arguments[1].messages, [
    {
      content: 'Prompt 2',
      role: 'user'
    },
    {
      content: 'Response 1',
      role: 'assistant'
    },
    {
      content: 'Response 2',
      role: 'assistant'
    },
    {
      content: 'Prompt 3',
      role: 'user'
    }
  ])
  assert.equal(content.join(''), 'Response 3')
})
