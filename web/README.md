# web/ — FormFromFile SPA

Vite + React 19 + TS + Tailwind v4 (emerald theme). See the repo root
[`../README.md`](../README.md), [`../CLAUDE.md`](../CLAUDE.md), and
[`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §2.

```bash
bun install
bun run dev     # :5273, proxies /api → :8787
bun run build   # tsc -b && vite build → dist/
bun run test    # Vitest
bun run lint    # oxlint
```

`src/core/form_flow/**` is copied verbatim from InfraKit Studio and must stay
framework-free (`grep -rl "from 'react" src/core` prints nothing).
