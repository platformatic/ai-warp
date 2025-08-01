// Types duplicated from @platformatic/ai-provider to keep ai-client dependency-free
// This package is designed to be standalone and not depend on other Platformatic modules
export type TimeWindow = number | string
export type AiSessionId = string
export type AiEventId = string
export type AiProvider = 'openai' | 'deepseek' | 'gemini'
export type AiChatHistory = {
  prompt: string;
  response: string;
}[]
export type AiRestore = {
  rateLimit?: TimeWindow
  retry?: TimeWindow
  timeout?: TimeWindow
  providerCommunicationError?: TimeWindow
  providerExceededError?: TimeWindow
}
export type AiModel = {
  provider: AiProvider;
  model: string;
  limits?: {
    maxTokens?: number;
    rate?: {
      max: number;
      timeWindow: TimeWindow;
    };
  };
  restore?: AiRestore;
}
export type AiResponseResult = 'COMPLETE' | 'INCOMPLETE_MAX_TOKENS' | 'INCOMPLETE_UNKNOWN'
//

export type LogDataPrimitive = string | number | boolean | null | undefined | Error

export interface LogDataObject {
  [key: string]: LogDataValue
}

export type LogDataValue = LogDataPrimitive | LogDataObject | LogDataValue[]

export type LogData = LogDataValue

export interface Logger {
  debug(message: string, data?: LogData): void
  info(message: string, data?: LogData): void
  warn(message: string, data?: LogData): void
  error(message: string, data?: LogData): void
}

export interface ClientOptions {
  url: string
  headers?: Record<string, string>
  timeout?: number
  logger?: Logger
  promptPath?: string
  streamPath?: string
}

export type ContextValue = string | number | boolean | null | undefined | ContextObject | ContextValue[]
export interface ContextObject {
  [key: string]: ContextValue
}
export type Context = string | ContextObject | ContextValue[]

export type QueryModel = string | AiModel

export interface AskOptions {
  prompt: string
  sessionId?: AiSessionId
  context?: Context
  temperature?: number
  models?: QueryModel[]
  history?: AiChatHistory
  stream?: boolean
  resume?: boolean
  resumeEventId?: AiEventId
}

export interface AskResponse {
  text: string
  sessionId: AiSessionId
  result: AiResponseResult
}

export interface StreamMessage {
  type: 'content' | 'error' | 'done'
  content?: string
  error?: Error
  response?: AskResponse
}

export interface AsyncIterableStream<T> {
  [Symbol.asyncIterator](): AsyncIterator<T>
}

export interface AskResponseStream {
  stream: AsyncIterableStream<StreamMessage>
  headers: Headers
}

export interface AskResponseData {
  text: string
  sessionId: AiSessionId
  result: AiResponseResult
}

export interface AskResponseContent {
  content: AskResponseData
  headers: Headers
}
