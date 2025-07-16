import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { schema } from '@platformatic/service'
import { fileURLToPath } from 'node:url'

const pkgJsonPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json')

const pkgJson: { version: string } = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))

const aiWarpSchema = {
  ...schema.schema,
  $id: `https://schemas.platformatic.com/@platformatic/ai-warp/${pkgJson.version}.json`,
  title: 'Ai Warp Config',
  version: pkgJson.version,
  properties: {
    ...schema.schema.properties,
    module: { type: 'string' },
    // AiPluginOptions from @platformatic/fastify-ai
    ai: {
      type: 'object',
      required: ['providers', 'models'],
      additionalProperties: false,
      properties: {
        headerSessionIdName: { type: 'string', default: 'x-session-id' },
        promptPath: { type: 'string', default: '/api/v1/prompt' },
        streamPath: { type: 'string', default: '/api/v1/stream' },
        providers: {
          type: 'object',
          additionalProperties: false,
          properties: {
            openai: { 
              type: 'object', 
              required: ['apiKey'],
              properties: { 
                apiKey: { type: 'string' }
              } 
            },
            deepseek: { 
              type: 'object', 
              required: ['apiKey'],
              properties: { 
                apiKey: { type: 'string' }
              } 
            },
            gemini: { 
              type: 'object', 
              required: ['apiKey'],
              properties: { 
                apiKey: { type: 'string' }
              } 
            }
          }
        },
        models: {
          type: 'array',
          items: {
            type: 'object',
            required: ['provider', 'model'],
            additionalProperties: false,
            properties: {
              provider: { type: 'string', enum: ['openai', 'deepseek', 'gemini'] },
              model: { type: 'string' },
              limits: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  maxTokens: { type: 'number' },
                  rate: {
                    type: 'object',
                    required: ['max', 'timeWindow'],
                    properties: {
                      max: { type: 'number' },
                      timeWindow: { anyOf: [{ type: 'number' }, { type: 'string' }] }
                    }
                  }
                }
              },
              restore: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  rateLimit: { anyOf: [{ type: 'number' }, { type: 'string' }] },
                  retry: { anyOf: [{ type: 'number' }, { type: 'string' }] },
                  timeout: { anyOf: [{ type: 'number' }, { type: 'string' }] },
                  providerCommunicationError: { anyOf: [{ type: 'number' }, { type: 'string' }] },
                  providerExceededError: { anyOf: [{ type: 'number' }, { type: 'string' }] }
                }
              }
            }
          }
        },
        storage: {
          type: 'object',
          additionalProperties: false,
          required: ['type'],
          properties: {
            type: { type: 'string', default: 'memory', enum: ['memory', 'valkey'] },
            valkey: {
              type: 'object',
              properties: {
                host: { type: 'string' },
                port: { type: 'number' },
                username: { type: 'string' },
                password: { type: 'string' },
                database: { type: 'number' }
              }
            }
          }
        },
        limits: {
          type: 'object',
          additionalProperties: false,
          properties: {
            maxTokens: { type: 'number' },
            rate: {
              type: 'object',
              required: ['max', 'timeWindow'],
              properties: {
                max: { type: 'number' },
                timeWindow: { anyOf: [{ type: 'number' }, { type: 'string' }] }
              }
            },
            requestTimeout: { type: 'number' },
            retry: { 
              type: 'object', 
              required: ['max', 'interval'],
              properties: { 
                max: { type: 'number' }, 
                interval: { type: 'number' } 
              } 
            },
            historyExpiration: { anyOf: [{ type: 'number' }, { type: 'string' }] }
          }
        },
        restore: {
          type: 'object',
          additionalProperties: false,
          properties: {
            rateLimit: { anyOf: [{ type: 'number' }, { type: 'string' }] },
            retry: { anyOf: [{ type: 'number' }, { type: 'string' }] },
            timeout: { anyOf: [{ type: 'number' }, { type: 'string' }] },
            providerCommunicationError: { anyOf: [{ type: 'number' }, { type: 'string' }] },
            providerExceededError: { anyOf: [{ type: 'number' }, { type: 'string' }] }
          }
        }
      }
    },
  },
  required: ['ai'],
  additionalProperties: false
}

export { aiWarpSchema as schema }

if (process.argv.length > 2 && process.argv[2] === '--dump-schema') {
  console.log(JSON.stringify(aiWarpSchema, null, 2))
}
