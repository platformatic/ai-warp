import { test, mock, describe } from 'node:test'
import assert from 'node:assert'
import pino from 'pino'
import { Ai, type AiContentResponse, type AiStreamResponse } from '../src/index.ts'
import { type HistoryContentEvent } from '../src/lib/ai.ts'
import { consumeStream, createAi, createDummyClient, mockOpenAiStream, storages } from './helper/helper.ts'
import { isStream } from '../src/lib/utils.ts'
import { randomUUID } from 'node:crypto'

const historyExpiration = 10_000

describe('session', () => {
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

  for (const storage of storages) {
    test(`should load history when request has session id, non-streaming, with ${storage.type} storage`, async (t) => {
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

    test(`should load history when request has session id, stream, with ${storage.type} storage`, async (t) => {
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

    test(`should update last prompt when history last event is a prompt, non-streaming, with ${storage.type} storage`, async (t) => {
      const client = {
        ...createDummyClient(),
        request: mock.fn(async () => {
          return { choices: [{ message: { content: 'Some Response' }, finish_reason: 'stop' }] }
        })
      }
      const ai = await createAi({ t, client, storage })

      const sessionId = randomUUID()
      await ai.history.push(sessionId, randomUUID(), {
        event: 'content',
        data: { prompt: 'Last Prompt' },
        type: 'prompt'
      }, historyExpiration)

      const response = await ai.request({
        prompt: 'New Prompt!',
        options: { stream: false, sessionId }
      }) as AiContentResponse

      assert.equal(client.request.mock.calls.length, 1, 'Should have one request call')
      // @ts-ignore
      assert.deepEqual(client.request.mock.calls[0].arguments[1].messages, [
        {
          role: 'user',
          content: 'New Prompt!'
        }
      ])

      assert.equal(response.text, 'Some Response')
      assert.equal(response.result, 'COMPLETE')
      assert.equal(response.sessionId, sessionId)
    })

    test(`should load history when request has session id, stream, with ${storage.type} storage`, async (t) => {
      const client = {
        ...createDummyClient(),
        stream: mock.fn(async () => {
          return mockOpenAiStream([
            { choices: [{ delta: { content: 'A Response' } }] },
            { choices: [{ delta: { content: ' Again' }, finish_reason: 'stop' }] }
          ])
        })
      }
      const ai = await createAi({ t, client, storage })

      const sessionId = randomUUID()
      await ai.history.push(sessionId, randomUUID(), {
        event: 'content',
        data: { prompt: 'Old Prompt' },
        type: 'prompt'
      }, historyExpiration)

      const response = await ai.request({
        prompt: 'New Prompt!',
        options: { stream: true, sessionId }
      }) as AiStreamResponse

      const { content } = await consumeStream(response)

      assert.equal(content.join(''), 'A Response Again')
      assert.equal(client.stream.mock.calls.length, 1, 'Should have one request call')
      // @ts-ignore
      assert.deepEqual(client.stream.mock.calls[0].arguments[1].messages, [
        {
          role: 'user',
          content: 'New Prompt!'
        }
      ])
    })

    test(`should load history when request has session id, non-streaming, no resume, with ${storage.type} storage`, async (t) => {
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

      const resumeEventId = randomUUID()
      await ai.history.push(sessionId, resumeEventId, {
        event: 'end',
        data: { response: 'COMPLETE' }
      }, historyExpiration)

      const response = await ai.request({
        prompt: 'How are you?',
        options: { stream: false, sessionId, resumeEventId }
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

    test(`should load history when request has session id by resume id, without calling the provider, response type content, with ${storage.type} storage`, async (t) => {
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

      assert.equal(client.stream.mock.calls.length, 0)
      assert.equal(content.join(''), 'Response 1')
    })
  }
})

describe('compactHistory', () => {
  for (const storage of storages) {
    test(`should load history from storage format and compact in history format / last event: end, with ${storage.type} storage`, async (t) => {
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

    test(`should load history from storage format and compact in history format / last event: error, with ${storage.type} storage`, async (t) => {
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

    test(`should load history from storage format and compact in history format / last event: content and type: response, with ${storage.type} storage`, async (t) => {
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

    test(`should load history from storage format and compact in history format / last event: content and type: prompt, with ${storage.type} storage`, async (t) => {
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

      assert.equal(compactedHistory.length, 1, 'Should have one compact history entry')
      assert.equal(compactedHistory[0].prompt, 'Tell me a joke', 'Prompt should be the second prompt due to compaction logic')
      assert.equal(compactedHistory[0].response, 'The weather is sunny today.', 'Response should be from the first conversation')

      // Note: This behavior shows that the last prompt without response gets the previous response
    })

    test(`should handle empty history array, with ${storage.type} storage`, async (t) => {
      const ai = await createAi({ t, storage })

      const compactedHistory = ai['compactHistory']([])

      assert.equal(compactedHistory.length, 0, 'Empty history should return empty array')
    })

    test(`should handle history with only prompts (no responses), with ${storage.type} storage`, async (t) => {
      const ai = await createAi({ t, storage })

      const contentEvents: HistoryContentEvent[] = [
        {
          event: 'content',
          data: { prompt: 'First question' },
          type: 'prompt'
        },
        {
          event: 'content',
          data: { prompt: 'Second question' },
          type: 'prompt'
        }
      ]

      const compactedHistory = ai['compactHistory'](contentEvents)

      // Should have one entry with the last prompt and empty response
      assert.equal(compactedHistory.length, 1, 'Should have one compact history entry')
      assert.equal(compactedHistory[0].prompt, 'Second question', 'Should have the last prompt')
      assert.equal(compactedHistory[0].response, '', 'Response should be empty')
    })

    test(`should handle history with only responses (no prompts), with ${storage.type} storage`, async (t) => {
      const ai = await createAi({ t, storage })

      const contentEvents: HistoryContentEvent[] = [
        {
          event: 'content',
          data: { response: 'First response' },
          type: 'response'
        },
        {
          event: 'content',
          data: { response: 'Second response' },
          type: 'response'
        }
      ]

      const compactedHistory = ai['compactHistory'](contentEvents)

      // Should have one entry with empty prompt and concatenated responses
      assert.equal(compactedHistory.length, 1, 'Should have one compact history entry')
      assert.equal(compactedHistory[0].prompt, '', 'Prompt should be empty')
      assert.equal(compactedHistory[0].response, 'First responseSecond response', 'Should concatenate all responses')
    })

    test(`should handle multiple complete conversation pairs, with ${storage.type} storage`, async (t) => {
      const ai = await createAi({ t, storage })

      const contentEvents: HistoryContentEvent[] = [
        {
          event: 'content',
          data: { prompt: 'What is AI?' },
          type: 'prompt'
        },
        {
          event: 'content',
          data: { response: 'AI is artificial intelligence' },
          type: 'response'
        },
        {
          event: 'content',
          data: { prompt: 'How does it work?' },
          type: 'prompt'
        },
        {
          event: 'content',
          data: { response: 'It uses algorithms and data' },
          type: 'response'
        },
        {
          event: 'content',
          data: { prompt: 'Tell me more' },
          type: 'prompt'
        },
        {
          event: 'content',
          data: { response: 'AI can learn from' },
          type: 'response'
        },
        {
          event: 'content',
          data: { response: ' experience and improve' },
          type: 'response'
        }
      ]

      const compactedHistory = ai['compactHistory'](contentEvents)

      assert.equal(compactedHistory.length, 3, 'Should have three compact history entries')

      assert.equal(compactedHistory[0].prompt, 'How does it work?', 'First entry uses second prompt')
      assert.equal(compactedHistory[0].response, 'AI is artificial intelligence', 'First response is from first response')

      assert.equal(compactedHistory[1].prompt, 'Tell me more', 'Second entry uses third prompt')
      assert.equal(compactedHistory[1].response, 'It uses algorithms and data', 'Second response is from second response')

      assert.equal(compactedHistory[2].prompt, '', 'Third entry has empty prompt (no more prompts)')
      assert.equal(compactedHistory[2].response, 'AI can learn from experience and improve', 'Third response is remaining concatenated responses')
    })

    test(`should handle history starting with orphaned response, with ${storage.type} storage`, async (t) => {
      const ai = await createAi({ t, storage })

      const contentEvents: HistoryContentEvent[] = [
        {
          event: 'content',
          data: { response: 'This is an orphaned response' },
          type: 'response'
        },
        {
          event: 'content',
          data: { prompt: 'What is this?' },
          type: 'prompt'
        },
        {
          event: 'content',
          data: { response: 'This is a proper response' },
          type: 'response'
        }
      ]

      const compactedHistory = ai['compactHistory'](contentEvents)

      assert.equal(compactedHistory.length, 2, 'Should have two compact history entries')

      // First entry should pair the orphaned response with the first prompt
      assert.equal(compactedHistory[0].prompt, 'What is this?', 'First prompt should be the actual prompt')
      assert.equal(compactedHistory[0].response, 'This is an orphaned response', 'Should use the orphaned response')

      // Second entry should have the proper response with empty prompt (leftover)
      assert.equal(compactedHistory[1].prompt, '', 'Second prompt should be empty')
      assert.equal(compactedHistory[1].response, 'This is a proper response', 'Second response should match')
    })

    test(`should handle undefined/empty prompt and response data, with ${storage.type} storage`, async (t) => {
      const ai = await createAi({ t, storage })

      const contentEvents: HistoryContentEvent[] = [
        {
          event: 'content',
          data: { prompt: undefined },
          type: 'prompt'
        },
        {
          event: 'content',
          data: { response: undefined },
          type: 'response'
        },
        {
          event: 'content',
          data: {},
          type: 'prompt'
        },
        {
          event: 'content',
          data: { response: '' },
          type: 'response'
        }
      ]

      const compactedHistory = ai['compactHistory'](contentEvents)

      assert.equal(compactedHistory.length, 2, 'Should have two compact history entries')

      // The algorithm converts undefined prompt to empty string with: event.data.prompt || ''
      // When undefined gets pushed to array and then joined, it becomes empty string, not "undefined"
      assert.equal(compactedHistory[0].prompt, '', 'First prompt should be empty string (from missing data)')
      assert.equal(compactedHistory[0].response, '', 'First response should be empty when response is undefined due to JS array behavior')

      assert.equal(compactedHistory[1].prompt, '', 'Second prompt should be empty')
      assert.equal(compactedHistory[1].response, '', 'Second response should be empty')
    })

    test(`should handle complex alternating pattern with multiple responses per prompt, with ${storage.type} storage`, async (t) => {
      const ai = await createAi({ t, storage })

      const contentEvents: HistoryContentEvent[] = [
        {
          event: 'content',
          data: { prompt: 'Explain quantum physics' },
          type: 'prompt'
        },
        {
          event: 'content',
          data: { response: 'Quantum physics is' },
          type: 'response'
        },
        {
          event: 'content',
          data: { response: ' a branch of physics' },
          type: 'response'
        },
        {
          event: 'content',
          data: { response: ' that studies matter and energy' },
          type: 'response'
        },
        {
          event: 'content',
          data: { prompt: 'Give me an example' },
          type: 'prompt'
        },
        {
          event: 'content',
          data: { response: 'An example is' },
          type: 'response'
        },
        {
          event: 'content',
          data: { response: ' the double-slit experiment' },
          type: 'response'
        },
        {
          event: 'content',
          data: { prompt: 'Tell me about wave-particle duality' },
          type: 'prompt'
        }
      ]

      const compactedHistory = ai['compactHistory'](contentEvents)

      assert.equal(compactedHistory.length, 2, 'Should have two compact history entries')

      assert.equal(compactedHistory[0].prompt, 'Give me an example', 'First entry uses the second prompt')
      assert.equal(compactedHistory[0].response, 'Quantum physics is a branch of physics that studies matter and energy', 'First response is from the first set of responses')

      assert.equal(compactedHistory[1].prompt, 'Tell me about wave-particle duality', 'Second entry uses the third prompt')
      assert.equal(compactedHistory[1].response, 'An example is the double-slit experiment', 'Second response is from the second set of responses')
    })

    test(`should handle mixed scenario with gaps and multiple prompts, with ${storage.type} storage`, async (t) => {
      const ai = await createAi({ t, storage })

      const contentEvents: HistoryContentEvent[] = [
        {
          event: 'content',
          data: { prompt: 'First question' },
          type: 'prompt'
        },
        {
          event: 'content',
          data: { prompt: 'Second question' },
          type: 'prompt'
        },
        {
          event: 'content',
          data: { prompt: 'Third question' },
          type: 'prompt'
        },
        {
          event: 'content',
          data: { response: 'Combined response' },
          type: 'response'
        },
        {
          event: 'content',
          data: { response: ' for all questions' },
          type: 'response'
        }
      ]

      const compactedHistory = ai['compactHistory'](contentEvents)

      // The algorithm processes prompts sequentially, so only the last prompt gets paired with responses
      assert.equal(compactedHistory.length, 1, 'Should have one compact history entry')
      assert.equal(compactedHistory[0].prompt, 'Third question', 'Should have the last prompt')
      assert.equal(compactedHistory[0].response, 'Combined response for all questions', 'Should have concatenated responses')
    })
  }
})
