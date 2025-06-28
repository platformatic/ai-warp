import { MemoryStorage } from './memory.ts'
import { ValkeyStorage } from './valkey.ts'

export type StorageType = 'memory' | 'valkey'

export type StorageOptions = {
  type: StorageType
}

export type Storage = {
  get: (key: string) => Promise<any>
  set: (key: string, value: any) => Promise<void>
}

const defaultStorageOptions: StorageOptions = {
  type: 'memory'
}

export function createStorage (options?: StorageOptions): Storage {
  // TODO validate options
  const storageOptions = options ? { ...defaultStorageOptions, ...options } : defaultStorageOptions

  if (storageOptions.type === 'valkey') {
    return new ValkeyStorage(storageOptions)
  } else {
    return new MemoryStorage(storageOptions)
  }
}
