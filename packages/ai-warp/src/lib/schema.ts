import { schema as serviceSchema } from '@platformatic/service'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const packageJson = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf-8'))
export const version = packageJson.version

export const ai = {
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
}

export const auth = {
  type: 'object',
  additionalProperties: false,
  properties: {
    required: {
      type: 'boolean',
      description: 'If true, any unauthenticated requests will be blocked',
      default: false
    },
    jwt: {
      type: 'object',
      additionalProperties: false,
      properties: {
        jwks: {
          oneOf: [
            { type: 'boolean' },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                max: { type: 'number' },
                ttl: { type: 'number' },
                issuersWhitelist: {
                  type: 'array',
                  items: { type: 'string' }
                },
                providerDiscovery: { type: 'boolean' },
                jwksPath: { type: 'string' },
                timeout: { type: 'number' }
              }
            }
          ]
        },
        secret: {
          oneOf: [
            { type: 'string' },
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                public: { type: 'string' },
                private: { type: 'string' }
              },
              required: ['public']
            }
          ]
        },
        decode: {
          type: 'object',
          additionalProperties: false,
          properties: {
            complete: { type: 'boolean' },
            checkTyp: { type: 'string' }
          }
        },
        sign: {
          type: 'object',
          additionalProperties: false,
          properties: {
            expiresIn: {
              oneOf: [{ type: 'number' }, { type: 'string' }]
            },
            notBefore: {
              oneOf: [{ type: 'number' }, { type: 'string' }]
            },
            key: { type: 'string' }
          },
          required: ['expiresIn', 'notBefore']
        },
        verify: {
          type: 'object',
          additionalProperties: false,
          properties: {
            extractToken: { type: 'boolean' },
            onlyCookie: { type: 'boolean' },
            errorCacheTTL: { type: 'number' },
            cache: { type: 'boolean' },
            cacheTTL: { type: 'number' },
            allowedIss: {
              oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }]
            },
            allowedAud: {
              oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }]
            },
            allowedSub: {
              oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }]
            },
            requiredClaims: {
              type: 'array',
              items: { type: 'string' }
            },
            maxAge: {
              oneOf: [{ type: 'number' }, { type: 'string' }]
            }
          }
        },
        cookie: {
          type: 'object',
          additionalProperties: false,
          properties: {
            cookieName: { type: 'string' },
            signed: { type: 'boolean' }
          }
        },
        namespace: { type: 'string' }
      },
      required: ['secret']
    },
    webhook: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: { type: 'string' }
      },
      required: ['url']
    }
  }
}

export const schemaComponents = {
  ai,
  auth
}

export const schema = structuredClone(serviceSchema)

schema.$id = `https://schemas.platformatic.dev/@platformatic/ai-warp/${packageJson.version}.json`
schema.title = 'AI Warp configuration'
schema.version = packageJson.version
schema.properties.ai = ai
schema.properties.auth = auth
schema.required ??= []
schema.required.push('ai')
