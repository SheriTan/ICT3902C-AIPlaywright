// To support transient failures so that entire test does not immediately fail on first hiccup, e.g., slow network

const { WaitEngine } = require('../wait-engine/waitEngine');

class RecoveryEngine {
    constructor(page, logger = null) {
        this.page = page;
        this.logger = logger;
        this.waitEngine = new WaitEngine(page);
        this.lastError = null;
    }

    /**
     * Runs `fn`, retrying on failure up to `retries` extra times.
     * @param {() => Promise<any>} fn - the action to attempt
     * @param {{retries?: number, label?: string}} options
     */
    async retry(fn, options = {}) {
        const { retries = 0, label = 'step' } = options;
        this.lastError = null;

        for (let attempt = 0; attempt <= retries; attempt += 1) {
            try {
                return await fn();
            } catch (err) {
                this.lastError = err;
                if (attempt < retries) {
                    const message = `"${label}" failed (attempt ${attempt + 1}/${retries}): ${err.message.split('\n')[0]} - retrying`;
                    if (this.logger) this.logger.info(message);
                    else console.warn(`[RECOVERY] ${message}`);
                    await this.runRecoveryActions();
                }
            }
        }

        throw this.lastError;
    }

    async runRecoveryActions() {
        try {
            await this.page.keyboard.press('Escape'); // dismiss overlays/tooltips
        } catch (_) { // To Be Added
        }

        try {
            await this.waitEngine.waitForStableDOM({ timeout: 5000, quietPeriod: 300 });
        } catch (_) { // To Be Added
        }
    }
}

module.exports = { RecoveryEngine };