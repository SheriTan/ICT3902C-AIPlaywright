// Runs a test's actions as named, retryable steps and records what happened
// (step timeline, locator used, where and why it failed) for the log reporter and the AI diagnosis.

const { Logger } = require('../logger/logger');
const { redact } = require('../logger/sensitiveData');
const { LocatorEngine } = require('../locator-engine/locatorEngine');
const { RecoveryEngine } = require('../recovery/recoveryEngine');
const { firstLine } = require('../../utils/global/text');

class TestExecutor {
  /**
   * @param {import('@playwright/test').Page} page
   * @param {import('@playwright/test').TestInfo} testInfo
   */
  constructor(page, testInfo) {
    this.page = page;
    this.testInfo = testInfo;
    this.logger = new Logger(testInfo);
    this.recoveryEngine = new RecoveryEngine(page, this.logger);
    this.locatorEngine = new LocatorEngine(this.logger, this.recoveryEngine);

    this.currentStep = null;
    this.lastFailedStep = null;
    this.lastError = null;
    this.attemptFailureLogged = false;
    this._stepStack = [];
  }

  get isFinalAttempt() {
    const configuredRetries = this.testInfo.project?.retries ?? 0;
    return this.testInfo.retry === configuredRetries;
  }

  /**
   * Finds an element from a ranked locator spec (see locatorLoader.loadLocatorSpec).
   * @param {{ name: string, strategies: object[] }} spec
   * @param {{ perStrategyTimeout?: number, scrollRounds?: number, scrollInterval?: number }} [options]
   */
  locate(spec, options = {}) {
    const defaultScrollRounds = this.isFinalAttempt ? 1 : 3;
    return this.locatorEngine.find(this.page, spec, { scrollRounds: defaultScrollRounds, ...options });
  }

  /** Waits until the page stops re-rendering (Playwright's auto-wait only covers single elements). */
  waitForStableDOM(options) {
    return this.recoveryEngine.waitForStableDOM(options);
  }

  /**
   * @param {string} name - human-readable step name, shown in logs/reports
   * @param {() => Promise<any>} fn - the actual Playwright actions
   * @param {{ retries?: number }} [options] - defaults to 2 retries, or 0 on the final attempt
   */
  async step(name, fn, options = {}) {
    const { retries = this.isFinalAttempt ? 0 : 2 } = options;

    return this.testInfo.step
      ? this.testInfo.step(name, () => this._runStep(name, fn, retries))
      : this._runStep(name, fn, retries);
  }

  async _runStep(name, fn, retries) {
    this.currentStep = name;
    this.attemptFailureLogged = false;
    this._stepStack.push(name);
    const startedAt = Date.now();
    this.logger.info(`STEP: ${name}`);

    try {
      const value = await this.recoveryEngine.retry(fn, { retries, label: name });
      this.logger.info(`PASSED: ${name} (${Date.now() - startedAt}ms)`);
      return value;
    } catch (error) {
      const elapsed = Date.now() - startedAt;
      if (this.lastError !== error) {
        // First step to see this error = the innermost step = where it really failed.
        this.lastFailedStep = name;
        this.lastError = error;
        this.logger.info(`FAILED: ${name} (${elapsed}ms) - ${firstLine(error?.message)}`);
      } else {
        // Same error bubbling up through a parent step; keep the innermost as the failure point.
        this.logger.info(`ABORTED: ${name} (${elapsed}ms) - a step inside it failed`);
      }
      this.recordAttemptFailure();

      throw error;
    } finally {
      this._stepStack.pop();
    }
  }

  /** Logs where and why this attempt failed (once per attempt). */
  recordAttemptFailure() {
    if (this.attemptFailureLogged) return;

    const attemptNumber = this.testInfo.retry + 1;
    const totalAttempts = (this.testInfo.project?.retries ?? 0) + 1;
    const error = this.lastError || this.testInfo.error || null;
    const reason = firstLine(error?.message);
    const interruptedStep = this._stepStack[this._stepStack.length - 1];

    // Say WHERE it failed: a step that threw, a step cut short (e.g. timeout),
    // or a plain assertion/action written outside any executor.step().
    let where;
    if (this.lastFailedStep) {
      where = `failed at step "${this.lastFailedStep}"`;
    } else if (interruptedStep) {
      this.lastFailedStep = interruptedStep; // so the report header can say where it stopped
      where = `was interrupted during step "${interruptedStep}" (likely a timeout)`;
    } else if (this.currentStep) {
      where = `failed outside any step, after step "${this.currentStep}" had passed`;
    } else {
      where = 'failed before any step ran';
    }

    this.logger.info(
      `FAILED (attempt ${attemptNumber}/${totalAttempts}): test ${where}${reason ? ` - ${reason}` : ''}`
    );

    const closingNote = this.isFinalAttempt
      ? 'proceed to close browser & end test execution'
      : 'proceed to close browser and retry';
    this.logger.info(`${attemptNumber}/${totalAttempts} Attempts failed, ${closingNote}`);
    this.attemptFailureLogged = true;
  }

  /** Called by the fixture after the test body: closes out a failed attempt and attaches the trace the reporter reads. */
  async finish() {
    if (this.testInfo.status !== 'passed') this.recordAttemptFailure();

    const trace = {
      steps: this.logger.getTrace(),
      locatorUsed: this.locatorEngine.lastUsed ? redact(this.locatorEngine.lastUsed) : null,
      failedStep: this.lastFailedStep,
      errorType: this.lastError?.name || null,
    };

    await this.testInfo.attach('execution-trace', {
      body: Buffer.from(JSON.stringify(trace), 'utf-8'),
      contentType: 'application/json',
    });
  }
}

module.exports = { TestExecutor };
