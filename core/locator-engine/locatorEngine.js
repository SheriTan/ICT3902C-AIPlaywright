// Locator Strategy Logic: Ranking from most to least reliable
// await executor.step('test description', async () => {
//     const someElement = await executor.locate({
//         name: 'someElement',
//         strategies: [
//             { type: 'testId', value: 'some-test-id' },
//             { type: 'role', value: { role: 'button', name: 'Click me' } },
//             { type: 'text', value: 'Click me' },
//             { type: 'css', value: '.fallback-css-selector' },
//         ],
//     });
//     await someElement.click();
// });

const { Logger } = require('../logger/logger');

const STRATEGY_BUILDERS = {
    testId: (page, value) => page.getByTestId(value),
    role: (page, value) => page.getByRole(value.role, { name: value.name, exact: value.exact }),
    label: (page, value) => page.getByLabel(value),
    placeholder: (page, value) => page.getByPlaceholder(value),
    text: (page, value) => page.getByText(value, { exact: false }),
    css: (page, value) => page.locator(value),
    xpath: (page, value) => page.locator(`xpath=${value}`),
};

class LocatorEngine {
    constructor(testInfo) {
        this.logger = new Logger(testInfo);
        this.lastUsed = null;
    }

    async find(page, spec, options = {}) {
        const { perStrategyTimeout = 3000, scrollRetries = 2, scrollInterval = 500 } = options;
        const attempts = [];

        for (let round = 0; round <= scrollRetries; round += 1) {
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
                        `Locator "${spec.name}" resolved via strategy "${strategy.type}"` +
                        (attempts.length ? ` (after ${attempts.length} failed attempt(s) across ${round + 1} scroll round(s))` : '')
                    );
                    this.lastUsed = { name: spec.name, strategy: strategy.type, value: strategy.value };
                    return locator.first();
                } catch (err) {
                    attempts.push(`${strategy.type} -> ${err.message.split('\n')[0]}`);
                }
            }

            if (round < scrollRetries) {
                this.logger.info(`Locator "${spec.name}" not found - scrolling and retrying (round ${round + 2}/${scrollRetries + 1})`);
                await this._scrollForMore(page, scrollInterval);
            }
        }

        // If every strategy failed
        this.lastUsed = { name: spec.name, strategy: 'unresolved', value: attempts };

        const failure = new Error(
            `All locator strategies failed for "${spec.name}" after ${scrollRetries + 1} scroll round(s).\n` + attempts.join('\n')
        );
        failure.name = 'LocatorResolutionError';
        await this.logger.logError(failure, page, `resolving locator "${spec.name}"`);
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