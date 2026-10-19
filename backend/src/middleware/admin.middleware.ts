import type { NextFunction, Response } from 'express'
import { prisma } from '../config/prisma.js'
import type { AuthRequest } from './auth.middleware.js'

export const ADMIN_ROLE = 'admin'

// Must run after requireAuth. The role is read from the database on every request
// so that revoking an admin takes effect immediately, not when their token expires.
export async function requireAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { role: true, status: true } })
    if (!user || user.status !== 'active' || user.role !== ADMIN_ROLE) {
      return res.status(403).json({ code: 'ADMIN_REQUIRED', message: 'Administrator access required.' })
    }
    return next()
  } catch (error) {
    return next(error)
  }
}
