import { readFileSync } from 'node:fs'
import { request } from '@playwright/test'
import { API_URL } from '../playwright.config'

let counter = 0

/** A unique account per call, so tests never depend on each other's data. */
export function newCredentials(label = 'user') {
  counter += 1
  return { name: `E2E ${label}`, email: `${label}-${Date.now()}-${counter}@e2e.test`, password: 'e2e-password-123' }
}

export async function registerViaApi(credentials = newCredentials()) {
  const api = await request.newContext({ baseURL: API_URL })
  const res = await api.post('/auth/register', { data: credentials })
  if (!res.ok()) throw new Error(`register failed: ${res.status()} ${await res.text()}`)
  await api.dispose()
  return credentials
}

/** The user auth.setup.ts registered. Register is rate limited (10 per hour per process), so tests reuse it where they can. */
export function seededUser(): { name: string; email: string; password: string } {
  return JSON.parse(readFileSync('.auth/credentials.json', 'utf8'))
}
