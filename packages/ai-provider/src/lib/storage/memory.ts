import { EventEmitter } from 'node:events'
import type { AiStorageOptions, Storage } from './index.ts'

export class MemoryStorage implements Storage {
  values: KeyValueStorage
  hash: HashStorage
  pubsub: PubSubStorage

  constructor (_options: AiStorageOptions) {
    this.values = new KeyValueStorage()
    this.hash = new HashStorage()
    this.pubsub = new PubSubStorage()
  }

  async init () {
    // nothing to do
  }

  async close () {
    // nothing to do
  }

  async valueGet (key: string) {
    return this.values.get(key)
  }

  async valueSet (key: string, value: any) {
    this.values.set(key, value)
  }

  async hashSet (key: string, field: string, value: any, expiration: number, publish?: boolean) {
    this.hash.set(key, field, value, expiration)
    if (!publish) {
      return
    }

    // Publish the event to notify subscribers
    // The value should be the event data that was stored
    this.pubsub.publish(key, value)
  }

  async hashGetAll (key: string) {
    return this.hash.getAll(key)
  }

  async hashGet (key: string, field: string) {
    return this.hash.get(key, field)
  }

  async createSubscription (_sessionId: string) {
    // nothing to do
  }

  async removeSubscription (_sessionId: string) {
    // nothing to do
  }

  async subscribe (channel: string, callback: (message: any) => void) {
    this.pubsub.subscribe(channel, callback)
  }

  async unsubscribe (channel: string, callback: (message: any) => void) {
    this.pubsub.unsubscribe(channel, callback)
  }
}

class KeyValueStorage {
  storage: Map<string, string>

  constructor () {
    this.storage = new Map()
  }

  close () {
    // nothing to do
  }

  async get (key: string) {
    return this.storage.get(key)
  }

  async set (key: string, value: any) {
    this.storage.set(key, value)
  }
}

type HashValue = {
  value: any
  expire: number
}

type HashData = Map<string, HashValue>

class HashStorage {
  storage: Map<string, HashData>

  constructor () {
    this.storage = new Map()
  }

  async set (key: string, field: string, value: any, expiration: number) {
    let hash = this.storage.get(key)
    if (!hash) {
      hash = new Map()
      this.storage.set(key, hash)
    }

    hash.set(field, { value, expire: Date.now() + expiration })

    // Clean up expired fields when setting new ones
    this.cleanExpired(key)
  }

  async get (key: string, field: string) {
    const hash = this.storage.get(key)
    if (!hash) { return undefined }

    const hashValue = hash.get(field)
    if (!hashValue) { return undefined }

    const now = Date.now()
    if (hashValue.expire <= now) {
      hash.delete(field)
      return undefined
    }

    return hashValue.value
  }

  async getAll (key: string): Promise<Record<string, any>> {
    const hash = this.storage.get(key)
    if (!hash) { return {} }

    this.cleanExpired(key)

    const result: Record<string, any> = {}
    for (const [field, hashValue] of hash.entries()) {
      result[field] = hashValue.value
    }

    return result
  }

  private cleanExpired (key: string) {
    const hash = this.storage.get(key)
    if (!hash) { return }

    const now = Date.now()
    for (const [field, hashValue] of hash.entries()) {
      if (hashValue.expire <= now) {
        hash.delete(field)
      }
    }

    // Remove the key if no fields remain
    if (hash.size === 0) {
      this.storage.delete(key)
    }
  }
}

class PubSubStorage extends EventEmitter {
  publish (channel: string, message: any) {
    this.emit(channel, message)
  }

  subscribe (channel: string, callback: (message: any) => void) {
    this.on(channel, callback)
  }

  unsubscribe (channel: string, callback: (message: any) => void) {
    this.off(channel, callback)
  }
}
