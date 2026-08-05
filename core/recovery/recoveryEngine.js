// To support transient failures so that entire test does not immediately fail on first hiccup, e.g., slow network

const { WaitEngine } = require('../wait-engine/waitEngine');

class RecoveryEngine {
    constructor(page) {
        this.page = page;
        this.waitEngine = new WaitEngine(page);
    }

    /**
     * Runs `fn`, retrying on failure up to `retries` extra times.
     * @param {() => Promise<any>} fn - the action to attempt
     * @param {{retries?: number, label?: string}} options
     */
    async retry(fn, options = {}) {
        const { retries = 2, label = 'step' } = options;
        let lastError;

        for (let attempt = 0; attempt <= retries; attempt += 1) {
            try {
                return await fn();
            } catch (err) {
                lastError = err;
                if (attempt < retries) {
                    console.warn(`[RECOVERY] "${label}" failed (attempt ${attempt + 1}/${retries + 1}): ${err.message.split('\n')[0]}`);
                    await this._runRecoveryActions();
                }
            }
        }

        throw lastError;
    }

    async _runRecoveryActions() {
        try {
            await this.page.keyboard.press('Escape'); // dismiss stray overlays/tooltips
        } catch (_) { // To Be Added
        }

        try {
            await this.waitEngine.waitForStableDOM({ timeout: 5000, quietPeriod: 300 });
        } catch (_) { // To Be Added
        }
    }
}

module.exports = { RecoveryEngine };