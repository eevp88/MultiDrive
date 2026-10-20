import { rateLimit } from 'express-rate-limit'

function limiter(options: { windowMs: number; limit: number; skipSuccessfulRequests?: boolean }) {
  return rateLimit({
    ...options,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' }),
  })
}

// Counts only failed logins, so regular users are never locked out by their own successful sign-ins.
export const loginLimiter = limiter({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true })

export const registerLimiter = limiter({ windowMs: 60 * 60 * 1000, limit: 10 })
