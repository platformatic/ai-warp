import { test, mock } from 'node:test'
import assert from 'node:assert'
import { Ai, type AiStreamResponse, type AiContentResponse } from '../src/lib/ai.ts'
import { OptionError, ProviderExceededQuotaError, ProviderResponseError, ProviderResponseNoContentError } from '../src/lib/errors.ts'
import { mockOpenAiStream, consumeStream, createDummyClient } from './helper/helper.ts'
import pino from 'pino'
import { isStream } from '../src/lib/utils.ts'

const apiKey = 'test-api-key'
const logger = pino({ level: 'silent' })

test('DeepSeekProvider - should be able to perform a basic prompt', async (t) => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return {
        choices: [{
          message: {
            content: 'Hello! I am doing well, thank you for asking.'
          },
          finish_reason: 'stop'
        }]
      }
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      deepseek: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'deepseek',
      model: 'deepseek-chat'
    }],
  })
  await ai.init()
  t.after(() => ai.close())

  const response = await ai.request({
    models: ['deepseek:deepseek-chat'],
    prompt: 'Hello, how are you?'
  }) as AiContentResponse

  assert.equal(response.text, 'Hello! I am doing well, thank you for asking.')
  assert.equal(response.result, 'COMPLETE')
})

test('DeepSeekProvider - should be able to perform a prompt with options', async () => {
  const client = {
    ...createDummyClient(),
    request: mock.fn(async () => {
      return {
        choices: [{
          message: {
            content: 'I am a helpful AI assistant ready to help you.'
          },
          finish_reason: 'stop'
        }]
      }
    })
  }

  const ai = new Ai({
    logger,
    providers: {
      deepseek: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'deepseek',
      model: 'deepseek-chat'
    }],
  })
  await ai.init()

  const response = await ai.request({
    models: ['deepseek:deepseek-chat'],
    prompt: 'Hello, how are you?',
    options: {
      context: 'You are a nice helpful assistant.',
      temperature: 0.7,
      maxTokens: 500,
    }
  }) as AiContentResponse

  // @ts-ignore
  const requestCall = client.request.mock.calls[0].arguments[1]
  assert.deepEqual(requestCall, {
    model: 'deepseek-chat',
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
    temperature: 0.7,
    max_tokens: 500,
    stream: false
  })
  assert.equal(response.text, 'I am a helpful AI assistant ready to help you.')
})

test('DeepSeekProvider - should be able to perform a prompt with stream', async () => {
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Hello!' } }] },
        { choices: [{ delta: { content: ' I am doing well.' }, finish_reason: 'stop' }] }
      ])
    })
  }

  const ai = new Ai({
    logger,
    providers: {
      deepseek: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'deepseek',
      model: 'deepseek-chat'
    }],
  })
  await ai.init()

  const response = await ai.request({
    models: ['deepseek:deepseek-chat'],
    prompt: 'Hello, how are you?',
    options: {
      context: 'You are a nice helpful assistant.',
      stream: true,
    }
  }) as AiStreamResponse

  assert.ok(isStream(response))

  const { content } = await consumeStream(response)
  assert.equal(content.map((c: any) => c.data.response).join(''), 'Hello! I am doing well.')

  // @ts-ignore
  const streamCall = client.stream.mock.calls[0]?.arguments[1] as any
  assert.ok(streamCall)
  assert.equal(streamCall.model, 'deepseek-chat')
  assert.equal(streamCall.stream, true)
  assert.deepEqual(streamCall.messages, [
    {
      role: 'system',
      content: 'You are a nice helpful assistant.'
    },
    {
      role: 'user',
      content: 'Hello, how are you?'
    }
  ])
})

test('DeepSeekProvider - should be able to perform a prompt with history', async () => {
  const client = {
    ...createDummyClient(),
    request: mock.fn(async () => {
      return {
        choices: [{
          message: {
            content: 'Sure, I can help you with math problems!'
          },
          finish_reason: 'stop'
        }]
      }
    })
  }

  const ai = new Ai({
    logger,
    providers: {
      deepseek: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'deepseek',
      model: 'deepseek-chat'
    }],
  })
  await ai.init()

  const response = await ai.request({
    models: ['deepseek:deepseek-chat'],
    prompt: 'Can you help me with math?',
    options: {
      context: 'You are a nice helpful assistant.',
      temperature: 0.5,
      history: [
        {
          prompt: 'Hello, how are you?',
          response: 'I am doing well, thank you!'
        }
      ]
    }
  }) as AiContentResponse

  // @ts-ignore
  const requestCall = client.request.mock.calls[0]?.arguments[1] as any
  assert.ok(requestCall)
  assert.equal(requestCall.model, 'deepseek-chat')
  assert.equal(requestCall.temperature, 0.5)
  assert.equal(requestCall.stream, false)
  assert.deepEqual(requestCall.messages, [
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
      content: 'I am doing well, thank you!'
    },
    {
      role: 'user',
      content: 'Can you help me with math?'
    }
  ])
  assert.equal(response.text, 'Sure, I can help you with math problems!')
})

test('DeepSeekProvider - should handle API error responses', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      throw new ProviderResponseError('DeepSeek Response: 400 - Bad Request')
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      deepseek: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'deepseek',
      model: 'deepseek-chat'
    }],
  })
  await ai.init()

  await assert.rejects(
    async () => {
      await ai.request({
        models: ['deepseek:deepseek-chat'],
        prompt: 'Hello, how are you?'
      })
    },
    (err: any) => {
      assert.ok(err instanceof ProviderResponseError)
      assert.ok(err.message.includes('DeepSeek Response: 400 - Bad Request'))
      return true
    }
  )
})

test('DeepSeekProvider - should handle quota exceeded error (429)', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      throw new ProviderExceededQuotaError('DeepSeek Response: 429 - Rate limit exceeded')
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      deepseek: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'deepseek',
      model: 'deepseek-chat'
    }],
  })
  await ai.init()

  await assert.rejects(
    async () => {
      await ai.request({
        models: ['deepseek:deepseek-chat'],
        prompt: 'Hello, how are you?'
      })
    },
    (err: any) => {
      assert.ok(err instanceof ProviderExceededQuotaError)
      return true
    }
  )
})

test('DeepSeekProvider - should handle insufficient balance error (402)', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      throw new ProviderExceededQuotaError('DeepSeek Response: 402 - Insufficient Balance')
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      deepseek: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'deepseek',
      model: 'deepseek-chat'
    }],
  })
  await ai.init()

  await assert.rejects(
    async () => {
      await ai.request({
        models: ['deepseek:deepseek-chat'],
        prompt: 'Hello, how are you?'
      })
    },
    (err: any) => {
      assert.ok(err instanceof ProviderExceededQuotaError)
      return true
    }
  )
})

test('DeepSeekProvider - should handle no content response', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return {
        choices: [{
          message: {
            content: null
          },
          finish_reason: 'stop'
        }]
      }
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      deepseek: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'deepseek',
      model: 'deepseek-chat'
    }],
  })
  await ai.init()

  await assert.rejects(
    async () => {
      await ai.request({
        models: ['deepseek:deepseek-chat'],
        prompt: 'Hello, how are you?'
      })
    },
    (err: any) => {
      assert.ok(err instanceof ProviderResponseNoContentError)
      return true
    }
  )
})

test('DeepSeekProvider - should handle max tokens response', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return {
        choices: [{
          message: {
            content: 'This response was cut off due to max tokens'
          },
          finish_reason: 'length'
        }]
      }
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      deepseek: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'deepseek',
      model: 'deepseek-chat'
    }],
  })
  await ai.init()

  const response = await ai.request({
    models: ['deepseek:deepseek-chat'],
    prompt: 'Hello, how are you?'
  }) as AiContentResponse

  assert.equal(response.text, 'This response was cut off due to max tokens')
  assert.equal(response.result, 'INCOMPLETE_MAX_TOKENS')
})

test('DeepSeekProvider - should handle different finish reasons', async () => {
  const testCases = [
    { finish_reason: 'stop', expectedResult: 'COMPLETE' },
    { finish_reason: 'length', expectedResult: 'INCOMPLETE_MAX_TOKENS' },
    { finish_reason: 'content_filter', expectedResult: 'INCOMPLETE_UNKNOWN' },
    { finish_reason: 'tool_calls', expectedResult: 'INCOMPLETE_UNKNOWN' },
    { finish_reason: null, expectedResult: 'INCOMPLETE_UNKNOWN' },
    { finish_reason: undefined, expectedResult: 'INCOMPLETE_UNKNOWN' }
  ]

  // eslint-disable-next-line
  for (const { finish_reason, expectedResult } of testCases) {
    const client = {
      ...createDummyClient(),
      request: async () => {
        return {
          choices: [{
            message: {
              content: 'Test response'
            },
            // eslint-disable-next-line
            finish_reason
          }]
        }
      }
    }

    const ai = new Ai({
      logger,
      providers: {
        deepseek: {
          apiKey,
          client
        }
      },
      models: [{
        provider: 'deepseek',
        model: 'deepseek-chat'
      }],
    })
    await ai.init()

    const response = await ai.request({
      models: ['deepseek:deepseek-chat'],
      prompt: 'Test prompt'
    }) as AiContentResponse

    // eslint-disable-next-line
    assert.equal(response.result, expectedResult, `Failed for finish_reason: ${finish_reason}`)
  }
})

test('DeepSeekProvider - should handle stream error', async () => {
  const client = {
    ...createDummyClient(),
    stream: async () => {
      return mockOpenAiStream([], { message: 'Stream error' })
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      deepseek: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'deepseek',
      model: 'deepseek-chat'
    }],
  })
  await ai.init()

  const response = await ai.request({
    models: ['deepseek:deepseek-chat'],
    prompt: 'Hello, how are you?',
    options: {
      stream: true
    }
  }) as AiStreamResponse

  // The stream should handle the error gracefully
  assert.ok(isStream(response))

  // Consume the stream and expect it to handle the error properly
  await new Promise<void>((resolve, reject) => {
    let errorReceived = false
    let streamEnded = false

    response.on('data', (chunk: Buffer) => {
      const eventData = chunk.toString('utf8')
      if (eventData.includes('event: error')) {
        errorReceived = true
      }
    })

    response.on('end', () => {
      streamEnded = true
      // The stream should have received an error event
      assert.ok(errorReceived, 'Expected error event to be received')
      resolve()
    })

    response.on('error', (error) => {
      // This is expected - the stream should emit an error
      // when it encounters the error event from the mock
      // Accept any truthy error value
      assert.ok(error, 'Expected error to be truthy')
      resolve()
    })

    // Add a timeout to prevent hanging
    setTimeout(() => {
      if (!streamEnded && !errorReceived) {
        reject(new Error('Test timeout - stream did not complete'))
      }
    }, 1000)
  })
})

test('DeepSeekProvider - should require API key', async () => {
  const ai = new Ai({
    logger,
    providers: {
      deepseek: {
        apiKey: '' // Empty API key
      }
    },
    models: [{
      provider: 'deepseek',
      model: 'deepseek-chat'
    }],
  })

  await assert.rejects(
    async () => {
      await ai.init()
    },
    (err: any) => {
      assert.ok(err instanceof OptionError)
      // The actual error message might be different, let's just check for OptionError
      return true
    }
  )
})

test('DeepSeekProvider - should handle streaming with finish reason', async () => {
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Streaming' } }] },
        { choices: [{ delta: { content: ' response' }, finish_reason: 'stop' }] }
      ])
    })
  }

  const ai = new Ai({
    logger,
    providers: {
      deepseek: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'deepseek',
      model: 'deepseek-chat'
    }],
  })
  await ai.init()

  const response = await ai.request({
    models: ['deepseek:deepseek-chat'],
    prompt: 'Test streaming',
    options: {
      stream: true
    }
  }) as AiStreamResponse

  const { content, end } = await consumeStream(response)
  assert.equal(content.map((c: any) => c.data.response).join(''), 'Streaming response')
  assert.equal(end, 'COMPLETE')
})

test('DeepSeekProvider - should handle custom client', async () => {
  const client = {
    ...createDummyClient(),
    request: mock.fn(async () => {
      return {
        choices: [{
          message: {
            content: 'Custom client response'
          },
          finish_reason: 'stop'
        }]
      }
    })
  }

  const ai = new Ai({
    logger,
    providers: {
      deepseek: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'deepseek',
      model: 'deepseek-chat'
    }],
  })
  await ai.init()

  const response = await ai.request({
    models: ['deepseek:deepseek-chat'],
    prompt: 'Hello with custom client'
  }) as AiContentResponse

  assert.equal(response.text, 'Custom client response')
  assert.equal(response.result, 'COMPLETE')
})

test('DeepSeekProvider - should handle empty generation config when no options provided', async () => {
  const client = {
    ...createDummyClient(),
    request: mock.fn(async () => {
      return {
        choices: [{
          message: {
            content: 'Response without options'
          },
          finish_reason: 'stop'
        }]
      }
    })
  }

  const ai = new Ai({
    logger,
    providers: {
      deepseek: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'deepseek',
      model: 'deepseek-chat'
    }],
  })
  await ai.init()

  await ai.request({
    models: ['deepseek:deepseek-chat'],
    prompt: 'Hello'
  })

  // @ts-ignore
  const requestCall = client.request.mock.calls[0]?.arguments[1] as any
  assert.ok(requestCall)
  assert.equal(requestCall.model, 'deepseek-chat')
  assert.equal(requestCall.stream, false)
  assert.deepEqual(requestCall.messages, [
    {
      role: 'user',
      content: 'Hello'
    }
  ])
  // The provider adds undefined properties, so let's just check they exist
  assert.equal(requestCall.temperature, undefined)
  assert.equal(requestCall.max_tokens, undefined)
})

test('DeepSeekProvider - should handle partial generation config', async () => {
  const client = {
    ...createDummyClient(),
    request: mock.fn(async () => {
      return {
        choices: [{
          message: {
            content: 'Response with partial config'
          },
          finish_reason: 'stop'
        }]
      }
    })
  }

  const ai = new Ai({
    logger,
    providers: {
      deepseek: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'deepseek',
      model: 'deepseek-chat'
    }],
  })
  await ai.init()

  await ai.request({
    models: ['deepseek:deepseek-chat'],
    prompt: 'Hello',
    options: {
      temperature: 0.8
      // maxTokens not provided
    }
  })

  // @ts-ignore
  const requestCall = client.request.mock.calls[0]?.arguments[1] as any
  assert.ok(requestCall)
  assert.equal(requestCall.temperature, 0.8)
  assert.equal(requestCall.max_tokens, undefined)
})
