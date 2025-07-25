import { Pool } from 'undici'
import { Readable, Transform, pipeline } from 'node:stream'
import { promisify } from 'node:util'
import type { AiProvider, AiResponseResult } from '../lib/ai.ts'
import { type ProviderClient, type ProviderClientContext, type ProviderClientOptions, type ProviderOptions, type ProviderRequestOptions, type ProviderResponse, type StreamChunkCallback } from '../lib/provider.ts'
import { createEventId, encodeEvent, parseEventStream, type AiStreamEvent } from '../lib/event.ts'
import { OptionError, ProviderExceededQuotaError, ProviderResponseError, ProviderResponseMaxTokensError, ProviderResponseNoContentError } from '../lib/errors.ts'
import { BaseProvider } from './lib/base.ts'
import { DEFAULT_UNDICI_POOL_OPTIONS, GEMINI_DEFAULT_BASE_URL, GEMINI_PROVIDER_NAME, UNDICI_USER_AGENT } from '../lib/config.ts'

// @see https://ai.google.dev/gemini-api/docs/text-generation?lang=rest
// @see https://ai.google.dev/api/all-methods

export type GeminiOptions = ProviderOptions

export type GeminiPart = {
  text: string
}

export type GeminiContent = {
  role?: 'user' | 'model'
  parts: GeminiPart[]
}

export type GeminiGenerationConfig = {
  temperature?: number
  maxOutputTokens?: number
  stopSequences?: string[]
  topK?: number
  topP?: number
}

export type GeminiRequest = {
  contents: GeminiContent[]
  generationConfig?: GeminiGenerationConfig
  systemInstruction?: {
    parts: GeminiPart[]
  }
}

export type GeminiCandidate = {
  content: GeminiContent
  finishReason?: string
  index?: number
}

export type GeminiResponse = {
  candidates: GeminiCandidate[]
  promptFeedback?: any
  usageMetadata?: any
}

export type GeminiClientOptions = ProviderClientOptions & {
  baseUrl: string
  apiKey: string
  userAgent: string
  providerName: string
  undiciOptions?: Pool.Options
}

async function checkResponse (response: any, context: ProviderClientContext, providerName: string, stream: boolean): Promise<GeminiResponse | undefined> {
  if (response.statusCode !== 200) {
    const errorText = await response.body.text()
    context.logger.error({ statusCode: response.statusCode, error: errorText }, `${providerName} API response error`)
    if (response.statusCode === 429) {
      throw new ProviderExceededQuotaError(`${providerName} Response: ${response.statusCode} - ${errorText}`)
    }
    throw new ProviderResponseError(`${providerName} Response: ${response.statusCode} - ${errorText}`)
  }

  if (stream) {
    return
  }

  const responseText = await response.body.text()
  const responseData = JSON.parse(responseText)

  if (responseData.error) {
    throw new ProviderResponseError(`${providerName} API error: ${responseData.error.message}`)
  }

  return responseData
}

function createGeminiClient (options: GeminiClientOptions): ProviderClient {
  return {
    async init (clientOptions: ProviderClientOptions | undefined, context: ProviderClientContext): Promise<any> {
      const baseUrl = clientOptions?.baseUrl ?? options.baseUrl
      const userAgent = clientOptions?.userAgent ?? options.userAgent
      const undiciOptions = clientOptions?.undiciOptions ?? options.undiciOptions
      const apiKey = clientOptions?.apiKey ?? options.apiKey

      if (!apiKey) {
        throw new OptionError('Gemini API key is required')
      }

      const pool = new Pool(baseUrl, undiciOptions)

      context.logger.debug({ baseUrl, userAgent }, `${options.providerName} client initialized`)

      return {
        pool,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': userAgent,
          'x-goog-api-key': apiKey,
        }
      }
    },

    async close (client: any, context: ProviderClientContext): Promise<void> {
      if (client?.pool) {
        await client.pool.close()
        context.logger.debug(`${options.providerName} client closed`)
      }
    },

    async request (client: any, params: { model: string; request: GeminiRequest }, context: ProviderClientContext): Promise<GeminiResponse> {
      const { model, request } = params
      const path = `/v1beta/models/${model}:generateContent`

      const response = await client.pool.request({
        method: 'POST',
        path,
        headers: client.headers,
        body: JSON.stringify(request),
      })

      const responseData = await checkResponse(response, context, options.providerName, false)
      context.logger.debug({ responseData }, `${options.providerName} response received`)

      return responseData as GeminiResponse
    },

    async stream (client: any, params: { model: string; request: GeminiRequest; stream: boolean }, context: ProviderClientContext): Promise<Readable> {
      const { model, request } = params
      const path = `/v1beta/models/${model}:streamGenerateContent?alt=sse`

      const response = await client.pool.request({
        method: 'POST',
        path,
        headers: client.headers,
        body: JSON.stringify(request),
      })

      await checkResponse(response, context, options.providerName, true)

      return response.body as Readable
    }
  }
}

export class GeminiProvider extends BaseProvider {
  name: AiProvider = 'gemini'
  providerName: string = GEMINI_PROVIDER_NAME

  constructor (options: GeminiOptions, client?: ProviderClient) {
    super(options, client ?? createGeminiClient({
      providerName: GEMINI_PROVIDER_NAME,
      baseUrl: options.clientOptions?.baseUrl ?? GEMINI_DEFAULT_BASE_URL,
      apiKey: options.clientOptions?.apiKey ?? '',
      userAgent: options.clientOptions?.userAgent ?? UNDICI_USER_AGENT,
      undiciOptions: options.clientOptions?.undiciOptions ?? DEFAULT_UNDICI_POOL_OPTIONS,
    }))
  }

  async request (model: string, prompt: string, options: ProviderRequestOptions): Promise<ProviderResponse> {
    const contents: GeminiContent[] = []

    // Add chat history
    if (options.history) {
      for (const previousInteraction of options.history) {
        contents.push({ role: 'user', parts: [{ text: previousInteraction.prompt }] })
        contents.push({ role: 'model', parts: [{ text: previousInteraction.response }] })
      }
    }

    // Add current user prompt
    contents.push({ role: 'user', parts: [{ text: prompt }] })

    const request: GeminiRequest = {
      contents,
    }

    // Add system instruction if context is provided
    if (options.context) {
      request.systemInstruction = {
        parts: [{ text: options.context }]
      }
    }

    // Add generation config if options are provided
    if (options.temperature !== undefined || options.maxTokens !== undefined) {
      request.generationConfig = {}
      if (options.temperature !== undefined) {
        request.generationConfig.temperature = options.temperature
      }
      if (options.maxTokens !== undefined) {
        request.generationConfig.maxOutputTokens = options.maxTokens
      }
    }

    if (options.stream) {
      const response = await this.client.stream(this.api, { model, request, stream: true }, this.context)
      const transformer = new GeminiStreamTransformer(this.providerName, options.onStreamChunk)

      // Use pipeline to connect the response stream to the transformer
      const pipelineAsync = promisify(pipeline)

      // Create the pipeline but don't await it - return the transformer stream
      pipelineAsync(response, transformer).catch((err) => {
        // Handle pipeline errors by destroying the transformer
        transformer.destroy(err)
      })

      return transformer
    }

    this.logger.debug({ request }, `${this.providerName} request`)
    const response = await this.client.request(this.api, { model, request }, this.context)

    this.logger.debug({ response }, `${this.providerName} full response (no stream)`)

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text
    const result = mapResponseResult(response.candidates?.[0]?.finishReason)

    if (!text && result === 'COMPLETE') {
      throw new ProviderResponseNoContentError(this.providerName)
    }

    if (!text && result === 'INCOMPLETE_MAX_TOKENS') {
      throw new ProviderResponseMaxTokensError(this.providerName)
    }

    return {
      text,
      result
    }
  }
}

class GeminiStreamTransformer extends Transform {
  providerName: string
  chunkCallback?: StreamChunkCallback

  constructor (providerName: string, chunkCallback?: StreamChunkCallback) {
    super()
    this.providerName = providerName
    this.chunkCallback = chunkCallback
  }

  async _transform (chunk: Buffer, _encoding: string, callback: (error?: Error | null, data?: any) => void) {
    try {
      const events = parseEventStream(chunk.toString('utf8'))
      for (const event of events) {
        if (event.event === 'error') {
          const error = new ProviderResponseNoContentError(`${this.providerName} stream`)

          const eventData: AiStreamEvent = {
            id: event.id ?? createEventId(),
            event: 'error',
            data: error
          }
          this.push(encodeEvent(eventData))
          return callback()
        }

        // data only events
        if (!event.event && event.data) {
          if (event.data === '[DONE]') {
            return callback()
          }

          const data = JSON.parse(event.data)
          const content = data.candidates?.[0]?.content?.parts?.[0]?.text
          let response = content ?? ''
          if (this.chunkCallback) {
            response = await this.chunkCallback(response)
          }

          const eventData: AiStreamEvent = {
            id: event.id ?? createEventId(),
            event: 'content',
            data: { response }
          }
          this.push(encodeEvent(eventData))

          const finish = data.candidates?.[0]?.finishReason
          if (finish) {
            const eventData: AiStreamEvent = {
              id: event.id ?? createEventId(),
              event: 'end',
              data: { response: mapResponseResult(finish) }
            }
            this.push(encodeEvent(eventData))
            return callback()
          }
        }
      }
      callback()
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)))
    }
  }
}

function mapResponseResult (result: string | undefined): AiResponseResult {
  // response is complete
  if (result === 'STOP') {
    return 'COMPLETE'
  }
  // when the response is truncated because of maxTokens
  if (result === 'MAX_TOKENS') {
    return 'INCOMPLETE_MAX_TOKENS'
  }
  // other finish reasons like SAFETY, RECITATION, etc.
  if (result === 'SAFETY' || result === 'RECITATION' || result === 'OTHER') {
    return 'INCOMPLETE_UNKNOWN'
  }
  return 'INCOMPLETE_UNKNOWN'
}
