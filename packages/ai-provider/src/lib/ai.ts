import { randomUUID } from 'node:crypto'
import { setTimeout as wait } from 'node:timers/promises'
import { Readable, Transform } from 'node:stream'
import type { Logger } from 'pino'
import { type FastifyError } from '@fastify/error'

import { type AiChatHistory, type Provider, type ProviderClient, type ProviderOptions, type ProviderRequestOptions, type ProviderResponse, type AiSessionId, createAiProvider, type AiEventId, type StreamResponseType } from './provider.ts'
import { createStorage, type Storage, type AiStorageOptions } from './storage/index.ts'
import { isStream, parseTimeWindow } from './utils.ts'
import { HistoryGetError, ModelStateError, OptionError, ProviderNoModelsAvailableError, ProviderRateLimitError, ProviderRequestEndError, ProviderRequestStreamTimeoutError, ProviderRequestTimeoutError, ProviderStreamError } from './errors.ts'
import { DEFAULT_HISTORY_EXPIRATION, DEFAULT_MAX_RETRIES, DEFAULT_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_TIME_WINDOW, DEFAULT_REQUEST_TIMEOUT, DEFAULT_RESTORE_PROVIDER_COMMUNICATION_ERROR, DEFAULT_RESTORE_PROVIDER_EXCEEDED_QUOTA_ERROR, DEFAULT_RESTORE_RATE_LIMIT, DEFAULT_RESTORE_REQUEST_TIMEOUT, DEFAULT_RESTORE_RETRY, DEFAULT_RETRY_INTERVAL, DEFAULT_STORAGE } from './config.ts'
import { createEventId, decodeEventStream, encodeEvent, type AiStreamEvent, type AiStreamEventPrompt } from './event.ts'

// supported providers
export type AiProvider = 'openai' | 'deepseek' | 'gemini'

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

export type ModelSelection = {
  provider: ProviderState
  model: ModelState
  settings: ModelSettings
}

export type Request = {
  prompt?: string
  models?: QueryModel[]
  options?: ProviderRequestOptions
}

type ProviderContext = {
  selectedModel?: ModelSelection
  attempts: number
  sessionId: AiSessionId
  history?: AiStreamEvent[]

  response: {
    stream?: AiStreamResponse
    subscribed: boolean
  },

  request: {
    stream: boolean
    models: QueryModel[]
    sessionId?: AiSessionId
    resumeEventId?: AiEventId
    history?: AiChatHistory
    context?: string
    prompt?: string
    promptEventId?: AiEventId
    temperature?: number
    onStreamChunk?: (response: string) => Promise<string>
    maxTokens?: number
    streamResponseType: StreamResponseType
  }

  // callback to run a following request without closing the stream
  next?: () => Promise<void> | void
}

export type AiResponseResult = 'COMPLETE' | 'INCOMPLETE_MAX_TOKENS' | 'INCOMPLETE_UNKNOWN'

export type AiContentResponse = {
  text: string
  result: AiResponseResult
  sessionId: AiSessionId
}

export type AiStreamResponse = Readable & {
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

export type HistoryContentEvent = {
  event: 'content'
  data: any
  type: 'prompt' | 'response'
}

export type HistoryEndEvent = {
  event: 'end'
  data: any
}

export type HistoryErrorEvent = {
  event: 'error'
  data: any
}

export type HistoryEvent = HistoryContentEvent | HistoryEndEvent | HistoryErrorEvent

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
  // @ts-expect-error
  pubsub: Pubsub

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
    this.pubsub = new Pubsub(this.storage)
    this.providers = new Map()

    for (const provider of Object.keys(this.options.providers)) {
      const providerId = provider as AiProvider
      const options: ProviderOptions = {
        logger: this.logger,
        client: this.options.providers[providerId]?.client,
        clientOptions: {
          apiKey: this.options.providers[providerId]?.apiKey ?? ''
        }
      }

      const providerState = {
        provider: createAiProvider(providerId, options, options.client),
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
      for (const model of this.options.models.filter(m => m.provider === providerId)) {
        const modelName = typeof model === 'string' ? model : model.model
        const modelState = await this.getModelState(modelName, providerState)
        if (!modelState) {
          const modelState = createModelState(modelName)
          writes.push(this.setModelState(modelName, providerState, modelState, Date.now()))
        }
      }
      await Promise.all(writes)

      this.providers.set(providerId, providerState)
    }

    this.modelSettings = this.options.models.reduce((models: Record<string, ModelSettings>, model) => {
      models[model.model] = {
        limits: {
          maxTokens: model.limits?.maxTokens ?? this.options.limits.maxTokens,
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

  async close () {
    const tasks = []
    for (const provider of this.providers.values()) {
      tasks.push(provider.provider.close())
    }
    tasks.push(this.history.storage.close())
    tasks.push(this.storage.close())
    await Promise.allSettled(tasks)
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
    if (!options.limits?.maxTokens) {
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
   * TODO implement optional logic, for example round robin, random, least used, etc.
   */
  async selectModel (models: QueryModel[], skip?: string[]): Promise<ModelSelection | undefined> {
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
      // no PROVIDER_RESPONSE_MAX_TOKENS_ERROR because it depends by options
      return false
    }

    return modelState.state.timestamp + wait < Date.now()
  }

  async createContext (request: Request): Promise<ProviderContext> {
    if (request.options?.history && request.options?.sessionId) {
      throw new OptionError('history and sessionId cannot be used together')
    }
    if (request.options?.resumeEventId && !request.options?.sessionId) {
      throw new OptionError('resumeEventId requires sessionId')
    }
    if (!request.prompt && !request.options?.resumeEventId) {
      throw new OptionError('prompt is missing')
    }

    const context: ProviderContext = {
      sessionId: request.options?.sessionId ?? await this.createSessionId(),
      attempts: 0,

      request: {
        prompt: request.prompt,
        context: request.options?.context,
        models: request.models ?? [],
        stream: request.options?.stream ?? false,
        sessionId: request.options?.sessionId,
        resumeEventId: request.options?.resumeEventId,
        history: request.options?.history,
        temperature: request.options?.temperature,
        onStreamChunk: request.options?.onStreamChunk,
        maxTokens: request.options?.maxTokens,
        streamResponseType: request.options?.streamResponseType ?? 'content',
      },

      response: {
        subscribed: false
      }
    }

    if (context.request.sessionId) {
      try {
        context.history = await this.history.range(context.sessionId)
        if (!context.history || context.history.length < 1) {
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

    if (request.models) {
      for (const model of request.models) {
        if (typeof model === 'string') {
          if (!this.options.models.some(m => `${m.provider}:${m.model}` === model)) {
            throw new OptionError(`Request model ${model} not defined`)
          }
        } else {
          if (!this.options.models.some(m => m.model === model.model && m.provider === model.provider)) {
            throw new OptionError(`Request model ${model.model} not defined for provider ${model.provider}`)
          }
        }
      }
      context.request.models = request.models
    } else {
      context.request.models = this.options.models
    }

    return context
  }

  async request (request: Request): Promise<Response> {
    const context = await this.createContext(request)

    // Note the difference between request.sessionId and r.request.sessionId
    // request.sessionId is the input sessionId
    // r.request.sessionId is the sessionId of the request, that could be the input request.sessionId or a new sessionId
    if (context.request.resumeEventId && context.request.sessionId && context.request.stream) {
      const sessionId = context.request.sessionId!
      context.response.stream = createResponseStream(sessionId)
      this.resumeRequest(context.response.stream, sessionId, context.request.streamResponseType, context.request.resumeEventId)
        .then(({ complete, prompt, promptEventId }) => {
          if (complete && !prompt && !context.request.prompt) {
            return
          }

          // When the resume is not complete: make a further request wit the last prompt from resume
          if (prompt && !context.request.prompt) {
            context.request.prompt = prompt
            return this._request(context)
          } else if (!prompt && context.request.prompt) {
            // When a new prompt is provided on the new request, make a further request
            return this._request(context)
          } else if (prompt && context.request.prompt) {
            // Edge case: both prompt and context.request.prompt because the last requqest is incomplete and a new prompt is provided in the new request
            const requestPrompt = context.request.prompt
            const c = { ...context }
            c.request.prompt = prompt
            c.request.promptEventId = promptEventId
            c.next = () => {
              context.request.prompt = requestPrompt
              context.request.promptEventId = undefined
              this._request(context)
            }
            return this._request(c)
          }
        })
        .catch((error) => {
          this.logger.error({ error, sessionId: context.request.sessionId }, 'Failed to resume stream, proceed with new request')
          context.response.stream!.destroy(error as Error)
        })
      return context.response.stream
    }

    return this._request(context)
  }

  async _request (context: ProviderContext) {
    try {
      if (context.request.stream && !context.response.stream) {
        context.response.stream = createResponseStream(context.sessionId)
      }
      return await this.providerRequest(context.sessionId, context) as Response
    } catch (error) {
      this.logger.error({ error, sessionId: context.sessionId }, 'ai request error')
      throw error
    }
  }

  private async providerRequest (sessionId: AiSessionId, context: ProviderContext): Promise<ProviderResponse> {
    const prompt: string = context.request.prompt!
    const models: QueryModel[] = context.request.models
    const skipModels: string[] = []

    let selected = context.selectedModel ?? await this.selectModel(models)
    if (!selected) {
      this.logger.warn({ models }, 'No models available')
      throw new ProviderNoModelsAvailableError(models.map(m => typeof m === 'string' ? m : `${m.provider}:${m.model}`).join(', '))
    }

    this.pubsub.listen(sessionId)

    // this is necessary in case the request is not resuming
    const history = await this.getHistory(context.request.sessionId, context.request.history)
    const promptEventId = context.request.promptEventId ?? history.promptEventId ?? createEventId()

    this.history.push(sessionId, promptEventId, {
      event: 'content',
      data: { prompt: context.request.prompt },
      type: 'prompt'
    }, this.options.limits.historyExpiration, false)

    if (context.request.resumeEventId && context.request.streamResponseType === 'session') {
      // ongoing resume stream response, send prompt
      context.response.stream!.push(encodeEvent({
        id: promptEventId,
        event: 'content',
        data: { prompt: context.request.prompt }
      } as AiStreamEvent))
    }

    const options = {
      context: context.request.context,
      temperature: context.request.temperature,
      stream: context.request.stream,
      history: history.messages,
      maxTokens: context.request.maxTokens ?? this.options.limits.maxTokens
    }

    while (selected) {
      this.logger.debug({ model: selected.model.name }, 'Selected model')
      const operationTimestamp = Date.now()

      // set maxTokens from model limits or options
      options.maxTokens = selected.settings.limits.maxTokens ?? context.request.maxTokens ?? this.options.limits.maxTokens
      const rateLimit = { max: selected.settings.limits.rate.max, timeWindow: selected.settings.limits.rate.timeWindow }

      let providerResponse!: ProviderResponse
      let err: FastifyError | undefined
      try {
        await this.checkRateLimit(selected, rateLimit)
        await this.updateModelStateRateLimit(selected.model.name, selected.provider, selected.model.rateLimit)

        let retry
        const retryInterval = this.options.limits.retry.interval
        do {
          err = undefined
          try {
            const providerPromise = selected.provider.provider.request(selected.model.name, prompt, options)
            providerResponse = await this.requestTimeout(
              providerPromise,
              this.options.limits.requestTimeout,
              context.request.stream
            )
            break
          } catch (error: any) {
            const errorWithCode = error as FastifyError
            err = errorWithCode

            // do not retry on timeout errors and empty response
            if (!this.isErrorRetryableSameModel(errorWithCode)) {
              break
            }

            retry = this.options.limits.retry && context.attempts++ < this.options.limits.retry.max
            if (retry) {
              this.logger.warn({ err }, `Failed to request from provider, retrying in ${retryInterval} ms...`)
              await wait(retryInterval)
            } else {
              this.logger.error({ err }, `Failed to request from provider after ${context.attempts} attempts`)
            }
          }
        } while (retry && err)

        if (err) {
          // non retryable error
          throw err
        }

        if (options.stream && isStream(providerResponse)) {
          // on retry the stream is already subscribed
          if (!context.response.subscribed) {
            await this.subscribeToStorage(context.response.stream!, sessionId, context.request.streamResponseType)
            context.response.subscribed = true
          }

          let err: FastifyError | undefined

          this.pipeStreamResponseToStorage(sessionId, providerResponse as Readable)
            .then(() => {
              if (context.next) {
                context.next()
                return
              }
              // on success
              // close the stream
              context.response.stream!.push(null)
              // remove the subscription
              this.pubsub.remove(sessionId)
            })
            .catch((error: any) => {
              err = error
              return this.shouldRetryStreamRequest(selected!, models, skipModels, error, operationTimestamp, context)
                .then((nextModel) => {
                  if (nextModel) {
                    context.selectedModel = nextModel
                    // call request again with the new model, since the response is a stream
                    return this._request(context)
                  } else {
                    this.logger.error({ err, sessionId }, 'ai request stream error')
                    throw err
                  }
                })
                .catch((error: any) => {
                  this.logger.error({ error, sessionId }, 'ai request stream error')
                  // on error
                  // close the stream
                  context.response.stream!.destroy(error)
                  // remove the subscription
                  this.pubsub.remove(sessionId)
                })
            })
          return context.response.stream!
        } else {
          // Handle non-streaming response
          const contentEvent: HistoryContentEvent = {
            event: 'content',
            data: { response: (providerResponse as any).text || '' },
            type: 'response'
          }
          await this.history.push(sessionId, createEventId(), contentEvent, this.options.limits.historyExpiration)

          const endEvent: HistoryEndEvent = {
            event: 'end',
            data: { response: (providerResponse as any).result || 'COMPLETE' }
          }
          await this.history.push(sessionId, createEventId(), endEvent, this.options.limits.historyExpiration)
        }

        this.pubsub.remove(sessionId)
        context.next?.()
        return {
          text: (providerResponse as any).text || '',
          result: mapResultError((providerResponse as any).result),
          sessionId
        } as AiContentResponse
      } catch (error: any) {
        err = error as FastifyError
      }

      if (err) {
        selected = await this.selectNextModel(selected, models, skipModels, err, operationTimestamp)
        if (selected) {
          continue
        }
        throw err
      }
    }

    this.logger.error({ sessionId }, 'Unexpected end of providerRequest')
    throw new ProviderRequestEndError()
  }

  async selectNextModel (selected: ModelSelection, models: QueryModel[], skipModels: string[], err: FastifyError, operationTimestamp: number): Promise<ModelSelection | undefined> {
    if (!this.isErrorToUpdateModelState(err)) {
      return
    }

    try {
      selected.model.state = this.modelErrorState(err)
      await this.setModelState(selected.model.name, selected.provider, selected.model, operationTimestamp)
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to set model state')
      return
    }

    // try to select a new model from the remaining models
    skipModels.push(`${selected.provider.provider.name}:${selected.model.name}`)
    const nextModel = await this.selectModel(models, skipModels)

    if (!nextModel) {
      this.logger.warn({ models }, 'No more models available')
      return
    }

    return nextModel
  }

  async shouldRetryStreamRequest (selected: ModelSelection, models: QueryModel[], skipModels: string[], err: FastifyError, operationTimestamp: number, context: ProviderContext): Promise<ModelSelection | undefined> {
    if (this.options.limits.retry && context.attempts++ < this.options.limits.retry.max) {
      const nextModel = await this.selectNextModel(selected, models, skipModels, err, operationTimestamp)
      if (!nextModel) {
        return
      }
      // wait here to avoid had flow with promises
      await wait(this.options.limits.retry.interval)
      return nextModel
    }
  }

  /**
   * Resume a request from storage starting from a specific event id
   */
  async resumeRequest (stream: AiStreamResponse, sessionId: AiSessionId, streamResponseType: StreamResponseType, resumeEventId: AiEventId)
    : Promise<{ complete: boolean, prompt: string | undefined, promptEventId: AiEventId | undefined }> {
    let complete = false
    let lastPrompt: AiStreamEventPrompt | undefined

    try {
      const existingHistory = await this.history.rangeFromId(sessionId, resumeEventId)
      const events = []

      // on streamResponseType === 'content', send events of a single response
      if (streamResponseType === 'content') {
        for (const event of existingHistory) {
          // TODO fix types
          // @ts-ignore
          if (event?.type === 'prompt') {
            // @ts-ignore
            lastPrompt = event
            continue
          }

          // do not send content on error
          if (event?.event === 'error') {
            events.length = 0
            break
          }

          events.push(event)
          // stop on end
          if (event?.event === 'end') {
            complete = event.data.response === 'COMPLETE'
            lastPrompt = undefined
            break
          }
        }
      } else if (streamResponseType === 'session') {
        // send all events but response with error
        // lookup for error and end event, collect only if end event is present and error is not
        // stop in case of error
        const buffer: AiStreamEvent[] = []
        for (const event of existingHistory) {
          // TODO fix types
          // @ts-ignore
          if (event?.type === 'prompt') {
            // @ts-ignore
            lastPrompt = event
            continue
          }

          // skip response containing error
          if (event?.event === 'error') {
            complete = false
            break
          } else if (event?.event === 'end') {
            // collect request-response pair only when complete
            events.push(lastPrompt)
            events.push(...buffer)
            buffer.length = 0
            lastPrompt = undefined
            continue
          }

          buffer.push(event)
        }

        if (buffer.length > 0) {
          complete = false
        }
      }

      for (const event of events) {
        this.sendEvent(stream, sessionId, streamResponseType, event, complete)
      }
    } catch (error) {
      this.logger.error({ error, sessionId }, 'Failed to resume stream')
    }

    // @ts-ignore TODO fix types
    return { complete, prompt: lastPrompt?.data?.prompt, promptEventId: lastPrompt?.id }
  }

  /** Subscribe to storage updates for this session and send events to the stream */
  async subscribeToStorage (stream: AiStreamResponse, sessionId: AiSessionId, streamResponseType: StreamResponseType) {
    const callback = (event: any) => this.sendEvent(stream, sessionId, streamResponseType, event, false)
    await this.storage.subscribe(sessionId, callback)
  }

  sendEvent (stream: AiStreamResponse, sessionId: AiSessionId, streamResponseType: StreamResponseType, event: any, close = true, callback?: (event: any) => void) {
    try {
      if (event.event === 'content') {
        const encodedEvent = encodeEvent(event)

        // Filter out prompt events if streamResponseType is content
        if (event.type === 'prompt' && streamResponseType === 'content') {
          return
        }
        stream.push(encodedEvent)
      } else if (event.event === 'end') {
        const encodedEvent = encodeEvent(event)
        stream.push(encodedEvent)
        close && stream.push(null) // End the stream
        callback && this.storage.unsubscribe(sessionId, callback)
      } else if (event.event === 'error') {
        const encodedEvent = encodeEvent(event)
        stream.push(encodedEvent)
        close && stream.destroy(event.data as Error)
        callback && this.storage.unsubscribe(sessionId, callback)
      }
    } catch (error) {
      this.logger.error({ error, sessionId }, 'Failed to process storage event')
      close && stream.destroy(error as Error)
      callback && this.storage.unsubscribe(sessionId, callback)
    }
  }

  // get the stream and push to history storage
  // it will be consumed by createResponseStream
  async pipeStreamResponseToStorage (sessionId: AiSessionId, providerResponse: Readable) {
    try {
      let endEvent: HistoryEndEvent | undefined

      for await (const chunk of providerResponse) {
        // Decode the chunk from Buffer to string
        const chunkString = chunk.toString('utf8')
        // Parse the event stream format to extract events
        const events = decodeEventStream(chunkString)

        // Process each event
        for (const event of events) {
          const eventId = event.id || createEventId()

          if (event.event === 'content') {
            const content = (event.data as any)?.response || ''

            const contentEvent: HistoryContentEvent = {
              event: 'content',
              data: { response: content },
              type: 'response'
            }

            await this.history.push(sessionId, eventId, contentEvent, this.options.limits.historyExpiration)
          } else if (event.event === 'end') {
            endEvent = {
              event: 'end',
              data: { response: (event.data as any).response || 'COMPLETE' }
            }
            await this.history.push(sessionId, eventId, endEvent, this.options.limits.historyExpiration)
          } else if (event.event === 'error') {
            this.logger.error({ error: event.data, sessionId }, 'Received error event on stream')
            // wrap error
            throw new ProviderStreamError(event.data.code, { cause: new Error(event.data.message) })
          }
        }
      }

      if (!endEvent) {
        await this.history.push(sessionId, createEventId(), {
          event: 'end',
          data: { response: 'COMPLETE' }
        }, this.options.limits.historyExpiration)
      }
    } catch (error: any) {
      this.logger.error({ error, sessionId }, 'Failed to pipe stream response to storage')
      const errorEvent: HistoryErrorEvent = {
        event: 'error',
        data: { code: error.code, message: error.message }
      }
      await this.history.push(sessionId, createEventId(), errorEvent, this.options.limits.historyExpiration)
      throw error
    }
  }

  async getHistory (sessionId?: AiSessionId, history?: AiChatHistory): Promise<{ messages: AiChatHistory, promptEventId?: AiEventId }> {
    if (history) {
      return { messages: history, promptEventId: undefined }
    }
    // if history and not sessionId, logic error, should not happen
    // TODO get and update history should be atomic for concurrent requests with same sessionId

    // load history from storage
    const contentHistory: AiStreamEvent[] = []
    try {
      const storedHistory = await this.history.range(sessionId!)
      if (!storedHistory || storedHistory.length < 1) { return { messages: [], promptEventId: undefined } }

      const contentBuffer: AiStreamEvent[] = []
      for (const event of storedHistory) {
        if (event?.type === 'prompt') {
          // @ts-ignore
          contentHistory.push(event!)
          continue
        }

        if (event?.event === 'error') {
          contentBuffer.length = 0
          continue
        } else if (event?.event === 'end') {
          contentHistory.push(...contentBuffer)
          contentBuffer.length = 0
          continue
        }

        contentBuffer.push(event)
      }
    } catch (err) {
      this.logger.error({ err, sessionId }, 'Failed to get history')
    }

    if (contentHistory.length < 1) {
      return { messages: [], promptEventId: undefined }
    }

    const lastEvent: AiStreamEvent = contentHistory?.at(-1)!
    let promptEventId: AiEventId | undefined

    // when last event is end, last request is complete, happy state
    // when last event is error, last request is incomplete, so surely it's a resume
    // when last event is a content and type is response, last request is incomplete, state is not clear: probabily it's a resume

    // when last event is a content and type is prompt, edge case: last event got an error before getting the response >
    // in this case, remove the last prompt to be replaced by the new prompt

    // when last event is not end, last request is incomplete
    if (lastEvent.type === 'prompt') {
      promptEventId = lastEvent.id
    }

    return { messages: this._compactHistory(contentHistory), promptEventId }
  }

  private _compactHistory (history: AiStreamEvent[]): AiChatHistory {
    const compactedHistory: AiChatHistory = []
    let lastResponse: string = ''
    let lastPrompt: string = ''
    for (const event of history) {
      if (event.type === 'response') {
        lastResponse = event.data.response!
      } else if (event.type === 'prompt') {
        lastPrompt = event.data.prompt!
      }
      if (lastResponse && lastPrompt) {
        compactedHistory.push({ prompt: lastPrompt, response: lastResponse })
        lastResponse = ''
        lastPrompt = ''
      }
    }

    return compactedHistory
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

  modelErrorState (error: FastifyError): ModelState['state'] {
    return {
      status: 'error',
      timestamp: Date.now(),
      reason: error.code as ModelStateErrorReason
    }
  }

  async checkRateLimit (model: ModelSelection, rateLimit: { max: number, timeWindow: number }) {
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

      if (response instanceof Readable) {
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

  private wrapStreamWithTimeout (stream: Readable, timeout: number): Readable {
    let timeoutId: NodeJS.Timeout | undefined

    const resetTimeout = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      timeoutId = setTimeout(() => {
        timeoutTransform.destroy(new ProviderRequestStreamTimeoutError(timeout))
      }, timeout).unref()
    }

    const timeoutTransform = new Transform({
      transform (chunk: Buffer, _encoding: string, callback: (error?: Error | null, data?: any) => void) {
        resetTimeout()
        callback(null, chunk)
      },

      flush (callback: (error?: Error | null, data?: any) => void) {
        if (timeoutId) {
          clearTimeout(timeoutId)
        }
        callback()
      }
    })

    // Set up initial timeout
    resetTimeout()

    // Handle source stream errors
    stream.on('error', (error) => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      timeoutTransform.destroy(error)
    })

    // Pipe the source stream through the timeout transform
    stream.pipe(timeoutTransform)

    return timeoutTransform
  }

  // TODO user grants
  async createSessionId () {
    return randomUUID()
  }

  // retryable error: will retry with same model
  isErrorRetryableSameModel (error: FastifyError) {
    return error.code === 'PROVIDER_STREAM_ERROR' ||
      error.code === 'PROVIDER_RESPONSE_ERROR'
  }

  isErrorToUpdateModelState (error: FastifyError) {
    return error.code === 'PROVIDER_STREAM_ERROR' ||
      error.code === 'PROVIDER_RATE_LIMIT_ERROR' ||
      error.code === 'PROVIDER_RESPONSE_ERROR' ||
      error.code === 'PROVIDER_REQUEST_TIMEOUT_ERROR' ||
      error.code === 'PROVIDER_REQUEST_STREAM_TIMEOUT_ERROR' ||
      error.code === 'PROVIDER_RESPONSE_NO_CONTENT' ||
      error.code === 'PROVIDER_EXCEEDED_QUOTA_ERROR' ||
      error.code === 'PROVIDER_RESPONSE_MAX_TOKENS_ERROR'
  }
}

export function createModelState (modelName: string): ModelState {
  return {
    name: modelName,
    rateLimit: { count: 0, windowStart: 0 },
    state: { status: 'ready', timestamp: 0, reason: 'NONE' }
  }
}

function mapResultError (code: string): AiResponseResult {
  if (code === 'COMPLETE') {
    return 'COMPLETE'
  }
  if (code === 'INCOMPLETE_MAX_TOKENS') {
    return 'INCOMPLETE_MAX_TOKENS'
  }
  return 'INCOMPLETE_UNKNOWN'
}

function createResponseStream (sessionId: AiSessionId): AiStreamResponse {
  const stream = new Readable({
    objectMode: false,
    read () { }
  }) as AiStreamResponse
  stream.sessionId = sessionId
  return stream
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

  async push (sessionId: string, eventId: string, value: HistoryContentEvent | HistoryEndEvent | HistoryErrorEvent, expiration: number, publish: boolean = true) {
    const eventData = {
      ...value,
      id: eventId,
      timestamp: Date.now()
    }

    return await this.storage.hashSet(sessionId, eventId, eventData, expiration, publish)
  }

  async range (sessionId: AiSessionId): Promise<AiStreamEvent[]> {
    const hash = await this.storage.hashGetAll(sessionId)

    // Convert hash to array and sort by timestamp to maintain order
    return Object.values(hash).sort((a: any, b: any) => a.timestamp - b.timestamp)
  }

  async rangeFromId (sessionId: AiSessionId, fromEventId: AiEventId) {
    const events = await this.range(sessionId)

    // Find the index of the fromEventId
    const fromIndex = events.findIndex((event: any) => event.id === fromEventId)

    // Return events from that index onwards, or empty array if not found
    return fromIndex >= 0 ? events.slice(fromIndex) : []
  }

  async getEvent (sessionId: AiSessionId, eventId: AiEventId) {
    return await this.storage.hashGet(sessionId, eventId)
  }
}

class Pubsub {
  storage: Storage

  constructor (storage: Storage) {
    this.storage = storage
  }

  async listen (sessionId: string) {
    return await this.storage.createSubscription(sessionId)
  }

  async remove (sessionId: string) {
    return await this.storage.removeSubscription(sessionId)
  }
}
