import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
    // tsc -b emits declarations and JS to dist-types for the project reference graph.
    // Without this, vitest discovers the compiled copies and runs every suite twice.
    exclude: ['dist-types/**', 'dist/**', 'node_modules/**'],
  },
});
