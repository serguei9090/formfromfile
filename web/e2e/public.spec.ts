import { test, expect } from '@playwright/test'
import { loginAsAdmin, SAMPLE_JSON } from './helpers'

test('publish → anonymous fill → owner reads the submission', async ({ page }) => {
  await loginAsAdmin(page)

  const created = await page.request.post('/api/schemas', {
    data: { name: 'E2E share config', kind: 'json', body: SAMPLE_JSON, formJson: '{}' },
  })
  expect(created.ok(), `create ${created.status()}`).toBeTruthy()
  const { schema } = await created.json()

  const published = await page.request.post(`/api/schemas/${schema.id}/publish`)
  expect(published.ok()).toBeTruthy()
  const slug = (await published.json()).schema.shareSlug as string
  expect(slug).toBeTruthy()

  // fill it with no session
  await page.context().clearCookies()
  await page.goto(`/f/${slug}`)
  await expect(page.getByRole('heading', { name: 'E2E share config' })).toBeVisible()

  await page.getByRole('textbox', { name: 'host' }).fill('shared.example.com')
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByRole('button', { name: 'Send to team' }).click()
  await expect(page.getByText('Sent to the team. Thank you!')).toBeVisible()

  // owner sees exactly one submission
  await loginAsAdmin(page)
  const list = await page.request.get(`/api/schemas/${schema.id}/submissions`)
  expect(list.ok()).toBeTruthy()
  const { submissions } = await list.json()
  expect(submissions).toHaveLength(1)

  const detail = await page.request.get(`/api/submissions/${submissions[0].id}`)
  expect(detail.ok()).toBeTruthy()
  expect(JSON.stringify(await detail.json())).toContain('shared.example.com')
})
