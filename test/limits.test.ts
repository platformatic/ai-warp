import { test } from 'node:test'
import assert from 'node:assert'
import { Ai, type PlainResponse } from '../src/lib/ai.ts'
import pino from 'pino'

const apiKey = 'test'
const logger = pino({ level: 'silent' })

test('should succeed after some failures because of retries', async () => {
  let callCount = 0
  const client = {
    chat: {
      completions: {
        create: async () => {
          callCount++
          if (callCount === 2) {
            throw new Error('ERROR_FROM_PROVIDER')
          }
          return {
            choices: [{
              message: {
                content: 'All good'
              }
            }]
          }
        }
      }
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      openai: {
        apiKey,
        models: [{ name: 'gpt-4o-mini' }],
        client
      }
    }
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello, how are you?',
    options: {
      limits: {
        retry: {
          max: 2,
          interval: 100
        }
      }
    }
  }) as PlainResponse

  assert.equal(callCount, 1)

  assert.equal(response.text, 'All good')
})

test('should fail after max retries', async () => {
  let callCount = 0
  const client = {
    chat: {
      completions: {
        create: async () => {
          callCount++
          throw new Error('ERROR_FROM_PROVIDER')
        }
      }
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      openai: {
        apiKey,
        models: [{ name: 'gpt-4o-mini' }],
        client
      }
    }
  })
  await ai.init()

  await assert.rejects(ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello, how are you?',
    options: {
      limits: {
        retry: {
          max: 2,
          interval: 100
        }
      }
    }
  }), new Error('ERROR_FROM_PROVIDER'))

  assert.equal(callCount, 3)
})

// provider rate limit
// client rate limit
// history expiration
// max retries
// max tokens
// request timeout

// all them with stream
