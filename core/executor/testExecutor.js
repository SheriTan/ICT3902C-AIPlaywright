const { Logger } = require('../logger/logger');
const { LocatorEngine } = require('../locator-engine/locatorEngine');
const { WaitEngine } = require('../wait-engine/waitEngine');
const { RecoveryEngine } = require('../recovery/recoveryEngine');

class TestExecutor {
    constructor(page, testInfo) {
        this.page = page;
        this.testInfo = testInfo;
        this.logger = new Logger(testInfo);
        this.locatorEngine = new LocatorEngine(testInfo);
        this.waitEngine = new WaitEngine(page);
        this.recoveryEngine = new RecoveryEngine(page);
    }

    async locate(spec, options) {
        return this.locatorEngine.find(this.page, spec, options);
    }

    wait() {
        return this.waitEngine;
    }

    getLastLocatorUsed() {
        return this.locatorEngine.lastUsed;
    }

    /**
     * Test step wrapper end-to-end:
     *  1. runs it + automatic retry + recovery actions on failure
     *  2. if it still fails after retries, logs a full structured failure record
     * @param {string} name - human-readable step name, shown in logs/reports
     * @param {() => Promise<void>} fn - the actual Playwright actions
     * @param {{retries?: number}} options
     */
    async step(name, fn, options = {}) {
        const { retries = 1 } = options;

        return this.testInfo.step
            ? this.testInfo.step(name, () => this._runStep(name, fn, retries))
            : this._runStep(name, fn, retries);
    }

    async _runStep(name, fn, retries) {
        try {
            return await this.recoveryEngine.retry(fn, { retries, label: name });
        } catch (error) {
            const logPath = await this.logger.logError(error, this.page, name);

            throw error;
        }
    }
}

module.exports = { TestExecutor };