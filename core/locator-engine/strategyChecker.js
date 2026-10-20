// Verifies that every ranked strategy in a locator spec really works.
//
// A locator in locators/*.locators.json is a ranked list (first = most preferred):
//   "usernameInput": { "strategies": [ label, testId, placeholder, ... ] }
// LocatorEngine tries them top to bottom and falls back to the next on failure. That is only
// useful if each rank actually works, otherwise a "fallback" silently points nowhere or at the
// wrong element. For every locator this checker proves three things:
//
//   1. RANK WORKS      each strategy, tried on its own, finds a visible element
//   2. SAME TARGET     that element is the primary (rank 1) element, or sits right inside / around it
//                      (e.g. a role=row match vs the <tr> a css strategy returns)
//   3. FALLBACK ORDER  with ranks 1..n-1 sabotaged the engine lands on rank n,
//                      and with nothing sabotaged it picks rank 1
//
// Typical use inside a test:
//
//   const outcome = await checkLocatorStrategies(page, specs, { logger: executor.logger });
//   expect(outcome.failures, outcome.summary).toEqual([]);

const { LocatorEngine, describeStrategy } = require('./locatorEngine');
const { firstLine } = require('../../utils/global/text');

const SILENT_LOGGER = { info() {} };
const NO_SUCH_ELEMENT = '__strategy_check_no_such_element__';

// Same element, or one contains the other (row vs cell vs row-container)
async function isRelated(primary, other) {
  try {
    const otherHandle = await other.elementHandle({ timeout: 1000 });
    if (!otherHandle) return false;
    return await primary.evaluate((a, b) => a === b || a.contains(b) || b.contains(a), otherHandle);
  } catch {
    return false;
  }
}

// A value that cannot match anything, shaped like the strategy it replaces
function brokenStrategy(strategy) {
  switch (strategy.type) {
    case 'role':
      return { type: 'role', value: { role: strategy.value.role, name: NO_SUCH_ELEMENT, exact: true } };
    case 'css':
      return { type: 'css', value: `#${NO_SUCH_ELEMENT}` };
    case 'xpath':
      return { type: 'xpath', value: `//*[@id='${NO_SUCH_ELEMENT}']` };
    default:
      return { type: strategy.type, value: NO_SUCH_ELEMENT };
  }
}

/**
 * Resolves a spec with a fresh engine.
 * @returns {Promise<{ locator?: import('@playwright/test').Locator, used?: string, error?: string }>}
 */
async function resolveWith(page, spec, timeoutMs) {
  const engine = new LocatorEngine(SILENT_LOGGER);
  try {
    const locator = await engine.find(page, spec, { perStrategyTimeout: timeoutMs, scrollRounds: 1 });
    return { locator, used: engine.lastUsed?.strategy };
  } catch (err) {
    return { error: firstLine(err.message) };
  }
}

/**
 * @param {import('@playwright/test').Page} page - already on the page that shows the elements
 * @param {Array<{ name: string, strategies: object[] }>} specs - from loadLocatorSpec(...)
 * @param {{ logger?: { info: Function }, timeoutMs?: number, label?: string }} [options]
 *   timeoutMs = how long a strategy may take to match (and how long each sabotaged rank costs in the
 *   fallback phase). Keep it small; elements should already be on screen.
 * @returns {Promise<{ results: object[], failures: string[], summary: string }>}
 */
async function checkLocatorStrategies(page, specs, options = {}) {
  const { logger = SILENT_LOGGER, timeoutMs = 600, label = '' } = options;
  const results = [];
  const failures = [];
  const lines = [];

  for (const spec of specs) {
    const { name, strategies } = spec;
    const tag = `${label ? `${label}.` : ''}${name}`;
    const entry = { name, ranks: [], fallback: [], primaryWins: null };

    // 1 + 2: every rank on its own, compared with rank 1
    let primary = null;
    for (let i = 0; i < strategies.length; i += 1) {
      const strategy = strategies[i];
      const rank = i + 1;
      const started = Date.now();
      const row = { rank, type: strategy.type, resolved: false, related: null, ms: 0, error: null };

      const { locator, error } = await resolveWith(
        page,
        { name: `${name}#${rank}`, strategies: [strategy] },
        timeoutMs
      );
      if (locator) {
        row.resolved = true;
        if (!primary) primary = locator;
        row.related = locator === primary ? true : await isRelated(primary, locator);
      } else {
        row.error = error;
      }
      row.ms = Date.now() - started;
      entry.ranks.push(row);

      if (!row.resolved) {
        failures.push(`${tag} rank ${rank} ${describeStrategy(strategy)} did not resolve to a visible element`);
      } else if (row.related === false) {
        failures.push(
          `${tag} rank ${rank} ${describeStrategy(strategy)} resolved, but not to the same element as rank 1`
        );
      }
    }

    // 3a: nothing sabotaged -> rank 1 must win
    const unsabotaged = await resolveWith(page, spec, timeoutMs);
    entry.primaryWins = unsabotaged.used === strategies[0].type;
    if (unsabotaged.error) {
      failures.push(`${tag} could not be resolved at all: ${unsabotaged.error}`);
    } else if (!entry.primaryWins) {
      failures.push(`${tag} expected rank 1 (${strategies[0].type}) to win but the engine used ${unsabotaged.used}`);
    }

    // 3b: sabotage ranks 1..k-1 -> the engine must fall back to rank k, in order
    for (let k = 1; k < strategies.length; k += 1) {
      const rank = k + 1;
      const expected = strategies[k].type;

      if (!entry.ranks[k].resolved) {
        entry.fallback.push({ rank, expected, actual: 'skipped (rank does not work on its own)', ok: false });
        continue;
      }

      const sabotaged = [...strategies.slice(0, k).map(brokenStrategy), ...strategies.slice(k)];
      const outcome = await resolveWith(page, { name, strategies: sabotaged }, timeoutMs);
      const actual = outcome.error ? `unresolved (${outcome.error})` : outcome.used;
      const ok = actual === expected;
      entry.fallback.push({ rank, expected, actual, ok });
      if (!ok) failures.push(`${tag} fallback to rank ${rank}: expected ${expected}, engine used ${actual}`);
    }

    results.push(entry);

    const rankText = entry.ranks
      .map((r) => `${r.rank}:${r.type}${r.resolved && r.related ? ' ok' : ' FAIL'}`)
      .join(' | ');
    const fallbackOk = entry.primaryWins && entry.fallback.every((f) => f.ok);
    lines.push(`${tag} -> ${rankText} | rank-1-wins=${entry.primaryWins} fallback-order=${fallbackOk ? 'ok' : 'FAIL'}`);
  }

  lines.forEach((line) => logger.info(line));
  const verdict = failures.length ? `${failures.length} problem(s):\n- ${failures.join('\n- ')}` : 'All strategies OK';
  return { results, failures, summary: [...lines, '', verdict].join('\n') };
}

module.exports = { checkLocatorStrategies };
