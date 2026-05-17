import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Vite config.
//
// Why there is no manualChunks block here
//   Phase 2 introduced a heuristic name-based manualChunks function
//   that split vendors into ~14 named chunks for caching. The Phase 2
//   recap reported a ~80% initial-JS reduction, but the bulk of that
//   win came from the React.lazy() route splits in src/App.tsx, not
//   from the manual chunk split.
//
//   The manualChunks function turned out to be fragile: it produced
//   circular imports between sibling chunks. The catch-all
//   misc-vendor bucket pulled in small helpers that depend on
//   @radix-ui, recharts/d3, etc. Splitting those into their own
//   chunks created cycles like misc-vendor ↔ radix-vendor and
//   misc-vendor ↔ charts-vendor. At module-eval time, one side would
//   re-enter the cycle and read a still-uninitialised React export,
//   throwing things like:
//     TypeError: Cannot read properties of undefined (reading 'forwardRef')
//     ReferenceError: Cannot access 'A' before initialization
//     TypeError: Cannot read properties of undefined (reading 'createContext')
//   Each of those produces a blank page in prod.
//
//   The route lazy-loading is what matters for first-paint; the named
//   vendor chunks were only a caching micro-optimisation. Letting
//   Rollup compute the chunk graph from actual usage is safer and
//   cycle-free.

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
      // No manualChunks — see header comment.
      output: {},
    },
    // Tighten the warning threshold a notch so future regressions
    // surface in the build output rather than silently growing.
    chunkSizeWarningLimit: 1000,
  },
}));
