import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'iphone',
      use: { ...devices['iPhone 14'] },
    },
  ],
  webServer: {
    command: 'npm run build && node build/index.js',
    port: 3001,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: '3001',
      GITHUB_CLIENT_ID: 'test-client-id',
      SESSION_SECRET: 'test-secret-for-playwright',
      NODE_ENV: 'development',
    },
  },
});
