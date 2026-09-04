import { test as setup, expect } from '@playwright/test'
import { ADMIN } from './helpers'

// Runs once, before the chromium project. Registers the bootstrap admin so the
// authoring specs have author rights regardless of file order.
setup('register bootstrap admin', async ({ request }) => {
  const res = await request.post('/api/auth/register', { data: ADMIN })
  // 201 fresh, 409 if a previous run's DB survived (reuseExistingServer locally)
  expect([201, 409], `unexpected register status ${res.status()}`).toContain(res.status())
})
