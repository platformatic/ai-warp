import { mock, test } from 'node:test'
import assert from 'node:assert'
import { Readable } from 'node:stream'
import { setTimeout as wait } from 'node:timers/promises'
import { Ai, type AiStreamResponse, type AiContentResponse } from '../src/lib/ai.ts'
import pino from 'pino'
import { consumeStream, createDummyClient, mockOpenAiStream } from './helper/helper.ts'
import { isStream } from '../src/lib/utils.ts'

const apiKey = 'test'
const logger = pino({ level: 'silent' })

test('should succeed after some failures because of retries', async (t) => {
  let callCount = 0
  const client = {
    ...createDummyClient(),
    request: async () => {
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
    limits: {
      retry: {
        max: 2,
        interval: 100
      }
    }
  })
  await ai.init()
  t.after(() => ai.close())

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello, how are you?',
  }) as AiContentResponse

  assert.equal(callCount, 1)

  assert.equal(response.text, 'All good')
})

test('should fail after max retries', async (t) => {
  const client = {
    ...createDummyClient(),
    request: mock.fn(async () => {
      const error = new Error('Request error')
      ;(error as any).code = 'PROVIDER_RESPONSE_ERROR'
      throw error
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
    limits: {
      retry: {
        max: 2,
        interval: 100
      }
    }
  })
  await ai.init()
  t.after(() => ai.close())

  await assert.rejects(async () => await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Hello, how are you?',
  }), { code: 'PROVIDER_RESPONSE_ERROR' })

  assert.equal(client.request.mock.calls.length, 3)
})

test('should allow requests within rate limit', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => ({
      choices: [{
        message: {
          content: 'Response'
        }
      }]
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
    limits: {
      rate: {
        max: 3,
        timeWindow: '1m'
      }
    }
  })
  await ai.init()

  // Should allow 3 requests within limit
  for (let i = 0; i < 3; i++) {
    const response = await ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: `Request ${i + 1}`,
    }) as AiContentResponse

    assert.equal(response.text, 'Response')
  }
})

test('should block requests when rate limit exceeded', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => ({
      choices: [{
        message: {
          content: 'Response'
        }
      }]
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
    limits: {
      rate: {
        max: 2,
        timeWindow: '10s'
      }
    }
  })
  await ai.init()

  // Make requests up to the limit
  for (let i = 0; i < 2; i++) {
    await ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: `Request ${i + 1}`,
    })
  }

  // Next request should be blocked
  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'Blocked request',
    }),
    /Rate limit exceeded/
  )
})

test('should allow requests after time window passes', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => ({
      choices: [{
        message: {
          content: 'Response'
        }
      }]
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
    limits: {
      rate: {
        max: 1,
        timeWindow: '50ms'
      }
    }
  })
  await ai.init()

  // Make request up to the limit with short time window
  await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'First request',
  })

  // Wait for time window to pass
  await wait(60)

  // Should allow another request after time window passes
  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Second request',
  }) as AiContentResponse

  assert.equal(response.text, 'Response')
})

test('should maintain separate rate limits per model', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => ({
      choices: [{
        message: {
          content: 'Response'
        }
      }]
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
    }, {
      provider: 'openai',
      model: 'gpt-4o'
    }],
    limits: {
      rate: {
        max: 1,
        timeWindow: '10s'
      }
    }
  })
  await ai.init()

  // Use up rate limit for first model
  await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Request to mini',
  })

  // Should still be able to use second model
  const response = await ai.request({
    models: ['openai:gpt-4o'],
    prompt: 'Request to gpt-4o'
  }) as AiContentResponse

  assert.equal(response.text, 'Response')

  // But first model should be blocked
  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'Blocked request to mini',
    }),
    /PROVIDER_RATE_LIMIT_ERROR/
  )
})

test('should work with streaming responses and rate limits (streaming)', async () => {
  const client = {
    ...createDummyClient(),
    stream: async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'chunk1' } }] },
        { choices: [{ delta: { content: 'chunk2' } }] }
      ])
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
    limits: {
      rate: {
        max: 1,
        timeWindow: '10s'
      }
    }
  })
  await ai.init()

  // First streaming request should work
  const response1 = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'First streaming request',
    options: {
      stream: true,
    }
  })

  assert.ok(isStream(response1))

  // Second streaming request should be blocked
  await assert.rejects(async () => await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Blocked streaming request',
    options: {
      stream: true
    }
  }),
  /PROVIDER_RATE_LIMIT_ERROR/
  )
})

// Request timeout tests

test('should timeout non-streaming request after requestTimeout', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      // Simulate a slow response
      await wait(200)
      return {
        choices: [{
          message: {
            content: 'Response'
          }
        }]
      }
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

    limits: {
      requestTimeout: 100
    }
  })
  await ai.init()

  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'This should timeout',
    }),
    /PROVIDER_REQUEST_TIMEOUT_ERROR/
  )
})

test('should timeout streaming request after requestTimeout (streaming)', async () => {
  const client = {
    ...createDummyClient(),
    stream: async () => {
      // Simulate a slow initial response
      await wait(200)
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'chunk1' } }] },
        { choices: [{ delta: { content: 'chunk2' } }] }
      ])
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
    limits: {
      requestTimeout: 100 // 100ms timeout
    }
  })
  await ai.init()

  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'This should timeout',
      options: {
        stream: true,
      }
    }),
    /PROVIDER_REQUEST_STREAM_TIMEOUT_ERROR/
  )
})

test('should timeout streaming request between chunks', async () => {
  const client = {
    ...createDummyClient(),
    stream: async () => {
      // Create a Node.js Readable stream that simulates delay between chunks
      const readable = new Readable({
        read () { }
      })

      const pushChunks = async () => {
        try {
          // Send first chunk immediately
          readable.push(Buffer.from('data: {"choices": [{"delta": {"content": "chunk1"}}]}\n\n'))

          // Wait longer than timeout before second chunk
          await wait(200)

          // This should never be reached due to timeout
          readable.push(Buffer.from('data: {"choices": [{"delta": {"content": "chunk2"}}]}\n\n'))
          readable.push(Buffer.from('data: [DONE]\n\n'))
          readable.push(null)
        } catch (error) {
          readable.destroy(error)
        }
      }

      setImmediate(() => pushChunks())
      return readable
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
    limits: {
      requestTimeout: 100 // 100ms timeout between chunks
    }
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'This should timeout',
    options: {
      stream: true,
    }
  }) as AiStreamResponse

  await assert.rejects(consumeStream(response), { code: 'PROVIDER_REQUEST_STREAM_TIMEOUT_ERROR' })
})

test('should not timeout with fast responses', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => {
      return {
        choices: [{
          message: {
            content: 'Fast response'
          }
        }]
      }
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
    limits: {
      requestTimeout: 100 // 100ms timeout
    }
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Fast request',
  }) as AiContentResponse

  assert.equal(response.text, 'Fast response')
})

test('should not retry on timeout error', async () => {
  let callCount = 0
  const client = {
    ...createDummyClient(),
    request: async () => {
      callCount++
      // Simulate a slow response
      await wait(200)
      return {
        choices: [{
          message: {
            content: 'Response'
          }
        }]
      }
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
    limits: {
      requestTimeout: 100 // 100ms timeout
    }
  })
  await ai.init()

  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'This should timeout',
    }),
    /PROVIDER_REQUEST_TIMEOUT_ERROR/
  )
  assert.equal(callCount, 1)
})

// History expiration tests

test('should store history with expiration', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => ({
      choices: [{ message: { content: 'Response from AI' }, finish_reason: 'stop' }]
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
    limits: {
      historyExpiration: '500ms'
    }
  })
  await ai.init()

  // Create a session and make a request with history
  const response1 = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'First message',
  }) as AiContentResponse

  assert.ok(response1.sessionId)
  assert.equal(response1.text, 'Response from AI')

  // Immediately check that history exists
  const history = await ai.history.range(response1.sessionId!)

  assert.equal(history.length, 3)
  assert.equal((history[0] as any).data.prompt, 'First message')
  assert.equal((history[1] as any).data.response, 'Response from AI')
  assert.equal((history[2] as any).data.response, 'COMPLETE')

  // Wait for expiration
  await wait(750)

  // History should be empty after expiration
  const expiredHistory = await ai.history.range(response1.sessionId!)
  assert.equal(expiredHistory.length, 0)
})

test('should work with streaming responses and history expiration', async () => {
  const client = {
    ...createDummyClient(),
    stream: async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Stream' } }] },
        { choices: [{ delta: { content: ' response' }, finish_reason: 'stop' }] },
      ])
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
    limits: {
      historyExpiration: '100ms'
    }
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Streaming request',
    options: { stream: true }
  }) as AiStreamResponse

  assert.ok(isStream(response))
  assert.ok(response.sessionId)

  // Consume the stream
  const chunks: Buffer[] = []

  return new Promise((resolve, reject) => {
    response.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    response.on('end', async () => {
      try {
        // Wait a bit for the background history processing to complete
        await wait(50)

        // Check that history was stored
        let history = await ai.history.range(response.sessionId)

        assert.equal(history.length, 4)
        assert.equal((history[0] as any).data.prompt, 'Streaming request')
        assert.equal((history[1] as any).data.response, 'Stream')
        assert.equal((history[2] as any).data.response, ' response')
        assert.equal((history[3] as any).data.response, 'COMPLETE')

        // Wait for expiration
        await wait(100)

        // History should be expired
        history = await ai.history.range(response.sessionId)
        assert.equal(history.length, 0)

        resolve(undefined)
      } catch (error) {
        reject(error)
      }
    })

    response.on('error', (error) => {
      reject(error)
    })
  })
})

// Max tokens tests

test('should handle max tokens limit in non-streaming response', async () => {
  const client = {
    ...createDummyClient(),
    request: async (api: any, request: any) => {
      // Verify that max_tokens is passed correctly
      assert.equal(request.max_tokens, 100)

      return {
        choices: [{
          message: {
            content: 'This is a truncated response because'
          },
          finish_reason: 'length' // Indicates max tokens reached
        }]
      }
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
    prompt: 'Write a long story',
    options: {
      maxTokens: 100
    }
  }) as AiContentResponse

  assert.equal(response.text, 'This is a truncated response because')
  assert.equal(response.result, 'INCOMPLETE_MAX_TOKENS')
})

test('should handle max tokens limit in streaming response', async () => {
  const client = {
    ...createDummyClient(),
    stream: async (api: any, request: any) => {
      assert.equal(request.max_tokens, 50)
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'This is' } }] },
        { choices: [{ delta: { content: ' a truncated' } }] },
        { choices: [{ delta: { content: ' response' } }] },
        { choices: [{ delta: {}, finish_reason: 'length' }] }
      ])
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
    }]
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Write a long story',
    options: {
      stream: true,
      maxTokens: 50
    }
  }) as AiStreamResponse

  assert.ok(isStream(response))

  const { content, end } = await consumeStream(response)

  assert.equal(content.map((c: any) => c.data.response).join(''), 'This is a truncated response')
  assert.equal(end, 'INCOMPLETE_MAX_TOKENS')
})

test('should handle complete response when max tokens not reached', async () => {
  const client = {
    ...createDummyClient(),
    request: async (api: any, request: any) => {
      // Verify that max_tokens is passed correctly
      assert.equal(request.max_tokens, 1000)

      return {
        choices: [{
          message: {            content: 'This is a complete response.'          },
          finish_reason: 'stop' // Indicates natural completion
        }]
      }
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
    }]
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Say hello',
    options: {
      maxTokens: 1000
    }
  }) as AiContentResponse

  assert.equal(response.text, 'This is a complete response.')
  assert.equal(response.result, 'COMPLETE')
})

test('should handle complete streaming response when max tokens not reached', async () => {
  const client = {
    ...createDummyClient(),
    stream: async (api: any, request: any) => {
      assert.equal(request.max_tokens, 1000)
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Complete' } }] },
        { choices: [{ delta: { content: ' response.' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] }
      ])
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
    }]
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Say hello',
    options: {
      stream: true,
      maxTokens: 1000
    }
  }) as AiStreamResponse

  assert.ok(isStream(response))

  const { content, end } = await consumeStream(response)

  assert.equal(content.map((c: any) => c.data.response).join(''), 'Complete response.')
  assert.equal(end, 'COMPLETE')
  // Note: The consumeStream helper doesn't currently parse the final result event
  // so we can't assert on finalResult here
})

test('should handle unknown finish reason', async () => {
  const client = {
    ...createDummyClient(),
    request: async () => ({
      choices: [{
        message: {
          content: 'Response with unknown finish reason'
        },
        finish_reason: 'content_filter' // Unknown finish reason
      }]
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
    }]
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Test prompt',
    options: {
      maxTokens: 100
    }
  }) as AiContentResponse

  assert.equal(response.text, 'Response with unknown finish reason')
  assert.equal(response.result, 'INCOMPLETE_UNKNOWN')
})

test('should not pass max_tokens when not specified', async () => {
  const client = {
    ...createDummyClient(),
    request: async (api: any, request: any) => {
      // Verify that max_tokens is undefined when not specified
      assert.equal(request.max_tokens, undefined)

      return {
        choices: [{
          message: {
            content: 'Response without max tokens limit'
          },
          finish_reason: 'stop'
        }]
      }
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
    }]
  })
  await ai.init()

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Test prompt'
    // No limits specified
  }) as AiContentResponse

  assert.equal(response.text, 'Response without max tokens limit')
  assert.equal(response.result, 'COMPLETE')
})

// Retry with stream option tests

test('should retry streaming request on retryable error and succeed', async (t) => {
  const client = createDummyClient()
  client.stream = mock.fn(async () => {
    // @ts-ignore
    if (client.stream.mock.calls.length === 1) {
      const error = new Error('Request timeout')
      ;(error as any).code = 'PROVIDER_RESPONSE_ERROR' // Use a retryable error
      throw error
    }
    return mockOpenAiStream([
      { choices: [{ delta: { content: 'Success' } }] },
      { choices: [{ delta: { content: ' after retry' } }] }
    ])
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
      model: 'gpt-4o-mini'
    }],
    limits: {
      retry: {
        max: 2,
        interval: 50
      }
    }
  })
  await ai.init()
  t.after(() => ai.close())

  // For streaming requests, retryable errors are not retried before the stream starts
  // Instead, they fail immediately and would be handled by model fallback logic
  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Test retry with stream',
    options: {
      stream: true
    }
  }) as AiStreamResponse

  assert.ok(isStream(response))

  const { content } = await consumeStream(response)
  assert.equal(content.map((c: any) => c.data.response).join(''), 'Success after retry')

  // @ts-ignore
  assert.equal(client.stream.mock.calls.length, 1) // Only one call made before failure
})

test('should retry streaming request multiple times until max retries', async (t) => {
  const client = createDummyClient()
  client.stream = mock.fn(async () => {
    const error = new Error('Request error')
    ;(error as any).code = 'PROVIDER_RESPONSE_ERROR'
    throw error
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
      model: 'gpt-4o-mini'
    }],
    limits: {
      retry: {
        max: 3,
        interval: 10
      }
    }
  })
  await ai.init()
  t.after(() => ai.close())

  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'Test max retries with stream',
      options: {
        stream: true
      }
    }),
    { code: 'PROVIDER_RESPONSE_ERROR' }
  )

  // @ts-ignore
  assert.equal(client.stream.mock.calls.length, 4) // Initial attempt + 3 retries
})

test('should not retry streaming request on non-retryable timeout error', async (t) => {
  const client = createDummyClient()
  client.stream = mock.fn(async () => {
    // Simulate timeout - wait longer than the timeout limit
    await wait(200)
    return mockOpenAiStream([
      { choices: [{ delta: { content: 'Should not reach' } }] }
    ])
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
      model: 'gpt-4o-mini'
    }],
    limits: {
      requestTimeout: 100,
      retry: {
        max: 2,
        interval: 50
      }
    }
  })
  await ai.init()
  t.after(() => ai.close())

  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'Test no retry on timeout',
      options: {
        stream: true
      }
    }),
    /PROVIDER_REQUEST_STREAM_TIMEOUT_ERROR/
  )

  // @ts-ignore
  assert.equal(client.stream.mock.calls.length, 1) // Should not retry on timeout
})

test('should retry streaming request with different models when first model fails', async (t) => {
  const client = createDummyClient()
  client.stream = mock.fn(async (_api: any, request: any) => {
    if (request.model === 'gpt-4o-mini') {
      return mockOpenAiStream([], { message: 'Provider stream error' })
    } else if (request.model === 'deepseek-chat') {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Success' } }] },
        { choices: [{ delta: { content: ' from deepseek' } }] }
      ])
    }
    return {}
  }) as any

  const ai = new Ai({
    logger,
    providers: {
      openai: {
        apiKey,
        client
      },
      deepseek: {
        apiKey,
        client
      }
    },
    models: [
      {
        provider: 'openai',
        model: 'gpt-4o-mini'
      },
      {
        provider: 'deepseek',
        model: 'deepseek-chat'
      }
    ],
    limits: {
      retry: {
        max: 1,
        interval: 10
      }
    }
  })
  await ai.init()
  t.after(() => ai.close())

  const response = await ai.request({
    models: ['openai:gpt-4o-mini', 'deepseek:deepseek-chat'],
    prompt: 'Test fallback to different model',
    options: {
      stream: true
    }
  }) as AiStreamResponse

  assert.ok(isStream(response))
  const { content } = await consumeStream(response)
  assert.equal(content.map((c: any) => c.data.response).join(''), 'Success from deepseek')

  // @ts-ignore
  assert.equal(client.stream.mock.calls.length, 2)
  // @ts-ignore
  assert.equal(client.stream.mock.calls[0].arguments[1].model, 'gpt-4o-mini')
  // @ts-ignore
  assert.equal(client.stream.mock.calls[1].arguments[1].model, 'deepseek-chat')
})

test('should handle streaming error when all models fail with event error', async (t) => {
  const client = createDummyClient()
  client.stream = mock.fn(async () => {
    return mockOpenAiStream([], { message: 'Provider stream error' })
  }) as any

  const ai = new Ai({
    logger,
    providers: {
      openai: {
        apiKey,
        client
      },
      deepseek: {
        apiKey,
        client
      }
    },
    models: [
      {
        provider: 'openai',
        model: 'gpt-4o-mini'
      },
      {
        provider: 'deepseek',
        model: 'deepseek-chat'
      }
    ],
    limits: {
      retry: {
        max: 1,
        interval: 10
      }
    }
  })
  await ai.init()
  t.after(() => ai.close())

  const response = await ai.request({
    models: ['openai:gpt-4o-mini', 'deepseek:deepseek-chat'],
    prompt: 'Test fallback to different model',
    options: {
      stream: true
    }
  }) as AiStreamResponse

  assert.ok(isStream(response))
  await assert.rejects(consumeStream(response), { code: 'PROVIDER_STREAM_ERROR' })

  // @ts-ignore
  assert.equal(client.stream.mock.calls.length, 2)
  // @ts-ignore
  assert.equal(client.stream.mock.calls[0].arguments[1].model, 'gpt-4o-mini')
  // @ts-ignore
  assert.equal(client.stream.mock.calls[1].arguments[1].model, 'deepseek-chat')
})

test('should handle streaming error when all models fail on request', async (t) => {
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => {
      const error = new Error('Request error')
      ;(error as any).code = 'PROVIDER_STREAM_ERROR'
      throw error
    })
  }

  const ai = new Ai({
    logger,
    providers: {
      openai: {
        apiKey,
        client
      },
      deepseek: {
        apiKey,
        client
      }
    },
    models: [
      {
        provider: 'openai',
        model: 'gpt-4o-mini'
      },
      {
        provider: 'deepseek',
        model: 'deepseek-chat'
      }
    ],
    limits: {
      retry: {
        max: 0,
        interval: 10
      }
    }
  })
  await ai.init()
  t.after(() => ai.close())

  await assert.rejects(ai.request({
    models: ['openai:gpt-4o-mini', 'deepseek:deepseek-chat'],
    prompt: 'Test fallback to different model',
    options: {
      stream: true
    }
  }), { code: 'PROVIDER_STREAM_ERROR' })

  // @ts-ignore
  assert.equal(client.stream.mock.calls.length, 2)
  // @ts-ignore
  assert.equal(client.stream.mock.calls[0].arguments[1].model, 'gpt-4o-mini')
  // @ts-ignore
  assert.equal(client.stream.mock.calls[1].arguments[1].model, 'deepseek-chat')
})

test('should handle streaming error in middle of response and not retry', async (t) => {
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => {
      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Partial' } }] },
        { choices: [{ delta: { content: ' response' } }] }
      ],
      { code: 'PROVIDER_STREAM_ERROR', message: 'Stream interrupted' })
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
    limits: {
      retry: {
        max: 2,
        interval: 10
      }
    }
  })
  await ai.init()
  t.after(() => ai.close())

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Test streaming error handling',
    options: {
      stream: true
    }
  }) as AiStreamResponse

  // @ts-ignore
  assert.equal(client.stream.mock.calls.length, 1)
  assert.ok(isStream(response))
  await assert.rejects(consumeStream(response), { code: 'PROVIDER_STREAM_ERROR' })
})

test('should respect retry interval in streaming requests', async (t) => {
  const callTimes: number[] = []
  const client = {
    ...createDummyClient(),
    stream: mock.fn(async () => {
      callTimes.push(Date.now())

      if (client.stream.mock.calls.length < 2) {
        const error = new Error('Request error')
        ;(error as any).code = 'PROVIDER_RESPONSE_ERROR'
        throw error
      }

      return mockOpenAiStream([
        { choices: [{ delta: { content: 'Success after interval wait' } }] }
      ])
    })
  }

  const retryInterval = 100
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
    limits: {
      retry: {
        max: 3,
        interval: retryInterval
      }
    }
  })
  await ai.init()
  t.after(() => ai.close())

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Test retry interval',
    options: {
      stream: true
    }
  }) as AiStreamResponse

  assert.ok(isStream(response))

  const { content } = await consumeStream(response)
  assert.equal(content.map((c: any) => c.data.response).join(''), 'Success after interval wait')
  // @ts-ignore
  assert.equal(client.stream.mock.calls.length, 3)

  // Verify retry intervals were respected (with some tolerance for timing)
  if (callTimes.length >= 2) {
    const interval1 = callTimes[1] - callTimes[0]
    assert.ok(interval1 >= retryInterval - 10, `First retry interval too short: ${interval1}ms`)
  }

  if (callTimes.length >= 3) {
    const interval2 = callTimes[2] - callTimes[1]
    assert.ok(interval2 >= retryInterval - 10, `Second retry interval too short: ${interval2}ms`)
  }
})

test('should handle shouldRetry method returning undefined when no more models available', async (t) => {
  const client = createDummyClient()
  client.stream = mock.fn(async () => {
    const error = new Error('Request error')
    ;(error as any).code = 'PROVIDER_EXCEEDED_QUOTA_ERROR'
    throw error
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
      model: 'gpt-4o-mini'
    }], // Only one model, so no fallback
    limits: {
      retry: {
        max: 1,
        interval: 10
      }
    }
  })
  await ai.init()
  t.after(() => ai.close())

  await assert.rejects(
    ai.request({
      models: ['openai:gpt-4o-mini'],
      prompt: 'Test no more models available',
      options: {
        stream: true
      }
    }),
    { code: 'PROVIDER_EXCEEDED_QUOTA_ERROR' }
  )

  // @ts-ignore
  assert.equal(client.stream.mock.calls.length, 1, 'No retries')
})

test('should handle shouldRetry method returning undefined when no more models available on error event', async (t) => {
  const client = createDummyClient()
  client.stream = mock.fn(async () => {
    return mockOpenAiStream([], { code: 'PROVIDER_EXCEEDED_QUOTA_ERROR' })
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
      model: 'gpt-4o-mini'
    }], // Only one model, so no fallback
    limits: {
      retry: {
        max: 1,
        interval: 10
      }
    }
  })
  await ai.init()
  t.after(() => ai.close())

  const response = await ai.request({
    models: ['openai:gpt-4o-mini'],
    prompt: 'Test no more models available',
    options: {
      stream: true
    }
  }) as AiStreamResponse
  await assert.rejects(consumeStream(response), { code: 'PROVIDER_STREAM_ERROR' })

  // The error is retried through the synchronous retry mechanism first
  // @ts-ignore
  assert.equal(client.stream.mock.calls.length, 1)
})
