import { defineConfig } from '@playwright/test'

// The server runs from source under tsx (its build step is a no-op); the root
// build produces the web client that the server serves statically.
/**
 * The port is configurable so a run cannot silently test somebody else's
 * server. `reuseExistingServer` is on outside CI, which is convenient until
 * a stale process on 3000 answers instead of a fresh build — set E2E_PORT to
 * step around one rather than killing it.
 */
const PORT = process.env.E2E_PORT ?? '3000'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // A full round is carve + four vote phases; the spec sizes its own waits
  // from DEFAULT_ROOM_CONFIG, this is only the outer safety net.
  timeout: 180_000,
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  webServer: {
    command: 'pnpm build && pnpm -F @tg/server start',
    url: `http://127.0.0.1:${PORT}`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: { DATABASE_URL: ':memory:', PORT },
  },
})
