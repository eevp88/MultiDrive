import { writeFileSync } from 'node:fs'
import { expect, test as setup } from '@playwright/test'
import { registerViaApi } from './helpers'

// Registers one user through the API and signs in through the UI once; the other tests reuse the saved session.
setup('sign in the seeded user', async ({ page }) => {
  const user = await registerViaApi()
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await expect(page).toHaveURL(/\/all-files/)
  await page.context().storageState({ path: '.auth/user.json' })
  writeFileSync('.auth/credentials.json', JSON.stringify(user))
})
