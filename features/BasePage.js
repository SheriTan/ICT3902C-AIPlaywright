// Base class for every page object. Gives pages the framework's step, locate and navigation helpers
// so a page only has to describe what a user can do on it.

const { buildLocators } = require('../core/locator-engine/locatorEngine');
const { loadLocatorSpec } = require('../utils/global/locatorLoader');

class BasePage {
  /**
   * @param {import('@playwright/test').Page} page
   * @param {import('../core/executor/testExecutor').TestExecutor} executor
   * @param {string} pageName - name of the locator file, e.g. 'loginPage' -> locators/loginPage.locators.json
   */
  constructor(page, executor, pageName) {
    this.page = page;
    this.executor = executor;
    this.pageName = pageName;
  }

  /** Runs `fn` as a named, retryable step (see TestExecutor.step). */
  step(name, fn, options) {
    return this.executor.step(name, fn, options);
  }

  /**
   * The ranked strategies of one locator in this page's locator file, without resolving them.
   * @param {string} locatorName - key inside the locator file
   * @param {{ dynamicValue?: string }} [substitutions] - fills "__DYNAMIC__" strategy values
   */
  spec(locatorName, substitutions) {
    return loadLocatorSpec(this.pageName, locatorName, substitutions);
  }

  /**
   * Finds an element using the ranked strategies in this page's locator file.
   * @param {string} locatorName - key inside the locator file
   * @param {{ dynamicValue?: string }} [substitutions] - fills "__DYNAMIC__" strategy values
   */
  locate(locatorName, substitutions) {
    return this.executor.locate(this.spec(locatorName, substitutions));
  }

  /**
   * Smart page readiness as one step: waits for load state, API calls to finish, every `visible` locator to be
   * shown, every `hidden` locator (spinners, skeletons) to be gone, and the DOM to stop changing.
   * Locator names come from this page's locator file and use its ranked strategies (see WaitEngine.forPageReady).
   * @param {{ visible?: string[], hidden?: string[], label?: string }} [readiness] - locator names
   * @param {{ loadState?: string|null, apiIdle?: boolean, domStable?: boolean, ignoreApi?: RegExp[], timeout?: number }} [waitOptions]
   * @param {{ retries?: number }} [stepOptions]
   */
  waitUntilReady(readiness = {}, waitOptions = {}, stepOptions) {
    const label = readiness.label ?? this.pageName;
    return this.step(`Wait until ${label} is ready`, () => this._forReady(readiness, waitOptions), stepOptions);
  }

  /**
   * Same wait, for a page that is meant to never become ready: the step passes and the error is returned
   * (caught inside the step, so the report does not show a failed step for a test that expects it).
   * @returns {Promise<{ error: Error | null }>}
   */
  waitUntilReadyExpectingFailure(readiness = {}, waitOptions = {}) {
    const label = readiness.label ?? this.pageName;
    return this.step(
      `Wait until ${label} is ready (expected to fail)`,
      async () => ({
        error: await this._forReady(readiness, waitOptions).then(
          () => null,
          (err) => err
        ),
      }),
      { retries: 0 }
    );
  }

  _forReady({ visible = [], hidden = [], label = this.pageName }, waitOptions) {
    const shown = visible.map((name) => ({
      name: `visible: ${name}`,
      wait: () => this.locate(name),
    }));
    // A spinner counts as present if ANY of its strategies matches, so every strategy must be hidden.
    const gone = hidden.map((name) => ({
      name: `hidden: ${name}`,
      wait: (timeout) =>
        Promise.all(
          buildLocators(this.page, this.spec(name)).map((locator) => locator.waitFor({ state: 'hidden', timeout }))
        ),
    }));

    return this.executor.waitEngine.forPageReady({ label, ...waitOptions, conditions: [...shown, ...gone] });
  }

  /** Navigates to `url` (relative to baseURL) as a step and waits for the network to settle. */
  open(url, stepName) {
    return this.step(stepName, async () => {
      await this.page.goto(url);
      await this.page.waitForLoadState('networkidle', { timeout: 10000 });
    });
  }
}

module.exports = { BasePage };
