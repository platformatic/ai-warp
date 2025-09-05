import { type TestContext } from 'node:test'
import { create } from '../src/index.ts'

let apps = 0
export function getPort (): number {
  apps++
  return 3042 + apps
}

export async function createApplication (t: TestContext, { client, authConfig }: { client?: any; authConfig?: any }) {
  const port = getPort()

  const app = await create(import.meta.dirname, {
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
  })

  t.after(() => app.stop())

  await app.init()
  return app
}

export function createDummyClient () {
  return {
    init: async (_options: any, _context: any) => ({}),
    close: async (_api: any, _context: any) => {},
    request: async (_api: any, _request: any, _context: any) => ({}),
    stream: async (_api: any, _request: any, _context: any) => ({})
  }
}
