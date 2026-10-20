// Resolves a ranked list of locator strategies (see locators/*.locators.json).
// Strategies are tried top to bottom; the first one that finds a visible element wins.
// If all of them fail, the page is scrolled and the whole list is tried again.

const { firstLine } = require('../../utils/global/text');

// Order of reliability, most to least. JSON files choose the order per locator; this is only the vocabulary.
const STRATEGY_BUILDERS = {
  testId: (page, value) => page.getByTestId(value),
  role: (page, value) => page.getByRole(value.role, { name: value.name, exact: value.exact }),
  label: (page, value) => page.getByLabel(value),
  placeholder: (page, value) => page.getByPlaceholder(value),
  text: (page, value) => page.getByText(value, { exact: false }),
  css: (page, value) => page.locator(value),
  xpath: (page, value) => page.locator(`xpath=${value}`),
};

/** e.g. role({"role":"button","name":"Sign in"}) - used in logs and test output */
function describeStrategy(strategy) {
  const value = typeof strategy.value === 'object' ? JSON.stringify(strategy.value) : strategy.value;
  return `${strategy.type}(${value})`;
}

class LocatorEngine {
  /**
   * @param {{ info: (message: string) => void }} logger
   * @param {import('../recovery/recoveryEngine').RecoveryEngine | null} [recoveryEngine]
   *   when given, recovery actions run between scroll rounds
   */
  constructor(logger, recoveryEngine = null) {
    this.logger = logger;
    this.recoveryEngine = recoveryEngine;
    /** @type {{ name: string, strategy: string, value: any } | null} */
    this.lastUsed = null;
  }

  /**
   * @param {import('@playwright/test').Page} page
   * @param {{ name: string, strategies: Array<{ type: string, value: any }> }} spec
   * @param {{ perStrategyTimeout?: number, scrollRounds?: number, scrollInterval?: number }} [options]
   * @returns {Promise<import('@playwright/test').Locator>}
   * @throws {Error} named LocatorResolutionError when no strategy matches
   */
  async find(page, spec, options = {}) {
    const { perStrategyTimeout = 3000, scrollRounds = 3, scrollInterval = 500 } = options;
    const attempts = [];

    for (let round = 0; round < scrollRounds; round += 1) {
      for (const strategy of spec.strategies) {
        const builder = STRATEGY_BUILDERS[strategy.type];
        if (!builder) {
          attempts.push(`${strategy.type}: unknown strategy type`);
          continue;
        }

        try {
          const locator = builder(page, strategy.value).first();
          await locator.waitFor({ state: 'visible', timeout: perStrategyTimeout });
          this.logger.info(
            `Locator "${spec.name}" resolved via strategy "${strategy.type}" on round ${round + 1}/${scrollRounds}`
          );
          this.lastUsed = { name: spec.name, strategy: strategy.type, value: strategy.value };
          return locator;
        } catch (err) {
          attempts.push(`round ${round + 1}: ${strategy.type} -> ${firstLine(err.message)}`);
        }
      }

      if (round < scrollRounds - 1) {
        await this._scrollForMore(page, scrollInterval);
        if (this.recoveryEngine) await this.recoveryEngine.runRecoveryActions();
      }
    }

    this.lastUsed = { name: spec.name, strategy: 'unresolved', value: attempts };

    const failure = new Error(
      `All locator strategies failed for "${spec.name}" after ${scrollRounds} round(s).\n${attempts.join('\n')}`
    );
    failure.name = 'LocatorResolutionError';
    throw failure;
  }

  async _scrollForMore(page, interval) {
    try {
      await page.mouse.wheel(0, 800);
      await page.waitForTimeout(interval);
    } catch {
      // page may have navigated or closed mid-scroll; the next round simply tries again
    }
  }
}

module.exports = { LocatorEngine, describeStrategy };
