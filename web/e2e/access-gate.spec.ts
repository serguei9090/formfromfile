import { test, expect } from '@playwright/test'
import { loginAsAdmin, SAMPLE_JSON } from './helpers'

test('authenticated-only template blocks anonymous fillers, redirects back after sign-in', async ({
  page,
}) => {
  await loginAsAdmin(page)

  const created = await page.request.post('/api/schemas', {
    data: { name: 'E2E gated form', kind: 'json', body: SAMPLE_JSON, formJson: '{}' },
  })
  expect(created.ok()).toBeTruthy()
  const { schema } = await created.json()

  await page.request.post(`/api/schemas/${schema.id}/publish`)
  const ops = await page.request.post(`/api/schemas/${schema.id}/ops`, {
    data: { submissionCap: 0, brand: '', retentionDays: 0, publicAccess: 'authenticated' },
  })
  expect(ops.ok()).toBeTruthy()
  const slug = (await ops.json()).schema.shareSlug as string
  expect(slug).toBeTruthy()

  // a separate filler account — not the template owner
  const fillerEmail = `filler+${Date.now()}@e2e.test`
  const fillerPassword = 'e2e-password-123'
  const registered = await page.request.post('/api/auth/register', {
    data: { email: fillerEmail, password: fillerPassword },
  })
  expect(registered.ok()).toBeTruthy()

  // drop the session (registering just logged this context in) to act anonymous
  await page.context().clearCookies()
  await page.goto(`/f/${slug}`)
  await expect(page.getByText('This form requires you to sign in first.')).toBeVisible()

  const signInLink = page.getByRole('link', { name: 'Sign in to continue' })
  await expect(signInLink).toHaveAttribute('href', new RegExp(`redirect=.*f%2F${slug}`))
  await signInLink.click()
  await expect(page).toHaveURL(/\/login\?redirect=/)

  await page.getByPlaceholder('you@example.com').fill(fillerEmail)
  await page.getByPlaceholder('Password').fill(fillerPassword)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // signing in redirects straight back to the form that required it
  await expect(page).toHaveURL(new RegExp(`/f/${slug}$`))
  await expect(page.getByRole('heading', { name: 'E2E gated form' })).toBeVisible()

  // and the filler can actually submit now
  await page.getByRole('textbox', { name: 'host' }).fill('gated.example.com')
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByRole('button', { name: 'Send to team' }).click()
  await expect(page.getByText('Sent to the team. Thank you!')).toBeVisible()
})
