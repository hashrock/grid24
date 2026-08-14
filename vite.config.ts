import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import ssrPlugin from 'vite-ssr-components/plugin'
import { inertiaPages } from '@hono/inertia/vite'

export default defineConfig({
  // React JSX is transformed by esbuild via tsconfig (jsx: react-jsx).
  // No @vitejs/plugin-react — its Fast Refresh preamble isn't injected into
  // our custom Inertia SSR document, which would break hydration.
  plugins: [
    inertiaPages(),
    tailwindcss(),
    cloudflare(),
    // Our sources live in app/, not the plugin's default src/. The entry scan is
    // pinned to root-view.tsx — the only file using vite-ssr-components' own
    // Script/Link; scanning wider would also pick up Inertia's same-named <Link>
    // and turn route hrefs like "/icons" into bogus build entries.
    ssrPlugin({
      entry: { target: 'app/root-view.tsx' },
      hotReload: { target: ['app/**/*.ts', 'app/**/*.tsx'] },
    }),
  ],
})
