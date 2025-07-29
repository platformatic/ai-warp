import { mock, test } from 'node:test'
import assert from 'node:assert'
import { Ai, type AiContentResponse } from '../src/lib/ai.ts'
import pino from 'pino'
import { createDummyClient } from './helper/helper.ts'

const apiKey = 'test'
const logger = pino({ level: 'silent' })

interface ExtendedError extends Error {
  code?: string
}

test('should use fallback model when the primary model is not available because of rate limit', async (t) => {
  const client = createDummyClient()
  client.request = mock.fn(async (_api: any, _request: any, _context: any) => {
    return {
      choices: [{ message: { content: 'Success' } }]
    }
  })

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
      model: 'gpt-4o-mini',
    }, {
      provider: 'openai',
      model: 'gpt-4o'
    }],
    limits: {
      rate: {
        max: 1,
        timeWindow: '30s'
      }
    }
  })
  await ai.init()
  t.after(() => ai.close())

  // Make a request to consume rate limit
  await ai.request({
    models: ['openai:gpt-4o-mini', 'openai:gpt-4o'],
    prompt: 'First request'
  })

  // Try to make another request - should hit rate limit and should use the second model
  const response = await ai.request({
    models: ['openai:gpt-4o-mini', 'openai:gpt-4o'],
    prompt: 'Second request'
  }) as AiContentResponse

  // Verify model state is in error
  const provider = ai.providers.get('openai')!
  const modelState = await ai.getModelState('gpt-4o-mini', provider)!
  assert.equal(modelState!.state.status, 'error')
  assert.equal(modelState!.state.reason, 'PROVIDER_RATE_LIMIT_ERROR')

  assert.equal(response.text, 'Success')
  // @ts-ignore
  assert.equal(client.request.mock.calls.length, 2)

  // @ts-ignore
  assert.deepEqual(client.request.mock.calls[0].arguments[1], {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'First request' }],
    max_tokens: undefined,
    stream: false,
    temperature: undefined,
  })

  // @ts-ignore
  assert.deepEqual(client.request.mock.calls[1].arguments[1], {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Second request' }],
    max_tokens: undefined,
    stream: false,
    temperature: undefined,
  })
})

test('should use fallback model when the primary model is not available because of communication error', async (t) => {
  const client = createDummyClient()
  client.request = mock.fn(async (_api: any, request: any, _context: any) => {
    if (request.model === 'gpt-4o-mini') {
      const err: ExtendedError = new Error('Communication error')
      err.code = 'PROVIDER_RESPONSE_ERROR'
      throw err
    }
    return {
      choices: [{ message: { content: 'Success' } }]
    }
  })

  const ai = new Ai({
    logger,
    providers: {
      openai: {
        apiKey,
        client
      }
    },
    limits: {
      retry: {
        max: 2,
        interval: 100
      }
    },
    models: [{
      provider: 'openai',
      model: 'gpt-4o-mini',
    }, {
      provider: 'openai',
      model: 'gpt-4o'
    }]
  })
  await ai.init()
  t.after(() => ai.close())

  // Make a request to consume rate limit
  await ai.request({
    models: ['openai:gpt-4o-mini', 'openai:gpt-4o'],
    prompt: 'First request'
  })

  // Try to make another request - should hit rate limit and should use the second model
  const response = await ai.request({
    models: ['openai:gpt-4o-mini', 'openai:gpt-4o'],
    prompt: 'Second request'
  }) as AiContentResponse

  // Verify model state is in error
  const provider = ai.providers.get('openai')!
  const modelState = await ai.getModelState('gpt-4o-mini', provider)!
  assert.equal(modelState!.state.status, 'error')
  assert.equal(modelState!.state.reason, 'PROVIDER_RESPONSE_ERROR')

  assert.equal(response.text, 'Success')
  // @ts-ignore
  assert.equal(client.request.mock.calls.length, 5)

  for (let i = 0; i < 3; i++) {
    // @ts-ignore
    assert.deepEqual(client.request.mock.calls[i].arguments[1], {
      model: 'gpt-4o-mini',
      messages: [{ content: 'First request', role: 'user' }],
      max_tokens: undefined,
      stream: false,
      temperature: undefined
    })
  }
  // @ts-ignore
  assert.deepEqual(client.request.mock.calls[3].arguments[1], {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'First request' }],
    max_tokens: undefined,
    stream: false,
    temperature: undefined
  })
  // @ts-ignore
  assert.deepEqual(client.request.mock.calls[4].arguments[1], {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Second request' }],
    max_tokens: undefined,
    stream: false,
    temperature: undefined
  })
})
