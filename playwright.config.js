const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });

// custom utils
const { loadConfig } = require('./utils/global/configLoader');

const envConfig = loadConfig();

const PROJECT_ROOT = __dirname;
const REPORTS_DIR = path.join(PROJECT_ROOT, 'reports');

/**
 * @param {string} name
 * @returns {boolean}
 */
function envEnabled(name) {
  const value = process.env[name];
  if (value === undefined) return false;
  return !['0', 'false', 'no', 'off', ''].includes(value.trim().toLowerCase());
}

/**
 * @type {import('@playwright/test').ReporterDescription[]}
 */
const reporters = [
  ['list'],
  ['json', { outputFile: path.join(REPORTS_DIR, 'results.json') }],
  ['./utils/global/logHandler.js'],
  ['./utils/global/aiReporter.js'],
];

if (envEnabled('HTML_REPORT')) {
  reporters.push(['html', { outputFolder: path.join(REPORTS_DIR, 'html-report'), open: 'never' }]);
}

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './tests',
  timeout: envConfig.timeout, // max test execution duration
  retries: envConfig.retries, // max retries on failed test execution

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