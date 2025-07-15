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
    url: '/api/v1/prompt',
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
    url: '/api/v1/stream',
    body: {
      prompt: 'Hello, how are you?'
    }
  })

  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['content-type'], 'text/event-stream')
  assert.equal(response.body, 'event: content\ndata: {"response":"All"}\n\nevent: content\ndata: {"response":" good"}\n\nevent: end\ndata: {"response":"COMPLETE"}\n\n')
})

test('should get error when no prompt is provided', async () => {
  const app = await createApp({ client: createDummyClient() })
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/prompt',
    body: { }
  })

  const body = JSON.parse(response.body)

  assert.equal(response.statusCode, 400)
  assert.equal(body.message, "body must have required property 'prompt'")
  assert.equal(body.code, 'FST_ERR_VALIDATION')
})
