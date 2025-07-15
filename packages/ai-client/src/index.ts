import { Client } from './client.ts'
import type { ClientOptions, AIClient } from './types.ts'

export function buildClient (options: ClientOptions): AIClient {
  return new Client(options)
}

export type {
  ClientOptions,
  AskOptions,
  AskResponse,
  StreamMessage,
  AIClient
} from './types.ts'
