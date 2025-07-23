import { Redis } from 'iovalkey'
import type { AiStorageOptions, Storage, ValkeyOptions } from './index.ts'
import { StorageGetError, StorageListPushError, StorageListRangeError, StorageSetError } from '../errors.ts'
import EventEmitter from 'node:events'

const defaultValkeyOptions: ValkeyOptions = {
  host: 'localhost',
  port: 6379,
  database: 0
}

export class ValkeyStorage implements Storage {
  private options: AiStorageOptions
  private client!: Redis
  private pubsub!: Redis
  private subscriptions: EventEmitter
  private subscriptionsCount: Record<string, number> = {}

  constructor (options: AiStorageOptions) {
    // TODO validate options
    this.options = options
    this.subscriptions = new EventEmitter()
  }

  async init () {
    const valkeyOptions = this.options.valkey || {}

    const connectionConfig = {
      host: valkeyOptions.host || defaultValkeyOptions.host,
      port: valkeyOptions.port || defaultValkeyOptions.port,
      username: valkeyOptions.username,
      password: valkeyOptions.password,
      db: valkeyOptions.database || defaultValkeyOptions.database
    }

    this.client = new Redis(connectionConfig)
    this.pubsub = new Redis(connectionConfig)

    this.pubsub.on('message', (sessionId, event) => {
      this.subscriptions.emit(sessionId, event)
    })
  }

  async close () {
    await this.client.quit()
    await this.pubsub.quit()
  }

  async valueGet (key: string) {
    try {
      const value = await this.client.get(key)
      if (!value) {
        return
      }

      // Try to parse as JSON, fallback to string if it fails
      try {
        return JSON.parse(value)
      } catch {

      }
    } catch (error) {
      console.error('valkey valueGet error', key, error)
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new StorageGetError(key, errorMessage)
    }
  }

  async valueSet (key: string, value: any) {
    try {
      const serializedValue = typeof value === 'string' ? value : JSON.stringify(value)
      await this.client.set(key, serializedValue)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new StorageSetError(key, errorMessage)
    }
  }

  async hashSet (key: string, field: string, value: any, expiration: number) {
    try {
      const serializedValue = typeof value === 'string' ? value : JSON.stringify(value)
      await this.client.hset(key, field, serializedValue)
      await this.client.expire(key, Math.ceil(expiration / 1000))
      await this.pubsub.publish(key, value)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new StorageListPushError(key, errorMessage)
    }
  }

  async hashGetAll (key: string): Promise<Record<string, any>> {
    try {
      const hash = await this.client.hgetall(key)
      const result: Record<string, any> = {}

      for (const [field, value] of Object.entries(hash)) {
        try {
          result[field] = JSON.parse(value)
        } catch {
          result[field] = value
        }
      }

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new StorageListRangeError(key, errorMessage)
    }
  }

  async hashGet (key: string, field: string) {
    try {
      const value = await this.client.hget(key, field)
      if (!value) { return }

      try {
        return JSON.parse(value)
      } catch {
        return value
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new StorageGetError(key, errorMessage)
    }
  }

  async createSubscription (sessionId: string) {
    if (!this.subscriptionsCount[sessionId]) {
      this.subscriptionsCount[sessionId] = 0
      await this.pubsub.subscribe(sessionId)
    }
    this.subscriptionsCount[sessionId]++
  }

  async removeSubscription (sessionId: string) {
    this.subscriptionsCount[sessionId]--
    if (this.subscriptionsCount[sessionId] === 0) {
      await this.pubsub.unsubscribe(sessionId)
    }
  }

  async subscribe (sessionId: string, callback: (message: any) => void) {
    try {
      this.subscriptions.on(sessionId, callback)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new StorageGetError(sessionId, errorMessage)
    }
  }

  async unsubscribe (sessionId: string, callback: (message: any) => void) {
    try {
      this.subscriptions.off(sessionId, callback)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new StorageGetError(sessionId, errorMessage)
    }
  }
}
