import { defineConfig } from 'vitest/config'

// vitest 3.0.5 has no `projects` option (added in 3.2); inline `workspace` is its form.
// Two projects so the web package gets jsdom automatically while server and
// shared keep running under node. `pnpm vitest run` from the root collects both.
export default defineConfig({
  test: {
    workspace: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['packages/server/**/*.test.{ts,tsx}', 'packages/shared/**/*.test.{ts,tsx}'],
        },
      },
      {
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['packages/web/**/*.test.{ts,tsx}'],
          setupFiles: ['packages/web/src/test-setup.ts'],
        },
      },
    ],
  },
})
