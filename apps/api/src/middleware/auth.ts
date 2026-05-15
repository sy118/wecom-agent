import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET ?? 'change-me-in-production'

if (!process.env.JWT_SECRET) {
  console.warn('[auth] WARNING: JWT_SECRET is not set. Using insecure default. Set JWT_SECRET in production.')
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // EventSource cannot set custom headers, so also accept token as query param
  const queryToken = typeof req.query.token === 'string' ? req.query.token : undefined
  const header = req.headers.authorization

  let token: string | undefined
  if (header?.startsWith('Bearer ')) {
    token = header.slice(7)
  } else if (queryToken) {
    token = queryToken
  }

  if (!token) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' })
    return
  }
  try {
    jwt.verify(token, JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Token expired or invalid' })
  }
}

export { JWT_SECRET }
