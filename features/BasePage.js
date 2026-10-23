// Base class for every page object. Gives pages the framework's step, locate and navigation helpers
// so a page only has to describe what a user can do on it.

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

  /** Navigates to `url` (relative to baseURL) as a step and waits for the network to settle. */
  open(url, stepName) {
    return this.step(stepName, async () => {
      await this.page.goto(url);
      await this.page.waitForLoadState('networkidle', { timeout: 10000 });
    });
  }
}

module.exports = { BasePage };