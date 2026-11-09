// Stops a transient hiccup (slow network, a stray overlay) from being reported as a failed test.
// A failed action is re-run up to `recoveryRetries` times (set per environment in config/<ENV>/config.json),
// with a best-effort page clean-up between attempts. Waiting is the wait engine's job, not this file's.

const { firstLine } = require('../../utils/global/text');

class RecoveryEngine {
  /**
   * @param {import('@playwright/test').Page} page
   * @param {{ info: (message: string) => void } | null} [logger]
   * @param {{ defaultRetries?: number, waitEngine?: import('../wait-engine/waitEngine').WaitEngine | null }} [options]
   *   defaultRetries - extra attempts used when retry() is not given its own number (from config recoveryRetries)
   *   waitEngine     - when given, the page is allowed to settle between attempts
   */
  constructor(page, logger = null, options = {}) {
    this.page = page;
    this.logger = logger;
    this.defaultRetries = options.defaultRetries ?? 0;
    this.waitEngine = options.waitEngine ?? null;
  }

  /**
   * Runs `fn`, retrying on failure up to `retries` extra times (with recovery actions in between).
   * @param {() => Promise<any>} fn - the action to attempt
   * @param {{ retries?: number, label?: string }} [options]
   */
  async retry(fn, options = {}) {
    const { retries = this.defaultRetries, label = 'step' } = options;
    const totalAttempts = retries + 1;
    let lastError = null;

    for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
      try {
        const value = await fn();
        if (attempt > 1) this._log(`RECOVERED: "${label}" passed on attempt ${attempt}/${totalAttempts}`);
        return value;
      } catch (err) {
        lastError = err;
        if (attempt < totalAttempts) {
          this._log(`"${label}" failed (attempt ${attempt}/${totalAttempts}): ${firstLine(err.message)} - retrying`);
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

    if (!this.waitEngine) return;
    try {
      await this.waitEngine.forStableDOM({ timeout: 5000, quietPeriod: 300 });
    } catch {
      // DOM kept changing; let the retry proceed anyway
    }
  }

  _log(message) {
    if (this.logger) this.logger.info(message);
    else console.warn(`[RECOVERY] ${message}`);
  }
}

module.exports = { RecoveryEngine };
