import type { AiStorageOptions } from './storage/index.ts'

export const UNDICI_USER_AGENT = 'platformatic-warp/0.6.0' // TODO version from package.json

export const DEFAULT_UNDICI_POOL_OPTIONS = {
  pipelining: 2,
  bodyTimeout: 60_000,
  headersTimeout: 30_000,
}

export const DEFAULT_STORAGE: AiStorageOptions = {
  type: 'memory'
}

export const DEFAULT_RATE_LIMIT_MAX = 200
export const DEFAULT_RATE_LIMIT_TIME_WINDOW = '30s'
export const DEFAULT_REQUEST_TIMEOUT = 30_000
export const DEFAULT_HISTORY_EXPIRATION = '1d'
export const DEFAULT_MAX_RETRIES = 1
export const DEFAULT_RETRY_INTERVAL = 1_000

export const DEFAULT_RESTORE_RATE_LIMIT = '1m'
export const DEFAULT_RESTORE_RETRY = '1m'
export const DEFAULT_RESTORE_REQUEST_TIMEOUT = '1m'
export const DEFAULT_RESTORE_PROVIDER_COMMUNICATION_ERROR = '1m'
export const DEFAULT_RESTORE_PROVIDER_EXCEEDED_QUOTA_ERROR = '10m'

export const OPENAI_PROVIDER_NAME = 'OpenAI'
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com'
export const OPENAI_DEFAULT_API_PATH = '/v1/chat/completions'

export const DEEPSEEK_PROVIDER_NAME = 'DeepSeek'
export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com'
export const DEEPSEEK_DEFAULT_API_PATH = '/chat/completions'

export const GEMINI_PROVIDER_NAME = 'Gemini'
export const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com'
export const GEMINI_DEFAULT_API_PATH = '/v1beta/openai/chat/completions'
