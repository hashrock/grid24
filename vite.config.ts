import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import ssrPlugin from 'vite-ssr-components/plugin'
import { inertiaPages } from '@hono/inertia/vite'

export default defineConfig({
  // React JSX is transformed by esbuild via tsconfig (jsx: react-jsx).
  // No @vitejs/plugin-react — its Fast Refresh preamble isn't injected into
  // our custom Inertia SSR document, which would break hydration.
  plugins: [inertiaPages(), tailwindcss(), cloudflare(), ssrPlugin()],
  // Honour the PORT env var (assigned by the harness when autoPort is on);
  // Vite otherwise ignores PORT and defaults to 5173.
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
  },
})
