import undici from 'undici'
import { Readable } from 'node:stream'
import { OptionError, ProviderExceededQuotaError, ProviderResponseError } from '../../lib/errors.ts'
import type { ProviderClient, ProviderClientContext, ProviderClientOptions } from '../../lib/provider.ts'
import type { OpenAiClientOptions, OpenAIRequest } from '../openai.ts'

async function checkResponse (response: any, context: ProviderClientContext, providerName: string) {
  if (response.statusCode !== 200) {
    const errorText = await response.body.text()
    context.logger.error({ statusCode: response.statusCode, error: errorText }, `${providerName} API response error`)
    if (response.statusCode === 429) {
      throw new ProviderExceededQuotaError(`${providerName} Response: ${response.statusCode} - ${errorText}`)
    }
    throw new ProviderResponseError(`${providerName} Response: ${response.statusCode} - ${errorText}`)
  }
}

export function createOpenAiClient (options: OpenAiClientOptions) {
  // TODO validate options
  if (!options.apiKey) {
    throw new OptionError(`${options.providerName} apiKey is required`)
  }

  const { providerName, baseUrl, apiKey, userAgent, apiPath, undiciOptions } = options

  const checkResponseFn = options.checkResponseFn ?? checkResponse

  const openaiUndiciClient: ProviderClient = {
    init: async (_options: ProviderClientOptions | undefined, _context: ProviderClientContext): Promise<any> => {
      return {
        pool: new undici.Pool(baseUrl, undiciOptions),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': userAgent
        }
      }
    },
    close: async (client, _context: ProviderClientContext): Promise<void> => {
      client.pool.close()
    },
    request: async (client, request: OpenAIRequest, context: ProviderClientContext): Promise<any> => {
      context.logger.debug({ path: apiPath, request }, `${providerName} undici request`)

      const response = await client.pool.request({
        path: apiPath,
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

      await checkResponseFn(response, context, providerName)

      const responseData = await response.body.json()
      context.logger.debug({ responseData }, `${providerName} response received`)

      return responseData
    },
    stream: async (client, request: OpenAIRequest, context: ProviderClientContext): Promise<Readable> => { // TODO types
      context.logger.debug({ path: apiPath, request }, 'OpenAI undici stream request')

      const response = await client.pool.request({
        path: apiPath,
        method: 'POST',
        headers: client.headers,
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          max_tokens: request.max_tokens,
          temperature: request.temperature,
          stream: true,
          n: 1,
        })
      })

      await checkResponseFn(response, context, providerName)

      return response.body as Readable
    }
  }

  return openaiUndiciClient
}
