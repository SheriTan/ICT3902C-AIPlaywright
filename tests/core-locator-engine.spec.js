const { test, expect } = require('../core/fixtures');
const { LocatorEngine, describeStrategy } = require('../core/locator-engine/locatorEngine');
const { checkLocatorStrategies } = require('../core/locator-engine/strategyChecker');

// ---------------------------------------------------------------------------
// What this file proves
// ---------------------------------------------------------------------------
// LocatorEngine takes a ranked list of strategies (testId > role > label > ...)
// and tries them top to bottom. These tests run against a tiny local HTML page
// (no network, no demo website) so that every result is repeatable and each
// failure points at the locator engine rather than at a site change.
//
//   Group 1  Single strategy   each of the 7 strategy types can find an element
//   Group 2  Ranking           rank 1 wins when everything works
//   Group 3  Fallback          a broken rank is skipped and the next one is used
//   Group 4  Failure           when nothing matches, the error lists every attempt
//   Group 5  Strategy checker  the checker utility validates whole ranked lists
//
// Every test writes a PURPOSE line, then runs named steps through executor.step().
// Those names (and the engine's own "Locator ... resolved via ..." lines) are what
// the AI report shows as the step timeline.

const FIXTURE_HTML = `<!doctype html><html><body>
  <label for="email">Email address</label>
  <input id="email" data-testid="email-input" placeholder="Your email" />
  <label for="password">Password</label>
  <input id="password" data-testid="password-input" placeholder="Your password" />
  <button id="sign-in" data-testid="login-submit">Sign in</button>
  <p id="status">Ready to sign in</p>
</body></html>`;

const FIXTURE_SUMMARY = 'Email input, Password input, "Sign in" button, "Ready to sign in" text';

// Deterministic checks must not be silently retried by the executor, so every
// step here runs once (retries: 0). A failure is then reported at the step that caused it.
const stepsFor = (executor) => (name, fn) => executor.step(name, fn, { retries: 0 });

test.describe('Locator strategy engine - deterministic checks', () => {
  test.beforeEach(async ({ page, executor }) => {
    await stepsFor(executor)(`Load local HTML fixture (${FIXTURE_SUMMARY})`, async () => {
      await page.setContent(FIXTURE_HTML);
    });
  });

  // -------------------------------------------------------------------------
  // Group 1 - one strategy at a time
  // -------------------------------------------------------------------------
  const strategyCases = [
    {
      title: 'testId',
      target: 'email input',
      expected: 'INPUT',
      spec: { name: 'emailInput', strategies: [{ type: 'testId', value: 'email-input' }] },
    },
    {
      title: 'role',
      target: 'Sign in button',
      expected: 'BUTTON',
      spec: {
        name: 'signInButton',
        strategies: [{ type: 'role', value: { role: 'button', name: 'Sign in', exact: true } }],
      },
    },
    {
      title: 'label',
      target: 'email input',
      expected: 'INPUT',
      spec: { name: 'emailInput', strategies: [{ type: 'label', value: 'Email address' }] },
    },
    {
      title: 'placeholder',
      target: 'password input',
      expected: 'INPUT',
      spec: { name: 'passwordInput', strategies: [{ type: 'placeholder', value: 'Your password' }] },
    },
    {
      title: 'text',
      target: 'status message',
      expected: 'P',
      spec: { name: 'statusMessage', strategies: [{ type: 'text', value: 'Ready to sign in' }] },
    },
    {
      title: 'css',
      target: 'Sign in button',
      expected: 'BUTTON',
      spec: { name: 'signInButton', strategies: [{ type: 'css', value: '#sign-in' }] },
    },
    {
      title: 'xpath',
      target: 'Sign in button',
      expected: 'BUTTON',
      spec: { name: 'signInButton', strategies: [{ type: 'xpath', value: "//*[@id='sign-in']" }] },
    },
  ];

  for (const item of strategyCases) {
    test(`Single strategy [${item.title}] finds the ${item.target}`, async ({ executor }) => {
      const step = stepsFor(executor);
      const strategy = item.spec.strategies[0];
      const engine = new LocatorEngine(executor.logger);
      let locator;

      executor.logger.info(
        `PURPOSE: prove the "${item.title}" strategy alone can locate the ${item.target}. ` +
          `Expected result: a visible <${item.expected.toLowerCase()}> element.`
      );

      await step(`Resolve "${item.spec.name}" using only ${describeStrategy(strategy)}`, async () => {
        locator = await engine.find(executor.page, item.spec, { perStrategyTimeout: 500, scrollRounds: 1 });
      });

      await step('Check the located element is visible on the page', async () => {
        await expect(locator).toBeVisible();
      });

      await step(`Check the element is a <${item.expected.toLowerCase()}> tag (the ${item.target})`, async () => {
        expect(await locator.evaluate((el) => el.tagName)).toBe(item.expected);
      });

      await step(`Check the engine recorded "${item.title}" as the strategy used`, async () => {
        expect(engine.lastUsed.strategy).toBe(strategy.type);
      });
    });
  }

  // -------------------------------------------------------------------------
  // Group 2 - ranking
  // -------------------------------------------------------------------------
  test('Ranking: rank 1 (testId) wins when every strategy can resolve', async ({ executor }) => {
    const step = stepsFor(executor);
    const engine = new LocatorEngine(executor.logger);
    const spec = {
      name: 'signInButton',
      strategies: [
        { type: 'testId', value: 'login-submit' },
        { type: 'role', value: { role: 'button', name: 'Sign in', exact: true } },
        { type: 'css', value: '#sign-in' },
        { type: 'xpath', value: "//*[@id='sign-in']" },
      ],
    };
    let locator;

    executor.logger.info(
      'PURPOSE: with 4 working strategies for the same button, the engine must stop at the highest ' +
        'ranked one (testId) and never touch the lower ranks.'
    );
    spec.strategies.forEach((s, i) => executor.logger.info(`Rank ${i + 1}: ${describeStrategy(s)} (working)`));

    await step('Resolve "signInButton" using the full ranked list', async () => {
      locator = await engine.find(executor.page, spec, { perStrategyTimeout: 500, scrollRounds: 1 });
    });

    await step('Check the located element is the "Sign in" button', async () => {
      await expect(locator).toHaveText('Sign in');
    });

    await step('Check the engine used rank 1 (testId)', async () => {
      expect(engine.lastUsed.strategy).toBe('testId');
    });
  });

  // -------------------------------------------------------------------------
  // Group 3 - fallback
  // -------------------------------------------------------------------------
  test('Fallback: a broken rank 1 is skipped and rank 2 (role) takes over', async ({ executor }) => {
    const step = stepsFor(executor);
    const engine = new LocatorEngine(executor.logger);
    const spec = {
      name: 'signInButton',
      strategies: [
        { type: 'testId', value: 'missing-test-id' },
        { type: 'role', value: { role: 'button', name: 'Sign in', exact: true } },
        { type: 'css', value: '#sign-in' },
      ],
    };
    let locator;

    executor.logger.info(
      'PURPOSE: simulate a page change that breaks the preferred locator. The engine should skip ' +
        'the dead testId, fall back to the next rank (role) and still find the button.'
    );
    executor.logger.info(`Rank 1: ${describeStrategy(spec.strategies[0])} (DELIBERATELY BROKEN - no such element)`);
    executor.logger.info(`Rank 2: ${describeStrategy(spec.strategies[1])} (working - expected to be used)`);
    executor.logger.info(`Rank 3: ${describeStrategy(spec.strategies[2])} (working - expected to be unused)`);

    await step('Resolve "signInButton" while rank 1 does not exist on the page', async () => {
      locator = await engine.find(executor.page, spec, { perStrategyTimeout: 250, scrollRounds: 1 });
    });

    await step('Check the fallback still found the "Sign in" button', async () => {
      await expect(locator).toHaveText('Sign in');
    });

    await step('Check the engine fell back to rank 2 (role), not rank 1 or rank 3', async () => {
      expect(engine.lastUsed.strategy).toBe('role');
    });
  });

  // -------------------------------------------------------------------------
  // Group 4 - failure reporting
  // -------------------------------------------------------------------------
  test('Failure: when no strategy matches, the error lists every attempt', async ({ executor }) => {
    const step = stepsFor(executor);
    const engine = new LocatorEngine(executor.logger);
    const spec = {
      name: 'ghostButton',
      strategies: [
        { type: 'testId', value: 'no-such-test-id' },
        { type: 'css', value: '#no-such-id' },
      ],
    };
    let error;

    executor.logger.info(
      'PURPOSE: confirm the engine fails loudly (LocatorResolutionError) when nothing matches, and that ' +
        'the message names each strategy tried. The AI diagnosis relies on this detail.'
    );
    spec.strategies.forEach((s, i) =>
      executor.logger.info(`Rank ${i + 1}: ${describeStrategy(s)} (DELIBERATELY BROKEN)`)
    );

    await step('Resolve "ghostButton" where no strategy can match (an error is expected)', async () => {
      error = await engine.find(executor.page, spec, { perStrategyTimeout: 250, scrollRounds: 1 }).then(
        () => null,
        (err) => err
      );
    });

    await step('Check a LocatorResolutionError was thrown', async () => {
      expect(error, 'engine.find should have thrown').not.toBeNull();
      expect(error.name).toBe('LocatorResolutionError');
    });

    await step('Check the error message lists both strategies that were tried', async () => {
      expect(error.message).toContain('testId');
      expect(error.message).toContain('css');
    });

    await step('Check the engine marked the locator as "unresolved"', async () => {
      expect(engine.lastUsed.strategy).toBe('unresolved');
    });
  });

  // -------------------------------------------------------------------------
  // Group 5 - strategy checker utility
  // -------------------------------------------------------------------------
  test('Strategy checker: validates every rank and the fallback order of whole locator lists', async ({ executor }) => {
    const step = stepsFor(executor);
    const specs = [
      {
        name: 'submit',
        strategies: [
          { type: 'testId', value: 'login-submit' },
          { type: 'role', value: { role: 'button', name: 'Sign in', exact: true } },
          { type: 'css', value: '#sign-in' },
          { type: 'xpath', value: "//*[@id='sign-in']" },
        ],
      },
      {
        name: 'email',
        strategies: [
          { type: 'label', value: 'Email address' },
          { type: 'placeholder', value: 'Your email' },
          { type: 'testId', value: 'email-input' },
          { type: 'css', value: '#email' },
          { type: 'xpath', value: "//*[@id='email']" },
        ],
      },
    ];
    let outcome;

    executor.logger.info(
      'PURPOSE: run the checker that guards real locator files. For each locator it proves that ' +
        '(1) every rank works alone, (2) every rank points at the same element, and ' +
        '(3) the engine falls back through the ranks in the configured order.'
    );
    specs.forEach((s) => executor.logger.info(`Locator "${s.name}": ${s.strategies.map((x) => x.type).join(' > ')}`));

    await step('Run the strategy checker on the "submit" and "email" locators', async () => {
      // The checker logs one result line per locator into this test's step timeline.
      outcome = await checkLocatorStrategies(executor.page, specs, {
        logger: executor.logger,
        timeoutMs: 300,
        label: 'fixture',
      });
    });

    await step('Check no rank failed to resolve, pointed at a different element, or broke fallback order', async () => {
      expect(outcome.failures, outcome.summary).toEqual([]);
    });
  });
});
