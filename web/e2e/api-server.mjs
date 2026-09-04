// Boots the Go API on :8787 with a throwaway SQLite DB for the e2e run.
// Playwright starts this as a `webServer`; it waits for http://localhost:8787/healthz.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdirSync, rmSync } from 'node:fs'

const tmpDir = fileURLToPath(new URL('./.tmp/', import.meta.url))
const dbPath = fileURLToPath(new URL('./.tmp/e2e.db', import.meta.url))
const serverDir = fileURLToPath(new URL('../../server/', import.meta.url))

mkdirSync(tmpDir, { recursive: true })
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  try {
    rmSync(dbPath + suffix)
  } catch {
    /* not there — fine */
  }
}

const child = spawn(
  'go',
  ['run', './cmd/formfromfile', '--addr', '127.0.0.1:8787', '--db', dbPath],
  {
    cwd: serverDir,
    stdio: 'inherit',
    env: { ...process.env, FFF_ALLOW_REGISTER: 'true', FFF_LOG_LEVEL: 'warn' },
  },
)

const stop = () => {
  child.kill('SIGTERM')
  process.exit(0)
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
child.on('exit', (code) => process.exit(code ?? 0))
