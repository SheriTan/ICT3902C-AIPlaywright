const base = require('@playwright/test');
const { TestExecutor } = require('../core/executor/testExecutor');

const test = base.test.extend({
    executor: async ({ page }, use, testInfo) => {
        const executor = new TestExecutor(page, testInfo);

        await use(executor);

        const executionStatus = testInfo.status === 'passed' ? 'pass' : 'fail';
        const attemptNumber = testInfo.retry + 1; // 1-based: "first run", "second run", ...

        let error = null;
        if (executionStatus === 'fail' && testInfo.error) {
            error = new Error(testInfo.error.message || 'Test failed');
            error.stack = testInfo.error.stack;
        }

        const logger = executor.logger;
        const locatorUsed = executor.getLastLocatorUsed();

        const runLogPath = await logger.writeRunLog({
            status: executionStatus,
            error,
            locatorUsed,
            page,
            attemptNumber,
        });

        if (executionStatus === 'pass' || executor.isFinalAttempt) {
            await logger.writeTestResult({
                status: executionStatus,
                error,
                locatorUsed,
                runLogPath,
            });
        }
    },
});

module.exports = { test, expect: base.expect };
