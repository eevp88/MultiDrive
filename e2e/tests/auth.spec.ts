import { expect, test } from '@playwright/test'
import { newCredentials, registerViaApi, seededUser } from './helpers'

// These tests start signed out.
test.use({ storageState: { cookies: [], origins: [] } })

test('sends a signed out visitor to the login page', async ({ page }) => {
  await page.goto('/all-files')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible()
})

test('registers a new account and lands in All Files', async ({ page }) => {
  const user = newCredentials('register')
  await page.goto('/register')
  await page.getByLabel('Name').fill(user.name)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Create Account' }).click()

  await expect(page).toHaveURL(/\/all-files/)
  await expect(page.getByRole('link', { name: 'All Files' })).toBeVisible()
})

test('refuses to register an email that is already taken', async ({ page }) => {
  const user = await registerViaApi(newCredentials('taken'))
  await page.goto('/register')
  await page.getByLabel('Name').fill(user.name)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Create Account' }).click()

  await expect(page.getByText('Email already registered.')).toBeVisible()
  await expect(page).toHaveURL(/\/register/)
})

test('shows an error for a wrong password and stays on the login page', async ({ page }) => {
  const user = seededUser()
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill('not-the-password')
  await page.getByRole('button', { name: 'Login', exact: true }).click()

  await expect(page.getByText('Invalid email or password.')).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})

test('signs in with valid credentials and signs out again', async ({ page }) => {
  const user = seededUser()
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await expect(page).toHaveURL(/\/all-files/)

  await page.getByRole('button', { name: 'Log Out' }).click()
  await expect(page).toHaveURL(/\/login/)

  // The session is really gone: a protected page sends the visitor back to login.
  await page.goto('/all-files')
  await expect(page).toHaveURL(/\/login/)
})
