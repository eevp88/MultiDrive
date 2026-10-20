import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

// The docs and templates have shipped placeholder values that satisfy the length check but are public, so anyone could forge tokens.
const secret = z
  .string()
  .min(32)
  .refine((value) => !/^(change-this|replace-with)/i.test(value), 'Placeholder value from the docs or template. Generate a real secret, e.g. `openssl rand -base64 48`.')

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_PORT: z.coerce.number().default(4000),
  FRONTEND_URL: z.string().url(),
  JWT_ACCESS_SECRET: secret,
  TOKEN_ENCRYPTION_KEY: secret,
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  MAX_UPLOAD_BYTES: z.coerce.number().default(5 * 1024 * 1024 * 1024),
  RECAPTCHA_SECRET_KEY: z.string().optional(),
})

export const env = envSchema.parse(process.env)
