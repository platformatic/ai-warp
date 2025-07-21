import { test } from 'node:test'
import assert from 'node:assert'
import { createApp, createDummyClient, mockOpenAiStream } from './helper/helper.ts'

test('should be able to perform a basic prompt', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'All good' }, finish_reason: 'stop' }] }
    }
  }

  const app = await createApp({ client })
  const response = await app.inject({
    method: 'POST',
    url: '/prompt',
    body: {
      prompt: 'Hello, how are you?'
    }
  })

  const body = JSON.parse(response.body)

  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(body.text, 'All good')
  assert.equal(body.result, 'COMPLETE')
  assert.ok(body.sessionId.length > 0)
})

test('should be able to perform a basic prompt with stream', async () => {
  const client = {
    ...createDummyClient(),
    stream: async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'All' } }] },
        { choices: [{ delta: { content: ' good' }, finish_reason: 'stop' }] }
      ])
    }
  }

  const app = await createApp({ client })
  const response = await app.inject({
    method: 'POST',
    url: '/stream',
    body: {
      prompt: 'Hello, how are you?'
    }
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['content-type'], 'text/event-stream')
  
  // Check that the response contains the expected content and events, but be flexible about UUIDs
  assert.ok(response.body.includes('event: content'))
  assert.ok(response.body.includes('data: {"response":"All"}'))
  assert.ok(response.body.includes('data: {"response":" good"}'))
  assert.ok(response.body.includes('event: end'))
  assert.ok(response.body.includes('data: {"response":"COMPLETE"}'))
  // Check that UUIDs are present
  assert.ok(response.body.includes('id: '))
})
