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

    this.client = new Redis({
      connectionName: 'client',
      ...connectionConfig
    })
    this.pubsub = new Redis({
      connectionName: 'pubsub',
      ...connectionConfig
    })

    // TODO PUBLISH __keyevent@0__:del mykey
    this.pubsub.on('message', (sessionId, event) => {
      try {
        const unserializedEvent = JSON.parse(event)
        this.subscriptions.emit(sessionId, unserializedEvent)
      } catch (error) {
        // TODO logger.error
        console.error('valkey pubsub message error', sessionId, event, error)
      }
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
      // TODO logger.error
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

  async hashSet (key: string, field: string, value: any, expiration: number, publish?: boolean) {
    try {
      const serializedValue = typeof value === 'string' ? value : JSON.stringify(value)
      await this.client.hset(key, field, serializedValue)
      await this.client.expire(key, Math.ceil(expiration / 1000))
      if (!publish) {
        return
      }
      await this.client.publish(key, serializedValue)
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
    try {
      if (!this.subscriptionsCount[sessionId]) {
        this.subscriptionsCount[sessionId] = 0
        await this.pubsub.subscribe(sessionId)
      }
      this.subscriptionsCount[sessionId]++
    } catch (error) {
    // TODO logger.error
      console.error('valkey createSubscription error', sessionId, error)
    }
  }

  async removeSubscription (sessionId: string) {
    try {
      this.subscriptionsCount[sessionId]--
      if (this.subscriptionsCount[sessionId] === 0) {
        await this.pubsub.unsubscribe(sessionId)
      }
    } catch {
    }
  }

  async subscribe (key: string, callback: (message: any) => void) {
    try {
      this.subscriptionsCount[key] = (this.subscriptionsCount[key] || 0) + 1
      this.subscriptions.on(key, callback)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new StorageGetError(key, errorMessage)
    }
  }

  async unsubscribe (key: string, callback: (message: any) => void) {
    try {
      this.subscriptionsCount[key] = (this.subscriptionsCount[key] || 0) - 1
      this.subscriptions.off(key, callback)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new StorageGetError(key, errorMessage)
    }
  }
}
