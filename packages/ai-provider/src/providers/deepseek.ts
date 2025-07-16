import type { AiProvider } from '../lib/ai.ts'
import { DEEPSEEK_DEFAULT_API_PATH, DEEPSEEK_DEFAULT_BASE_URL, DEEPSEEK_PROVIDER_NAME, DEFAULT_UNDICI_POOL_OPTIONS, UNDICI_USER_AGENT } from '../lib/config.ts'
import { ProviderExceededQuotaError, ProviderResponseError } from '../lib/errors.ts'
import type { ProviderClient, ProviderClientContext } from '../lib/provider.ts'
import { createOpenAiClient } from './lib/openai-undici-client.ts'
import { OpenAIProvider, type OpenAIOptions } from './openai.ts'

// DeepSeek implementation is based on the OpenAI implementation

// @see https://api-docs.deepseek.com/

// rate limit: disabled, but check empty response
// https://api-docs.deepseek.com/quick_start/rate_limit

// errors
// https://api-docs.deepseek.com/quick_start/error_codes

export class DeepSeekProvider extends OpenAIProvider {
  name: AiProvider = 'deepseek'
  providerName: string = DEEPSEEK_PROVIDER_NAME

  constructor (options: OpenAIOptions, client?: ProviderClient) {
    super(options, client ?? createOpenAiClient({
      providerName: DEEPSEEK_PROVIDER_NAME,
      baseUrl: options.clientOptions?.baseUrl ?? DEEPSEEK_DEFAULT_BASE_URL,
      apiPath: options.clientOptions?.apiPath ?? DEEPSEEK_DEFAULT_API_PATH,
      apiKey: options.clientOptions?.apiKey ?? '',
      userAgent: options.clientOptions?.userAgent ?? UNDICI_USER_AGENT,
      undiciOptions: options.clientOptions?.undiciOptions ?? DEFAULT_UNDICI_POOL_OPTIONS,

      checkResponseFn: checkResponse
    }))
  }
}

async function checkResponse (response: any, context: ProviderClientContext, providerName: string) {
  if (response.statusCode !== 200) {
    const errorText = await response.body.text()
    context.logger.error({ statusCode: response.statusCode, error: errorText }, `${providerName} API response error`)
    if (response.statusCode === 429 || // Rate Limit Reached
        response.statusCode === 402 // Insufficient Balance
    ) {
      throw new ProviderExceededQuotaError(`${providerName} Response: ${response.statusCode} - ${errorText}`)
    }
    throw new ProviderResponseError(`${providerName} Response: ${response.statusCode} - ${errorText}`)
  }
}
