import type { StorageOptions, Storage } from './index.ts'

export class MemoryStorage implements Storage {
  storage: Map<string, string>

  constructor (options: StorageOptions) {
    this.storage = new Map()
  }

  async get (key: string) {
    return this.storage.get(key)
  }

  async set (key: string, value: any) {
    this.storage.set(key, value)
  }
}
