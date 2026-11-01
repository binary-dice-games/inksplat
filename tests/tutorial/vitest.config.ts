// MIT License © 2026 Binary Dice Games
import { defineConfig } from 'vitest/config';

// Not part of the test suite: `npm run tutorial:media` drives the built site in Chrome to make
// the screenshots and animations of the tutorial page (viewer/src/site/tutorial/).
export default defineConfig({
  test: {
    include: ['tests/tutorial/*.media.ts'],
    environment: 'node',
    testTimeout: 600000,
    hookTimeout: 180000,
    fileParallelism: false,
  },
});
