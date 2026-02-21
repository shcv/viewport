import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@app-sdk': path.resolve(__dirname, 'src/app-sdk'),
      '@test-apps': path.resolve(__dirname, 'src/test-apps'),
      '@harness': path.resolve(__dirname, 'src/harness'),
      '@automation': path.resolve(__dirname, 'src/automation'),
      '@mcp-server': path.resolve(__dirname, 'src/mcp-server'),
      '@variants': path.resolve(__dirname, 'src/variants'),
    },
  },
  test: {
    globals: true,
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 30000,
  },
});
