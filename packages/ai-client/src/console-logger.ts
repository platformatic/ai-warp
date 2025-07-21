import type { Logger } from './types.ts'

export const consoleLogger: Logger = {
  debug: (message: string, data?: any) => {
    if (data) {
      console.log(message, data)
    } else {
      console.log(message)
    }
  },
  info: (message: string, data?: any) => {
    if (data) {
      console.log(message, data)
    } else {
      console.log(message)
    }
  },
  warn: (message: string, data?: any) => {
    if (data) {
      console.warn(message, data)
    } else {
      console.warn(message)
    }
  },
  error: (message: string, data?: any) => {
    if (data) {
      console.error(message, data)
    } else {
      console.error(message)
    }
  }
}
