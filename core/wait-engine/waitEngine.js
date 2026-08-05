// Playwright already has auto-wait for elements to be attached before interacting
// This engine covers situations auto-wait does not cover:
// - Wait until page stops changing
// - Wait until specific custom condition is true
// - Wait until element stops moving

class WaitEngine {
    constructor(page) {
        this.page = page;
    }

    /**
     * Polling wait. Pass any function that returns true/false or a Promise<boolean>.
     * @param {() => boolean|Promise<boolean>} conditionFn
     * @param {{timeout?: number, interval?: number, description?: string}} options
     */
    async waitForCondition(conditionFn, options = {}) {
        const { timeout = 10000, interval = 250, description = 'custom condition' } = options;
        const start = Date.now();

        while (Date.now() - start < timeout) {
            if (await conditionFn()) return true;
            await this.page.waitForTimeout(interval);
        }

        throw new Error(`Timed out after ${timeout}ms waiting for: ${description}`);
    }

    // Waits until the DOM stops re-rendering themselves multiple times as async data arrives
    async waitForStableDOM(options = {}) {
        const { timeout = 15000, quietPeriod = 500 } = options;

        await this.page.waitForFunction(
            (quietMs) => {
                return new Promise((resolve) => {
                    let timer = setTimeout(() => resolve(true), quietMs);
                    const observer = new MutationObserver(() => {
                        clearTimeout(timer);
                        timer = setTimeout(() => {
                            observer.disconnect();
                            resolve(true);
                        }, quietMs);
                    });
                    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
                });
            },
            quietPeriod,
            { timeout }
        );
    }


    // Waits until an element's position/size stops changing
    async waitForElementStable(locator, options = {}) {
        const { timeout = 8000, checks = 3, interval = 100 } = options;
        const start = Date.now();
        let lastBox = null;
        let stableCount = 0;

        while (Date.now() - start < timeout) {
            const box = await locator.boundingBox();
            if (box && lastBox && box.x === lastBox.x && box.y === lastBox.y) {
                stableCount += 1;
                if (stableCount >= checks) return true;
            } else {
                stableCount = 0;
            }
            lastBox = box;
            await this.page.waitForTimeout(interval);
        }

        throw new Error('Element never became positionally stable within timeout.');
    }

    async waitForNetworkIdle(options = {}) {
        const { timeout = 10000 } = options;
        await this.page.waitForLoadState('networkidle', { timeout });
    }
}

module.exports = { WaitEngine };