const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });

// custom utils
const { loadConfig } = require('./utils/global/configLoader');
const { envFlag } = require('./utils/global/env');
const { JSON_RESULTS_PATH, HTML_REPORT_DIR } = require('./utils/global/paths');

const envConfig = loadConfig();

/**
 * @type {import('@playwright/test').ReporterDescription[]}
 */
const reporters = [
  ['list'],
  ['json', { outputFile: JSON_RESULTS_PATH }],
  ['./core/reporting/logReporter.js'], // writes /logs; must come before the AI reporter, which reads them
  ['./core/reporting/aiReporter.js'],
];

if (envFlag('HTML_REPORT')) {
  reporters.push(['html', { outputFolder: HTML_REPORT_DIR, open: 'never' }]);
}

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './tests',
  timeout: envConfig.waitTimeout, // max test execution duration
  retries: envConfig.recoveryRetries, // max retries on failed test execution

  // Defaults from Playwright framework
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,

  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: reporters,

  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: envConfig.baseURL,
    headless: false,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'retain-on-failure',
    // Capture screenshot after each test failure.
    screenshot: 'only-on-failure',
    // Record video on failure so the report can embed it.
    video: 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
