import { expect, test } from '@playwright/test'

// Uses the session saved by auth.setup.ts. With no Drive account connected, folders live in the database only.
test('creates a folder, and keeps it after a reload', async ({ page }) => {
  const name = `Taxes ${Date.now()}`
  await page.goto('/all-files')

  await page.getByRole('button', { name: 'New Folder' }).first().click()
  await page.getByLabel('Folder Name').fill(name)
  await page.getByRole('button', { name: 'Create Folder' }).click()

  // The page renders a grid and a table; at this width the table is the visible one.
  const row = page.getByRole('row', { name: new RegExp(name) })
  await expect(row).toBeVisible()
  await page.reload()
  await expect(row).toBeVisible()
})

test('shows the navigation pages of the signed in user', async ({ page }) => {
  await page.goto('/all-files')
  for (const [link, url] of [['Recycle Bin', /\/trash/], ['Quota Tracker', /\/quota/], ['Settings', /\/settings/]] as const) {
    await page.getByRole('link', { name: link }).click()
    await expect(page).toHaveURL(url)
  }
})
