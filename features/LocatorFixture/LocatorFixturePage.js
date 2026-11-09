const fs = require('fs');
const path = require('path');
const { BasePage } = require('../BasePage');
const { LocatorEngine } = require('../../core/locator-engine/locatorEngine');
const { checkLocatorStrategies } = require('../../core/locator-engine/strategyChecker');
const { loadLocatorSpec } = require('../../utils/global/locatorLoader');
const { DATA_DIR } = require('../../utils/global/paths');

const PAGE_NAME = 'locatorFixturePage';
const FIXTURE_PATH = path.join(DATA_DIR, 'locator-fixture.html');

// These are deterministic checks: a failure must be reported at the step that caused it, not silently retried.
const NO_RETRY = { retries: 0 };

class LocatorFixturePage extends BasePage {
  constructor(page, executor) {
    super(page, executor, PAGE_NAME);
  }

  /** @returns {string[]} the strategy types a locator lists, in rank order (readable before a page exists) */
  static strategyTypesOf(locatorName) {
    return loadLocatorSpec(PAGE_NAME, locatorName).strategies.map((strategy) => strategy.type);
  }

  /** Loads the local HTML fixture (no network, no demo site). */
  goto() {
    return this.step(
      'Load local HTML fixture (login form, SSO decoy button, newsletter decoy field, status banners)',
      async () => {
        await this.page.setContent(fs.readFileSync(FIXTURE_PATH, 'utf-8'));
      },
      NO_RETRY
    );
  }

  /**
   * A locator reduced to one strategy type, to prove that strategy works on its own.
   * @param {string} locatorName
   * @param {string} strategyType - e.g. 'css'
   */
  singleStrategySpec(locatorName, strategyType) {
    const spec = this.spec(locatorName);
    return { ...spec, strategies: spec.strategies.filter((strategy) => strategy.type === strategyType) };
  }

  /**
   * Resolves a spec with a fresh LocatorEngine (one round, no recovery) so the test sees only the engine itself.
   * Fails the step when nothing matches.
   * @param {string} stepName
   * @param {{ name: string, strategies: object[] }} spec
   * @param {{ timeout?: number }} [options] - per-strategy timeout in ms
   * @returns {Promise<{ locator: import('@playwright/test').Locator, strategyUsed: string }>}
   */
  resolve(stepName, spec, { timeout = 500 } = {}) {
    return this.step(
      stepName,
      async () => {
        const engine = new LocatorEngine(this.executor.logger);
        const locator = await engine.find(this.page, spec, { perStrategyTimeout: timeout, scrollRounds: 1 });
        return { locator, strategyUsed: engine.lastUsed.strategy };
      },
      NO_RETRY
    );
  }

  /**
   * Same as resolve(), but for specs that are meant to fail: the error is returned instead of thrown.
   * @returns {Promise<{ error: Error|null, strategyUsed: string|undefined }>}
   */
  resolveExpectingFailure(stepName, spec, { timeout = 250 } = {}) {
    return this.step(
      stepName,
      async () => {
        const engine = new LocatorEngine(this.executor.logger);
        const error = await engine
          .find(this.page, spec, { perStrategyTimeout: timeout, scrollRounds: 1 })
          .then(() => null, (err) => err);
        return { error, strategyUsed: engine.lastUsed?.strategy };
      },
      NO_RETRY
    );
  }

  /**
   * How many elements a css or xpath strategy matches on the whole page. The engine only ever uses the
   * first match, so a loose selector would hide behind it; this is what exposes it.
   * @param {{ type: string, value: string }} strategy
   */
  countMatches(strategy) {
    const selector = strategy.type === 'xpath' ? `xpath=${strategy.value}` : strategy.value;
    return this.page.locator(selector).count();
  }

  /**
   * Runs the strategy checker (every rank works, same element, fallback order) on locators of this page.
   * @param {string} stepName
   * @param {string[]} locatorNames
   * @returns {Promise<{ results: object[], failures: string[], summary: string }>}
   */
  checkStrategies(stepName, locatorNames, { timeoutMs = 300 } = {}) {
    return this.step(
      stepName,
      () =>
        checkLocatorStrategies(
          this.page,
          locatorNames.map((name) => this.spec(name)),
          { logger: this.executor.logger, timeoutMs, label: 'fixture' }
        ),
      NO_RETRY
    );
  }
}

module.exports = { LocatorFixturePage };
