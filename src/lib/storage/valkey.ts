import { Redis } from 'iovalkey'
import type { StorageOptions, Storage, ValkeyOptions } from './index.ts'

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
      throw new Error(`Failed to get value for key "${key}": ${errorMessage}`)
    }
  }

  async valueSet (key: string, value: any) {
    try {
      const serializedValue = typeof value === 'string' ? value : JSON.stringify(value)
      await this.client.set(key, serializedValue)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to set value for key "${key}": ${errorMessage}`)
    }
  }

  async listPush (key: string, value: any) {
    await this.client.lpush(key, JSON.stringify(value))
  }

  async listRange (key: string) {
    const list = await this.client.lrange(key, 0, -1)
    return list.map(item => JSON.parse(item))
  }
}
