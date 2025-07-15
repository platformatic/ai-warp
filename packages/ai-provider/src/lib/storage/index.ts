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
  listPush: (key: string, value: any, expiration: number) => Promise<void>
  listRange: (key: string) => Promise<any[]>
}

const defaultStorageOptions: AiStorageOptions = {
  type: 'memory'
}

export async function createStorage (options?: AiStorageOptions): Promise<Storage> {
  // TODO validate options
  const storageOptions = options ? { ...defaultStorageOptions, ...options } : defaultStorageOptions

  if (storageOptions.type === 'valkey') {
    const s = new ValkeyStorage(storageOptions)
    // TODO try/catch
    await s.init()
    return s
  } else {
    return new MemoryStorage(storageOptions)
  }
}
