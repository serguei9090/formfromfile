import { test, expect } from '@playwright/test'
import { loginAsAdmin, SAMPLE_JSON } from './helpers'

// Regression: unpublish keeps the share slug around (so republishing reuses
// the same link) — the "Publish" button used to treat that leftover slug as
// "already published" and skip the actual publish call, so a second Publish
// click silently did nothing instead of republishing.
test('republish after unpublish actually republishes, not a silent no-op', async ({ page }) => {
  await loginAsAdmin(page)

  const created = await page.request.post('/api/schemas', {
    data: { name: 'E2E republish', kind: 'json', body: SAMPLE_JSON, formJson: '{}' },
  })
  expect(created.ok()).toBeTruthy()
  const { schema } = await created.json()

  await page.goto('/')
  // scope to this template's own card — other specs leave templates in the
  // same shared dev DB, so an unscoped role query can match more than one
  // "Publish" button across the list.
  const row = page.locator('.flex.items-center.gap-3.p-3', { hasText: 'E2E republish' })
  const publishBtn = row.getByRole('button', { name: 'Publish', exact: true })
  const unpublishBtn = row.getByRole('button', { name: 'Unpublish' })

  await publishBtn.click()
  await expect(unpublishBtn).toBeVisible()

  let res = await page.request.get(`/api/schemas/${schema.id}`)
  const firstSlug = (await res.json()).schema.shareSlug as string
  expect(firstSlug).toBeTruthy()

  await unpublishBtn.click()
  await expect(publishBtn).toBeVisible()
  res = await page.request.get(`/api/schemas/${schema.id}`)
  expect((await res.json()).schema.visibility).toBe('private')

  // click Publish again — this is exactly what used to no-op
  await publishBtn.click()
  await expect(unpublishBtn).toBeVisible()

  res = await page.request.get(`/api/schemas/${schema.id}`)
  const body = (await res.json()).schema
  expect(body.visibility).toBe('shared')
  expect(body.status).toBe('published')
  expect(body.shareSlug).toBe(firstSlug) // same link is reused
})
