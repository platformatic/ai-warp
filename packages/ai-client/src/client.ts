import type { AIClient, AskOptions, ClientOptions, StreamMessage, AskResponse } from './types.ts'
import { pipeline } from 'node:stream/promises'
import { Transform, Readable } from 'node:stream'
import split2 from 'split2'

export class Client implements AIClient {
  private url: string
  private headers: Record<string, string>
  private timeout: number

  constructor (options: ClientOptions) {
    this.url = options.url.endsWith('/') ? options.url.slice(0, -1) : options.url
    this.headers = {
      'Content-Type': 'application/json',
      ...options.headers
    }
    this.timeout = options.timeout ?? 60000
  }

  async ask (options: AskOptions): Promise<AsyncIterable<StreamMessage>> {
    const endpoint = `${this.url}/ai`

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          ...this.headers,
          Accept: 'text/event-stream'
        },
        body: JSON.stringify({
          prompt: options.prompt,
          sessionId: options.sessionId,
          context: options.context,
          temperature: options.temperature,
          model: options.model,
          messages: options.messages,
          stream: options.stream !== false
        }),
        signal: AbortSignal.timeout(this.timeout)
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`HTTP ${response.status}: ${errorBody}`)
      }

      if (!response.body) {
        throw new Error('Response body is null')
      }

      return this.createStreamFromResponse(response.body)
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'TimeoutError') {
          throw new Error('Request timeout')
        }
        throw error
      }
      throw new Error('Unknown error occurred')
    }
  }

  private createStreamFromResponse (body: ReadableStream<Uint8Array>): AsyncIterable<StreamMessage> {
    async function * parseAIMessages (source: AsyncIterable<string>): AsyncGenerator<StreamMessage> {
      for await (const eventText of source) {
        if (eventText.trim()) {
          const event = parseEvent(eventText)
          if (event) {
            const message = convertEventToMessage(event)
            if (message) yield message
          }
        }
      }
    }

    const streamTransform = Transform.from(parseAIMessages)
    const nodeReadable = Readable.fromWeb(body)

    pipeline(nodeReadable, split2('\n\n'), streamTransform).catch(err => {
      console.error('Pipeline error:', err)
    })

    return streamTransform
  }

  async close (): Promise<void> {
  }
}

interface ParsedEvent {
  event?: string
  data?: string
}

function parseEvent (eventText: string): ParsedEvent | null {
  const lines = eventText.split('\n')
  const event: ParsedEvent = {}

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      event.event = line.slice(7).trim()
    } else if (line.startsWith('data: ')) {
      event.data = line.slice(6).trim()
    }
  }

  return (event.event || event.data) ? event : null
}

function convertEventToMessage (event: ParsedEvent): StreamMessage | null {
  if (!event.event || !event.data) {
    return null
  }

  try {
    const data = JSON.parse(event.data)

    switch (event.event) {
      case 'content':
        return {
          type: 'content',
          content: data.response || ''
        }

      case 'end':
        return {
          type: 'done',
          response: data.response as AskResponse
        }

      case 'error':
        return {
          type: 'error',
          error: new Error(data.message || 'Unknown error')
        }

      default:
        return null
    }
  } catch (error) {
    console.error('Failed to parse event data:', event.data, error)
    return null
  }
}
