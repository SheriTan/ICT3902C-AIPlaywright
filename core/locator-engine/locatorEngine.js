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
    }

    async find(page, spec, options = {}) {
        const { perStrategyTimeout = 3000 } = options;
        const attempts = [];

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
                    (attempts.length ? ` (after ${attempts.length} failed attempt(s))` : '')
                );
                return locator.first();
            } catch (err) {
                attempts.push(`${strategy.type} -> ${err.message.split('\n')[0]}`);
            }
        }

        // If every strategy failed
        const failure = new Error(
            `All locator strategies failed for "${spec.name}".\n` + attempts.join('\n')
        );
        failure.name = 'LocatorResolutionError';
        await this.logger.logError(failure, page, `resolving locator "${spec.name}"`);
        throw failure;
    }
}

module.exports = { LocatorEngine };