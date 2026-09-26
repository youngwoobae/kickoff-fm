import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['tests/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
      environment: 'node',
      passWithNoTests: true,
      testTimeout: 60_000,
    },
  }),
);
