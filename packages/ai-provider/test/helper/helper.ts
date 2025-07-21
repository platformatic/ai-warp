import { Readable } from 'node:stream'
import { Ai, createModelState, type AiProvider, type ModelStateErrorReason, type ModelStatus, type ProviderState } from '../../src/lib/ai.ts'

export function createDummyClient () {
  return {
    init: async (_options: any, _context: any) => ({}),
    close: async (_api: any, _context: any) => {},
    request: async (_api: any, _request: any, _context: any) => ({}),
    stream: async (_api: any, _request: any, _context: any) => ({})
  }
}

// Mock the readable stream to emit chunks that will result in 'All good'
export function mockOpenAiStream (chunks: any[]) {
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
        await new Promise(resolve => setTimeout(resolve, 10))
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

export async function consumeStream (response: Readable) {
  const content: string[] = []
  let end: string = ''

  return new Promise((resolve, reject) => {
    // The response is a Readable stream that emits Server-sent events
    response.on('data', (chunk: Buffer) => {
      const eventData = chunk.toString('utf8')
      // Parse Server-sent events format
      const lines = eventData.split('\n')

      let currentEvent: string | null = null
      let currentData: string | null = null

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.substring(7).trim()
        } else if (line.startsWith('data: ')) {
          currentData = line.substring(6).trim()
        } else if (line === '' && currentEvent && currentData) {
          // End of event, parse the data
          try {
            const parsedData = JSON.parse(currentData)
            if (currentEvent === 'content') {
              content.push(parsedData.response)
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
      resolve({ content, end })
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
