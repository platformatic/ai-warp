import type { AskOptions, ClientOptions, StreamMessage, AskResponse, Logger, AskResponseStream, AskResponseContent, AskResponseData } from './types.ts'
import { nullLogger } from './console-logger.ts'

const DEFAULT_PROMPT_PATH = '/api/v1/prompt'
const DEFAULT_STREAM_PATH = '/api/v1/stream'
const DEFAULT_TIMEOUT = 60_000

export class Client {
  private url: string
  private headers: Record<string, string>
  private timeout: number
  private logger: Logger
  private promptPath: string
  private streamPath: string
  private lastEventIds: Map<string, string> = new Map() // sessionId -> lastEventId

  constructor (options: ClientOptions) {
    this.url = options.url.endsWith('/') ? options.url.slice(0, -1) : options.url
    this.headers = {
      'Content-Type': 'application/json',
      ...options.headers
    }
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT
    this.logger = options.logger ?? nullLogger
    this.promptPath = options.promptPath ?? DEFAULT_PROMPT_PATH
    this.streamPath = options.streamPath ?? DEFAULT_STREAM_PATH
  }

  async ask (options: AskOptions & { stream: true }): Promise<AskResponseStream>
  async ask (options: AskOptions & { stream?: false }): Promise<AskResponseContent>
  async ask (options: AskOptions): Promise<AskResponseStream | AskResponseContent> {
    const isStreaming = options.stream !== false
    const endpoint = this.url + (isStreaming ? this.streamPath : this.promptPath)

    const shouldResume = isStreaming && options.resume !== false // Resume only applies to streaming
    let resumeEventId

    // Determine resumeEventId: explicit override, or from tracked events, or undefined
    // Only for streaming requests with sessionId
    if (shouldResume && options.sessionId) {
      resumeEventId = options.resumeEventId ?? this.lastEventIds.get(options.sessionId)
    }

    this.logger.debug('Making AI request', {
      endpoint,
      prompt: options.prompt,
      sessionId: options.sessionId,
      models: options.models,
      stream: isStreaming,
      resumeEventId
    })

    try {
      const requestBody: any = {
        prompt: options.prompt,
        sessionId: options.sessionId,
        context: options.context,
        temperature: options.temperature,
        models: options.models,
        history: options.history,
        stream: isStreaming
      }

      // Only include resume parameters for streaming requests
      if (isStreaming) {
        requestBody.resume = shouldResume

        // Include resumeEventId if we have one
        if (resumeEventId) {
          requestBody.resumeEventId = resumeEventId
        }
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          ...this.headers,
          Accept: isStreaming ? 'text/event-stream' : 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(this.timeout)
      })

      if (!response.ok) {
        const errorBody = await response.text()
        this.logger.error('AI request failed', { status: response.status, statusText: response.statusText, body: errorBody })
        throw new Error(`HTTP ${response.status}: ${errorBody}`)
      }

      this.logger.info('AI request successful', { status: response.status })

      if (isStreaming) {
        if (!response.body) {
          throw new Error('Response body is null')
        }

        // Extract sessionId from response if not provided in options
        // ai-provider always includes sessionId in response headers
        const responseSessionId = options.sessionId || response.headers.get('x-session-id') || undefined

        const webStream = this.createStreamFromResponse(response.body, responseSessionId)
        return {
          stream: this.createAsyncIterableStream(webStream, responseSessionId, options),
          headers: response.headers
        }
      } else {
        const content = await response.json() as AskResponseData

        // For non-streaming, sessionId is in the content, but we don't need it for event tracking
        // since resume only works with streaming
        return {
          content,
          headers: response.headers
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'TimeoutError') {
          this.logger.warn('AI request timed out', { timeout: this.timeout })
          throw new Error('Request timeout')
        }
        this.logger.error('AI request error', { error: error.message, stack: error.stack })
        throw error
      }
      this.logger.error('Unknown AI request error', { error: String(error) })
      throw new Error('Unknown error occurred')
    }
  }

  private createStreamFromResponse (body: ReadableStream<Uint8Array>, sessionId?: string): ReadableStream<StreamMessage> {
    let buffer = ''

    return body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(
        new TransformStream<string, StreamMessage>({
          transform: (chunk, controller) => {
            buffer += chunk

            const events = buffer.split('\n\n')
            buffer = events.pop() || ''

            for (const eventText of events) {
              if (eventText.trim()) {
                const event = parseEvent(eventText)
                if (event) {
                  // Track event ID for this session
                  if (event.id && sessionId) {
                    this.lastEventIds.set(sessionId, event.id)
                  }

                  const message = convertEventToMessage(event)
                  if (message) {
                    controller.enqueue(message)
                  }
                }
              }
            }
          },
          flush: (controller) => {
            if (buffer.trim()) {
              const event = parseEvent(buffer)
              if (event) {
                // Track event ID for this session
                if (event.id && sessionId) {
                  this.lastEventIds.set(sessionId, event.id)
                }

                const message = convertEventToMessage(event)
                if (message) {
                  controller.enqueue(message)
                }
              }
            }
          }
        })
      )
  }

  private createAsyncIterableStream (stream: ReadableStream<StreamMessage>, sessionId?: string, originalOptions?: AskOptions) {
    const reader = stream.getReader()

    return {
      [Symbol.asyncIterator]: async function * (this: Client) {
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            if (value) {
              // Handle event: error - automatically retry with resume
              if (value.type === 'error') {
                this.logger.debug('Stream error event received, attempting automatic resume', {
                  sessionId,
                  error: value.error?.message
                })

                // Only auto-resume if we have sessionId and streaming was enabled
                if (sessionId && originalOptions && originalOptions.stream !== false) {
                  try {
                    // Retry the request with the same sessionId to trigger resume
                    const resumeOptions = {
                      ...originalOptions,
                      sessionId,
                      stream: true as const,
                      resume: true // Explicit resume
                    }

                    this.logger.debug('Attempting resume after stream error', { sessionId })
                    const resumeResponse = await this.ask(resumeOptions)

                    // Yield all messages from the resumed stream
                    for await (const resumeMessage of resumeResponse.stream) {
                      yield resumeMessage
                    }
                    return // Exit the original stream since we've resumed
                  } catch (resumeError) {
                    this.logger.error('Failed to auto-resume after stream error', {
                      sessionId,
                      originalError: value.error?.message,
                      resumeError: resumeError instanceof Error ? resumeError.message : String(resumeError)
                    })
                    // Fall through to yield the original error
                  }
                }
              }

              yield value
            }
          }
        } finally {
          reader.releaseLock()
        }
      }.bind(this)
    }
  }
}

interface ParsedEvent {
  event?: string
  data?: string
  id?: string
}

interface SSEContentData {
  response?: string
}

interface SSEEndData {
  response: AskResponse
}

interface SSEErrorData {
  message?: string
  error?: string
}

interface SSEResponseData {
  response?: string | {
    content?: string
    model?: string
    sessionId?: string
  }
  content?: string
  error?: string
  message?: string
}

type SSEData = SSEContentData | SSEEndData | SSEErrorData | SSEResponseData

function parseEvent (eventText: string): ParsedEvent | null {
  const lines = eventText.split('\n')
  const event: ParsedEvent = {}

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      event.event = line.slice(7).trim()
    } else if (line.startsWith('data: ')) {
      event.data = line.slice(6).trim()
    } else if (line.startsWith('id: ')) {
      event.id = line.slice(4).trim()
    }
  }

  return (event.event || event.data) ? event : null
}

function convertEventToMessage (event: ParsedEvent): StreamMessage | null {
  if (!event.data) {
    return null
  }

  let data: SSEData | string
  let isPlainText = false

  try {
    data = JSON.parse(event.data) as SSEData
  } catch {
    isPlainText = true
    data = event.data.trim()
  }

  if (isPlainText) {
    return {
      type: 'content',
      content: data as string
    }
  }

  // Type guard to ensure data is an object
  if (typeof data !== 'object' || !data) {
    return null
  }

  const sseData = data as SSEData

  if (event.event) {
    switch (event.event) {
      case 'content':
        return {
          type: 'content',
          content: (sseData as SSEContentData).response || ''
        }

      case 'end':
        return {
          type: 'done',
          response: (sseData as SSEEndData).response
        }

      case 'error':
        return {
          type: 'error',
          error: new Error((sseData as SSEErrorData).message || 'Unknown error')
        }

      default:
        return null
    }
  } else {
    const responseData = sseData as SSEResponseData
    if (responseData.error || responseData.message) {
      return {
        type: 'error',
        error: new Error(responseData.error || responseData.message || 'Unknown error')
      }
    } else if (responseData.response) {
      if (typeof responseData.response === 'object' && (responseData.response.model || responseData.response.sessionId)) {
        return {
          type: 'done',
          response: responseData.response as AskResponse
        }
      } else {
        return {
          type: 'content',
          content: typeof responseData.response === 'string' ? responseData.response : responseData.response.content || ''
        }
      }
    } else if (responseData.content) {
      return {
        type: 'content',
        content: responseData.content
      }
    }
    return null
  }
}
