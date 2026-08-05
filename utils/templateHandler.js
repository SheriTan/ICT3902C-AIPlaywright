const base = require('@playwright/test');
const { TestExecutor } = require('../core/executor/testExecutor');
const { Logger } = require('../core/logger/logger');

const test = base.test.extend({
    executor: async ({ page }, use, testInfo) => {
        const executor = new TestExecutor(page, testInfo);

        await use(executor);

        const executionStatus = testInfo.status === 'passed' ? 'pass' : 'fail';

        let error = null;
        if (executionStatus === 'fail' && testInfo.error) {
            error = new Error(testInfo.error.message || 'Test failed');
            error.stack = testInfo.error.stack;
        }

        const logger = new Logger(testInfo);
        await logger.logResult({
            executionStatus,
            error,
            locatorUsed: executor.getLastLocatorUsed(),
            page,
        });
    },
});

module.exports = { test, expect: base.expect };
