import { randomUUID } from 'node:crypto'
import { OpenAIProvider } from '../providers/openai.ts'
import type { ChatHistory, Provider, ProviderClient, ProviderRequestOptions } from './provider.ts'
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
  sessionId?: string
}

export type Response = PlainResponse | ReadableStream

export type ProviderState = {
  provider: Provider
  models: Models
}

export type ModelState = {
  name: string
}

export class Ai {
  options: AiOptions
  // @ts-expect-error
  storage: Storage
  // @ts-expect-error
  providers: Map<AiProvider, ProviderState>
  // @ts-expect-error
  history: History

  constructor (options: AiOptions) {
    // TODO validate options

    this.options = options
  }

  async init () {
    this.storage = await createStorage(this.options.storage)
    this.history = new History(this.storage)
    this.providers = new Map()

    for (const provider of Object.keys(this.options.providers)) {
      const p = provider as AiProvider

      const providerState = {
        provider: new OpenAIProvider(this.options.providers[p], this.options.providers[p].client),
        models: new Models(this.storage)
      }

      if (this.options.providers[p].models) {
        for (const model of this.options.providers[p].models) {
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

    const { history, sessionId } = await this.getHistory(request.options?.history, request.options?.sessionId)

    console.log('history', history)
    console.log('sessionId', sessionId)

    const options = {
      context: request.options?.context,
      temperature: request.options?.temperature,
      maxTokens: request.options?.maxTokens,
      stream: request.options?.stream,
      history
    }

    const response = await p.provider.provider.request(p.model.name, request.prompt, options)

    // TODO response as stream
    if (response instanceof ReadableStream) {
      // TODO clone stream response to store in history
    } else {
      if (sessionId) {
        await this.history.push(sessionId, { prompt: request.prompt, response: response.text })
        response.sessionId = sessionId
      }
    }

    // TODO update state on error, set model state to error

    return response
  }

  // get history from storage if sessionId is a value
  // TODO lock with auth

  async getHistory (history: ChatHistory | undefined, sessionId: string | boolean | undefined) {
    if (history) {
      return { history, sessionId: undefined }
    }

    if (sessionId === true) {
      sessionId = await this.createSessionId()
    } else if (sessionId) {
      history = await this.history.range(sessionId)
    }

    return { history, sessionId }
  }

  // TODO add auth
  async createSessionId () {
    return randomUUID()
  }

  async updateModelState (modelName: string, providerState: ProviderState) {
    // TODO try/catch
    await providerState.models.set(`${providerState.provider.name}:${modelName}`, { name: modelName }) // TODO options, model state
  }

  async getModelState (modelName: string, provider: ProviderState): Promise<ModelState | undefined> {
    // TODO try/catch
    return await provider.models.get(`${provider.provider.name}:${modelName}`)
  }
}

class Models {
  storage: Storage

  constructor (storage: Storage) {
    this.storage = storage
  }

  async get (key: string) {
    return await this.storage.valueGet(key)
  }

  async set (key: string, value: any) {
    return await this.storage.valueSet(key, value)
  }
}

class History {
  storage: Storage

  constructor (storage: Storage) {
    this.storage = storage
  }

  async push (key: string, value: any) {
    return await this.storage.listPush(key, value)
  }

  async range (key: string) {
    return await this.storage.listRange(key)
  }
}
