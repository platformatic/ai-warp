import { randomUUID } from 'node:crypto'
import { setTimeout as wait } from 'node:timers/promises'
import type { Logger } from 'pino'
import type { FastifyError } from '@fastify/error'

import { OpenAIProvider } from '../providers/openai.ts'
import type { AiChatHistory, Provider, ProviderClient, ProviderOptions, ProviderRequestOptions, ProviderResponse, AiSessionId } from './provider.ts'
import { createStorage, type Storage, type AiStorageOptions } from './storage/index.ts'
import { parseTimeWindow, processStream } from './utils.ts'
import { HistoryGetError, ModelStateError, OptionError, ProviderNoModelsAvailableError, ProviderRateLimitError, ProviderRequestStreamTimeoutError, ProviderRequestTimeoutError } from './errors.ts'

// supported providers
export type AiProvider = 'openai' | 'deepseek'

export const DEFAULT_STORAGE: AiStorageOptions = {
  type: 'memory'
}

export const DEFAULT_RATE_LIMIT_MAX = 200
export const DEFAULT_RATE_LIMIT_TIME_WINDOW = '30s'
export const DEFAULT_REQUEST_TIMEOUT = 30_000
export const DEFAULT_HISTORY_EXPIRATION = '1d'
export const DEFAULT_MAX_RETRIES = 1
export const DEFAULT_RETRY_INTERVAL = 1_000

export const DEFAULT_RESTORE_RATE_LIMIT = '1m'
export const DEFAULT_RESTORE_RETRY = '1m'
export const DEFAULT_RESTORE_REQUEST_TIMEOUT = '1m'
export const DEFAULT_RESTORE_PROVIDER_COMMUNICATION_ERROR = '1m'
export const DEFAULT_RESTORE_PROVIDER_EXCEEDED_QUOTA_ERROR = '10m'

export type AiModel = {
  provider: AiProvider
  model: string
  limits?: {
    maxTokens?: number
    rate?: {
      max: number
      timeWindow: TimeWindow
    }
    // TODO requestTimeout, retry
  },
  restore?: AiRestore
}

type ModelLimits = {
  maxTokens?: number
  rate: {
    max: number
    timeWindow: number
  }
}

type ModelRestore = StrictAiRestore

type ModelSettings = {
  limits: ModelLimits
  restore: ModelRestore
}

type QueryModel = string | AiModel

// TODO doc
export type AiOptions = {
  logger: Logger
  providers: { [key in AiProvider]?: ProviderDefinitionOptions }
  storage?: AiStorageOptions
  limits?: AiLimits
  restore?: AiRestore
  models?: AiModel[]
}

type StrictAiOptions = AiOptions & {
  storage: AiStorageOptions
  limits: StrictAiLimits
  restore: StrictAiRestore
  models: AiModel[]
}

export type ProviderDefinitionOptions = {
  apiKey: string,
  client?: ProviderClient
}

export type ModelOptions = {
  name: string
} | string

export type AddModelsOptions = {
  provider: AiProvider
  model: ModelOptions
}

export type ModeleSelection = {
  provider: ProviderState
  model: ModelState
  settings: ModelSettings
}

export type Request = {
  models?: QueryModel[]
  context?: string
  temperature?: number

  prompt: string
  options?: ProviderRequestOptions
}

export type AiResponseResult = 'COMPLETE' | 'INCOMPLETE_MAX_TOKENS' | 'INCOMPLETE_UNKNOWN'

export type AiContentResponse = {
  text: string
  result: AiResponseResult
  sessionId: AiSessionId
}

export type AiStreamResponse = ReadableStream & {
  sessionId: AiSessionId
}

export type Response = AiContentResponse | AiStreamResponse

export type ProviderState = {
  provider: Provider
  models: Models
}

export type ModelStatus = 'ready' | 'error'
export type ModelStateErrorReason = 'NONE' | 'PROVIDER_RATE_LIMIT_ERROR' | 'PROVIDER_REQUEST_TIMEOUT_ERROR' | 'PROVIDER_REQUEST_STREAM_TIMEOUT_ERROR' | 'PROVIDER_RESPONSE_ERROR' | 'PROVIDER_RESPONSE_NO_CONTENT' | 'PROVIDER_EXCEEDED_QUOTA_ERROR'

export type ModelState = {
  name: string

  rateLimit: {
    count: number
    windowStart: number
  },

  state: {
    status: ModelStatus
    timestamp: number
    reason: ModelStateErrorReason
  }
}

export type TimeWindow = number | string

export type AiLimits = {
  maxTokens?: number
  rate?: {
    max: number
    timeWindow: TimeWindow
  }
  requestTimeout?: number // provider request timeout in ms
  retry?: {
    max: number
    interval: number
  }
  historyExpiration?: TimeWindow // history expiration time in ms
}

type StrictAiLimits = {
  maxTokens?: number
  rate: {
    max: number
    timeWindow: number // ms
  }
  requestTimeout: number // ms
  retry: {
    max: number
    interval: number
  }
  historyExpiration: number // ms
}

export type AiRestore = {
  rateLimit?: TimeWindow
  retry?: TimeWindow
  timeout?: TimeWindow
  providerCommunicationError?: TimeWindow
  providerExceededError?: TimeWindow
}

type StrictAiRestore = {
  rateLimit: number // ms
  retry: number // ms
  timeout: number // ms
  providerCommunicationError: number // ms
  providerExceededError: number // ms
}

export class Ai {
  options: StrictAiOptions
  logger: Logger
  modelSettings: Record<string, ModelSettings>
  // @ts-expect-error
  storage: Storage
  // @ts-expect-error
  providers: Map<AiProvider, ProviderState>
  // @ts-expect-error
  history: History

  constructor (options: AiOptions) {
    this.options = this.validateOptions(options)
    this.logger = options.logger
    this.modelSettings = {}
  }

  // test: options must have all the values, default if not from options
  // model state must be inited if not
  async init () {
    this.storage = await createStorage(this.options.storage)
    this.history = new History(this.storage)
    this.providers = new Map()

    for (const provider of Object.keys(this.options.providers)) {
      const p = provider as AiProvider
      const options: ProviderOptions = {
        logger: this.logger,
        client: this.options.providers[p]?.client,
        clientOptions: {
          apiKey: this.options.providers[p]?.apiKey ?? ''
        }
      }

      const providerState = {
        // TODO generic provider
        provider: new OpenAIProvider(options, options.client),
        models: new Models(this.storage)
      }

      try {
        await providerState.provider.init()
      } catch (error) {
        this.logger.error({ error }, 'Provider init error')
        throw error
      }

      const writes = []
      // TODO batch ops
      // Init models if not present
      for (const model of this.options.models.filter(m => m.provider === p)) {
        const modelName = typeof model === 'string' ? model : model.model
        const modelState = await this.getModelState(modelName, providerState)
        if (!modelState) {
          const modelState = createModelState(modelName)
          writes.push(this.setModelState(modelName, providerState, modelState, Date.now()))
        }
      }
      await Promise.all(writes)

      this.providers.set(p, providerState)
    }

    this.modelSettings = this.options.models.reduce((models: Record<string, ModelSettings>, model) => {
      models[model.model] = {
        limits: {
          maxTokens: model.limits?.maxTokens,
          rate: {
            max: model.limits?.rate?.max ?? this.options.limits.rate.max,
            timeWindow: parseTimeWindow(model.limits?.rate?.timeWindow ?? this.options.limits.rate.timeWindow, 'model.limits.rate.timeWindow')
          }
        },
        restore: {
          rateLimit: parseTimeWindow(model.restore?.rateLimit ?? this.options.restore.rateLimit, 'model.restore.rateLimit'),
          retry: parseTimeWindow(model.restore?.retry ?? this.options.restore.retry, 'model.restore.retry'),
          timeout: parseTimeWindow(model.restore?.timeout ?? this.options.restore.timeout, 'model.restore.timeout'),
          providerCommunicationError: parseTimeWindow(model.restore?.providerCommunicationError ?? this.options.restore.providerCommunicationError, 'model.restore.providerCommunicationError'),
          providerExceededError: parseTimeWindow(model.restore?.providerExceededError ?? this.options.restore.providerExceededError, 'model.restore.providerExceededError')
        }
      }
      return models
    }, {})
  }

  // TODO
  async close () {
    // for (const provider of this.providers.values()) {
    //   await provider.provider.close()
    // }
    // TODO close storage
  }

  validateOptions (options: AiOptions): StrictAiOptions {
    if (!options.logger) {
      throw new OptionError('logger is required')
    }

    // no providers
    if (!options.providers || Object.keys(options.providers).length === 0) {
      throw new OptionError('at least one provider is required')
    }

    // no models
    if (!options.models || options.models.length === 0) {
      throw new OptionError('at least one model is required')
    }

    // no valid limits values
    if (options.limits) {
      if (options.limits.maxTokens && typeof options.limits.maxTokens !== 'number' && options.limits.maxTokens < 0) {
        throw new OptionError('maxTokens must be a positive number')
      }

      if (options.limits.rate && typeof options.limits.rate.max !== 'number' && options.limits.rate.max < 0) {
        throw new OptionError('rate.max must be a positive number')
      }

      if (options.limits.retry && typeof options.limits.retry.max !== 'number' && options.limits.retry.max < 0) {
        throw new OptionError('retry.max must be a positive number')
      }

      if (options.limits.retry && typeof options.limits.retry.interval !== 'number' && options.limits.retry.interval < 0) {
        throw new OptionError('retry.interval must be a positive number')
      }
    }

    // models
    for (const model of options.models) {
      if (model.limits) {
        if (model.limits.maxTokens && typeof model.limits.maxTokens !== 'number' && model.limits.maxTokens < 0) {
          throw new OptionError('model.limits.maxTokens must be a positive number')
        }

        if (model.limits.rate) {
          if (typeof model.limits.rate.max !== 'number' && model.limits.rate.max < 0) {
            throw new OptionError('model.limits.rate.max must be a positive number')
          }

          parseTimeWindow(model.limits.rate.timeWindow, 'model.limits.rate.timeWindow')
        }

        if (model.restore) {
          model.restore.rateLimit && parseTimeWindow(model.restore.rateLimit, 'model.restore.rateLimit')
          model.restore.retry && parseTimeWindow(model.restore.retry, 'model.restore.retry')
          model.restore.timeout && parseTimeWindow(model.restore.timeout, 'model.restore.timeout')
          model.restore.providerCommunicationError && parseTimeWindow(model.restore.providerCommunicationError, 'model.restore.providerCommunicationError')
          model.restore.providerExceededError && parseTimeWindow(model.restore.providerExceededError, 'model.restore.providerExceededError')
        }
      }
    }

    // warn on missing max tokens in options
    if (options.limits?.maxTokens) {
      options.logger.warn('maxTokens is not set and will be ignored')
    }

    const limits = {
      maxTokens: options.limits?.maxTokens,
      rate: {
        max: options.limits?.rate?.max ?? DEFAULT_RATE_LIMIT_MAX,
        timeWindow: parseTimeWindow(options.limits?.rate?.timeWindow ?? DEFAULT_RATE_LIMIT_TIME_WINDOW, 'limits.rate.timeWindow')
      },
      requestTimeout: parseTimeWindow(options.limits?.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT, 'limits.requestTimeout'),
      retry: {
        max: options.limits?.retry?.max ?? DEFAULT_MAX_RETRIES,
        interval: options.limits?.retry?.interval ?? DEFAULT_RETRY_INTERVAL
      },
      historyExpiration: parseTimeWindow(options.limits?.historyExpiration ?? DEFAULT_HISTORY_EXPIRATION, 'limits.historyExpiration')
    }

    const restore = {
      rateLimit: parseTimeWindow(options.restore?.rateLimit ?? DEFAULT_RESTORE_RATE_LIMIT, 'restore.rateLimit'),
      retry: parseTimeWindow(options.restore?.retry ?? DEFAULT_RESTORE_RETRY, 'restore.retry'),
      timeout: parseTimeWindow(options.restore?.timeout ?? DEFAULT_RESTORE_REQUEST_TIMEOUT, 'restore.timeout'),
      providerCommunicationError: parseTimeWindow(options.restore?.providerCommunicationError ?? DEFAULT_RESTORE_PROVIDER_COMMUNICATION_ERROR, 'restore.providerCommunicationError'),
      providerExceededError: parseTimeWindow(options.restore?.providerExceededError ?? DEFAULT_RESTORE_PROVIDER_EXCEEDED_QUOTA_ERROR, 'restore.providerExceededError')
    }

    return {
      logger: options.logger,
      providers: options.providers,
      storage: options.storage ?? DEFAULT_STORAGE,
      limits,
      restore,
      models: options.models
        ? options.models.map(model => ({
          provider: model.provider,
          model: model.model,
          limits: model.limits,
          restore: model.restore
        }))
        : []
    }
  }

  /**
   * Select a model from the list of models, depending on the provider and model state
   * @param models - List of models to select from
   * @param skip - List of models to skip
   * @returns Selected model with provider and limits
   * TODO implement logic, for example round robin, random, least used, etc.
   */
  async selectModel (models: QueryModel[], skip?: string[]): Promise<ModeleSelection | undefined> {
    if (models.length === 0) {
      return undefined
    }

    for (const model of models) {
      let modelName: string
      let providerName: AiProvider

      if (typeof model === 'string') {
        const [p, m] = model.split(':')
        providerName = p as AiProvider
        modelName = m
      } else {
        providerName = model.provider
        modelName = model.model
      }

      if (skip?.includes(`${providerName}:${modelName}`)) {
        continue
      }

      const provider = this.providers.get(providerName)
      if (!provider) {
        this.logger.warn(`Provider ${providerName} not found`)
        continue
      }

      const modelState = await this.getModelState(modelName, provider)
      if (!modelState) {
        this.logger.warn(`Model ${modelName} not found for provider ${providerName}`)
        continue
      }

      if (modelState.state.status !== 'ready') {
        if (this.restoreModelState(modelState, this.modelSettings[modelName].restore)) {
          this.setModelState(modelName, provider, modelState, Date.now())
          return { provider, model: modelState, settings: this.modelSettings[modelName] }
        }
        this.logger.debug({ modelState }, `Model ${modelName} is not ready for provider ${providerName}`)
        continue
      } else {
        return { provider, model: modelState, settings: this.modelSettings[modelName] }
      }
    }
  }

  restoreModelState (modelState: ModelState, restore: ModelRestore): boolean {
    let wait: number
    if (modelState.state.reason === 'PROVIDER_RATE_LIMIT_ERROR') {
      wait = restore.rateLimit
    } else if (modelState.state.reason === 'PROVIDER_REQUEST_TIMEOUT_ERROR' || modelState.state.reason === 'PROVIDER_REQUEST_STREAM_TIMEOUT_ERROR') {
      wait = restore.timeout
    } else if (modelState.state.reason === 'PROVIDER_RESPONSE_ERROR' || modelState.state.reason === 'PROVIDER_RESPONSE_NO_CONTENT') {
      wait = restore.providerCommunicationError
    } else if (modelState.state.reason === 'PROVIDER_EXCEEDED_QUOTA_ERROR') {
      wait = restore.providerExceededError
    } else {
      return false
    }

    return modelState.state.timestamp + wait < Date.now()
  }

  // TODO check query models
  async validateRequest (request: Request) {
    if (request.options?.history && request.options?.sessionId) {
      throw new OptionError('history and sessionId cannot be used together')
    }

    const options = {
      ...(request.options ?? {}),
      sessionId: request.options?.sessionId,
      history: request.options?.history
    }

    if (request.options?.sessionId) {
      try {
        options.history = await this.history.range(request.options.sessionId)
        if (!options.history || options.history.length < 1) {
          throw new OptionError('sessionId does not exist')
        }
      } catch (err: any) {
        if (err.code === 'OPTION_ERROR') {
          throw err
        }
        this.logger.error({ err }, 'Failed to get history')
        throw new HistoryGetError()
      }
    }

    return options
  }

  async request (request: Request): Promise<Response> {
    const requestOptions = await this.validateRequest(request)

    this.logger.debug({ request }, 'AI request')

    const models = request.models ?? this.options.models
    const skipModels: string[] = []

    let selected = await this.selectModel(models)
    if (!selected) {
      this.logger.warn({ models }, 'No models available')
      throw new ProviderNoModelsAvailableError(models)
    }

    let response!: Response
    const history: AiChatHistory | undefined = requestOptions.history
    const sessionId: AiSessionId = requestOptions.sessionId ?? await this.createSessionId()

    while (selected) {
      this.logger.debug({ model: selected.model.name }, 'Selected model')

      const options = {
        context: requestOptions?.context,
        temperature: requestOptions?.temperature,
        stream: requestOptions?.stream,
        history,
        maxTokens: selected.settings.limits.maxTokens ?? requestOptions?.maxTokens ?? this.options.limits.maxTokens
      }

      const rateLimit = {
        max: selected.settings.limits.rate.max,
        timeWindow: selected.settings.limits.rate.timeWindow
      }
      const operationTimestamp = Date.now()

      let providerResponse!: ProviderResponse
      let err: FastifyError | undefined
      try {
        await this.checkRateLimit(selected, rateLimit)
        await this.updateModelStateRateLimit(selected.model.name, selected.provider, selected.model.rateLimit)

        let attempts = 0
        let retry
        const retryInterval = this.options.limits.retry.interval
        do {
          err = undefined
          try {
            providerResponse = await this.requestTimeout(
              selected.provider.provider.request(selected.model.name, request.prompt, options),
              this.options.limits.requestTimeout,
              options.stream
            )
            break
          } catch (error: any) { // TODO fix type
            err = error

            // do not retry on timeout errors
            if (error.code && (error.code === 'PROVIDER_REQUEST_TIMEOUT_ERROR' || error.code === 'PROVIDER_REQUEST_STREAM_TIMEOUT_ERROR')) {
              break
            }

            retry = this.options.limits.retry && attempts++ < this.options.limits.retry.max
            if (retry) {
              this.logger.warn({ err }, `Failed to request from provider, retrying in ${retryInterval} ms...`)
              await wait(retryInterval)
            } else {
              this.logger.error({ err }, `Failed to request from provider after ${attempts} attempts`)
            }
          }
        } while (retry && err)
        response = providerResponse as Response

        if (err) {
          throw err
        }

        // @ts-ignore
        if (typeof providerResponse.pipe === 'function' || providerResponse instanceof ReadableStream) {
          const [responseStream, historyStream] = (providerResponse as AiStreamResponse).tee()

          // Process the cloned stream in background to accumulate response for history
          processStream(historyStream)
            .then(response => {
              if (!response) {
                this.logger.error({ err }, 'Failed to clone stream, skipping history store')
                return
              }
              this.history.push(sessionId, { prompt: request.prompt, response }, this.options.limits.historyExpiration)
            })
          // processStream should not throw
            .catch(() => { });

          // Attach sessionId to the stream for the user
          (responseStream as AiStreamResponse).sessionId = sessionId
          return responseStream as AiStreamResponse
        }

        const contentResponse: AiContentResponse = response as AiContentResponse
        contentResponse.sessionId = sessionId
        await this.history.push(sessionId, { prompt: request.prompt, response: contentResponse.text }, this.options.limits.historyExpiration)

        return contentResponse
      } catch (error: any) { // TODO fix type
      // skip storage errors, update state if errors are one of:
        if (error.code !== 'PROVIDER_RATE_LIMIT_ERROR' &&
        error.code !== 'PROVIDER_REQUEST_TIMEOUT_ERROR' &&
        error.code !== 'PROVIDER_REQUEST_STREAM_TIMEOUT_ERROR' &&
        error.code !== 'PROVIDER_RESPONSE_ERROR' &&
        error.code !== 'PROVIDER_RESPONSE_NO_CONTENT' &&
        error.code !== 'PROVIDER_EXCEEDED_QUOTA_ERROR'
        ) {
          throw error
        }

        err = error
      }

      if (err) {
        try {
          selected.model.state.status = 'error'
          selected.model.state.timestamp = Date.now()
          selected.model.state.reason = err.code as ModelStateErrorReason

          await this.setModelState(selected.model.name, selected.provider, selected.model, operationTimestamp)

          // try to select a new model from the remaining models
          skipModels.push(`${selected.provider.provider.name}:${selected.model.name}`)
          selected = await this.selectModel(models, skipModels)

          if (!selected) {
            this.logger.warn({ models }, 'No more models available')
            throw err
          }

          // then try to request again
          continue
        } catch (error) {
          this.logger.error({ err: error }, 'Failed to set model state')
          throw err
        }
      }
    }

    // never happen, but makes typescript happy
    return response
  }

  // TODO user grants
  async createSessionId () {
    return randomUUID()
  }

  async setModelState (modelName: string, providerState: ProviderState, modelState: ModelState, operationTimestamp: number) {
    if (!modelState) {
      throw new ModelStateError('Model state is required')
    }

    // updates could be concurrent, handle by state.timestamp
    // TODO these ops should be atomic
    const key = `${providerState.provider.name}:${modelName}`
    const m = await providerState.models.get(key)

    // update when:
    // - the current state is older than the stored one
    // - the state is not stored
    // - the current state is in error and the operation don't override the error
    if (!m || m.state.timestamp < operationTimestamp) {
      await providerState.models.set(key, modelState)
      return
    }

    if (modelState.state.status === 'ready' &&
      m.state.status !== 'ready' &&
      this.restoreModelState(m, this.modelSettings[modelName].restore)) {
      await providerState.models.set(key, modelState)
    }
  }

  async getModelState (modelName: string, provider: ProviderState): Promise<ModelState | undefined> {
    return await provider.models.get(`${provider.provider.name}:${modelName}`)
  }

  /**
   * Update only the rate limit for a model, not the whole state
   * @param modelName - The name of the model
   * @param providerState - The provider state
   * @param rateLimitState - The rate limit state
   * TODO use a different key to avoid to get and set the whole state
   */
  async updateModelStateRateLimit (modelName: string, providerState: ProviderState, rateLimitState: ModelState['rateLimit']) {
    const key = `${providerState.provider.name}:${modelName}`
    const m = await providerState.models.get(key)

    m.rateLimit = rateLimitState
    await providerState.models.set(key, m)
  }

  async checkRateLimit (model: ModeleSelection, rateLimit: { max: number, timeWindow: number }) {
    const now = Date.now()
    const windowMs = rateLimit.timeWindow
    const modelState = model.model

    // Check if we're still in the same time window
    if (now - modelState.rateLimit.windowStart < windowMs) {
      // Same window - check if we've exceeded the limit
      if (modelState.rateLimit.count >= rateLimit.max) {
        const resetTime = modelState.rateLimit.windowStart + windowMs
        const waitTime = Math.ceil((resetTime - now) / 1000)
        throw new ProviderRateLimitError(waitTime)
      }

      // Increment count
      modelState.rateLimit.count++
    } else {
      // New window - reset counter
      modelState.rateLimit = {
        count: 1,
        windowStart: now
      }
    }
  }

  async requestTimeout (promise: Promise<ProviderResponse>, timeout: number, isStream?: boolean): Promise<ProviderResponse> {
    let timer: NodeJS.Timeout
    if (isStream) {
      // For streaming responses, we need to wrap the stream to handle timeout between chunks
      const response = await Promise.race([
        promise.then((response) => { timer && clearTimeout(timer); return response }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { reject(new ProviderRequestStreamTimeoutError(timeout)) }, timeout).unref()
        })
      ])

      if (response instanceof ReadableStream) {
        return this.wrapStreamWithTimeout(response, timeout) as AiStreamResponse
      }

      return response
    } else {
      // For non-streaming responses, use a simple timeout
      return await Promise.race([
        promise.then((response) => { timer && clearTimeout(timer); return response }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(ProviderRequestTimeoutError(timeout)), timeout).unref()
        })
      ]) as AiContentResponse
    }
  }

  private wrapStreamWithTimeout (stream: ReadableStream, timeout: number): ReadableStream {
    const reader = stream.getReader()
    let timeoutId: NodeJS.Timeout | undefined

    return new ReadableStream({
      async start (controller) {
        const resetTimeout = async () => {
          if (timeoutId) {
            clearTimeout(timeoutId)
          }

          timeoutId = setTimeout(() => {
            controller.error(new ProviderRequestStreamTimeoutError(timeout))
            reader.releaseLock()
          }, timeout).unref()
        }

        await resetTimeout()

        try {
          while (true) {
            const { done, value } = await reader.read()

            if (done) {
              if (timeoutId) {
                clearTimeout(timeoutId)
              }
              controller.close()
              break
            }

            // Reset timeout on each chunk
            await resetTimeout()
            controller.enqueue(value)
          }
        } catch (error) {
          if (timeoutId) {
            clearTimeout(timeoutId)
          }
          controller.error(error)
        }
      },

      cancel (reason) {
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        return reader.cancel(reason)
      }
    })
  }
}

export function createModelState (modelName: string): ModelState {
  return {
    name: modelName,
    rateLimit: { count: 0, windowStart: 0 },
    state: { status: 'ready', timestamp: 0, reason: 'NONE' }
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

  async push (key: string, value: any, expiration: number) {
    return await this.storage.listPush(key, value, expiration)
  }

  async range (key: string) {
    return await this.storage.listRange(key)
  }
}
