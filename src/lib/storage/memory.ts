import type { StorageOptions, Storage } from './index.ts'

export class MemoryStorage implements Storage {
  values: KeyValueStorage
  list: ListStorage

  constructor (_options: StorageOptions) {
    this.values = new KeyValueStorage()
    this.list = new ListStorage()
  }

  async valueGet (key: string) {
    return this.values.get(key)
  }

  async valueSet (key: string, value: any) {
    this.values.set(key, value)
  }

  async listPush (key: string, value: any) {
    this.list.push(key, value)
  }

  async listRange (key: string) {
    return this.list.range(key)
  }
}

class KeyValueStorage {
  storage: Map<string, string>

  constructor () {
    this.storage = new Map()
  }

  async get (key: string) {
    return this.storage.get(key)
  }

  async set (key: string, value: any) {
    this.storage.set(key, value)
  }
}

class ListStorage {
  storage: Map<string, string[]>

  constructor () {
    this.storage = new Map()
  }

  async push (key: string, value: any) {
    const list = this.storage.get(key) || []
    list.push(value)
    this.storage.set(key, list)
  }

  async range (key: string) {
    return this.storage.get(key) || []
  }
}
