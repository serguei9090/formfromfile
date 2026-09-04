import { expect, type Page } from '@playwright/test'

// The first account registered against a fresh DB becomes admin. The `setup`
// project registers this one before any other spec runs (see playwright.config).
export const ADMIN = { email: 'admin@e2e.test', password: 'e2e-password-123' }

export const SAMPLE_JSON = '{ "host": "localhost", "port": 5432, "ssl": true }'

/** Log in over the API — the login *form* is flaky under automation, the endpoint isn't. */
export async function loginAsAdmin(page: Page) {
  const res = await page.request.post('/api/auth/login', { data: ADMIN })
  expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy()
}
