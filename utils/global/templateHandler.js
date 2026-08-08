const base = require('@playwright/test');
const { TestExecutor } = require('../../core/executor/testExecutor');
const { Logger } = require('../../core/logger/logger');

const test = base.test.extend({
    executor: async ({ page }, use, testInfo) => {
        const executor = new TestExecutor(page, testInfo);

        await use(executor);

        if (testInfo.status !== 'passed' && !executor.hasAttemptFailureLog()) {
            executor.recordAttemptFailure();
        }

        const locatorUsed = executor.getLastLocatorUsed();
        const payload = {
            steps: executor.logger.getTrace(),
            locatorUsed: locatorUsed ? Logger.maskSensitive(locatorUsed) : null,
            failedStep: executor.getLastFailedStep(),
            errorType: executor.getLastErrorType(),
        };

        await testInfo.attach('execution-trace', {
            body: Buffer.from(JSON.stringify(payload), 'utf-8'),
            contentType: 'application/json',
        });
    },
});

module.exports = { test, expect: base.expect };