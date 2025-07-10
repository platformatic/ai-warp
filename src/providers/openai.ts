import { ReadableStream, type UnderlyingByteSource } from 'node:stream/web'
import undici from 'undici'
import type { AiProvider, ResponseResult } from '../lib/ai.ts'
import { type ChatHistory, type ProviderClient, type ProviderClientContext, type ProviderClientOptions, type ProviderOptions, type ProviderRequestOptions, type ProviderResponse, type StreamChunkCallback } from '../lib/provider.ts'
import { encodeEvent, parseEventStream, type AiStreamEvent } from '../lib/event.ts'
import { ProviderExceededQuotaError, ProviderResponseError, ProviderResponseNoContentError } from '../lib/errors.ts'
import { BaseProvider } from './base.ts'

// @see https://github.com/openai/openai-node
// @see https://platform.openai.com/docs/api-reference/chat/create

const DEFAULT_BASE_URL = 'https://api.openai.com'
const UNDICI_USER_AGENT = 'warp-dev/1.0.0'
const OPENAI_PATH = '/v1/chat/completions'

export type OpenAIOptions = ProviderOptions
export type OpenAIResponse = any // TODO fix types

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type OpenAIRequest = {
  model: string
  messages: OpenAIMessage[]
  temperature?: number
  max_tokens?: number
  stream?: boolean
}

const openaiUndiciClient: ProviderClient = {
  init: async (options: ProviderClientOptions | undefined, _context: ProviderClientContext): Promise<any> => {
    return {
      pool: new undici.Pool(options?.baseUrl ?? DEFAULT_BASE_URL, {
        pipelining: 2,
        // TODO undici client options
        // bodyTimeout
        // headersTimeout
      }),
      headers: {
        Authorization: `Bearer ${options?.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': UNDICI_USER_AGENT
      }
    }
  },
  close: async (client, _context: ProviderClientContext): Promise<void> => {
    client.pool.close()
  },
  request: async (client, request: OpenAIRequest, context: ProviderClientContext): Promise<any> => {
    context.logger.debug({ path: OPENAI_PATH, request }, 'OpenAI undici request')

    const response = await client.pool.request({
      path: OPENAI_PATH,
      method: 'POST',
      headers: client.headers,
      blocking: false,
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
        stream: false,
        n: 1,
      })
    })

    if (response.statusCode !== 200) {
      const errorText = await response.body.text()
      context.logger.error({ statusCode: response.statusCode, error: errorText }, 'OpenAI API response error')
      if (response.statusCode === 429) {
        throw new ProviderExceededQuotaError(`OpenAI Response: ${response.statusCode} - ${errorText}`)
      }
      throw new ProviderResponseError(`OpenAI Response: ${response.statusCode} - ${errorText}`)
    }

    const responseData = await response.body.json()
    context.logger.debug({ responseData }, 'OpenAI response received')

    return responseData
  },
  stream: async (client, request: OpenAIRequest, context: ProviderClientContext): Promise<ReadableStream> => { // TODO types
    context.logger.debug({ path: OPENAI_PATH, request }, 'OpenAI undici stream request')

    const response = await client.pool.request({
      path: OPENAI_PATH,
      method: 'POST',
      headers: client.headers,
      opaque: new ReadableStream(),
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        max_tokens: request.max_tokens,
        temperature: request.temperature,
        stream: true,
        n: 1,
      })
    })

    if (response.statusCode !== 200) {
      const errorText = await response.body.text()
      context.logger.error({ statusCode: response.statusCode, error: errorText }, 'OpenAI API error')
      if (response.statusCode === 429) {
        throw new ProviderExceededQuotaError(`OpenAI Response: ${response.statusCode} - ${errorText}`)
      }
      throw new ProviderResponseError(`OpenAI Response: ${response.statusCode} - ${errorText}`)
    }

    return response.body as ReadableStream
  }
}

export class OpenAIProvider extends BaseProvider {
  name: AiProvider = 'openai'

  constructor (options: OpenAIOptions, client?: ProviderClient) {
    super(options, client ?? openaiUndiciClient)
  }

  async request (model: string, prompt: string, options: ProviderRequestOptions): Promise<ProviderResponse> {
    const messages: OpenAIMessage[] = options.context ? [{ role: 'system', content: options.context }] : []
    messages.push(...this.chatHistoryToMessages(options.history))
    messages.push({ role: 'user', content: prompt })

    const request: OpenAIRequest = {
      model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: options.stream,
    }

    if (options.stream) {
      const response = await this.client.stream(this.api, request, this.context)

      return new ReadableStream(new OpenAiByteSource(response, options.onStreamChunk))
    }

    this.logger.debug({ request }, 'OpenaAI request')
    const response = await this.client.request(this.api, request, this.context)

    this.logger.debug({ response }, 'openai full response (no stream)')

    const text = response.choices?.[0]?.message?.content
    if (!text) {
      throw new ProviderResponseNoContentError('OpenAI')
    }

    return {
      text,
      result: mapResponseResult(response.choices?.[0]?.finish_reason)
    }
  }

  private chatHistoryToMessages (chatHistory?: ChatHistory): OpenAIMessage[] {
    if (chatHistory === undefined) {
      return []
    }

    const messages: OpenAIMessage[] = []
    for (const previousInteraction of chatHistory) {
      messages.push({ role: 'user', content: previousInteraction.prompt })
      messages.push({ role: 'assistant', content: previousInteraction.response })
    }

    return messages
  }
}

class OpenAiByteSource implements UnderlyingByteSource {
  type: 'bytes' = 'bytes'
  readable: ReadableStream
  chunkCallback?: StreamChunkCallback

  constructor (readable: ReadableStream, chunkCallback?: StreamChunkCallback) {
    this.readable = readable
    this.chunkCallback = chunkCallback
  }

  async start (controller: ReadableByteStreamController) {
    for await (const chunk of this.readable) {
      const events = parseEventStream(chunk.toString('utf8'))
      for (const event of events) {
        if (event.event === 'error') {
          const error = new ProviderResponseNoContentError('OpenAI stream')

          const eventData: AiStreamEvent = {
            event: 'error',
            data: error
          }
          controller.enqueue(encodeEvent(eventData))
          controller.close()

          return
        }

        // data only events
        if (!event.event && event.data) {
          if (event.data === '[DONE]') {
            return
          }

          const data = JSON.parse(event.data)
          const { content } = data.choices[0].delta
          let response = content ?? ''
          if (this.chunkCallback) {
            response = await this.chunkCallback(response)
          }

          const eventData: AiStreamEvent = {
            event: 'content',
            data: { response }
          }
          controller.enqueue(encodeEvent(eventData))

          const finish = data.choices[0].finish_reason
          if (finish) {
            const eventData: AiStreamEvent = {
              event: 'end',
              data: { response: mapResponseResult(finish) }
            }
            controller.enqueue(encodeEvent(eventData))
            controller.close()
            return
          }
        }
      }
    }
  }
}

function mapResponseResult (result: string | undefined): ResponseResult {
  // response is complete
  if (result === 'stop') {
    return 'COMPLETE'
  }
  // when the response is truncated because of maxTokens
  if (result === 'length') {
    return 'INCOMPLETE_MAX_TOKENS'
  }
  return 'INCOMPLETE_UNKNOWN'
}
