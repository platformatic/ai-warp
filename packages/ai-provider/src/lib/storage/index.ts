import { MemoryStorage } from './memory.ts'
import { ValkeyStorage } from './valkey.ts'

export type StorageType = 'memory' | 'valkey'

export type ValkeyOptions = {
  host?: string
  port?: number
  username?: string
  password?: string
  database?: number
}

export type AiStorageOptions = {
  type: StorageType
  valkey?: ValkeyOptions
}

export type Storage = {
  valueGet: (key: string) => Promise<any>
  valueSet: (key: string, value: any) => Promise<void>
  hashSet: (key: string, field: string, value: any, expiration: number) => Promise<void>
  hashGetAll: (key: string) => Promise<Record<string, any>>
  hashGet: (key: string, field: string) => Promise<any>
  publish: (channel: string, message: any) => Promise<void>
  subscribe: (channel: string, callback: (message: any) => void) => Promise<void>
  unsubscribe: (channel: string) => Promise<void>
  close: () => Promise<void>
}

const defaultStorageOptions: AiStorageOptions = {
  type: 'memory'
}

export async function createStorage (options?: AiStorageOptions): Promise<Storage> {
  // TODO validate options
  const storageOptions = options ? { ...defaultStorageOptions, ...options } : defaultStorageOptions

  if (storageOptions.type === 'valkey') {
    // TODO try/catch connection may fail
    const s = new ValkeyStorage(storageOptions)
    return s
  } else {
    return new MemoryStorage(storageOptions)
  }
}
