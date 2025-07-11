import { randomUUID } from 'node:crypto'
import { setTimeout as wait } from 'node:timers/promises'
import type { Logger } from 'pino'
import type { FastifyError } from 'fastify'

import { OpenAIProvider } from '../providers/openai.ts'
import type { ChatHistory, Provider, ProviderClient, ProviderOptions, ProviderRequestOptions } from './provider.ts'
import { createStorage, type Storage, type StorageOptions } from './storage/index.ts'
import { parseTimeWindow, processStream } from './utils.ts'
import { AiOptionsError, HistoryGetError, ModelStateError, ProviderNoModelsAvailableError, ProviderRateLimitError, ProviderRequestStreamTimeoutError, ProviderRequestTimeoutError } from './errors.ts'
import { verifyJWT, type AuthOptions } from './auth.ts'

// supported providers
export type AiProvider = 'openai' | 'deepseek'

export const DEFAULT_STORAGE: StorageOptions = {
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

export type Model = {
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

type QueryModel = string | Model

// TODO doc
export type AiOptions = {
  logger: Logger
  providers: { [key in AiProvider]?: ProviderDefinitionOptions }
  storage?: StorageOptions
  auth?: AuthOptions
  limits?: AiLimits
  restore?: AiRestore
  models?: Model[]
}

type StrictAiOptions = AiOptions & {
  storage: StorageOptions
  limits: StrictAiLimits
  restore: StrictAiRestore
  models: Model[]
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
  auth?: { jwt?: string }
}

export type ResponseResult = 'COMPLETE' | 'INCOMPLETE_MAX_TOKENS' | 'INCOMPLETE_UNKNOWN'

export type ContentResponse = {
  text: string
  result: ResponseResult
  sessionId?: string
}

export type StreamResponse = ReadableStream & {
  sessionId?: string
}

export type Response = ContentResponse | StreamResponse

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
            timeWindow: parseTimeWindow(model.limits?.rate?.timeWindow ?? this.options.limits.rate.timeWindow)
          }
        },
        restore: {
          rateLimit: parseTimeWindow(model.restore?.rateLimit ?? this.options.restore.rateLimit),
          retry: parseTimeWindow(model.restore?.retry ?? this.options.restore.retry),
          timeout: parseTimeWindow(model.restore?.timeout ?? this.options.restore.timeout),
          providerCommunicationError: parseTimeWindow(model.restore?.providerCommunicationError ?? this.options.restore.providerCommunicationError),
          providerExceededError: parseTimeWindow(model.restore?.providerExceededError ?? this.options.restore.providerExceededError)
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
    // TODO validate values

    // warn missing max tokens

    if (options.models && options.models.length < 1) {
      throw new AiOptionsError('No models provided')
    }

    const limits = {
      maxTokens: options.limits?.maxTokens,
      rate: {
        max: options.limits?.rate?.max ?? DEFAULT_RATE_LIMIT_MAX,
        timeWindow: parseTimeWindow(options.limits?.rate?.timeWindow ?? DEFAULT_RATE_LIMIT_TIME_WINDOW)
      },
      requestTimeout: parseTimeWindow(options.limits?.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT),
      retry: {
        max: options.limits?.retry?.max ?? DEFAULT_MAX_RETRIES,
        interval: options.limits?.retry?.interval ?? DEFAULT_RETRY_INTERVAL
      },
      historyExpiration: parseTimeWindow(options.limits?.historyExpiration ?? DEFAULT_HISTORY_EXPIRATION)
    }

    const restore = {
      rateLimit: parseTimeWindow(options.restore?.rateLimit ?? DEFAULT_RESTORE_RATE_LIMIT),
      retry: parseTimeWindow(options.restore?.retry ?? DEFAULT_RESTORE_RETRY),
      timeout: parseTimeWindow(options.restore?.timeout ?? DEFAULT_RESTORE_REQUEST_TIMEOUT),
      providerCommunicationError: parseTimeWindow(options.restore?.providerCommunicationError ?? DEFAULT_RESTORE_PROVIDER_COMMUNICATION_ERROR),
      providerExceededError: parseTimeWindow(options.restore?.providerExceededError ?? DEFAULT_RESTORE_PROVIDER_EXCEEDED_QUOTA_ERROR)
    }

    return {
      logger: options.logger,
      providers: options.providers,
      storage: options.storage ?? DEFAULT_STORAGE,
      auth: options.auth,
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

  async request (request: Request): Promise<Response> {
    // TODO validate request: query models

    this.logger.debug({ request }, 'AI request')

    // Check authentication if configured
    if (this.options.auth) {
      await verifyJWT(request.auth?.jwt, this.options.auth)
    }

    const models = request.models ?? this.options.models
    const skipModels: string[] = []

    let selected = await this.selectModel(models)
    if (!selected) {
      this.logger.warn({ models }, 'No models available')
      throw new ProviderNoModelsAvailableError(models)
    }

    let r!: Response

    while (selected) {
      this.logger.debug({ model: selected.model.name }, 'Selected model')

      let history: ChatHistory | undefined, sessionId: string | undefined
      try {
        const h = await this.getHistory(request.options?.history, request.options?.sessionId)
        history = h.history
        sessionId = h.sessionId
      } catch (err) {
        this.logger.error({ err }, 'Failed to get history')
        throw new HistoryGetError()
      }

      const options = {
        context: request.options?.context,
        temperature: request.options?.temperature,
        stream: request.options?.stream,
        history,
        maxTokens: selected.settings.limits.maxTokens ?? request.options?.maxTokens ?? this.options.limits.maxTokens
      }

      const rateLimit = {
        max: selected.settings.limits.rate.max,
        timeWindow: selected.settings.limits.rate.timeWindow
      }
      const operationTimestamp = Date.now()

      let response!: Response
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
            response = await this.requestTimeout(
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

        if (err) {
          throw err
        }

        // @ts-ignore
        if (typeof response.pipe === 'function' || response instanceof ReadableStream) {
          if (sessionId) {
            const streamResponse = response as ReadableStream
            const [responseStream, historyStream] = streamResponse.tee()

            // Process the cloned stream in background to accumulate response for history
            processStream(historyStream)
              .then(response => {
                if (!response) {
                  this.logger.error({ err }, 'Failed to clone stream, skipping history store')
                  return
                }
                this.history.push(sessionId as string, { prompt: request.prompt, response }, this.options.limits.historyExpiration)
              })
            // processStream should not throw
              .catch(() => { });

            // Attach sessionId to the stream for the user
            (responseStream as StreamResponse).sessionId = sessionId
            return responseStream
          }
          return response as StreamResponse
        }

        const contentResponse = response as ContentResponse
        if (sessionId) {
          await this.history.push(sessionId, { prompt: request.prompt, response: contentResponse.text }, this.options.limits.historyExpiration)
          contentResponse.sessionId = sessionId
          return contentResponse
        }

        // never happen, but makes typescript happy
        r = response

        return response
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
    return r
  }

  /**
   * get history from storage if sessionId is a value
   * TODO lock with auth
   * @param history
   * @param sessionId
   * @returns
   */
  async getHistory (history: ChatHistory | undefined, sessionId: string | boolean | undefined): Promise<{ history: ChatHistory | undefined, sessionId: string | undefined }> {
    // TODO try/catch
    if (history) {
      return { history, sessionId: undefined }
    }

    let sessionIdValue: string | undefined
    if (sessionId === true) {
      sessionIdValue = await this.createSessionId()
    } else if (sessionId) {
      history = await this.history.range(sessionId)
    }

    return { history, sessionId: sessionIdValue }
  }

  // TODO add auth
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

  async requestTimeout (promise: Promise<Response>, timeout: number, isStream?: boolean): Promise<Response> {
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
        return this.wrapStreamWithTimeout(response, timeout)
      }

      return response
    } else {
      // For non-streaming responses, use a simple timeout
      return await Promise.race([
        promise.then((response) => { timer && clearTimeout(timer); return response }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(ProviderRequestTimeoutError(timeout)), timeout).unref()
        })
      ])
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
