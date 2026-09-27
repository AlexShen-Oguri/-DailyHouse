import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/personal-workbench.test.ts', 'test/reading-shelf.test.ts', 'test/reading-covers.test.ts', 'test/workflow.test.ts'],
  },
});
