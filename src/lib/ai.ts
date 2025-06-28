import { OpenAIProvider } from '../providers/openai.ts'
import type { Provider, ProviderClient, ProviderRequestOptions } from './provider.ts'
import { createStorage, type Storage, type StorageOptions } from './storage/index.ts'

// supported providers
export type AiProvider = 'openai'

export type Model = {
  provider: AiProvider
  model: string
}

type QueryModel = string | Model

export type AiOptions = {
  providers: Record<AiProvider, ProviderOptions>
  storage?: StorageOptions
}

export type ProviderOptions = {
  apiKey: string,
  models?: ModelOptions[]
  client?: ProviderClient
}

export type ModelOptions = {
  name: string
} | string

export type AddModelsOptions = {
  provider: AiProvider
  model: ModelOptions
}

export type ModelProvider = {
  provider: ProviderState
  model: ModelState
}

export type Request = {
  models: QueryModel[]

  prompt: string
  options?: ProviderRequestOptions
}

export type PlainResponse = {
  text: string
}

export type Response = PlainResponse | ReadableStream

export type ProviderState = {
  provider: Provider
  models: Storage
}

export type ModelState = {
  name: string
}

export class Ai {
  providers: Map<AiProvider, ProviderState>

  constructor (options: AiOptions) {
    // TODO validate options

    this.providers = new Map()

    for (const provider of Object.keys(options.providers)) {
      const p = provider as AiProvider

      const providerState = {
        provider: new OpenAIProvider(options.providers[p], options.providers[p].client),
        models: createStorage(options.storage)
      }

      if (options.providers[p].models) {
        for (const model of options.providers[p].models) {
          const modelName = typeof model === 'string' ? model : model.name
          this.updateModelState(modelName, providerState)
        }
      }

      this.providers.set(p, providerState)
    }
  }

  async addModels (models: AddModelsOptions[]) {
    const updates = []

    for (const model of models) {
      const providerState = this.providers.get(model.provider)
      if (!providerState) {
        throw new Error(`Provider ${model.provider} not found`)
      }

      const modelName = typeof model.model === 'string' ? model.model : model.model.name
      updates.push(this.updateModelState(modelName, providerState))
    }

    await Promise.all(updates)
  }

  async select (models: QueryModel[]): Promise<ModelProvider | undefined> {
    // TODO real selection
    const selectedModel = models[0]
    let modelName: string
    let providerName: AiProvider

    if (typeof selectedModel === 'string') {
      const [provider, model] = selectedModel.split(':')
      providerName = provider as AiProvider
      modelName = model
    } else {
      providerName = selectedModel.provider
      modelName = selectedModel.model
    }
    
    const provider = this.providers.get(providerName)
    if (!provider) {
      throw new Error(`Provider ${providerName} not found`)
    }

    // const model = await provider?.models.get(selectedModel.model)
    const model = await this.getModelState(modelName, provider)
    
    return provider && model
      ? { provider, model }
      : undefined
  }

  async request (request: Request): Promise<Response> {
    // TODO validate query models

    const p = await this.select(request.models)

    if (!p) {
      throw new Error(`Provider not found for model: ${request.models[0]}`)
    }

    const options = {
      context: request.options?.context,
      temperature: request.options?.temperature,
      maxTokens: request.options?.maxTokens,
      stream: request.options?.stream,
      history: request.options?.history
    }

    const response = await p.provider.provider.request(p.model.name, request.prompt, options)

    // TODO update state

    // TODO map provider response to response

    return response
  }

  async updateModelState (modelName: string, providerState: ProviderState) {
    // TODO try/catch
    await providerState.models.set(`${providerState.provider.name}:${modelName}`, { name: modelName }) // TODO options, model state
  }

  async getModelState (modelName: string, provider: ProviderState): Promise<ModelState | undefined> {
    return await provider.models.get(`${provider.provider.name}:${modelName}`)
  }

}
