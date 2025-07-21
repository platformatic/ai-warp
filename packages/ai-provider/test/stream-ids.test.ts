import { test, mock } from 'node:test'
import assert from 'node:assert'
import { Readable } from 'node:stream'
import pino from 'pino'
import { Ai } from '../src/index.ts'
import { createDummyClient, mockOpenAiStream } from './helper/helper.ts'

test('should include UUID ids in streaming events', async () => {
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

  const response = await ai.request({
    prompt: 'Hello',
    options: {
      stream: true
    }
  })

  // Check if it's a stream-like object (could be a Readable or cloneable stream)
  assert.ok(typeof response.pipe === 'function', 'Response should be a stream-like object')

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

  await ai.close()
})

test('should include UUID ids in streaming events with valkey storage', async () => {
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
    ],
    storage: {
      type: 'valkey',
      valkey: {
        host: 'localhost',
        port: 6379,
        database: 0,
        username: 'default',
        password: 'password'
      }
    }
  })

  await ai.init()

  const response = await ai.request({
    prompt: 'Hello',
    options: {
      stream: true
    }
  })

  // Check if it's a stream-like object (could be a Readable or cloneable stream)
  assert.ok(typeof response.pipe === 'function', 'Response should be a stream-like object')

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

  await ai.close()
})
