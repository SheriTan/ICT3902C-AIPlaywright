const { Logger } = require('../logger/logger');
const { LocatorEngine } = require('../locator-engine/locatorEngine');
const { WaitEngine } = require('../wait-engine/waitEngine');
const { RecoveryEngine } = require('../recovery/recoveryEngine');

class TestExecutor {
    constructor(page, testInfo) {
        this.page = page;
        this.testInfo = testInfo;
        this.logger = new Logger(testInfo);
        this.locatorEngine = new LocatorEngine(this.logger);
        this.waitEngine = new WaitEngine(page);
        this.recoveryEngine = new RecoveryEngine(page, this.logger);
        this.lastFailedStep = null;
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

    getLastFailedStep() {
        return this.lastFailedStep;
    }

    get isFinalAttempt() {
        const configuredRetries = this.testInfo?.project?.retries ?? 0;
        return this.testInfo.retry === configuredRetries;
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
        const defaultRetries = this.isFinalAttempt ? 0 : 2;
        const { retries = defaultRetries } = options;

        return this.testInfo.step
            ? this.testInfo.step(name, () => this._runStep(name, fn, retries))
            : this._runStep(name, fn, retries);
    }

    async _runStep(name, fn, retries) {
        try {
            return await this.recoveryEngine.retry(fn, { retries, label: name });
        } catch (error) {
            this.lastFailedStep = name;
            throw error;
        }
    }
}

module.exports = { TestExecutor };