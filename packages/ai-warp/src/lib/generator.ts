import type { ConfigFieldDefinition } from '@platformatic/generators'
import { Generator as ServiceGenerator } from '@platformatic/service'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packageJson, schema } from './schema.ts'

const PLACEHOLDER_API_KEY = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'

export class Generator extends ServiceGenerator {
  getDefaultConfig () {
    const defaultBaseConfig = super.getDefaultConfig()

    const dir = import.meta.dirname || dirname(fileURLToPath(import.meta.url))
    const defaultConfig = {
      localSchema: false,
      plugin: false,
      tests: false,
      skipTypescript: true,
      // TODO: temporary fix, when running the typescript files directly
      //  (in tests) this goes a directory above the actual project. Exposing
      //  temporarily until I come up with something better
      aiWarpPackageJsonPath: join(dir, '..', '..', 'package.json')
    }
    return Object.assign({}, defaultBaseConfig, defaultConfig)
  }

  getConfigFieldsDefinitions () {
    const serviceConfigFieldsDefs = super.getConfigFieldsDefinitions()
    return [
      ...serviceConfigFieldsDefs,
      {
        var: 'PLT_OPENAI_API_KEY',
        label: 'What is your OpenAI API key?',
        default: PLACEHOLDER_API_KEY,
        type: 'string',
        configValue: 'aiOpenaiApiKey'
      },
      {
        var: 'PLT_DEEPSEEK_API_KEY',
        label: 'What is your DeepSeek API key?',
        default: PLACEHOLDER_API_KEY,
        type: 'string',
        configValue: 'aiDeepseekApiKey'
      },
      {
        var: 'PLT_GEMINI_API_KEY',
        label: 'What is your Gemini API key?',
        default: PLACEHOLDER_API_KEY,
        type: 'string',
        configValue: 'aiGeminiApiKey'
      }
    ] as ConfigFieldDefinition[]
  }

  async _getConfigFileContents () {
    const baseConfig = await super._getConfigFileContents()

    const aiConfig = {
      providers: {},
      models: [],
      limits: { maxTokens: 1000 }
    }

    if (this.config.aiProviders?.includes('openai')) {
      // @ts-ignore
      aiConfig.providers.openai = { apiKey: `{${this.getEnvVarName('PLT_OPENAI_API_KEY')}}` }
      // @ts-ignore
      aiConfig.models.push({ provider: 'openai', model: 'gpt-4o-mini' })
      // @ts-ignore
      aiConfig.models.push({ provider: 'openai', model: 'gpt-4o' })
    }
    if (this.config.aiProviders?.includes('deepseek')) {
      // @ts-ignore
      aiConfig.providers.deepseek = { apiKey: `{${this.getEnvVarName('PLT_DEEPSEEK_API_KEY')}}` }
      // @ts-ignore
      aiConfig.models.push({ provider: 'deepseek', model: 'deepseek-chat' })
    }
    if (this.config.aiProviders?.includes('gemini')) {
      // @ts-ignore
      aiConfig.providers.gemini = { apiKey: `{${this.getEnvVarName('PLT_GEMINI_API_KEY')}}` }
      // @ts-ignore
      aiConfig.models.push({ provider: 'gemini', model: 'gemini-2.5-flash' })
    }

    const config = {
      $schema: (this.config.localSchema as boolean)
        ? './stackable.schema.json'
        : `https://schemas.platformatic.dev/@platformatic/ai-warp/${packageJson.version}.json`,
      module: packageJson.name,
      ai: aiConfig
    }

    return Object.assign({}, baseConfig, config)
  }

  async _beforePrepare () {
    await super._beforePrepare()

    if (this.config.aiOpenaiApiKey) {
      // @ts-ignore
      this.addEnvVar('PLT_OPENAI_API_KEY', this.config.aiOpenaiApiKey, { overwrite: true, default: false })
    } else {
      // @ts-ignore
      this.addEnvVar('PLT_OPENAI_API_KEY', PLACEHOLDER_API_KEY, { overwrite: false, default: true })
    }

    if (this.config.aiDeepseekApiKey) {
      // @ts-ignore
      this.addEnvVar('PLT_DEEPSEEK_API_KEY', this.config.aiDeepseekApiKey, { overwrite: true, default: false })
    } else {
      // @ts-ignore
      this.addEnvVar('PLT_DEEPSEEK_API_KEY', PLACEHOLDER_API_KEY, { overwrite: false, default: true })
    }

    if (this.config.aiGeminiApiKey) {
      // @ts-ignore
      this.addEnvVar('PLT_GEMINI_API_KEY', this.config.aiGeminiApiKey, { overwrite: true, default: false })
    } else {
      // @ts-ignore
      this.addEnvVar('PLT_GEMINI_API_KEY', PLACEHOLDER_API_KEY, { overwrite: false, default: true })
    }

    this.config.dependencies = {
      [packageJson.name]: `^${packageJson.version}`
    }
  }

  async _afterPrepare () {
    await super._afterPrepare()

    if (this.config.localSchema as boolean) {
      this.addFile({
        path: '',
        file: 'stackable.schema.json',
        contents: JSON.stringify(schema, null, 2)
      })
    }
  }

  async prepareQuestions () {
    this.questions.push({
      type: 'checkbox',
      name: 'aiProviders',
      message: 'What AI providers would you like to use?',
      default: ['openai', 'deepseek', 'gemini'],
      choices: [
        { name: 'OpenAI', value: 'openai' },
        { name: 'DeepSeek', value: 'deepseek' },
        { name: 'Gemini', value: 'gemini' }
      ]
    })

    this.questions.push({
      type: 'password',
      name: 'aiOpenaiApiKey',
      when: (answers: Record<string, string>) => answers.aiProviders.includes('openai'),
      message: 'What is your OpenAI API key?'
    })

    this.questions.push({
      type: 'password',
      name: 'aiDeepseekApiKey',
      when: (answers: Record<string, string>) => answers.aiProviders.includes('deepseek'),
      message: 'What is your DeepSeek API key?'
    })

    this.questions.push({
      type: 'password',
      name: 'aiGeminiApiKey',
      when: (answers: Record<string, string>) => answers.aiProviders.includes('gemini'),
      message: 'What is your Gemini API key?'
    })
  }
}
