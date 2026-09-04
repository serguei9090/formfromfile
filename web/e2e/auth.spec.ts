import { test, expect } from '@playwright/test'

test('register a new account → lands in the app', async ({ page }) => {
  const email = `filler+${Date.now()}@e2e.test`
  await page.goto('/register')
  await page.getByPlaceholder('you@example.com').fill(email)
  await page.getByPlaceholder(/Password/).fill('e2e-password-123')
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'My Forms' })).toBeVisible()
})

test('unknown share link shows a friendly message', async ({ page }) => {
  await page.goto('/f/does-not-exist')
  await expect(page.getByText('This form link is not available.')).toBeVisible()
})
