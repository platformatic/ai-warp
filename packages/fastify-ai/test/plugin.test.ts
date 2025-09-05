import assert from 'node:assert'
import { test } from 'node:test'
import { createApp, createDummyClient, mockOpenAiStream } from './helper.ts'

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

test('should be able to retrieve chat history', async () => {
  const client = createDummyClient()

  const app = await createApp({ client })

  // Call the real retrieveHistory function - this covers the function execution
  const history = await app.ai.retrieveHistory('test-session-id')

  // The history should be an array (empty by default with our dummy client)
  assert.ok(Array.isArray(history))

  await app.close()
})

test('should use custom headerSessionIdName when provided', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Test response' }, finish_reason: 'stop' }] }
    }
  }

  const customHeaderName = 'x-custom-session'
  const app = await createApp({
    client,
    customOptions: {
      headerSessionIdName: customHeaderName
    }
  })

  const response = await app.inject({
    method: 'POST',
    url: '/prompt',
    body: {
      prompt: 'Hello'
    }
  })

  assert.equal(response.statusCode, 200)
  assert.ok(response.headers[customHeaderName])

  await app.close()
})

test('should call ai.close() when fastify closes', async () => {
  let closeCalled = false

  const client = {
    ...createDummyClient(),
    close: async () => {
      closeCalled = true
    }
  }

  const app = await createApp({ client })

  // Mock the ai.close method to track if it's called
  const originalClose = (app as any).ai.close
  if (originalClose) {
    ;(app as any).ai.close = async () => {
      closeCalled = true
      await originalClose()
    }
  }

  // Close the fastify app which should trigger the onClose hook
  await app.close()

  assert.equal(closeCalled, true)
})
