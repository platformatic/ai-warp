import { buildServer } from '@platformatic/service'
import stackable from '../dist/index.js'
import type { AiWarpConfig } from '../config.js'

let apps = 0
export function getPort (): number {
  apps++
  return 3042 + apps
}

export async function createApp ({ client, authConfig }: { client?: any, authConfig?: any }) {
  const port = getPort()

  const config: AiWarpConfig = {
    server: {
      port,
      forceCloseConnections: true,
      logger: { level: 'silent' }
    },
    service: { openapi: true },
    ai: {
      providers: {
        openai: {
          apiKey: 'test',
          client: client || createDummyClient()
        }
      },
      models: [
        {
          provider: 'openai',
          model: 'gpt-4o-mini'
        }
      ]
    },
    auth: authConfig
  }

  const app = await buildServer(config, stackable)

  return [app, port]
}

export function createDummyClient () {
  return {
    init: async (_options: any, _context: any) => ({}),
    close: async (_api: any, _context: any) => {},
    request: async (_api: any, _request: any, _context: any) => ({}),
    stream: async (_api: any, _request: any, _context: any) => ({})
  }
}
