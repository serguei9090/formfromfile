import { test, expect } from '@playwright/test'
import { loginAsAdmin } from './helpers'

test('admin settings toggle: disable registration, then reset', async ({ page }) => {
  await loginAsAdmin(page)
  await page.goto('/admin')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Access' })).toBeVisible()

  const toggle = page.getByRole('checkbox', { name: 'Allow public self-registration' })
  await expect(toggle).toBeChecked()
  // controlled checkbox — state flips only after the PUT + reload round-trip
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await expect(page.getByText('overridden').first()).toBeVisible()

  // registration is now closed (bootstrap admin already exists)
  const denied = await page.request.post('/api/auth/register', {
    data: { email: `late+${Date.now()}@e2e.test`, password: 'e2e-password-123' },
  })
  expect(denied.status()).toBe(403)

  // reset → registration works again
  await page.getByRole('button', { name: 'reset' }).first().click()
  await expect(toggle).toBeChecked()
  const ok = await page.request.post('/api/auth/register', {
    data: { email: `ok+${Date.now()}@e2e.test`, password: 'e2e-password-123' },
  })
  expect(ok.status()).toBe(201)
})
