import { defineConfig } from 'vitest/config';
import path from 'node:path';
import react from '@vitejs/plugin-react-swc';

// Vitest config for the React frontend. Kept intentionally close to the Vite
// config (same SWC plugin, same alias) so a passing build implies tests at
// least compile.
//
// Why jsdom (not happy-dom): @testing-library/react expects a few DOM APIs
// that happy-dom historically lagged on. jsdom is the safer default while
// the suite is small. Revisit when the suite grows past a few hundred ms.
//
// Coverage is wired but not required by CI; this lets devs run
// `npx vitest --coverage` locally without an extra install step.

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'ios', 'supabase/functions'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test-setup.ts'],
    },
  },
});
