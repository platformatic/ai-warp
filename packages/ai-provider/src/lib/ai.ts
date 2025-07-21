import { randomUUID } from 'node:crypto'
import { setTimeout as wait } from 'node:timers/promises'
import { Readable, Transform } from 'node:stream'
import cloneable from 'cloneable-readable'
import type { Logger } from 'pino'
import type { FastifyError } from '@fastify/error'

import { type AiChatHistory, type Provider, type ProviderClient, type ProviderOptions, type ProviderRequestOptions, type ProviderResponse, type AiSessionId, createAiProvider } from './provider.ts'
import { createStorage, type Storage, type AiStorageOptions } from './storage/index.ts'
import { parseTimeWindow } from './utils.ts'
import { HistoryGetError, ModelStateError, OptionError, ProviderNoModelsAvailableError, ProviderRateLimitError, ProviderRequestStreamTimeoutError, ProviderRequestTimeoutError } from './errors.ts'
import { DEFAULT_HISTORY_EXPIRATION, DEFAULT_MAX_RETRIES, DEFAULT_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_TIME_WINDOW, DEFAULT_REQUEST_TIMEOUT, DEFAULT_RESTORE_PROVIDER_COMMUNICATION_ERROR, DEFAULT_RESTORE_PROVIDER_EXCEEDED_QUOTA_ERROR, DEFAULT_RESTORE_RATE_LIMIT, DEFAULT_RESTORE_REQUEST_TIMEOUT, DEFAULT_RESTORE_RETRY, DEFAULT_RETRY_INTERVAL, DEFAULT_STORAGE } from './config.ts'
import { createEventId, decodeEventStream } from './event.ts'

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
  resume?: boolean
}

type ValidatedRequest = {
  models: QueryModel[]
  prompt: string
  options: ProviderRequestOptions
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

  // TODO
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
      // no PROVIDER_RESPONSE_MAX_TOKENS_ERROR because it depends by options
      return false
    }

    return modelState.state.timestamp + wait < Date.now()
  }

  async validateRequest (request: Request): Promise<ValidatedRequest> {
    if (request.options?.history && request.options?.sessionId) {
      throw new OptionError('history and sessionId cannot be used together')
    }

    const validatedRequest: ValidatedRequest = {
      models: [],
      prompt: request.prompt,
      options: {
        ...(request.options ?? {}),
        sessionId: request.options?.sessionId,
        history: request.options?.history
      },
    }

    if (request.options?.sessionId) {
      try {
        validatedRequest.options.history = await this.history.range(request.options.sessionId)
        if (!validatedRequest.options.history || validatedRequest.options.history.length < 1) {
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
      validatedRequest.models = request.models
    } else {
      validatedRequest.models = this.options.models
    }

    return validatedRequest
  }

  async request (request: Request): Promise<Response> {
    const req = await this.validateRequest(request)

    this.logger.debug({ request }, 'AI request')

    const sessionId: AiSessionId = req.options.sessionId ?? await this.createSessionId()

    // Handle stream resume functionality
    const shouldResume = request.resume !== false // Default to true

    // If resume is enabled and we have a sessionId, try to auto-resume from the last event
    if (shouldResume && req.options.sessionId && req.options.stream) {
      try {
        const allEvents = await this.history.range(req.options.sessionId)
        if (allEvents.length > 0) {
          // Get the last event ID to resume from
          const lastEvent = allEvents[allEvents.length - 1]
          const resumeFromEventId = lastEvent.eventId
          this.logger.debug({
            sessionId: req.options.sessionId,
            lastEventId: resumeFromEventId,
            totalEvents: allEvents.length
          }, 'Auto-resuming from last event')

          // Try to get events from the last event ID
          const events = await this.history.rangeFromId(req.options.sessionId, resumeFromEventId)

          if (events.length > 0) {
            // Create a resumable stream from historical events
            const resumeStream = this.createResumeStream(events, sessionId)
            return resumeStream as AiStreamResponse
          } else {
            this.logger.debug({ resumeFromEventId, sessionId }, 'No events found for resume, continuing with normal request')
          }
        }
      } catch (error: any) {
        // If we can't get events or resume fails, continue with normal request
        this.logger.debug({ sessionId: req.options.sessionId, error }, 'Could not auto-resume, continuing with normal request')
      }
    }

    const models: QueryModel[] = req.models
    const skipModels: string[] = []

    let selected = await this.selectModel(models)
    if (!selected) {
      this.logger.warn({ models }, 'No models available')
      throw new ProviderNoModelsAvailableError(models.map(m => typeof m === 'string' ? m : `${m.provider}:${m.model}`).join(', '))
    }

    let response!: Response
    const history: AiChatHistory | undefined = req.options.history

    while (selected) {
      this.logger.debug({ model: selected.model.name }, 'Selected model')

      const options = {
        context: req.options.context,
        temperature: req.options.temperature,
        stream: req.options.stream,
        history,
        maxTokens: selected.settings.limits.maxTokens ?? req.options.maxTokens ?? this.options.limits.maxTokens
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

            // do not retry on timeout errors and empty response
            if (error.code && (error.code === 'PROVIDER_REQUEST_TIMEOUT_ERROR' ||
              error.code === 'PROVIDER_REQUEST_STREAM_TIMEOUT_ERROR' ||
              error.code === 'PROVIDER_RESPONSE_MAX_TOKENS_ERROR')) {
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
        if (typeof providerResponse.pipe === 'function') {
          // Clone the stream using cloneable-readable for history processing
          // @ts-ignore
          const cloneableStream = cloneable(providerResponse as Readable)
          const responseStream = cloneableStream // Return the original
          const historyStream = cloneableStream.clone() // Create one clone for history

          // Handle streaming response: process history/pub/sub in background
          const streamChannel = `ai-stream:${sessionId}`
          let accumulatedResponse = ''

          // Process the cloned stream in background to accumulate response for history and pub/sub
          const processStreamInBackground = async () => {
            try {
              for await (const chunk of historyStream) {
                // Decode the chunk from Buffer to string
                const chunkString = chunk.toString('utf8')

                // Parse the event stream format to extract events
                const events = decodeEventStream(chunkString)

                // Process each event
                for (const event of events) {
                  const eventId = event.id || createEventId()

                  if (event.event === 'content') {
                    const content = (event.data as any)?.response || (event.data as any)?.content || ''
                    accumulatedResponse += content

                    // Publish streaming event via pub/sub
                    await this.storage.publish(streamChannel, {
                      eventId,
                      type: 'content',
                      sessionId,
                      data: event.data
                    })
                  } else if (event.event === 'error') {
                    // Store error to history
                    await this.history.push(sessionId, eventId, {
                      prompt: request.prompt,
                      error: event.data
                    }, this.options.limits.historyExpiration)

                    // Publish error event
                    await this.storage.publish(streamChannel, {
                      eventId,
                      type: 'error',
                      sessionId,
                      data: event.data
                    })
                    return
                  }
                }
              }

              // Store final accumulated response to history
              const finalEventId = createEventId()
              await this.history.push(sessionId, finalEventId, {
                prompt: request.prompt,
                response: accumulatedResponse
              }, this.options.limits.historyExpiration)

              // Publish final event
              await this.storage.publish(streamChannel, {
                eventId: finalEventId,
                type: 'complete',
                sessionId,
                data: { response: accumulatedResponse }
              })
            } catch (error: any) {
              // Store error to history
              const errorEventId = createEventId()
              await this.history.push(sessionId, errorEventId, {
                prompt: request.prompt,
                error: error.message || String(error)
              }, this.options.limits.historyExpiration)

              // Publish error event
              await this.storage.publish(streamChannel, {
                eventId: errorEventId,
                type: 'error',
                sessionId,
                data: { message: error.message || String(error) }
              })
            }
          }

          // Process stream in background (don't await to avoid blocking the response)
          processStreamInBackground().catch(error => {
            this.logger.error({ error }, 'Failed to process stream for history/pubsub')
          });

          // Attach sessionId to the stream for the user
          (responseStream as any).sessionId = sessionId
          return responseStream as unknown as AiStreamResponse
        }

        const contentResponse: AiContentResponse = response as AiContentResponse
        contentResponse.sessionId = sessionId
        await this.history.push(sessionId, createEventId(), { prompt: request.prompt, response: contentResponse.text }, this.options.limits.historyExpiration)

        return contentResponse
      } catch (error: any) { // TODO fix type
        // skip:
        // - storage errors
        // - PROVIDER_RESPONSE_MAX_TOKENS_ERROR (options error)
        // update state if errors are one of:
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

  private createResumeStream (events: any[], sessionId: AiSessionId): Readable {
    let eventIndex = 0

    const resumeStream = new Readable({
      read () {
        // Process events sequentially with a small delay to simulate streaming
        const processNextEvent = () => {
          if (eventIndex >= events.length) {
            // All events processed
            this.push(null)
            return
          }

          const event = events[eventIndex++]

          // Create SSE-formatted chunk for the event
          let eventType = 'content'
          let eventData = event

          // Handle different event types based on stored data structure
          if (event.error) {
            eventType = 'error'
            eventData = { message: event.error }
          } else if (event.response) {
            eventType = 'content'
            eventData = { response: event.response }
          }

          // Format as Server-Sent Event
          const sseChunk = `event: ${eventType}\ndata: ${JSON.stringify(eventData)}\nid: ${event.eventId || createEventId()}\n\n`
          const encodedChunk = Buffer.from(sseChunk, 'utf8')

          this.push(encodedChunk)

          // Schedule next event with a small delay to simulate real streaming
          setTimeout(processNextEvent, 10)
        }

        // Start processing
        processNextEvent()
      }
    })

    // Attach sessionId to the resume stream
    ;(resumeStream as any).sessionId = sessionId
    return resumeStream
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

  async push (sessionId: string, eventId: string, value: any, expiration: number) {
    // Add eventId and timestamp to the stored value for resume functionality
    const eventData = {
      ...value,
      eventId,
      timestamp: Date.now()
    }
    return await this.storage.hashSet(sessionId, eventId, eventData, expiration)
  }

  async range (sessionId: string) {
    const hash = await this.storage.hashGetAll(sessionId)

    // Convert hash to array and sort by timestamp to maintain order
    return Object.values(hash).sort((a: any, b: any) => a.timestamp - b.timestamp)
  }

  async rangeFromId (sessionId: string, fromEventId: string) {
    const hash = await this.storage.hashGetAll(sessionId)

    // Convert to array and sort by timestamp
    const events = Object.values(hash).sort((a: any, b: any) => a.timestamp - b.timestamp)

    // Find the index of the fromEventId
    const fromIndex = events.findIndex((event: any) => event.eventId === fromEventId)

    // Return events from that index onwards, or empty array if not found
    return fromIndex >= 0 ? events.slice(fromIndex) : []
  }

  async getEvent (sessionId: string, eventId: string) {
    return await this.storage.hashGet(sessionId, eventId)
  }
}
