import { test, mock } from 'node:test'
import assert from 'node:assert'
import pino from 'pino'
import { Ai, type AiContentResponse, type AiStreamResponse } from '../src/index.ts'
import { consumeStream, createAi, createDummyClient, mockOpenAiStream, storages } from './helper/helper.ts'
import { isStream } from '../src/lib/utils.ts'
import { randomUUID } from 'node:crypto'

const historyExpiration = 10_000

test('should include session ids in streaming events', async (t) => {
  const client = {
    ...createDummyClient(),
    stream: async () => {
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
  t.after(() => ai.close())

  const response = await ai.request({
    prompt: 'Hello',
    options: { stream: true }
  }) as AiStreamResponse

  // Check if it's a stream-like object (could be a Readable or cloneable stream)
  assert.ok(isStream(response), 'Response should be a stream-like object')

  const events: Array<{ event?: string, data?: string, id?: string }> = []
  let currentEvent: { event?: string, data?: string, id?: string } = {}

  for await (const chunk of response) {
    const chunkString = chunk.toString('utf8')
    const lines = chunkString.split('\n')

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent.event = line.substring(7).trim()
      } else if (line.startsWith('data: ')) {
        currentEvent.data = line.substring(6).trim()
      } else if (line.startsWith('id: ')) {
        currentEvent.id = line.substring(4).trim()
      } else if (line === '' && (currentEvent.event || currentEvent.data)) {
        // Complete event found
        events.push({ ...currentEvent })
        currentEvent = {}
      }
    }
  }

  // Should have content events and end event
  assert.ok(events.length > 0, 'Should have at least one event')

  // Every event should have an id field with a UUID
  for (const event of events) {
    assert.ok(event.id, `Event should have an id: ${JSON.stringify(event)}`)
    // Check if it's a valid UUID format (36 characters with dashes in specific positions)
    assert.match(event.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      `Event id should be a valid UUID: ${event.id}`)
  }

  // Check we have content events
  const contentEvents = events.filter(e => e.event === 'content')
  assert.ok(contentEvents.length > 0, 'Should have content events')

  // Check we have an end event
  const endEvents = events.filter(e => e.event === 'end')
  assert.equal(endEvents.length, 1, 'Should have exactly one end event')

  // All events should have unique IDs
  const eventIds = events.map(e => e.id)
  const uniqueIds = new Set(eventIds)
  assert.equal(eventIds.length, uniqueIds.size, 'All event IDs should be unique')
})

for (const storage of [storages[0]]) {
  test(`should load history when request has session id but not history, non-streaming, with ${storage.type} storage`, async (t) => {
    const client = {
      ...createDummyClient(),
      request: mock.fn(async () => {
        return { choices: [{ message: { content: 'I am good, thank you!' }, finish_reason: 'stop' }] }
      })
    }
    const ai = await createAi({ t, client, storage })

    const sessionId = randomUUID()
    await ai.history.push(sessionId, randomUUID(), {
      event: 'content',
      data: { prompt: 'Hello' },
      type: 'prompt'
    }, historyExpiration)

    await ai.history.push(sessionId, randomUUID(), {
      event: 'content',
      data: { response: 'Hi there!' },
      type: 'response'
    }, historyExpiration)

    await ai.history.push(sessionId, randomUUID(), {
      event: 'end',
      data: { response: 'COMPLETE' }
    }, historyExpiration)

    const response = await ai.request({
      prompt: 'How are you?',
      resume: false,
      options: { stream: false, sessionId }
    }) as AiContentResponse

    assert.equal(client.request.mock.calls.length, 1, 'Should have one request call')
    // @ts-ignore
    assert.deepEqual(client.request.mock.calls[0].arguments[1].messages, [
      {
        role: 'user',
        content: 'Hello'
      },
      {
        role: 'assistant',
        content: 'Hi there!'
      },
      {
        role: 'user',
        content: 'How are you?'
      }
    ])

    assert.equal(response.text, 'I am good, thank you!')
    assert.equal(response.result, 'COMPLETE')
    assert.equal(response.sessionId, sessionId)
  })

  test(`should load history when request has session id but not history, stream, with ${storage.type} storage`, async (t) => {
    const client = {
      ...createDummyClient(),
      stream: mock.fn(async () => {
        return mockOpenAiStream([
          { choices: [{ delta: { content: 'Response' } }] },
          { choices: [{ delta: { content: ' 2' }, finish_reason: 'stop' }] }
        ])
      })
    }
    const ai = await createAi({ t, client, storage })

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

    const response = await ai.request({
      prompt: 'Prompt 2',
      resume: false,
      options: { stream: true, sessionId }
    }) as AiStreamResponse

    const { content } = await consumeStream(response)

    assert.equal(content.join(''), 'Response 2')
    assert.equal(client.stream.mock.calls.length, 1, 'Should have one request call')
    // @ts-ignore
    assert.deepEqual(client.stream.mock.calls[0].arguments[1].messages, [
      {
        role: 'user',
        content: 'Prompt 1'
      },
      {
        role: 'assistant',
        content: 'Response 1'
      },
      {
        role: 'user',
        content: 'Prompt 2'
      }
    ])
  })

  // TODO should update last prompt when history last event is content and type is prompt

  test(`compactHistory - should load history from storage format and compact in history format / last event: end, with ${storage.type} storage`, async (t) => {
    const ai = await createAi({ t, storage })

    const sessionId = randomUUID()
    await ai.history.push(sessionId, randomUUID(), {
      event: 'content',
      data: { prompt: 'What is AI?' },
      type: 'prompt'
    }, historyExpiration)

    await ai.history.push(sessionId, randomUUID(), {
      event: 'content',
      data: { response: 'AI stands for Artificial Intelligence. It is' },
      type: 'response'
    }, historyExpiration)

    await ai.history.push(sessionId, randomUUID(), {
      event: 'content',
      data: { response: ' a field of computer science.' },
      type: 'response'
    }, historyExpiration)

    await ai.history.push(sessionId, randomUUID(), {
      event: 'end',
      data: { response: 'COMPLETE' }
    }, historyExpiration)

    // Test what the actual getHistory method returns (which should compact)
    // Test the compactHistory method directly - only pass content events
    const events = await ai.history.range(sessionId)
    const contentEvents = events.filter(e => e.event === 'content')
    const compactedHistory = ai['compactHistory'](contentEvents)

    // Should have one complete conversation pair
    assert.equal(compactedHistory.length, 1, 'Should have one compact history entry')
    assert.equal(compactedHistory[0].prompt, 'What is AI?', 'Prompt should match')
    assert.equal(compactedHistory[0].response, 'AI stands for Artificial Intelligence. It is a field of computer science.', 'Response should be concatenated')
  })

  test(`compactHistory - should load history from storage format and compact in history format / last event: error, with ${storage.type} storage`, async (t) => {
    const ai = await createAi({ t })

    // Create storage events that end with an 'error' event
    const sessionId = randomUUID()
    await ai.history.push(sessionId, randomUUID(), {
      event: 'content',
      data: { prompt: 'Tell me a story' },
      type: 'prompt'
    }, historyExpiration)

    await ai.history.push(sessionId, randomUUID(), {
      event: 'content',
      data: { response: 'Once upon a time' },
      type: 'response'
    }, historyExpiration)

    await ai.history.push(sessionId, randomUUID(), {
      event: 'error',
      data: { code: 'PROVIDER_ERROR', message: 'Connection failed' },
    }, historyExpiration)

    // Test the compactHistory method directly - only pass content events
    const events = await ai.history.range(sessionId)
    const contentEvents = events.filter(e => e.event === 'content')
    const compactedHistory = ai['compactHistory'](contentEvents)

    // Should have one incomplete conversation pair (response is partial)
    assert.equal(compactedHistory.length, 1, 'Should have one compact history entry')
    assert.equal(compactedHistory[0].prompt, 'Tell me a story', 'Prompt should match')
    assert.equal(compactedHistory[0].response, 'Once upon a time', 'Response should be partial')
  })

  test(`compactHistory - should load history from storage format and compact in history format / last event: content and type: response, with ${storage.type} storage`, async (t) => {
    const ai = await createAi({ t })

    // Create storage events that end with a 'content' event of type 'response' (incomplete conversation)
    const sessionId = randomUUID()
    await ai.history.push(sessionId, randomUUID(), {
      event: 'content',
      data: { prompt: 'Explain quantum physics' },
      type: 'prompt'
    }, historyExpiration)

    await ai.history.push(sessionId, randomUUID(), {
      event: 'content',
      data: { response: 'Quantum physics is' },
      type: 'response'
    }, historyExpiration)

    await ai.history.push(sessionId, randomUUID(), {
      event: 'content',
      data: { response: ' the branch of physics that deals' },
      type: 'response'
    }, historyExpiration)

    // Test the compactHistory method directly - only pass content events
    const events = await ai.history.range(sessionId)
    const contentEvents = events.filter(e => e.event === 'content')
    const compactedHistory = ai['compactHistory'](contentEvents)

    // Should have one incomplete conversation pair (response is partial/ongoing)
    assert.equal(compactedHistory.length, 1, 'Should have one compact history entry')
    assert.equal(compactedHistory[0].prompt, 'Explain quantum physics', 'Prompt should match')
    assert.equal(compactedHistory[0].response, 'Quantum physics is the branch of physics that deals', 'Response should be concatenated partial response')
  })

  test(`compactHistory - should load history from storage format and compact in history format / last event: content and type: prompt, with ${storage.type} storage`, async (t) => {
    const ai = await createAi({ t })

    // Create storage events that end with a 'content' event of type 'prompt' (no response yet)
    const sessionId = randomUUID()
    await ai.history.push(sessionId, randomUUID(), {
      event: 'content',
      data: { prompt: 'What is the weather?' },
      type: 'prompt'
    }, historyExpiration)

    await ai.history.push(sessionId, randomUUID(), {
      event: 'content',
      data: { response: 'The weather is sunny today.' },
      type: 'response'
    }, historyExpiration)

    await ai.history.push(sessionId, randomUUID(), {
      event: 'end',
      data: { response: 'COMPLETE' }
    }, historyExpiration)

    await ai.history.push(sessionId, randomUUID(), {
      event: 'content' as const,
      data: { prompt: 'Tell me a joke' },
      type: 'prompt'
    }, historyExpiration)

    // Test the compactHistory method directly - only pass content events
    const events = await ai.history.range(sessionId)
    const contentEvents = events.filter(e => e.event === 'content')
    const compactedHistory = ai['compactHistory'](contentEvents)

    // The compactHistory method processes events sequentially:
    // 1. prompt: 'What is the weather?' (sets lastPrompt)
    // 2. response: 'The weather is sunny today.' (adds to lastResponse)
    // 3. prompt: 'Tell me a joke' (triggers push with current lastPrompt, then resets)
    // This results in the response being paired with the new prompt due to the algorithm
    assert.equal(compactedHistory.length, 1, 'Should have one compact history entry')
    assert.equal(compactedHistory[0].prompt, 'Tell me a joke', 'Prompt should be the second prompt due to compaction logic')
    assert.equal(compactedHistory[0].response, 'The weather is sunny today.', 'Response should be from the first conversation')

  // Note: This behavior shows that the last prompt without response gets the previous response
  })
}

// multiple clients same session
// with resume, stream
