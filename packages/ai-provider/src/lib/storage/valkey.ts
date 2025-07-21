import { Redis } from 'iovalkey'
import type { AiStorageOptions, Storage, ValkeyOptions } from './index.ts'
import { StorageGetError, StorageListPushError, StorageListRangeError, StorageSetError } from '../errors.ts'

const defaultValkeyOptions: ValkeyOptions = {
  host: 'localhost',
  port: 6379,
  database: 0
}

export class ValkeyStorage implements Storage {
  private client: Redis
  private subscriber: Redis
  private subscriptions: Map<string, (message: any) => void>

  constructor (options: AiStorageOptions) {
    // TODO validate options

    const valkeyOptions = options.valkey || {} // TODO when validated

    const connectionConfig = {
      host: valkeyOptions.host || defaultValkeyOptions.host,
      port: valkeyOptions.port || defaultValkeyOptions.port,
      username: valkeyOptions.username,
      password: valkeyOptions.password,
      db: valkeyOptions.database || defaultValkeyOptions.database
    }

    this.client = new Redis(connectionConfig)
    this.subscriber = new Redis(connectionConfig)
    this.subscriptions = new Map()

    // Handle subscriber messages
    this.subscriber.on('message', (channel, message) => {
      const callback = this.subscriptions.get(channel)
      if (callback) {
        try {
          const parsedMessage = JSON.parse(message)
          callback(parsedMessage)
        } catch {
          callback(message)
        }
      }
    })
  }

  async close () {
    await this.subscriber.quit()
    await this.client.quit()
  }

  async valueGet (key: string) {
    try {
      const value = await this.client.get(key)
      if (value === null) {
        return undefined
      }

      // Try to parse as JSON, fallback to string if it fails
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
      await this.client.expire(key, expiration / 1000)
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
      if (value === null) {
        return undefined
      }

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

  async publish (channel: string, message: any) {
    try {
      const serializedMessage = typeof message === 'string' ? message : JSON.stringify(message)
      await this.client.publish(channel, serializedMessage)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new StorageSetError(channel, errorMessage)
    }
  }

  async subscribe (channel: string, callback: (message: any) => void) {
    try {
      this.subscriptions.set(channel, callback)
      await this.subscriber.subscribe(channel)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new StorageGetError(channel, errorMessage)
    }
  }

  async unsubscribe (channel: string) {
    try {
      this.subscriptions.delete(channel)
      await this.subscriber.unsubscribe(channel)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new StorageGetError(channel, errorMessage)
    }
  }
}
