import jwt, { type Algorithm } from 'jsonwebtoken'
import { AuthenticationInvalidTokenError, AuthenticationRequiredError, AuthenticationTokenExpiredError } from './errors.ts'

export type AuthOptions = {
  jwt: {
    secret: string
    algorithm?: Algorithm
  }
}

const DEFAULT_ALGORITHM = 'HS256'

/**
   * Verify JWT token using jsonwebtoken library
   * @param token - JWT token to verify
   * @returns Promise<boolean> - true if valid, throws error if invalid
   */
export async function verifyJWT (token: string | undefined, options: AuthOptions): Promise<boolean> {
  if (!token) {
    throw new AuthenticationRequiredError()
  }

  try {
    // Verify token using jsonwebtoken library
    jwt.verify(token, options.jwt.secret, {
      algorithms: [options.jwt.algorithm ?? DEFAULT_ALGORITHM],
      clockTolerance: 30 // Allow 30 seconds of clock skew
    })

    return true
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      throw new AuthenticationTokenExpiredError()
    } else if (error.name === 'JsonWebTokenError') {
      throw new AuthenticationInvalidTokenError(error.message)
    } else if (error.name === 'NotBeforeError') {
      throw new AuthenticationInvalidTokenError('Token not yet valid')
    } else {
      throw new AuthenticationInvalidTokenError('Token verification failed')
    }
  }
}
