// The test entry point: every spec imports `test` and `expect` from here instead of '@playwright/test'.
// It adds the `executor` fixture (steps, locator engine, recovery, execution trace) on top of Playwright's own.

const base = require('@playwright/test');
const { TestExecutor } = require('./executor/testExecutor');

const test = base.test.extend({
  executor: async ({ page }, use, testInfo) => {
    const executor = new TestExecutor(page, testInfo);
    await use(executor);
    await executor.finish();
  },
});

module.exports = { test, expect: base.expect };
