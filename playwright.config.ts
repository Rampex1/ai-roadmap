import { defineConfig, devices } from '@playwright/test';

// Separate outDir + port 4322 so tests never replace or collide with the learner's dist/ on 4321.
// Port 4322 so tests never collide with the learner's server on 4321.
// --ignore-lock keeps astro preview in the foreground (Astro 7 auto-backgrounds it under coding agents).
export default defineConfig({
  testDir: 'tests/e2e',
  use: { baseURL: 'http://localhost:4322' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx astro build --outDir dist-e2e && npx astro preview --outDir dist-e2e --port 4322 --host localhost --ignore-lock',
    url: 'http://localhost:4322',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
