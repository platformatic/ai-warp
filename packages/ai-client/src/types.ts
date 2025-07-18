// Types duplicated from @platformatic/ai-provider to keep ai-client dependency-free
// This package is designed to be standalone and not depend on other Platformatic modules
export type TimeWindow = number | string
export type AiSessionId = string
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

export interface Logger {
  debug(message: string, data?: any): void
  info(message: string, data?: any): void
  warn(message: string, data?: any): void
  error(message: string, data?: any): void
}

export interface ClientOptions {
  url: string
  headers?: Record<string, string>
  timeout?: number
  logger?: Logger
  promptPath?: string
  streamPath?: string
}

export type QueryModel = string | AiModel

export interface AskOptions {
  prompt: string
  sessionId?: AiSessionId
  context?: string | Record<string, any> | any[]
  temperature?: number
  models?: QueryModel[]
  history?: AiChatHistory
  stream?: boolean
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

export interface AskResponseContent {
  content: JSON
  headers: Headers
}
