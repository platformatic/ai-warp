import { Redis } from 'iovalkey'
import type { StorageOptions, Storage, ValkeyOptions } from './index.ts'
import { StorageGetError, StorageListPushError, StorageListRangeError, StorageSetError } from '../errors.ts'

const defaultValkeyOptions: ValkeyOptions = {
  host: 'localhost',
  port: 6379,
  database: 0
}

export class ValkeyStorage implements Storage {
  private client: Redis

  constructor (options: StorageOptions) {
    // TODO validate options

    const valkeyOptions = options.valkey || {} // TODO when validated

    this.client = new Redis({
      host: valkeyOptions.host || defaultValkeyOptions.host,
      port: valkeyOptions.port || defaultValkeyOptions.port,
      username: valkeyOptions.username,
      password: valkeyOptions.password,
      db: valkeyOptions.database || defaultValkeyOptions.database
    })
  }

  async init () {
    // TODO try/catch
    // await this.client.connect()
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

  async listPush (key: string, value: any, expiration: number) {
    try {
      await this.client.lpush(key, JSON.stringify(value))
      await this.client.expire(key, expiration / 1000)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new StorageListPushError(key, errorMessage)
    }
  }

  async listRange (key: string) {
    try {
      const list = await this.client.lrange(key, 0, -1)
      return list.map(item => JSON.parse(item))
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new StorageListRangeError(key, errorMessage)
      // TODO return [] if key does not exists
    }
  }
}
