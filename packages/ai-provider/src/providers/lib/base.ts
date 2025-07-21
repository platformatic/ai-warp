import type { Logger } from 'pino'
import type { AiProvider } from '../../lib/ai.ts'
import type { ProviderClient, ProviderClientContext, ProviderOptions, ProviderRequestOptions, ProviderResponse } from '../../lib/provider.ts'

export class BaseProvider {
  // @ts-expect-error
  protected name: AiProvider
  options: ProviderOptions
  logger: Logger

  client: ProviderClient
  protected context: ProviderClientContext
  protected api: any

  constructor (options: ProviderOptions, client: ProviderClient) {
    this.options = this.validateOptions(options)
    this.logger = options.logger
    this.context = { logger: this.logger }

    // TODO validate client
    this.client = client
  }

  validateOptions (_options: ProviderOptions): ProviderOptions {
    // TODO validate options
    // if(!this.options.client)
    return _options
  }

  async init () {
    try {
      this.api = await this.client.init(this.options?.clientOptions, this.context)
    } catch (error) {
      this.logger.error({ error }, 'Provider init error in client.init')
      throw error
    }
  }

  async close () {
    await this.client?.close(this.api, this.context)
  }

  async request (_model: string, _prompt: string, _options: ProviderRequestOptions): Promise<ProviderResponse> {
    throw new Error('Not implemented')
  }
}
