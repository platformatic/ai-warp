import { mock, test } from 'node:test'
import assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { Ai, type AiStreamResponse } from '../src/lib/ai.ts'
import { consumeStream, createAi, createDummyClient, mockOpenAiStream } from './helper/helper.ts'
import { isStream } from '../src/lib/utils.ts'

const apiKey = 'test'
const logger = pino({ level: 'silent' })
const historyExpiration = 10_000

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

  { const { content, chunks } = await consumeStream(originalResponse, 'content')
    assert.equal(chunks, 4)
    assert.equal(content.join(''), 'Hello world!')
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
    options: {
      stream: true,
      sessionId: originalSessionId,
      resumeEventId: firstEventId
    }
  }) as AiStreamResponse

  assert.ok(isStream(resumedResponse), 'Response should be a stream-like object')
  assert.equal((resumedResponse as any).sessionId, originalSessionId)

  {  // Should have received some chunks from the resume
    const { content, chunks } = await consumeStream(resumedResponse, 'content')
    assert.equal(chunks, 4)
    assert.equal(content.join(''), 'Hello world!')
  }
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

test('should get only the content of a specific resume event id, without prompt', async (t) => {
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
    options: { stream: true, sessionId, resumeEventId }
  }) as AiStreamResponse

  const { content } = await consumeStream(response)

  assert.equal(client.stream.mock.calls.length, 0, 'Should have no request call')
  assert.equal(content.join(''), 'Response 1')
})

test('should resume the second response by resume event id on an incomplete response', async (t) => {
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
    options: { stream: true, sessionId, resumeEventId }
  }) as AiStreamResponse

  const { content } = await consumeStream(response)

  assert.equal(client.stream.mock.calls.length, 0, 'Should have no request call')
  assert.equal(content.join(''), 'Response 2')
})

test('should not resume a error response by resume event id but make a new request for the last prompt in history', async (t) => {
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async (a,b) => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'New Response' } }] },
        { choices: [{ delta: { content: ' 2' }, finish_reason: 'stop' }] }
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
    data: { response: 'Response 2 erroring' },
    type: 'response'
  }, historyExpiration)

  await ai.history.push(sessionId, randomUUID(), {
    event: 'error',
    data: { code: 'PROVIDER_ERROR', message: 'Connection failed' },
  }, historyExpiration)

  const response = await ai.request({
    options: { stream: true, sessionId, resumeEventId }
  }) as AiStreamResponse

  const { content } = await consumeStream(response)

  assert.equal(client.stream.mock.calls.length, 1, 'Should have one request call')
  // @ts-ignore
  assert.deepEqual(client.stream.mock.calls[0].arguments[1].messages, [
    {
      content: 'Prompt 1',
      role: 'user'
    },
    {
      content: 'Response 1',
      role: 'assistant'
    },
    {
      content: 'Prompt 2',
      role: 'user'
    }
  ])
  assert.equal(content.join(''), 'New Response 2')
})

test.only('should not resume a error response by resume event id but make a new requests: one for the last prompt in history, one for the new prompt', async (t) => {
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => {
      if (client.stream.mock.calls.length === 0) {
        return mockOpenAiStream([
          { choices: [{ delta: { content: 'Response 2' }, finish_reason: 'stop' }] }
        ])
      }

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
    data: { response: 'Response 2 erroring' },
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

  assert.equal(client.stream.mock.calls.length, 2)
  // @ts-ignore
  assert.deepEqual(client.stream.mock.calls[0].arguments[1].messages, [
    {
      content: 'Prompt 1',
      role: 'user'
    },
    {
      content: 'Response 1',
      role: 'assistant'
    },
    {
      content: 'Prompt 2',
      role: 'user'
    }
  ])
  // @ts-ignore
  assert.deepEqual(client.stream.mock.calls[1].arguments[1].messages, [
    {
      content: 'Prompt 1',
      role: 'user'
    },
    {
      content: 'Response 1',
      role: 'assistant'
    },
    {
      content: 'Prompt 2',
      role: 'user'
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

test('should resume the session by a specific resume event id', async (t) => {
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: messages[5].data.response }, finish_reason: 'stop' }] }
      ])
    })
  }
  const ai = await createAi({ t, client })

  const sessionId = randomUUID()
  const eventIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()]

  const messages = [
    {
      eventId: eventIds[0],
      data: { prompt: 'Prompt 1' },
      type: 'prompt'
    },
    {
      eventId: eventIds[1],
      data: { response: 'Response 1' },
      type: 'response'
    },
    {
      eventId: eventIds[2],
      data: { prompt: 'Prompt 2' },
      type: 'prompt'
    },
    {
      eventId: eventIds[3],
      data: { response: 'Response 2' },
      type: 'response'
    },
    {
      data: { prompt: 'Prompt 3' },
      type: 'prompt'
    },
    {
      data: { response: 'Response 3' },
      type: 'response'
    }
  ]

  const calls = [
    {
      eventId: eventIds[0],
      response: messages.map(m => ({ id: m.eventId, event: 'content', data: m.data }))
    },
    {
      eventId: eventIds[1],
      response: messages.slice(1).map(m => ({ id: m.eventId, event: 'content', data: m.data }))
    },
    {
      eventId: eventIds[2],
      response: messages.slice(2).map(m => ({ id: m.eventId, event: 'content', data: m.data }))
    },
    {
      eventId: eventIds[3],
      response: messages.slice(3).map(m => ({ id: m.eventId, event: 'content', data: m.data }))
    },
    {
      eventId: eventIds[4],
      response: messages.slice(4).map(m => ({ id: m.eventId, event: 'content', data: m.data }))
    },
    {
      eventId: eventIds[5],
      response: messages.slice(5).map(m => ({ id: m.eventId, event: 'content', data: m.data }))
    }
  ]

  // First prompt-response
  await ai.history.push(sessionId, eventIds[0], {
    event: 'content',
    data: { prompt: 'Prompt 1' },
    type: 'prompt'
  }, historyExpiration)

  await ai.history.push(sessionId, eventIds[1], {
    event: 'content',
    data: { response: 'Response 1' },
    type: 'response'
  }, historyExpiration)

  await ai.history.push(sessionId, eventIds[2], {
    event: 'end',
    data: { response: 'COMPLETE' }
  }, historyExpiration)

  // Second prompt-response
  await ai.history.push(sessionId, eventIds[3], {
    event: 'content',
    data: { prompt: 'Prompt 2' },
    type: 'prompt'
  }, historyExpiration)

  await ai.history.push(sessionId, eventIds[4], {
    event: 'content',
    data: { response: 'Response 2' },
    type: 'response'
  }, historyExpiration)

  await ai.history.push(sessionId, eventIds[5], {
    event: 'end',
    data: { response: 'COMPLETE' }
  }, historyExpiration)

  for (let i = 0; i < 1; i++) {
    client.stream.mock.resetCalls()

    const response = await ai.request({
      prompt: 'Prompt 3',
      options: {
        stream: true,
        sessionId,
        resumeEventId: calls[i].eventId,
        streamResponseType: 'session'
      }
    }) as AiStreamResponse

    const { content } = await consumeStream(response, 'session')
    assert.equal(client.stream.mock.calls.length, 1, 'Should call the provider once to get response #3')

    for (let j = 0; j < content.length; j++) {
      const c: any = content[j]!
      // last message id (prompt 3) is assigned by the ai class
      if (c.id) {
        assert.deepEqual(c.event, calls[i].response[j].event)
        assert.deepEqual(c.data, calls[i].response[j].data)
      } else {
        assert.deepEqual(c, calls[i].response[j])
      }
    }
  }
})

test('should perform a provider request resuming an incomplete response with stream response type session', async (t) => {
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async (_, request) => {
      if (request.messages.at(-1)?.content === 'First prompt') {
        return mockOpenAiStream([
          { choices: [{ delta: { content: 'Replace first ' } }] },
          { choices: [{ delta: { content: 'incomplete response' }, finish_reason: 'stop' }] }
        ])
      } else if (request.messages.at(-1)?.content === 'Continue conversation') {
        return mockOpenAiStream([
          { choices: [{ delta: { content: 'Next ' } }] },
          { choices: [{ delta: { content: 'response' }, finish_reason: 'stop' }] }
        ])
      }
      return mockOpenAiStream([])
    })
  }
  const ai = await createAi({ t, client })

  const sessionId = randomUUID()
  const resumeEventId = randomUUID()

  // Set up incomplete response history
  await ai.history.push(sessionId, resumeEventId, {
    event: 'content',
    data: { prompt: 'First prompt' },
    type: 'prompt'
  }, historyExpiration)

  await ai.history.push(sessionId, randomUUID(), {
    event: 'content',
    data: { response: 'Incomplete response chunk #1' },
    type: 'response'
  }, historyExpiration)
  await ai.history.push(sessionId, randomUUID(), {
    event: 'content',
    data: { response: 'Incomplete response chunk #2' },
    type: 'response'
  }, historyExpiration)
  // No 'end' event - simulates incomplete response

  const response = await ai.request({
    prompt: 'Continue conversation',
    options: {
      stream: true,
      sessionId,
      resumeEventId,
      streamResponseType: 'session'
    }
  }) as AiStreamResponse

  const { content } = await consumeStream(response, 'session')

  assert.equal(client.stream.mock.calls.length, 2, 'Should perform one provider request for incomplete response')
  assert.equal(content.length, 6, 'Should return session content')
  assert.deepEqual(content[0], { id: resumeEventId, event: 'content', data: { prompt: 'First prompt' } })
  assert.deepEqual({ data: content[1].data, event: 'content' }, { event: 'content', data: { response: 'Replace first ' } })
  assert.deepEqual({ data: content[2].data, event: 'content' }, { event: 'content', data: { response: 'incomplete response' } })
  assert.deepEqual({ data: content[3].data, event: 'content' }, { event: 'content', data: { prompt: 'Continue conversation' } })
  assert.deepEqual({ data: content[4].data, event: 'content' }, { event: 'content', data: { response: 'Next ' } })
  assert.deepEqual({ data: content[5].data, event: 'content' }, { event: 'content', data: { response: 'response' } })

  assert.deepEqual(client.stream.mock.calls[0].arguments[1].messages, [
    { role: 'user', content: 'First prompt' }
  ])

  assert.deepEqual(client.stream.mock.calls[1].arguments[1].messages, [
    { role: 'user', content: 'First prompt' },
    { role: 'assistant', content: 'Replace first incomplete response' },
    { role: 'user', content: 'Continue conversation' }
  ])
})

// TODO same with error instead of incomplete response
// TODO longer history

test('should not perform a provider request resuming an incomplete response with stream response type content', async (t) => {
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Should not be called' }, finish_reason: 'stop' }] }
      ])
    })
  }
  const ai = await createAi({ t, client })

  const sessionId = randomUUID()
  const resumeEventId = randomUUID()

  // Set up incomplete response history
  await ai.history.push(sessionId, resumeEventId, {
    event: 'content',
    data: { prompt: 'Test prompt' },
    type: 'prompt'
  }, historyExpiration)

  await ai.history.push(sessionId, randomUUID(), {
    event: 'content',
    data: { response: 'Partial response' },
    type: 'response'
  }, historyExpiration)
  // No 'end' event - simulates incomplete response

  const response = await ai.request({
    options: {
      stream: true,
      sessionId,
      resumeEventId,
      streamResponseType: 'content'
    }
  }) as AiStreamResponse

  const { content } = await consumeStream(response, 'content')

  assert.equal(client.stream.mock.calls.length, 0, 'Should not perform provider request when resuming incomplete response with content type')
  assert.equal(content.join(''), 'Partial response', 'Should return existing partial response')
})

test('should perform 1 provider request resuming an incomplete response where last event is a prompt and the request has a prompt too, with response type content', async (t) => {
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Combined response' }, finish_reason: 'stop' }] }
      ])
    })
  }
  const ai = await createAi({ t, client })

  const sessionId = randomUUID()
  const resumeEventId = randomUUID()

  // Set up history where last event is a prompt (incomplete)
  await ai.history.push(sessionId, resumeEventId, {
    event: 'content',
    data: { prompt: 'Previous prompt' },
    type: 'prompt'
  }, historyExpiration)

  await ai.history.push(sessionId, randomUUID(), {
    event: 'content',
    data: { response: 'Previous response' },
    type: 'response'
  }, historyExpiration)

  await ai.history.push(sessionId, randomUUID(), {
    event: 'end',
    data: { response: 'COMPLETE' }
  }, historyExpiration)

  // Last event is another prompt without response
  await ai.history.push(sessionId, randomUUID(), {
    event: 'content',
    data: { prompt: 'Hanging prompt' },
    type: 'prompt'
  }, historyExpiration)

  const response = await ai.request({
    prompt: 'New prompt',
    options: {
      stream: true,
      sessionId,
      resumeEventId,
      streamResponseType: 'content'
    }
  }) as AiStreamResponse

  const { content } = await consumeStream(response, 'content')

  assert.equal(client.stream.mock.calls.length, 1, 'Should perform one provider request when both history and request have prompts')
  assert.equal(content.join(''), 'Combined response', 'Should return new response')
})

test('should perform 2 provider requests resuming an incomplete response where last event is a prompt and the request has a prompt too, with response type session', async (t) => {
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Response for hanging prompt' }, finish_reason: 'stop' }] }
      ])
    })
  }
  const ai = await createAi({ t, client })

  const sessionId = randomUUID()
  const resumeEventId = randomUUID()

  // Set up history where last event is a prompt (incomplete)
  await ai.history.push(sessionId, resumeEventId, {
    event: 'content',
    data: { prompt: 'Previous prompt' },
    type: 'prompt'
  }, historyExpiration)

  await ai.history.push(sessionId, randomUUID(), {
    event: 'content',
    data: { response: 'Previous response' },
    type: 'response'
  }, historyExpiration)

  // Last event is a prompt without response
  await ai.history.push(sessionId, randomUUID(), {
    event: 'content',
    data: { prompt: 'Hanging prompt' },
    type: 'prompt'
  }, historyExpiration)

  const response = await ai.request({
    prompt: 'Additional prompt',
    options: {
      stream: true,
      sessionId,
      resumeEventId,
      streamResponseType: 'session'
    }
  }) as AiStreamResponse

  const { content } = await consumeStream(response, 'session')

  // With session response type, it should make 2 requests:
  // 1. For the hanging prompt in history
  // 2. For the new prompt in the request
  assert.equal(client.stream.mock.calls.length, 2, 'Should perform two provider requests for session type with dual prompts')
  assert.ok(content.length > 0, 'Should return session content')
})

test('should perform 1 provider request resuming an incomplete response where last event is a prompt and the request doesnt have a prompt, with response type content', async (t) => {
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Response to hanging prompt' }, finish_reason: 'stop' }] }
      ])
    })
  }
  const ai = await createAi({ t, client })

  const sessionId = randomUUID()
  const resumeEventId = randomUUID()

  // Set up history where last event is a prompt (incomplete)
  await ai.history.push(sessionId, resumeEventId, {
    event: 'content',
    data: { prompt: 'Previous prompt' },
    type: 'prompt'
  }, historyExpiration)

  await ai.history.push(sessionId, randomUUID(), {
    event: 'content',
    data: { response: 'Previous response' },
    type: 'response'
  }, historyExpiration)

  // Last event is a prompt without response
  await ai.history.push(sessionId, randomUUID(), {
    event: 'content',
    data: { prompt: 'Hanging prompt' },
    type: 'prompt'
  }, historyExpiration)

  const response = await ai.request({
    options: {
      stream: true,
      sessionId,
      resumeEventId,
      streamResponseType: 'content'
    }
  }) as AiStreamResponse

  const { content } = await consumeStream(response, 'content')

  assert.equal(client.stream.mock.calls.length, 1, 'Should perform one provider request for hanging prompt')
  assert.equal(content.join(''), 'Response to hanging prompt', 'Should return response to hanging prompt')
})

test('should perform 1 provider request resuming an incomplete response where last event is a prompt and the request doesnt have a prompt, with response type session', async (t) => {
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Response to hanging prompt' }, finish_reason: 'stop' }] }
      ])
    })
  }
  const ai = await createAi({ t, client })

  const sessionId = randomUUID()
  const resumeEventId = randomUUID()

  // Set up history where last event is a prompt (incomplete)
  await ai.history.push(sessionId, resumeEventId, {
    event: 'content',
    data: { prompt: 'Previous prompt' },
    type: 'prompt'
  }, historyExpiration)

  await ai.history.push(sessionId, randomUUID(), {
    event: 'content',
    data: { response: 'Previous response' },
    type: 'response'
  }, historyExpiration)

  // Last event is a prompt without response
  await ai.history.push(sessionId, randomUUID(), {
    event: 'content',
    data: { prompt: 'Hanging prompt' },
    type: 'prompt'
  }, historyExpiration)

  const response = await ai.request({
    options: {
      stream: true,
      sessionId,
      resumeEventId,
      streamResponseType: 'session'
    }
  }) as AiStreamResponse

  const { content } = await consumeStream(response, 'session')

  assert.equal(client.stream.mock.calls.length, 1, 'Should perform one provider request for hanging prompt with session type')
  assert.ok(content.length > 0, 'Should return session content')
})

test('should perform 1 provider request resuming an incomplete response where last event is an error, with response type session', async (t) => {
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Retry response' }, finish_reason: 'stop' }] }
      ])
    })
  }
  const ai = await createAi({ t, client })

  const sessionId = randomUUID()
  const resumeEventId = randomUUID()

  // Set up history ending with an error
  await ai.history.push(sessionId, resumeEventId, {
    event: 'content',
    data: { prompt: 'Test prompt' },
    type: 'prompt'
  }, historyExpiration)

  await ai.history.push(sessionId, randomUUID(), {
    event: 'content',
    data: { response: 'Partial response' },
    type: 'response'
  }, historyExpiration)

  await ai.history.push(sessionId, randomUUID(), {
    event: 'error',
    data: { code: 'PROVIDER_ERROR', message: 'Network timeout' },
  }, historyExpiration)

  const response = await ai.request({
    prompt: 'Retry prompt',
    options: {
      stream: true,
      sessionId,
      resumeEventId,
      streamResponseType: 'session'
    }
  }) as AiStreamResponse

  const { content } = await consumeStream(response, 'session')

  assert.equal(client.stream.mock.calls.length, 1, 'Should perform one provider request when resuming from error with session type')
  assert.ok(content.length > 0, 'Should return session content after error recovery')
})

test('should perform 1 provider request resuming an incomplete response where last event is an error, with response type content', async (t) => {
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Retry response' }, finish_reason: 'stop' }] }
      ])
    })
  }
  const ai = await createAi({ t, client })

  const sessionId = randomUUID()
  const resumeEventId = randomUUID()

  // Set up history ending with an error
  await ai.history.push(sessionId, resumeEventId, {
    event: 'content',
    data: { prompt: 'Test prompt' },
    type: 'prompt'
  }, historyExpiration)

  await ai.history.push(sessionId, randomUUID(), {
    event: 'content',
    data: { response: 'Partial response' },
    type: 'response'
  }, historyExpiration)

  await ai.history.push(sessionId, randomUUID(), {
    event: 'error',
    data: { code: 'PROVIDER_ERROR', message: 'Network timeout' },
  }, historyExpiration)

  const response = await ai.request({
    prompt: 'Retry prompt',
    options: {
      stream: true,
      sessionId,
      resumeEventId,
      streamResponseType: 'content'
    }
  }) as AiStreamResponse

  const { content } = await consumeStream(response, 'content')

  assert.equal(client.stream.mock.calls.length, 1, 'Should perform one provider request when resuming from error with content type')
  assert.equal(content.join(''), 'Retry response', 'Should return retry response after error recovery')
})
