const { Logger } = require('../logger/logger');

const STRATEGY_BUILDERS = { // Rank from Most to Least reliable strategy
    testId: (page, value) => page.getByTestId(value),
    role: (page, value) => page.getByRole(value.role, { name: value.name, exact: value.exact }),
    label: (page, value) => page.getByLabel(value),
    placeholder: (page, value) => page.getByPlaceholder(value),
    text: (page, value) => page.getByText(value, { exact: false }),
    css: (page, value) => page.locator(value),
    xpath: (page, value) => page.locator(`xpath=${value}`),
};

class LocatorEngine {
    constructor(logger, recoveryEngine = null) {
        this.logger = logger;
        this.recoveryEngine = recoveryEngine;
        this.lastUsed = null;
    }

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
                    const locator = builder(page, strategy.value);
                    await locator.first().waitFor({ state: 'visible', timeout: perStrategyTimeout });
                    this.logger.info(
                        `Locator "${spec.name}" resolved via strategy "${strategy.type}" on round ${round + 1}/${scrollRounds}`
                    );
                    this.lastUsed = { name: spec.name, strategy: strategy.type, value: strategy.value }; return locator.first();
                } catch (err) {
                    attempts.push(`round ${round + 1}: ${strategy.type} -> ${err.message.split('\n')[0]}`);
                }
            }

            if (round < scrollRounds - 1) {
                await this._scrollForMore(page, scrollInterval);
                if (this.recoveryEngine) await this.recoveryEngine.runRecoveryActions();
            }
        }

        // If every strategy failed
        this.lastUsed = { name: spec.name, strategy: 'unresolved', value: attempts };

        const failure = new Error(
            `All locator strategies failed for "${spec.name}" after ${scrollRounds} round(s).\n` + attempts.join('\n')
        );
        failure.name = 'LocatorResolutionError';
        throw failure;
    }

    async _scrollForMore(page, interval) {
        try {
            await page.mouse.wheel(0, 800);
            await page.waitForTimeout(interval);
        } catch (_) {
            // To Be Added
        }
    }
}

module.exports = { LocatorEngine };