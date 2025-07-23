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
  private subscriptions: EventEmitter

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

    try {
      await this.client.config('SET', 'notify-keyspace-events', 'KE')
    } catch (error) {
      // TODO !! this.logger.error({ error }, 'Failed to set keyspace notifications')
    }

    // Subscribe to all keyspace events
    this.client.subscribe(`__keyspace@${connectionConfig.db}__:*`)

    this.client.on('message', async (sessionId, event) => {
      if(event !== 'hset') {
        return
      }
      try {
        const value = await this.valueGet(sessionId)
        this.subscriptions.emit(sessionId, value)
      } catch (error) {
        // TODO this.logger.error({ error }, 'Failed to get value')
      }
    })
  }

  async close () {
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

  async subscribe (sessionId: string, callback: (message: any) => void) {
    try {
      this.subscriptions.on(sessionId, callback)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new StorageGetError(sessionId, errorMessage)
    }
  }

  async unsubscribe (sessionId: string) {
    try {
      this.subscriptions.off(sessionId) // TODO !!
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new StorageGetError(sessionId, errorMessage)
    }
  }
}
