import { test } from 'node:test'
import assert from 'node:assert'
import { Ai, type AiContentResponse } from '../src/lib/ai.ts'
import { createDummyClient } from './helper/helper.ts'
import pino from 'pino'

const apiKey = 'test'
const logger = pino({ level: 'silent' })

test('should select the model from the list of models', async () => {
  const openaiClient = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'All good from openai' } }] }
    }
  }

  const deepseekClient = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'All good from deepseek' } }] }
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      openai: { apiKey, client: openaiClient },
      deepseek: { apiKey, client: deepseekClient },
    },
    models: [
      { provider: 'deepseek', model: 'deepseek-chat' },
      { provider: 'openai', model: 'gpt-4o-mini' },
    ],
  })
  await ai.init()

  const response = await ai.request({
    prompt: 'Hello, how are you?'
  }) as AiContentResponse

  assert.equal((response).text, 'All good from deepseek')
})

test('should select the model in the request from the list of models', async () => {
  const openaiClient = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'All good from openai' } }] }
    }
  }

  const deepseekClient = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'All good from deepseek' } }] }
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      openai: { apiKey, client: openaiClient },
      deepseek: { apiKey, client: deepseekClient },
    },
    models: [
      { provider: 'openai', model: 'gpt-4o-mini' },
      { provider: 'deepseek', model: 'deepseek-chat' }
    ],
  })
  await ai.init()

  const response = await ai.request({
    models: ['deepseek:deepseek-chat'],
    prompt: 'Hello, how are you?'
  }) as AiContentResponse

  assert.equal((response).text, 'All good from deepseek')
})
