import { ReadableStream, type UnderlyingByteSource, ReadableByteStreamController } from 'node:stream/web'
import { ReadableStream as ReadableStreamPolyfill } from 'web-streams-polyfill'
import { type ChatCompletionChunk } from 'openai/resources/index'
import OpenAI from 'openai'
import type { AiProvider } from '../lib/ai.ts'
import { InvalidTypeError, NoContentError, type ProviderClient, type ProviderRequestOptions, type ProviderResponse, type StreamChunkCallback } from '../lib/provider.ts'
import { encodeEvent, type AiStreamEvent } from '../lib/event.ts'

// @see https://github.com/openai/openai-node
// @see https://platform.openai.com/docs/api-reference/chat/create

export type OpenAIOptions = {
  // TODO logger
  apiKey: string
  baseURL?: string
}

type OpenAIRequestOptions = ProviderRequestOptions

// TODO implements Provider interface
export class OpenAIProvider {
  name: AiProvider = 'openai'

  client: ProviderClient

  constructor (options: OpenAIOptions, client?: ProviderClient) {
    if (client) {
      // for testing
      this.client = client
    } else {
      this.client = new OpenAI({
        apiKey: options.apiKey,
      // TODO baseURL: options.baseURL
      })
    }
  }

  async request (model: string, prompt: string, options: OpenAIRequestOptions): Promise<ProviderResponse> {
    // TODO history

    const messages = options.context
      ? [
          { role: 'system', content: options.context },
          { role: 'user', content: prompt }
        ]
      : [{ role: 'user', content: prompt }]

    const request = {
      model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: options.stream,
    }

    if (options.stream) {
      const response = await this.client.chat.completions.create(request)
      console.log('response', response)
      return new ReadableStream(new OpenAiByteSource(response.toReadableStream() as ReadableStreamPolyfill, options.onStreamChunk))
    }

    const response = await this.client.chat.completions.create(request)

    // logger.debug response
    // console.dir(response, { depth: null })

    return {
      text: response.choices[0].message.content
    }
  }
}

class OpenAiByteSource implements UnderlyingByteSource {
  type: 'bytes' = 'bytes'
  polyfillStream: ReadableStreamPolyfill
  reader?: ReadableStreamDefaultReader
  chunkCallback?: StreamChunkCallback

  constructor (polyfillStream: ReadableStreamPolyfill, chunkCallback?: StreamChunkCallback) {
    this.polyfillStream = polyfillStream
    this.chunkCallback = chunkCallback
  }

  start (): void {
    this.reader = this.polyfillStream.getReader()
  }

  async pull (controller: ReadableByteStreamController): Promise<void> {
    // start() defines this.reader and is called before this

    const { done, value } = await this.reader!.read()

    if (done !== undefined && done) {
      controller.close()
      return
    }

    if (!(value instanceof Uint8Array)) {
      // This really shouldn't happen but just in case + typescript likes
      const error = new InvalidTypeError('OpenAI stream value not a Uint8Array')

      const eventData: AiStreamEvent = {
        event: 'error',
        data: error
      }
      controller.enqueue(encodeEvent(eventData))
      controller.close()

      return
    }

    const jsonString = Buffer.from(value).toString('utf8')
    const chunk: ChatCompletionChunk = JSON.parse(jsonString)

    if (chunk.choices.length === 0) {
      const error = new NoContentError('OpenAI stream')

      const eventData: AiStreamEvent = {
        event: 'error',
        data: error
      }
      controller.enqueue(encodeEvent(eventData))
      controller.close()

      return
    }

    const { content } = chunk.choices[0].delta

    let response = content ?? ''
    if (this.chunkCallback !== undefined) {
      response = await this.chunkCallback(response)
    }

    const eventData: AiStreamEvent = {
      event: 'content',
      data: {
        response
      }
    }
    controller.enqueue(encodeEvent(eventData))
  }
}
