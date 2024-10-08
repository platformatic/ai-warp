import { expectAssignable } from 'tsd'
import { AiWarpConfig } from '../../config.js'

expectAssignable<AiWarpConfig['aiProvider']>({
  openai: {
    model: 'gpt-3.5-turbo',
    apiKey: ''
  }
})

expectAssignable<AiWarpConfig['aiProvider']>({
  openai: {
    model: 'gpt-4',
    apiKey: ''
  }
})

expectAssignable<AiWarpConfig['aiProvider']>({
  mistral: {
    model: 'open-mistral-7b',
    apiKey: ''
  }
})

expectAssignable<AiWarpConfig>({
  aiProvider: {
    openai: {
      model: 'gpt-3.5-turbo',
      apiKey: ''
    }
  }
})

expectAssignable<AiWarpConfig>({
  aiProvider: {
    mistral: {
      model: 'open-mistral-7b',
      apiKey: ''
    }
  }
})

expectAssignable<AiWarpConfig>({
  aiProvider: {
    ollama: {
      host: '',
      model: 'some-model'
    }
  }
})

expectAssignable<AiWarpConfig>({
  aiProvider: {
    llama2: {
      modelPath: '/some/model.bin'
    }
  }
})

expectAssignable<AiWarpConfig>({
  $schema: './stackable.schema.json',
  service: {
    openapi: true
  },
  watch: true,
  server: {
    hostname: '{PLT_SERVER_HOSTNAME}',
    port: '{PORT}',
    logger: {
      level: 'info'
    }
  },
  module: '@platformatic/ai-warp',
  aiProvider: {
    openai: {
      model: 'gpt-3.5-turbo',
      apiKey: '{PLT_OPENAI_API_KEY}'
    }
  },
  promptDecorators: {
    prefix: '',
    suffix: ''
  },
  plugins: {
    paths: [
      {
        path: './plugins',
        encapsulate: false
      }
    ]
  }
})

expectAssignable<AiWarpConfig['promptDecorators']>({})

expectAssignable<AiWarpConfig['promptDecorators']>({
  prefix: ''
})

expectAssignable<AiWarpConfig['promptDecorators']>({
  suffix: ''
})

expectAssignable<AiWarpConfig['promptDecorators']>({
  prefix: '',
  suffix: ''
})
