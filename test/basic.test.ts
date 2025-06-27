import { test, mock } from 'node:test'
import assert from 'node:assert'
import { Ai, type PlainResponse } from '../src/lib/ai.ts'
import { mockOpenAiStream, consumeStream } from './helper/helper.ts'

const apiKey = 'test'

test('should be able to perform a basic prompt', async () => {
  const client = {
    chat: {
      completions: {
        create: async () => {
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
    providers: {
      openai: {
        apiKey,
        models: [{
          name: 'gpt-4o-mini',
        }],
        client
      }
    }
  })

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello, how are you?'
  }) as PlainResponse

  assert.equal((response).text, 'All good')
})

test('should be able to perform a prompt with options', async () => {
  const client = {
    chat: {
      completions: {
        create: mock.fn(async () => {
          return {
            choices: [{
              message: {
                content: 'All good'
              }
            }]
          }
        })
      }
    }
  }

  const ai = new Ai({
    providers: {
      openai: {
        apiKey,
        models: [{
          name: 'gpt-4o-mini',
        }],
        client
      }
    }
  })

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello, how are you?',
    options: {
      context: 'You are a nice helpful assistant.',
      temperature: 0.5,
      maxTokens: 1000,
    }
  }) as PlainResponse

  assert.deepEqual(client.chat.completions.create.mock.calls[0].arguments, [{
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
  }])
  assert.equal((response).text, 'All good')
})

test('should be able to perform a prompt with stream', async () => {
  const client = {
    chat: {
      completions: {
        create: mock.fn(async () => {
          return mockOpenAiStream([
            { choices: [{ delta: { content: 'All' } }] },
            { choices: [{ delta: { content: ' good' } }] }
          ])
        })
      }
    }
  }

  const ai = new Ai({
    providers: {
      openai: {
        apiKey,
        models: [{
          name: 'gpt-4o-mini',
        }],
        client
      }
    }
  })

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello, how are you?',
    options: {
      context: 'You are a nice helpful assistant.',
      stream: true,
    }
  }) as ReadableStream

  assert.deepEqual(client.chat.completions.create.mock.calls[0].arguments, [{
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
  }])

  const chunks = await consumeStream(response)

  assert.equal(chunks.join(''), 'All good')
})

test('should be able to perform a prompt with history', async () => {
  const client = {
    chat: {
      completions: {
        create: mock.fn(async () => {
          return {
            choices: [{
              message: {
                content: 'Sure, I can help you with math.'
              }
            }]
          }
        })
      }
    }
  }

  const ai = new Ai({
    providers: {
      openai: {
        apiKey,
        models: [{
          name: 'gpt-4o-mini',
        }],
        client
      }
    }
  })

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Can you help me to with math?',
    options: {
      context: 'You are a nice helpful assistant.',
      temperature: 0.5,
      maxTokens: 1000,
      history: [
        {
          prompt: 'Hello, how are you?',
          response: 'All good'
        }
      ]
    }
  }) as PlainResponse

  assert.deepEqual(client.chat.completions.create.mock.calls[0].arguments, [{
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
    max_tokens: 1000,
    stream: undefined,
  }])
  assert.equal((response).text, 'Sure, I can help you with math.')
})
