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

  async listPush (key: string, value: any, expiration: number) {
    this.list.push(key, value, expiration)
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

type ListValue = {
  value: any
  expire: number
}

class ListStorage {
  storage: Map<string, ListValue[]>

  constructor () {
    this.storage = new Map()
  }

  async push (key: string, value: any, expiration: number) {
    const list = this.storage.get(key) || []
    list.push({ value, expire: Date.now() + expiration })

    // Clean up expired items when pushing new ones
    const now = Date.now()
    const filteredList = list.filter(item => item.expire > now)

    this.storage.set(key, filteredList)
  }

  async range (key: string) {
    const list = this.storage.get(key)
    if (!list) { return [] }

    const now = Date.now()
    const validItems = list.filter(item => item.expire > now)

    // Update storage with filtered items to remove expired ones
    if (validItems.length !== list.length) {
      this.storage.set(key, validItems)
    }

    return validItems.map(item => item.value)
  }
}
