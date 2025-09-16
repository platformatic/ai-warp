import { test, mock } from 'node:test'
import assert from 'node:assert'
import { Ai, type AiStreamResponse, type AiContentResponse } from '../src/lib/ai.ts'
import { OptionError, ProviderExceededQuotaError, ProviderResponseError, ProviderResponseNoContentError, ProviderResponseMaxTokensError } from '../src/lib/errors.ts'
import { mockGeminiStream, consumeStream, createDummyClient } from './helper/helper.ts'
import pino from 'pino'
import { isStream } from '../src/lib/utils.ts'

const apiKey = 'test-api-key'
const logger = pino({ level: 'silent' })

test('GeminiProvider - should be able to perform a basic prompt', async (t) => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return {
        candidates: [{
          content: {
            parts: [{ text: 'Hello! I am doing well, thank you for asking.' }]
          },
          finishReason: 'STOP'
        }]
      }
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      gemini: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'gemini',
      model: 'gemini-1.5-flash'
    }],
  })
  await ai.init()
  t.after(() => ai.close())

  const response = await ai.request({
    models: ['gemini:gemini-1.5-flash'],
    prompt: 'Hello, how are you?'
  }) as AiContentResponse

  assert.equal(response.text, 'Hello! I am doing well, thank you for asking.')
  assert.equal(response.result, 'COMPLETE')
})

test('GeminiProvider - should be able to perform a prompt with options', async () => {
  const client = {
    ...createDummyClient(),
    request: mock.fn(async () => {
      return {
        candidates: [{
          content: {
            parts: [{ text: 'I am a helpful AI assistant ready to help you.' }]
          },
          finishReason: 'STOP'
        }]
      }
    })
  }

  const ai = new Ai({
    logger,
    providers: {
      gemini: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'gemini',
      model: 'gemini-1.5-flash'
    }],
  })
  await ai.init()

  const response = await ai.request({
    models: ['gemini:gemini-1.5-flash'],
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
    model: 'gemini-1.5-flash',
    request: {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Hello, how are you?' }]
        }
      ],
      systemInstruction: {
        parts: [{ text: 'You are a nice helpful assistant.' }]
      },
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 500
      }
    }
  })
  assert.equal(response.text, 'I am a helpful AI assistant ready to help you.')
})

test('GeminiProvider - should be able to perform a prompt with stream', async () => {
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => {
      return mockGeminiStream([
        { candidates: [{ content: { parts: [{ text: 'Hello!' }] } }] },
        { candidates: [{ content: { parts: [{ text: ' I am doing well.' }] }, finishReason: 'STOP' }] }
      ])
    })
  }

  const ai = new Ai({
    logger,
    providers: {
      gemini: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'gemini',
      model: 'gemini-1.5-flash'
    }],
  })
  await ai.init()

  const response = await ai.request({
    models: ['gemini:gemini-1.5-flash'],
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
  const streamCall = client.stream.mock.calls[0].arguments[1]
  assert.deepEqual(streamCall, {
    model: 'gemini-1.5-flash',
    request: {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Hello, how are you?' }]
        }
      ],
      systemInstruction: {
        parts: [{ text: 'You are a nice helpful assistant.' }]
      }
    },
    stream: true
  })
})

test('GeminiProvider - should be able to perform a prompt with history', async () => {
  const client = {
    ...createDummyClient(),
    request: mock.fn(async () => {
      return {
        candidates: [{
          content: {
            parts: [{ text: 'Sure, I can help you with math problems!' }]
          },
          finishReason: 'STOP'
        }]
      }
    })
  }

  const ai = new Ai({
    logger,
    providers: {
      gemini: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'gemini',
      model: 'gemini-1.5-flash'
    }],
  })
  await ai.init()

  const response = await ai.request({
    models: ['gemini:gemini-1.5-flash'],
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
  const requestCall = client.request.mock.calls[0].arguments[1]
  assert.deepEqual(requestCall, {
    model: 'gemini-1.5-flash',
    request: {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Hello, how are you?' }]
        },
        {
          role: 'model',
          parts: [{ text: 'I am doing well, thank you!' }]
        },
        {
          role: 'user',
          parts: [{ text: 'Can you help me with math?' }]
        }
      ],
      systemInstruction: {
        parts: [{ text: 'You are a nice helpful assistant.' }]
      },
      generationConfig: {
        temperature: 0.5
      }
    }
  })
  assert.equal(response.text, 'Sure, I can help you with math problems!')
})

test('GeminiProvider - should handle API error responses', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      throw new ProviderResponseError('Gemini Response: 400 - Bad Request')
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      gemini: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'gemini',
      model: 'gemini-1.5-flash'
    }],
  })
  await ai.init()

  await assert.rejects(
    async () => {
      await ai.request({
        models: ['gemini:gemini-1.5-flash'],
        prompt: 'Hello, how are you?'
      })
    },
    (err: any) => {
      assert.ok(err instanceof ProviderResponseError)
      assert.ok(err.message.includes('Gemini Response: 400 - Bad Request'))
      return true
    }
  )
})

test('GeminiProvider - should handle quota exceeded error', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      throw new ProviderExceededQuotaError('Gemini Response: 429 - Quota exceeded')
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      gemini: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'gemini',
      model: 'gemini-1.5-flash'
    }],
  })
  await ai.init()

  await assert.rejects(
    async () => {
      await ai.request({
        models: ['gemini:gemini-1.5-flash'],
        prompt: 'Hello, how are you?'
      })
    },
    (err: any) => {
      assert.ok(err instanceof ProviderExceededQuotaError)
      return true
    }
  )
})

test('GeminiProvider - should handle no content response', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return {
        candidates: [{
          content: {
            parts: []
          },
          finishReason: 'STOP'
        }]
      }
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      gemini: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'gemini',
      model: 'gemini-1.5-flash'
    }],
  })
  await ai.init()

  await assert.rejects(
    async () => {
      await ai.request({
        models: ['gemini:gemini-1.5-flash'],
        prompt: 'Hello, how are you?'
      })
    },
    (err: any) => {
      assert.ok(err instanceof ProviderResponseNoContentError)
      return true
    }
  )
})

test('GeminiProvider - should handle max tokens response', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return {
        candidates: [{
          content: {
            parts: []
          },
          finishReason: 'MAX_TOKENS'
        }]
      }
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      gemini: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'gemini',
      model: 'gemini-1.5-flash'
    }],
  })
  await ai.init()

  await assert.rejects(
    async () => {
      await ai.request({
        models: ['gemini:gemini-1.5-flash'],
        prompt: 'Hello, how are you?'
      })
    },
    (err: any) => {
      assert.ok(err instanceof ProviderResponseMaxTokensError)
      return true
    }
  )
})

test('GeminiProvider - should handle different finish reasons', async () => {
  const testCases = [
    { finishReason: 'STOP', expectedResult: 'COMPLETE' },
    { finishReason: 'MAX_TOKENS', expectedResult: 'INCOMPLETE_MAX_TOKENS' },
    { finishReason: 'SAFETY', expectedResult: 'INCOMPLETE_UNKNOWN' },
    { finishReason: 'RECITATION', expectedResult: 'INCOMPLETE_UNKNOWN' },
    { finishReason: 'OTHER', expectedResult: 'INCOMPLETE_UNKNOWN' },
    { finishReason: undefined, expectedResult: 'INCOMPLETE_UNKNOWN' }
  ]

  for (const { finishReason, expectedResult } of testCases) {
    const client = {
      ...createDummyClient(),
      request: async () => {
        return {
          candidates: [{
            content: {
              parts: [{ text: 'Test response' }]
            },
            finishReason
          }]
        }
      }
    }

    const ai = new Ai({
      logger,
      providers: {
        gemini: {
          apiKey,
          client
        }
      },
      models: [{
        provider: 'gemini',
        model: 'gemini-1.5-flash'
      }],
    })
    await ai.init()

    const response = await ai.request({
      models: ['gemini:gemini-1.5-flash'],
      prompt: 'Test prompt'
    }) as AiContentResponse

    assert.equal(response.result, expectedResult, `Failed for finishReason: ${finishReason}`)
  }
})

test('GeminiProvider - should handle stream error', async () => {
  const client = {
    ...createDummyClient(),
    stream: async () => {
      return mockGeminiStream([], { message: 'Stream error' })
    }
  }

  const ai = new Ai({
    logger,
    providers: {
      gemini: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'gemini',
      model: 'gemini-1.5-flash'
    }],
  })
  await ai.init()

  const response = await ai.request({
    models: ['gemini:gemini-1.5-flash'],
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

test('GeminiProvider - should require API key', async () => {
  const ai = new Ai({
    logger,
    providers: {
      gemini: {
        apiKey: '' // Empty API key
      }
    },
    models: [{
      provider: 'gemini',
      model: 'gemini-1.5-flash'
    }],
  })

  await assert.rejects(
    async () => {
      await ai.init()
    },
    (err: any) => {
      assert.ok(err instanceof OptionError)
      assert.ok(err.message.includes('Gemini API key is required'))
      return true
    }
  )
})

test('GeminiProvider - should handle streaming with finish reason', async () => {
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => {
      return mockGeminiStream([
        { candidates: [{ content: { parts: [{ text: 'Streaming' }] } }] },
        { candidates: [{ content: { parts: [{ text: ' response' }] }, finishReason: 'STOP' }] }
      ])
    })
  }

  const ai = new Ai({
    logger,
    providers: {
      gemini: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'gemini',
      model: 'gemini-1.5-flash'
    }],
  })
  await ai.init()

  const response = await ai.request({
    models: ['gemini:gemini-1.5-flash'],
    prompt: 'Test streaming',
    options: {
      stream: true
    }
  }) as AiStreamResponse

  const { content, end } = await consumeStream(response)
  assert.equal(content.map((c: any) => c.data.response).join(''), 'Streaming response')
  assert.equal(end, 'COMPLETE')
})

test('GeminiProvider - should handle empty generation config when no options provided', async () => {
  const client = {
    ...createDummyClient(),
    request: mock.fn(async () => {
      return {
        candidates: [{
          content: {
            parts: [{ text: 'Response without generation config' }]
          },
          finishReason: 'STOP'
        }]
      }
    })
  }

  const ai = new Ai({
    logger,
    providers: {
      gemini: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'gemini',
      model: 'gemini-1.5-flash'
    }],
  })
  await ai.init()

  await ai.request({
    models: ['gemini:gemini-1.5-flash'],
    prompt: 'Hello'
  })

  // @ts-ignore
  const requestCall = client.request.mock.calls[0]?.arguments[1]
  assert.ok(requestCall)
  assert.deepEqual(requestCall, {
    model: 'gemini-1.5-flash',
    request: {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Hello' }]
        }
      ]
    }
  })
})

test('GeminiProvider - should handle partial generation config', async () => {
  const client = {
    ...createDummyClient(),
    request: mock.fn(async () => {
      return {
        candidates: [{
          content: {
            parts: [{ text: 'Response with partial config' }]
          },
          finishReason: 'STOP'
        }]
      }
    })
  }

  const ai = new Ai({
    logger,
    providers: {
      gemini: {
        apiKey,
        client
      }
    },
    models: [{
      provider: 'gemini',
      model: 'gemini-1.5-flash'
    }],
  })
  await ai.init()

  await ai.request({
    models: ['gemini:gemini-1.5-flash'],
    prompt: 'Hello',
    options: {
      temperature: 0.8
      // maxTokens not provided
    }
  })

  // @ts-ignore
  const requestCall = client.request.mock.calls[0]?.arguments[1] as any
  assert.ok(requestCall)
  assert.deepEqual(requestCall.request.generationConfig, {
    temperature: 0.8
  })
})
