import { test } from '@playwright/test'
import { mkdirSync, copyFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Not a test — a content-generation script for the README. Drives the real
// app headless, screenshots key moments, and records a video of the whole
// run. Run via `bun run demo` (capture + convert to gif/mp4 via ffmpeg).
// Uses playwright.demo.config.ts (own testDir, video recording, a fresh
// throwaway DB every run — the same e2e/api-server.mjs the real e2e suite
// uses, just started with reuseExistingServer: false here).

const assets = fileURLToPath(new URL('../../docs/assets/', import.meta.url))
mkdirSync(assets, { recursive: true })

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

test('capture the designer → publish → fill → submit lifecycle', async ({ page, context }) => {
  test.setTimeout(60_000)

  // fresh DB (webServer spawns it) → this registration becomes admin
  const email = 'demo@formfromfile.local'
  const password = 'DemoPassword123'
  let res = await page.request.post('/api/auth/register', { data: { email, password } })
  if (!res.ok()) {
    res = await page.request.post('/api/auth/login', { data: { email, password } })
  }

  // --- Home, empty state ---
  await page.goto('/')
  await pause(600)
  await page.screenshot({ path: assets + 'screenshot-home.png' })

  // --- Designer: load a sample, watch it get detected ---
  await page.goto('/designer?sample=k8s-yaml')
  await page.getByPlaceholder('Form name').fill('Kubernetes Deployment')
  await pause(900)
  await page.screenshot({ path: assets + 'screenshot-designer-schema.png' })

  // --- Show live form toggle ---
  await page.getByTitle(/Show a live form/).click()
  await pause(700)
  await page.screenshot({ path: assets + 'screenshot-designer-live-form.png' })

  // --- Fill preview tab ---
  await page.getByRole('button', { name: 'Fill preview' }).click()
  await pause(700)
  await page.screenshot({ path: assets + 'screenshot-fill-preview.png' })

  // back to Design, save it so it shows up on Home
  await page.getByRole('button', { name: 'Design', exact: true }).click()
  await pause(300)
  await page.getByRole('button', { name: 'Save new' }).click()
  await pause(1000)

  // --- Home: publish it ---
  await page.goto('/')
  await pause(500)
  const row = page.locator('.flex.items-center.gap-3.p-3', { hasText: 'Kubernetes Deployment' })
  await row.getByRole('button', { name: 'Publish', exact: true }).click()
  await pause(400)
  await page.getByRole('button', { name: 'Anyone with the link' }).click()
  await pause(700)
  await page.screenshot({ path: assets + 'screenshot-home-published.png' })

  // --- A second, simple template — publish → anonymous fill → submit ---
  const created = await page.request.post('/api/schemas', {
    data: {
      name: 'Server config',
      kind: 'json',
      body: '{ "host": "localhost", "port": 5432, "ssl": true }',
      formJson: '{}',
    },
  })
  const { schema } = await created.json()
  const published = await page.request.post(`/api/schemas/${schema.id}/publish`)
  const slug = (await published.json()).schema.shareSlug as string

  await page.context().clearCookies()
  await page.goto(`/f/${slug}`)
  await pause(500)
  await page.getByRole('textbox', { name: 'host' }).fill('db.example.com')
  await pause(400)
  await page.getByRole('button', { name: 'Export' }).click()
  await pause(300)
  await page.getByRole('button', { name: 'Send to team' }).click()
  await pause(900)
  await page.screenshot({ path: assets + 'screenshot-public-fill.png' })

  // --- Owner reviews the submission ---
  await page.request.post('/api/auth/login', { data: { email, password } })
  await page.goto(`/schemas/${schema.id}/submissions`)
  await pause(700)
  await page.screenshot({ path: assets + 'screenshot-submissions.png' })

  await pause(500)

  // finalize the video before the fixture teardown closes the context
  const video = page.video()
  await context.close()
  if (video) {
    const rawPath = await video.path()
    try {
      rmSync(assets + 'demo-raw.webm')
    } catch {
      /* not there — fine */
    }
    copyFileSync(rawPath, assets + 'demo-raw.webm')
  }
})
