import { defineConfig } from '@playwright/test'

// The server runs from source under tsx (its build step is a no-op); the root
// build produces the web client that the server serves statically.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // A full round is carve + four vote phases; the spec sizes its own waits
  // from DEFAULT_ROOM_CONFIG, this is only the outer safety net.
  timeout: 180_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3000' },
  webServer: {
    command: 'pnpm build && pnpm -F @tg/server start',
    url: 'http://127.0.0.1:3000',
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
    env: { DATABASE_URL: ':memory:', PORT: '3000' },
  },
})
