import createError from '@fastify/error'

export const AiOptionsError = createError<string>('AI_OPTIONS_ERROR', 'Invalid options: %s')
export const ProviderResponseError = createError<string>('PROVIDER_RESPONSE_ERROR', 'Ai Provider Response error: %s')
export const ProviderExceededQuotaError = createError<string>('PROVIDER_EXCEEDED_QUOTA_ERROR', 'Ai Provider Response: %s')
export const ModelStateError = createError<string>('MODEL_STATE_ERROR', 'Model state error: %s')
export const HistoryGetError = createError<string>('HISTORY_GET_ERROR', 'Failed to get history')

export const ProviderNotFoundError = createError<string>('PROVIDER_NOT_FOUND_ERROR', 'Provider %s not found')
export const ModelProviderNotFoundError = createError<string>('MODEL_PROVIDER_NOT_FOUND_ERROR', 'Model provider not found %s')
export const ProviderNoModelsAvailableError = createError<string>('PROVIDER_NO_MODELS_AVAILABLE_ERROR', 'No models available to select from %s')
export const ModelStateNotFoundError = createError<string>('MODEL_STATE_NOT_FOUND_ERROR', 'Model state not found %s')
export const ProviderRateLimitError = createError<string>('PROVIDER_RATE_LIMIT_ERROR', 'Rate limit exceeded. Try again in %s seconds.')
export const ProviderRequestTimeoutError = createError<string>('PROVIDER_REQUEST_TIMEOUT_ERROR', 'Provider request timeout after %s ms')
export const ProviderRequestStreamTimeoutError = createError<string>('PROVIDER_REQUEST_STREAM_TIMEOUT_ERROR', 'Stream timeout after %s ms of inactivity')

export const ProviderResponseNoContentError = createError<[string]>('PROVIDER_RESPONSE_NO_CONTENT', '%s didn\'t return any content')

export const StreamError = createError<string>('STREAM_ERROR', 'Received error on stream: %s')

export const StorageGetError = createError<string>('STORAGE_GET_ERROR', 'Failed to get value for key "%s" : %s')
export const StorageSetError = createError<string>('STORAGE_SET_ERROR', 'Failed to set value for key "%s" : %s')
export const StorageListPushError = createError<string>('STORAGE_LIST_PUSH_ERROR', 'Failed to list push value for key "%s" : %s')
export const StorageListRangeError = createError<string>('STORAGE_LIST_RANGE_ERROR', 'Failed to list range for key "%s" : %s')

export const InvalidTimeWindowInputError = createError<string>('INVALID_TIME_WINDOW_INPUT_ERROR', 'Invalid time window %s')
export const InvalidTimeWindowUnitError = createError<string>('INVALID_TIME_WINDOW_UNIT_ERROR', 'Unsupported time unit %s')

export const DeserializingInvalidTypeError = createError<string>('DESERIALIZING_INVALID_TYPE_ERROR', 'Deserializing error: %s', 500)

export const AuthenticationRequiredError = createError<string>('AUTHENTICATION_REQUIRED_ERROR', 'Authentication is required', 401)
export const AuthenticationInvalidTokenError = createError<string>('AUTHENTICATION_INVALID_TOKEN_ERROR', 'Invalid authentication token: %s', 401)
export const AuthenticationTokenExpiredError = createError<string>('AUTHENTICATION_TOKEN_EXPIRED_ERROR', 'Authentication token has expired', 401)
