import { test, expect } from '@playwright/test'
import { loginAsAdmin, SAMPLE_JSON } from './helpers'

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page)
})

test('detect → export → save a JSON template', async ({ page }) => {
  await page.goto('/designer')

  await page.locator('textarea').fill(SAMPLE_JSON)
  await page.getByRole('button', { name: /Detect schema/ }).click()

  // the schema tree + form now render
  await expect(page.getByRole('heading', { name: 'Form' })).toBeVisible()

  await page.getByRole('textbox', { name: 'host' }).fill('db.internal')
  await page.getByRole('button', { name: 'Export' }).click()

  const output = page.locator('pre')
  await expect(output).toContainText('"host"')
  await expect(output).toContainText('db.internal')

  await page.getByPlaceholder('Form name').fill('E2E JSON config')
  await page.getByRole('button', { name: /Save new/ }).click()

  await expect(page).toHaveURL(/\/designer\/.+/)
})
