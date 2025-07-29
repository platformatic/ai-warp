import { test } from 'node:test'
import assert from 'node:assert'
import { Ai, type AiContentResponse } from '../src/lib/ai.ts'
import { createDummyClient } from './helper/helper.ts'
import pino from 'pino'

const apiKey = 'test'
const logger = pino({ level: 'silent' })

test('should select the model from the list of models', async (t) => {
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
  t.after(() => ai.close())

  const response = await ai.request({
    prompt: 'Hello, how are you?'
  }) as AiContentResponse

  assert.equal((response).text, 'All good from deepseek')
})

test('should select the model in the request from the list of models', async (t) => {
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
  t.after(() => ai.close())

  const response = await ai.request({
    models: ['deepseek:deepseek-chat'],
    prompt: 'Hello, how are you?'
  }) as AiContentResponse

  assert.equal((response).text, 'All good from deepseek')
})

test('should handle all the providers', async (t) => {
  const openaiClient = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Response from OpenAI' } }] }
    }
  }

  const deepseekClient = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'Response from DeepSeek' } }] }
    }
  }

  const geminiClient = {
    ...createDummyClient(),
    request: async () => {
      return { candidates: [{ content: { parts: [{ text: 'Response from Gemini' }] } }] }
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      openai: { apiKey, client: openaiClient },
      deepseek: { apiKey, client: deepseekClient },
      gemini: { apiKey, client: geminiClient }
    },
    models: [
      { provider: 'openai', model: 'gpt-4o-mini' },
      { provider: 'deepseek', model: 'deepseek-chat' },
      { provider: 'gemini', model: 'gemini-1.5-flash' }
    ],
  })
  await ai.init()
  t.after(() => ai.close())

  // Test OpenAI provider
  const openaiResponse = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello OpenAI'
  }) as AiContentResponse
  assert.equal(openaiResponse.text, 'Response from OpenAI')

  // Test DeepSeek provider
  const deepseekResponse = await ai.request({
    models: ['deepseek:deepseek-chat'],
    prompt: 'Hello DeepSeek'
  }) as AiContentResponse
  assert.equal(deepseekResponse.text, 'Response from DeepSeek')

  // Test Gemini provider
  const geminiResponse = await ai.request({
    models: ['gemini:gemini-1.5-flash'],
    prompt: 'Hello Gemini'
  }) as AiContentResponse
  assert.equal(geminiResponse.text, 'Response from Gemini')
})
