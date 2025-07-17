import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { readFile } from 'node:fs/promises'
import { Generator as ServiceGenerator } from '@platformatic/service'
import { BaseGenerator } from '@platformatic/generators'
import { schema } from './schema.js'
import { generateGlobalTypesFile } from './templates/types.js'
import { generatePlugins } from '@platformatic/generators/lib/create-plugin.js'

interface PackageJson {
  name: string
  version: string
  devDependencies: Record<string, string>
}

const PLACEHOLDER_API_KEY = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'

class AiWarpGenerator extends ServiceGenerator {
  private _packageJson: PackageJson | null = null

  getDefaultConfig(): { [x: string]: BaseGenerator.JSONValue } {
    const defaultBaseConfig = super.getDefaultConfig()

    const dir = import.meta.dirname || dirname(fileURLToPath(import.meta.url))
    const defaultConfig = {
      localSchema: false,
      plugin: false,
      tests: false,
      // TODO: temporary fix, when running the typescript files directly
      //  (in tests) this goes a directory above the actual project. Exposing
      //  temporarily until I come up with something better
      aiWarpPackageJsonPath: join(dir, '..', '..', 'package.json')
    }
    return Object.assign({}, defaultBaseConfig, defaultConfig)
  }

  getConfigFieldsDefinitions(): BaseGenerator.ConfigFieldDefinition[] {
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
    ]
  }

  async _getConfigFileContents(): Promise<{ [x: string]: BaseGenerator.JSONValue }> {
    const baseConfig = await super._getConfigFileContents()
    const packageJson = await this.getStackablePackageJson()

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
      $schema: this.config.localSchema as boolean ? './stackable.schema.json' : `https://schemas.platformatic.dev/@platformatic/ai-warp/${packageJson.version}.json`,
      module: packageJson.name,
      ai: aiConfig
    }

    return Object.assign({}, baseConfig, config)
  }

  async _beforePrepare(): Promise<void> {
    await super._beforePrepare()

    this.addEnvVars({
      PLT_OPENAI_API_KEY: this.config.aiOpenaiApiKey ?? PLACEHOLDER_API_KEY,
      PLT_DEEPSEEK_API_KEY: this.config.aiDeepseekApiKey ?? PLACEHOLDER_API_KEY,
      PLT_GEMINI_API_KEY: this.config.aiGeminiApiKey ?? PLACEHOLDER_API_KEY
    }, 
    // @ts-ignore
    { overwrite: false, default: false })

    const packageJson = await this.getStackablePackageJson()

    this.config.dependencies = {
      [packageJson.name]: `^${packageJson.version}`
    }
  }

  async _afterPrepare(): Promise<void> {
    const packageJson = await this.getStackablePackageJson()
    this.addFile({
      path: '',
      file: 'global.d.ts',
      contents: generateGlobalTypesFile(packageJson.name)
    })

    if (this.config.localSchema as boolean) {
      this.addFile({
        path: '',
        file: 'stackable.schema.json',
        contents: JSON.stringify(schema, null, 2)
      })
    }

    if (this.config.plugin !== undefined && this.config.plugin) {
      const plugins = generatePlugins(this.config.typescript ?? false)
      for (const plugin of plugins) {
        this.addFile(plugin)
      }
    }
  }

  async getStackablePackageJson(): Promise<PackageJson> {
    if (this._packageJson == null) {
      const packageJsonPath = this.config.aiWarpPackageJsonPath
      const packageJsonFile = await readFile(packageJsonPath, 'utf8')
      const packageJson: Partial<PackageJson> = JSON.parse(packageJsonFile)

      if (packageJson.name === undefined || packageJson.name === null) {
        throw new Error('Missing package name in package.json')
      }

      if (packageJson.version === undefined || packageJson.version === null) {
        throw new Error('Missing package version in package.json')
      }

      this._packageJson = packageJson as PackageJson
      return packageJson as PackageJson
    }
    return this._packageJson
  }

  async prepareQuestions(): Promise<void> {
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

export default AiWarpGenerator
export { AiWarpGenerator as Generator }
