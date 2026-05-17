import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Vite config.
//
// Why the manualChunks block exists
//   Pre-TASK-10X-Phase2 the build produced a single 2.6 MB / 742 kB-gz
//   index.js. That dominates first-paint on mobile. Manual chunks split
//   the third-party vendors into separate, cache-friendly files keyed
//   on the libraries that change infrequently. Combined with the
//   React.lazy() route splits in src/App.tsx, initial-paint payload
//   drops materially.
//
//   The chunk names are stable; bumping a vendor (e.g. Radix minor)
//   invalidates only that file, leaving every other vendor + the app
//   shell hot in the user's HTTP cache.
//
// Why a function (not an object)
//   Rollup invokes the function once per resolved module ID. Returning
//   a chunk name routes the module into that file; returning undefined
//   leaves it on Rollup's default heuristics (which mostly puts it in
//   the app shell). This is more robust than the object form, which
//   requires listing every transitive entry by hand.

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;

          // React + routing + state plumbing — the framework. Almost
          // never changes between releases; keep it big and stable.
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/react-router") ||
            id.includes("/node_modules/scheduler/")
          ) {
            return "react-vendor";
          }

          // Radix UI primitives — many packages, all related. Bundle
          // them so the Set-Cookie of one Radix release doesn't
          // invalidate ten files.
          if (id.includes("/node_modules/@radix-ui/")) {
            return "radix-vendor";
          }

          // Clerk auth SDK — large, bumps independently.
          if (id.includes("/node_modules/@clerk/")) {
            return "clerk-vendor";
          }

          // Supabase client + its WebSocket/fetch helpers.
          if (
            id.includes("/node_modules/@supabase/") ||
            id.includes("/node_modules/@supabase-")
          ) {
            return "supabase-vendor";
          }

          // TanStack Query — used everywhere; benefits from its own
          // long-lived cache file.
          if (id.includes("/node_modules/@tanstack/")) {
            return "tanstack-vendor";
          }

          // i18next + plugins.
          if (
            id.includes("/node_modules/i18next") ||
            id.includes("/node_modules/react-i18next/")
          ) {
            return "i18n-vendor";
          }

          // Date helpers — date-fns is sizeable when not tree-shaken.
          if (
            id.includes("/node_modules/date-fns/") ||
            id.includes("/node_modules/react-day-picker/")
          ) {
            return "date-vendor";
          }

          // Framer Motion — only loaded by pages with animation.
          if (id.includes("/node_modules/framer-motion/")) {
            return "motion-vendor";
          }

          // Recharts — heavy, only used in Admin/insights views.
          if (
            id.includes("/node_modules/recharts/") ||
            id.includes("/node_modules/d3-")
          ) {
            return "charts-vendor";
          }

          // Forms — used across multiple pages.
          if (
            id.includes("/node_modules/react-hook-form/") ||
            id.includes("/node_modules/@hookform/") ||
            id.includes("/node_modules/zod/")
          ) {
            return "forms-vendor";
          }

          // Markdown renderer — only on a few pages.
          if (
            id.includes("/node_modules/react-markdown/") ||
            id.includes("/node_modules/remark-") ||
            id.includes("/node_modules/rehype-") ||
            id.includes("/node_modules/micromark") ||
            id.includes("/node_modules/mdast-")
          ) {
            return "markdown-vendor";
          }

          // Carousel — landing page.
          if (id.includes("/node_modules/embla-carousel")) {
            return "carousel-vendor";
          }

          // Voice / streaming — only loaded on note input flows.
          if (id.includes("/node_modules/@deepgram/")) {
            return "voice-vendor";
          }

          // Capacitor — iOS shell glue.
          if (id.includes("/node_modules/@capacitor/")) {
            return "capacitor-vendor";
          }

          // Everything else from node_modules drops into a single
          // misc-vendor bucket so we still get a meaningful split
          // from app code.
          return "misc-vendor";
        },
      },
    },
    // Tighten the warning threshold a notch so future regressions
    // surface in the build output rather than silently growing.
    chunkSizeWarningLimit: 600,
  },
}));
