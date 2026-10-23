const { test, expect } = require('../core/fixtures');
const { describeStrategy } = require('../core/locator-engine/locatorEngine');
const { LocatorFixturePage } = require('../features/LocatorFixturePage');

// Tests the locator engine and strategy checker against a local HTML page (data/locator-fixture.html)
// through the LocatorFixturePage page object. Locators are in locators/locatorFixturePage.locators.json.
//
//   1. Single strategy: each strategy of each locator can find its element on its own
//   2. Unique selectors: every css / xpath strategy matches exactly one element
//   3. Ranking: Rank 1 wins when everything works
//   4. Fallback: Broken rank is skipped and the next one is used
//   5. Failure reporting: Nothing matches. Error lists every attempt
//   6. Strategy checker: Validates whole ranked lists, and flags a loose css selector

// Elements on the fixture page and the tag each locator must resolve to
const TARGETS = [
  { locator: 'emailInput', description: 'email input', tag: 'INPUT' },
  { locator: 'passwordInput', description: 'password input', tag: 'INPUT' },
  { locator: 'signInButton', description: 'Sign in button', tag: 'BUTTON' },
  { locator: 'statusMessage', description: 'status message', tag: 'P' },
];

const stepsFor = (executor) => (name, fn) => executor.step(name, fn, { retries: 0 });

test.describe('Locator strategy engine - deterministic checks', () => {
  test.beforeEach(async ({ page, executor }) => {
    await new LocatorFixturePage(page, executor).goto();
  });

  // Single strategy
  for (const target of TARGETS) {
    for (const type of LocatorFixturePage.strategyTypesOf(target.locator)) {
      test(`Single strategy [${type}] finds the ${target.description}`, async ({ page, executor }) => {
        const step = stepsFor(executor);
        const fixturePage = new LocatorFixturePage(page, executor);
        const spec = fixturePage.singleStrategySpec(target.locator, type);
        const expectedTag = target.tag.toLowerCase();

        executor.logger.info(
          `PURPOSE: prove "${type}" strategy can locate the ${target.description}. ` +
            `Expected result: a visible <${expectedTag}> element.`
        );

        const { locator, strategyUsed } = await fixturePage.resolve(
          `Resolve "${spec.name}" using only ${describeStrategy(spec.strategies[0])}`,
          spec
        );

        await step('Check the located element is visible on the page', async () => {
          await expect(locator).toBeVisible();
        });

        await step(`Check the element is a <${expectedTag}> tag (the ${target.description})`, async () => {
          expect(await locator.evaluate((el) => el.tagName)).toBe(target.tag);
        });

        await step(`Check the engine recorded "${type}" as the strategy used`, async () => {
          expect(strategyUsed).toBe(type);
        });
      });
    }
  }

  // Unique selectors
  test('Every css and xpath strategy matches exactly one element', async ({ page, executor }) => {
    const step = stepsFor(executor);
    const fixturePage = new LocatorFixturePage(page, executor);

    executor.logger.info(
      'PURPOSE: the engine only uses the first match, so a loose css/xpath would silently pick a decoy ' +
        'Validate css and xpath to match with exactly one element.'
    );

    for (const target of TARGETS) {
      const selectors = fixturePage.spec(target.locator).strategies.filter((s) => ['css', 'xpath'].includes(s.type));
      for (const strategy of selectors) {
        await step(`Check ${describeStrategy(strategy)} matches exactly one element (${target.description})`, async () => {
          expect(await fixturePage.countMatches(strategy)).toBe(1);
        });
      }
    }
  });

  // Ranking
  test('Rank 1 wins when every strategy can resolve', async ({ page, executor }) => {
    const step = stepsFor(executor);
    const fixturePage = new LocatorFixturePage(page, executor);
    const spec = fixturePage.spec('signInButton');

    executor.logger.info(
      'PURPOSE: validate engine stops at rank one (testId) when there are 4 working strategies for the same button'
    );
    spec.strategies.forEach((s, i) => executor.logger.info(`Rank ${i + 1}: ${describeStrategy(s)} (working)`));

    const { locator, strategyUsed } = await fixturePage.resolve('Resolve "signInButton" using the full ranked list', spec);

    await step('Check the located element is the "Sign in" button (not the SSO decoy)', async () => {
      await expect(locator).toHaveText('Sign in');
    });

    await step('Check the engine used rank 1 (testId)', async () => {
      expect(strategyUsed).toBe('testId');
    });
  });

  // Fallback
  test('Broken rank 1 is skipped and rank 2 takes over', async ({ page, executor }) => {
    const step = stepsFor(executor);
    const fixturePage = new LocatorFixturePage(page, executor);
    const spec = fixturePage.spec('brokenRank1SignIn');

    executor.logger.info(
      'PURPOSE: Simulate page change that breaks the preferred locator. Validate the engine skipping ' +
        'the dead testId, fall back to the next rank (role) and still find the button.'
    );
    executor.logger.info(`Rank 1: ${describeStrategy(spec.strategies[0])} (DELIBERATELY BROKEN - no such element)`);
    executor.logger.info(`Rank 2: ${describeStrategy(spec.strategies[1])} (working - expected to be used)`);
    executor.logger.info(`Rank 3: ${describeStrategy(spec.strategies[2])} (working - expected to be unused)`);

    const { locator, strategyUsed } = await fixturePage.resolve(
      'Resolve "brokenRank1SignIn" while rank 1 does not exist on the page',
      spec,
      { timeout: 250 }
    );

    await step('Check the fallback still found the "Sign in" button', async () => {
      await expect(locator).toHaveText('Sign in');
    });

    await step('Check the engine fell back to rank 2 (role), not rank 1 or rank 3', async () => {
      expect(strategyUsed).toBe('role');
    });
  });

  // Failure reporting
  test('Failure: when no strategy matches, the error lists every attempt', async ({ page, executor }) => {
    const step = stepsFor(executor);
    const fixturePage = new LocatorFixturePage(page, executor);
    const spec = fixturePage.spec('unresolvableButton');

    executor.logger.info(
      'PURPOSE: Confirm the engine fails (LocatorResolutionError) when nothing matches, and that ' +
        'the message names each strategy tried.'
    );
    spec.strategies.forEach((s, i) => executor.logger.info(`Rank ${i + 1}: ${describeStrategy(s)} (DELIBERATELY BROKEN)`));

    const { error, strategyUsed } = await fixturePage.resolveExpectingFailure(
      'Resolve "unresolvableButton" where no strategy can match (an error is expected)',
      spec
    );

    await step('Check a LocatorResolutionError was thrown', async () => {
      expect(error, 'engine.find should have thrown').not.toBeNull();
      expect(error.name).toBe('LocatorResolutionError');
    });

    await step('Check the error message lists both strategies that were tried', async () => {
      expect(error.message).toContain('testId');
      expect(error.message).toContain('css');
    });

    await step('Check the engine marked the locator as "unresolved"', async () => {
      expect(strategyUsed).toBe('unresolved');
    });
  });

  // Strategy checker
  test('Strategy checker: Validates every rank and the fallback order of whole locator lists', async ({
    page,
    executor,
  }) => {
    const step = stepsFor(executor);
    const fixturePage = new LocatorFixturePage(page, executor);
    const locators = TARGETS.map((target) => target.locator);

    executor.logger.info(
      'PURPOSE: run the checker that guards real locator files. For each locator it proves that ' +
        '(1) every rank works alone, (2) every rank points at the same element, and ' +
        '(3) the engine falls back through the ranks in the configured order.'
    );
    locators.forEach((name) =>
      executor.logger.info(`Locator "${name}": ${fixturePage.spec(name).strategies.map((x) => x.type).join(' > ')}`)
    );

    // The checker logs one result line per locator into this test's step timeline.
    const outcome = await fixturePage.checkStrategies(`Run the strategy checker on ${locators.join(', ')}`, locators);

    await step('Check no rank failed to resolve, pointed at a different element, or broke fallback order', async () => {
      expect(outcome.failures, outcome.summary).toEqual([]);
    });
  });

  test('Strategy checker: Flags a loose css selector that matches a decoy element', async ({ page, executor }) => {
    const step = stepsFor(executor);
    const fixturePage = new LocatorFixturePage(page, executor);

    executor.logger.info(
      'PURPOSE: rank 2 css ".btn" resolves, but to the SSO decoy button that comes first in the page. ' +
        'The checker must report that it does not point at the same element as rank 1.'
    );

    const outcome = await fixturePage.checkStrategies('Run the strategy checker on "looseCssSignIn"', ['looseCssSignIn']);

    await step('Check exactly one problem was reported: rank 2 css is not the same element as rank 1', async () => {
      expect(outcome.failures, outcome.summary).toHaveLength(1);
      expect(outcome.failures[0]).toContain('css(.btn)');
      expect(outcome.failures[0]).toContain('not to the same element as rank 1');
    });
  });
});
