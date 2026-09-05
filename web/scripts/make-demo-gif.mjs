// Converts docs/assets/demo-raw.webm (from `bun run demo:capture`) into a
// README-ready GIF + MP4, then removes the raw recording and palette.
// Requires ffmpeg on PATH. Run via `bun run demo:gif` (or `bun run demo` to
// do both steps).
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const assets = fileURLToPath(new URL('../../docs/assets/', import.meta.url))
const raw = assets + 'demo-raw.webm'
const palette = assets + 'palette.png'
const gif = assets + 'demo.gif'
const mp4 = assets + 'demo.mp4'

if (!existsSync(raw)) {
  console.error(`no recording at ${raw} — run "bun run demo:capture" first`)
  process.exit(1)
}

try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
} catch {
  console.error('ffmpeg not found on PATH — install it (e.g. `winget install ffmpeg`) and retry.')
  process.exit(1)
}

const run = (args) => execFileSync('ffmpeg', args, { stdio: 'inherit' })

// the recording starts the instant the browser context is created, before
// the spec's first navigation — trim that blank lead-in.
const trimStart = ['-ss', '1.5']

console.log('→ generating palette…')
run(['-y', ...trimStart, '-i', raw, '-update', '1', '-vf', 'fps=10,scale=800:-1:flags=lanczos,palettegen', palette])

console.log('→ encoding gif…')
run([
  '-y',
  ...trimStart,
  '-i', raw,
  '-i', palette,
  '-filter_complex', 'fps=10,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse',
  gif,
])

console.log('→ encoding mp4…')
run([
  '-y',
  ...trimStart,
  '-i', raw,
  '-vf', 'scale=1000:-2',
  '-c:v', 'libx264',
  '-crf', '23',
  '-preset', 'veryfast',
  '-pix_fmt', 'yuv420p',
  mp4,
])

rmSync(palette)
rmSync(raw)
console.log(`done — docs/assets/demo.gif and docs/assets/demo.mp4`)
