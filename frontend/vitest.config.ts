import { defineConfig } from 'vitest/config';

// Unit tests only. Playwright e2e specs (*.spec.ts under e2e/ and tests/e2e)
// are intentionally excluded so vitest never tries to run them.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['features/**/*.test.ts', 'lib/**/*.test.ts'],
  },
});
