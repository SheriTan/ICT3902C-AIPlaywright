// Keeps one transient hiccup (slow network, a stray overlay) from failing a whole test, and
// provides the DOM-settling wait that Playwright's built-in auto-waiting does not cover.

const { firstLine } = require('../../utils/global/text');

class RecoveryEngine {
  /**
   * @param {import('@playwright/test').Page} page
   * @param {{ info: (message: string) => void } | null} [logger]
   */
  constructor(page, logger = null) {
    this.page = page;
    this.logger = logger;
  }

  /**
   * Runs `fn`, retrying on failure up to `retries` extra times (with recovery actions in between).
   * @param {() => Promise<any>} fn - the action to attempt
   * @param {{ retries?: number, label?: string }} [options]
   */
  async retry(fn, options = {}) {
    const { retries = 0, label = 'step' } = options;
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt < retries) {
          this._log(`"${label}" failed (attempt ${attempt + 1}/${retries}): ${firstLine(err.message)} - retrying`);
          await this.runRecoveryActions();
        }
      }
    }

    throw lastError;
  }

  /** Best-effort clean-up between attempts. Never throws. */
  async runRecoveryActions() {
    try {
      await this.page.keyboard.press('Escape'); // dismiss overlays / tooltips
    } catch {
      // page may be closed or busy; recovery is best-effort
    }

    try {
      await this.waitForStableDOM({ timeout: 5000, quietPeriod: 300 });
    } catch {
      // DOM kept changing; let the retry proceed anyway
    }
  }

  /**
   * Waits until the DOM has stopped mutating for `quietPeriod` ms (e.g. async data finished rendering).
   * Playwright's auto-wait checks one element; it does not know when the whole page has settled.
   * @param {{ timeout?: number, quietPeriod?: number }} [options]
   */
  async waitForStableDOM(options = {}) {
    const { timeout = 15000, quietPeriod = 500 } = options;

    await this.page.waitForFunction(
      (quietMs) =>
        new Promise((resolve) => {
          let timer = setTimeout(() => resolve(true), quietMs);
          const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => {
              observer.disconnect();
              resolve(true);
            }, quietMs);
          });
          observer.observe(document.body, { childList: true, subtree: true, attributes: true });
        }),
      quietPeriod,
      { timeout }
    );
  }

  _log(message) {
    if (this.logger) this.logger.info(message);
    else console.warn(`[RECOVERY] ${message}`);
  }
}

module.exports = { RecoveryEngine };
