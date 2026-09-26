import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/personal-workbench.test.ts', 'test/reading-shelf.test.ts'],
  },
});
