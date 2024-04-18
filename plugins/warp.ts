// eslint-disable-next-line
/// <reference path="../index.d.ts" />
import fastifyPlugin from 'fastify-plugin'
import { OpenAiProvider } from '../ai-providers/open-ai.js'
import { MistralProvider } from '../ai-providers/mistral.js'
import { AiProvider, StreamChunkCallback } from '../ai-providers/provider.js'
import { AiWarpConfig } from '../config.js'
import createError from '@fastify/error'
import { OllamaProvider } from '../ai-providers/ollama.js'
import { AzureProvider } from '../ai-providers/azure.js'
import { Llama2Provider } from '../ai-providers/llama2.js'

const UnknownAiProviderError = createError('UNKNOWN_AI_PROVIDER', 'Unknown AI Provider')

function build (aiProvider: AiWarpConfig['aiProvider']): AiProvider {
  if ('openai' in aiProvider) {
    return new OpenAiProvider(aiProvider.openai)
  } else if ('mistral' in aiProvider) {
    return new MistralProvider(aiProvider.mistral)
  } else if ('ollama' in aiProvider) {
    return new OllamaProvider(aiProvider.ollama)
  } else if ('azure' in aiProvider) {
    return new AzureProvider(aiProvider.azure)
  } else if ('llama2' in aiProvider) {
    return new Llama2Provider(aiProvider.llama2)
  } else {
    throw new UnknownAiProviderError()
  }
}

export default fastifyPlugin(async (fastify) => {
  const { config } = fastify.platformatic
  const provider = build(config.aiProvider)

  fastify.decorate('ai', {
    warp: async (request, prompt) => {
      let decoratedPrompt = prompt
      if (config.promptDecorators !== undefined) {
        const { prefix, suffix } = config.promptDecorators
        decoratedPrompt = (prefix ?? '') + decoratedPrompt + (suffix ?? '')
      }

      let response = await provider.ask(decoratedPrompt)
      if (fastify.ai.preResponseCallback !== undefined) {
        response = await fastify.ai.preResponseCallback(request, response) ?? response
      }

      return response
    },
    warpStream: async (request, prompt) => {
      let decoratedPrompt = prompt
      if (config.promptDecorators !== undefined) {
        const { prefix, suffix } = config.promptDecorators
        decoratedPrompt = (prefix ?? '') + decoratedPrompt + (suffix ?? '')
      }

      let chunkCallback: StreamChunkCallback | undefined
      if (fastify.ai.preResponseChunkCallback !== undefined) {
        chunkCallback = async (response) => {
          if (fastify.ai.preResponseChunkCallback === undefined) {
            return response
          }
          return await fastify.ai.preResponseChunkCallback(request, response) ?? response
        }
      }

      const response = await provider.askStream(decoratedPrompt, chunkCallback)
      return response
    },
    rateLimiting: {}
  })
})
