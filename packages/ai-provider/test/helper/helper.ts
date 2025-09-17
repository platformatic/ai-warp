import { test } from 'node:test'
import pino from 'pino'
import { Readable } from 'node:stream'
import { setTimeout as wait } from 'node:timers/promises'
import { Ai, createModelState, type AiProvider, type ModelStateErrorReason, type ModelStatus, type ProviderState } from '../../src/lib/ai.ts'
import type { AiStorageOptions } from '../../src/index.ts'

export const storages = [
  {
    type: 'memory' as const,
  },
  {
    type: 'valkey' as const,
    valkey: {
      host: 'localhost',
      port: 6379,
      database: 0,
      username: 'default',
      password: 'password'
    }
  }
]

export function createDummyClient () {
  return {
    init: async (_options: any, _context: any) => ({}),
    close: async (_api: any, _context: any) => {},
    request: async (_api: any, _request: any, _context: any) => ({}),
    stream: async (_api: any, _request: any, _context: any) => ({})
  }
}

export async function createAi ({ t, client, storage }: { t: test.TestContext, client?: ReturnType<typeof createDummyClient>, storage?: AiStorageOptions }) {
  const c = client ?? createDummyClient()

  const ai = new Ai({
    logger: pino({ level: 'silent' }),
    providers: {
      openai: {
        apiKey: 'test',
        client: c
      }
    },
    models: [
      {
        provider: 'openai',
        model: 'gpt-4o-mini' + Date.now()
      }
    ],
    storage
  })

  await ai.init()
  t.after(() => ai.close())

  return ai
}

// Mock the readable stream to emit chunks that will result in 'All good'
export function mockOpenAiStream (chunks: any[], error?: any) {
  let chunkIndex = 0

  const readable = new Readable({
    read () {
      // No-op: data is pushed from async iteration
    }
  })

  // Simulate async streaming by pushing chunks
  const pushChunks = async () => {
    try {
      while (chunkIndex < chunks.length) {
        const chunk = chunks[chunkIndex++]
        // Send in OpenAI stream format - raw data lines
        const data = `data: ${JSON.stringify(chunk)}\n\n`
        readable.push(Buffer.from(data))

        // Small delay to simulate streaming
        await wait(10)
      }
      if (error) {
        const data = `event: error\ndata: ${JSON.stringify(error)}\n\n`
        readable.push(Buffer.from(data))

        // Small delay to simulate streaming
        await wait(10)
      }
      // Send [DONE] to end the stream
      readable.push(Buffer.from('data: [DONE]\n\n'))
      readable.push(null) // End the stream
    } catch (error) {
      readable.destroy(error)
    }
  }

  // Start pushing chunks asynchronously
  setImmediate(() => pushChunks())

  return readable
}

// Mock Gemini stream helper function
export function mockGeminiStream (chunks: any[], error?: any) {
  let chunkIndex = 0

  const readable = new Readable({
    read () {
      // No-op: data is pushed from async iteration
    }
  })

  // Simulate async streaming by pushing chunks
  const pushChunks = async () => {
    try {
      while (chunkIndex < chunks.length) {
        const chunk = chunks[chunkIndex++]
        // Send in Gemini stream format - raw data lines
        const data = `data: ${JSON.stringify(chunk)}\n\n`
        readable.push(Buffer.from(data))

        // Small delay to simulate streaming
        await wait(10)
      }
      if (error) {
        const data = `event: error\ndata: ${JSON.stringify(error)}\n\n`
        readable.push(Buffer.from(data))

        // Small delay to simulate streaming
        await wait(10)
      }
      // Send [DONE] to end the stream
      readable.push(Buffer.from('data: [DONE]\n\n'))
      readable.push(null) // End the stream
    } catch (error) {
      readable.destroy(error)
    }
  }

  // Start pushing chunks asynchronously
  setImmediate(() => pushChunks())

  return readable
}

export async function consumeStream (response: Readable): Promise<{ content: Object[], end: string, chunks: number }> {
  const content: Object[] = []
  let end: string = ''
  let chunks = 0
  return new Promise((resolve, reject) => {
    // The response is a Readable stream that emits Server-sent events
    response.on('data', (chunk: Buffer) => {
      const eventData = chunk.toString('utf8')
      chunks++

      // Parse Server-sent events format
      const lines = eventData.split('\n')

      let currentEvent: string | null = null
      let currentId: string | null = null
      let currentData: string | null = null

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.substring(7).trim()
        } else if (line.startsWith('id: ')) {
          currentId = line.substring(4).trim()
        } else if (line.startsWith('data: ')) {
          currentData = line.substring(6).trim()
        } else if (line === '' && currentEvent && currentData) {
          // End of event, parse the data
          try {
            const parsedData = JSON.parse(currentData)
            if (currentEvent === 'content') {
              content.push({ id: currentId, event: currentEvent, data: parsedData })
            } else if (currentEvent === 'end') {
              end = parsedData.response
            }
          } catch {
            // Ignore parsing errors
          }

          // Reset for next event
          currentEvent = null
          currentData = null
        }
      }
    })

    response.on('end', () => {
      resolve({ content, end, chunks })
    })

    response.on('error', (error) => {
      reject(error)
    })
  })
}

export async function setModelState ({
  ai,
  provider,
  model,
  status,
  reason,
  timestamp,
  rateLimit,
}: {
  ai: Ai
  provider: AiProvider
  model: string
  status: ModelStatus
  reason?: ModelStateErrorReason
  timestamp?: number
  rateLimit?: { count: number, windowStart: number }
}) {
  const providerState: ProviderState = ai.providers.get(provider)!
  const restoredModelState = (await ai.getModelState(model, providerState)) ?? createModelState(model)
  restoredModelState.state.status = status
  restoredModelState.state.reason = reason ?? 'NONE'
  restoredModelState.state.timestamp = timestamp || Date.now()
  restoredModelState.rateLimit = rateLimit ?? { count: 0, windowStart: 0 }
  await ai.setModelState(model, providerState, restoredModelState, timestamp || Date.now())
}
