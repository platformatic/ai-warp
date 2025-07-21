import { test, mock } from 'node:test'
import assert from 'node:assert'
import { Ai, type AiContentResponse } from '../src/lib/ai.ts'
import { mockOpenAiStream, consumeStream, createDummyClient } from './helper/helper.ts'
import pino from 'pino'

const apiKey = 'test'
const logger = pino({ level: 'silent' })

test('should be able to perform a basic prompt', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return { choices: [{ message: { content: 'All good' } }] }
    }
  }

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
      model: 'gpt-4o-mini'
    }],
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello, how are you?'
  }) as AiContentResponse

  assert.equal((response).text, 'All good')
})

test('should be able to perform a prompt with options', async () => {
  const client = {
    ...createDummyClient(),
    request: mock.fn(async () => {
      return { choices: [{ message: { content: 'All good' } }] }
    })
  }

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
      model: 'gpt-4o-mini'
    }],
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello, how are you?',
    options: {
      context: 'You are a nice helpful assistant.',
      temperature: 0.5,
      maxTokens: 1000,
    }
  }) as AiContentResponse

  // @ts-ignore
  assert.deepEqual(client.request.mock.calls[0].arguments[1], {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a nice helpful assistant.'
      },
      {
        role: 'user',
        content: 'Hello, how are you?'
      }
    ],
    temperature: 0.5,
    max_tokens: 1000,
    stream: undefined,
  })
  assert.equal((response).text, 'All good')
})

test('should be able to perform a prompt with stream', async () => {
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'All' } }] },
        { choices: [{ delta: { content: ' good' }, finish_reason: 'stop' }] }
      ])
    })
  }

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
      model: 'gpt-4o-mini'
    }],
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello, how are you?',
    options: {
      context: 'You are a nice helpful assistant.',
      stream: true,
    }
  }) as ReadableStream

  assert.ok(response instanceof ReadableStream)
  // @ts-ignore
  assert.deepEqual(client.stream.mock.calls[0].arguments[1], {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a nice helpful assistant.'
      },
      {
        role: 'user',
        content: 'Hello, how are you?'
      }
    ],
    max_tokens: undefined,
    temperature: undefined,
    stream: true,
  })

  const { content } = await consumeStream(response)

  assert.equal(content.join(''), 'All good')
})

test('should be able to perform a prompt with history', async () => {
  const client = {
    ...createDummyClient(),
    request: mock.fn(async () => {
      return {
        choices: [{
          message: {
            content: 'Sure, I can help you with math.'
          }
        }]
      }
    })
  }

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
      model: 'gpt-4o-mini'
    }],
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Can you help me to with math?',
    options: {
      context: 'You are a nice helpful assistant.',
      temperature: 0.5,
      history: [
        {
          prompt: 'Hello, how are you?',
          response: 'All good'
        }
      ]
    }
  }) as AiContentResponse

  // @ts-ignore
  assert.deepEqual(client.request.mock.calls[0].arguments[1], {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a nice helpful assistant.'
      },
      {
        role: 'user',
        content: 'Hello, how are you?'
      },
      {
        role: 'assistant',
        content: 'All good'
      },
      {
        role: 'user',
        content: 'Can you help me to with math?'
      }
    ],
    temperature: 0.5,
    max_tokens: undefined,
    stream: undefined,
  })
  assert.equal((response).text, 'Sure, I can help you with math.')
})

test('should be able to perform a prompt with stream (cloning stream)', async () => {
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Sure,' } }] },
        { choices: [{ delta: { content: ' I can help you' } }] },
        { choices: [{ delta: { content: ' with math.' }, finish_reason: 'stop' }] }
      ])
    })
  }

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
      model: 'gpt-4o-mini'
    }],
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Can you help me to with math?',
    options: {
      context: 'You are a nice helpful assistant.',
      temperature: 0.5,
      stream: true
    }
  }) as ReadableStream

  // @ts-ignore
  assert.deepEqual(client.stream.mock.calls[0].arguments[1], {
    model: 'gpt-4o-mini',
    max_tokens: undefined,
    messages: [
      {
        content: 'You are a nice helpful assistant.',
        role: 'system'
      },
      {
        content: 'Can you help me to with math?',
        role: 'user'
      }
    ],
    stream: true,
    temperature: 0.5
  })

  const { content } = await consumeStream(response)

  assert.equal(content.join(''), 'Sure, I can help you with math.')
})
