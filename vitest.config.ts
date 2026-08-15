import { defineConfig } from 'vitest/config'

// Deliberately standalone rather than extending vite.config.ts: the editor
// reducer is plain TypeScript, so tests need none of the Cloudflare / Tailwind
// / Inertia plugins — and booting workerd for a pure-function suite is slow.
export default defineConfig({
  test: {
    include: ['app/**/*.test.ts'],
    environment: 'node',
  },
})
