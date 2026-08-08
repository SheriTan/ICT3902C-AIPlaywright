const { Logger } = require('../logger/logger');
const { LocatorEngine } = require('../locator-engine/locatorEngine');
const { WaitEngine } = require('../wait-engine/waitEngine');
const { RecoveryEngine } = require('../recovery/recoveryEngine');

class TestExecutor {
    constructor(page, testInfo) {
        this.page = page;
        this.testInfo = testInfo;
        this.logger = new Logger(testInfo);
        this.waitEngine = new WaitEngine(page);
        this.recoveryEngine = new RecoveryEngine(page, this.logger);
        this.locatorEngine = new LocatorEngine(this.logger, this.recoveryEngine);
        this.lastFailedStep = null;
        this.lastError = null;
    }

    async locate(spec, options = {}) {
        const defaultScrollRounds = this.isFinalAttempt ? 1 : 3;
        return this.locatorEngine.find(this.page, spec, { scrollRounds: defaultScrollRounds, ...options });
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

    getCurrentStep() {
        return this.currentStep;
    }

    getLastError() {
        return this.lastError || this.recoveryEngine?.lastError || null;
    }

    hasAttemptFailureLog() {
        return this.attemptFailureLogged;
    }

    recordAttemptFailure() {
        if (this.attemptFailureLogged) return;

        const attemptNumber = this.testInfo.retry + 1;
        const totalAttempts = (this.testInfo?.project?.retries ?? 0) + 1;
        const error = this.getLastError();
        const label = this.currentStep || this.lastFailedStep;

        if (this.isFinalAttempt && label && error) {
            this.lastFailedStep = this.lastFailedStep || label;
            this.logger.info(`\"${label}\" failed (attempt ${attemptNumber}/${totalAttempts}): ${error.message.split('\n')[0]}`);
        }

        const closingNote = this.isFinalAttempt
            ? 'proceed to close browser & end test execution'
            : 'proceed to close browser';
        this.logger.info(`${attemptNumber}/${totalAttempts} Attempts failed, ${closingNote}`);
        this.attemptFailureLogged = true;
    }

    getLastErrorType() {
        return this.lastError?.name || null;
    }

    get isFinalAttempt() {
        const configuredRetries = this.testInfo?.project?.retries ?? 0;
        return this.testInfo.retry === configuredRetries;
    }

    /**
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
        this.currentStep = name;
        this.attemptFailureLogged = false;
        try {
            return await this.recoveryEngine.retry(fn, { retries, label: name });
        } catch (error) {
            this.lastFailedStep = name;
            this.lastError = error;
            this.recordAttemptFailure();

            throw error;
        }
    }
}

module.exports = { TestExecutor };