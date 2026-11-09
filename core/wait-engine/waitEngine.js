// Extra waiting on top of Playwright's built-in auto-waiting. Playwright waits for ONE element to be
// actionable; it cannot tell when a whole page is ready, when a dropdown has finished reloading after its
// parent changed, or when a business process (an order, a payment) has really finished behind the UI.
//
//   forStableDOM          the page has stopped re-rendering
//   forApiIdle            no fetch/XHR call is in flight (and none started recently)
//   forPageReady          ONE call that waits for every condition a page needs (smart page readiness)
//   syncDependent         a dependent dropdown reloaded after its parent changed (country -> state -> city)
//   forProcessCompletion  a multi-stage business process reached its end state (order monitoring)
//
// Every method throws an Error with a specific `name` (PageNotReadyError, ...) and a message that says
// which condition was not met, so the report and the AI diagnosis can tell why the wait failed.

const { firstLine } = require('../../utils/global/text');

const API_RESOURCE_TYPES = new Set(['xhr', 'fetch']);
const POLL_INTERVAL_MS = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Error with a specific name, so callers and reports can tell the kinds of wait failure apart. */
function namedError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

/** Rejects if `promise` takes longer than `ms`. Used for conditions that have no timeout option of their own. */
function withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/** e.g. "PENDING (0ms) -> PAID (812ms)" */
function describeTimeline(timeline) {
  return timeline.length
    ? timeline.map((entry) => `${entry.status} (${entry.atMs}ms)`).join(' -> ')
    : '(no status read)';
}

class WaitEngine {
  /**
   * @param {import('@playwright/test').Page} page
   * @param {{ info: (message: string) => void } | null} [logger]
   * @param {{ defaultTimeout?: number }} [options] - default timeout in ms (from config waitTimeout)
   */
  constructor(page, logger = null, options = {}) {
    this.page = page;
    this.logger = logger;
    this.defaultTimeout = options.defaultTimeout ?? 15000;

    this._inFlight = new Set();
    this._lastApiActivityAt = Date.now();
    this._trackApiRequests();
  }

  // ---------------------------------------------------------------------------------------------
  // Page-level waits
  // ---------------------------------------------------------------------------------------------

  /**
   * Waits until the DOM has stopped mutating for `quietPeriod` ms (e.g. async data finished rendering).
   * @param {{ timeout?: number, quietPeriod?: number }} [options]
   */
  async forStableDOM(options = {}) {
    const { timeout = this.defaultTimeout, quietPeriod = 500 } = options;

    await this.page.waitForFunction(
      (quietMs) =>
        new Promise((resolve) => {
          let timer;
          const finish = () => {
            observer.disconnect();
            resolve(true);
          };
          const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(finish, quietMs);
          });
          observer.observe(document.body, { childList: true, subtree: true, attributes: true });
          timer = setTimeout(finish, quietMs);
        }),
      quietPeriod,
      { timeout }
    );
  }

  /**
   * Waits until no fetch/XHR call is in flight and none has started or finished for `quietPeriod` ms.
   * Narrower than Playwright's 'networkidle' (which counts every request, including images and fonts)
   * and, unlike it, it can ignore long-lived calls such as analytics or polling.
   * @param {{ quietPeriod?: number, timeout?: number, ignore?: RegExp[] }} [options]
   *   ignore - URL patterns that are not waited for
   */
  async forApiIdle(options = {}) {
    const { quietPeriod = 500, timeout = this.defaultTimeout, ignore = [] } = options;
    const pending = () =>
      [...this._inFlight].filter((request) => !ignore.some((pattern) => pattern.test(request.url())));

    const { ok, state } = await this._poll({
      timeout,
      read: () => pending().map((request) => `${request.method()} ${request.url()}`),
      isDone: (calls) => calls.length === 0 && Date.now() - this._lastApiActivityAt >= quietPeriod,
    });

    if (!ok) {
      const calls = state ?? [];
      throw namedError(
        'ApiNotIdleError',
        calls.length
          ? `${calls.length} API call(s) still in flight after ${timeout}ms: ${calls.slice(0, 5).join(', ')}`
          : `API calls kept starting; no ${quietPeriod}ms quiet period within ${timeout}ms`
      );
    }
  }

  /**
   * Smart page readiness: ONE reusable call that waits for everything a page needs before a test may touch it.
   * Order: load state, then (in parallel) API idle + required elements + spinners gone + custom conditions,
   * then DOM stable. When it fails, the error lists every condition that was not met.
   *
   * @param {{
   *   label?: string,
   *   loadState?: 'load' | 'domcontentloaded' | 'networkidle' | null,
   *   apiIdle?: boolean,
   *   domStable?: boolean,
   *   visible?: import('@playwright/test').Locator[],
   *   hidden?: import('@playwright/test').Locator[],
   *   conditions?: Array<{ name: string, wait: (timeoutMs: number) => Promise<any> }>,
   *   ignoreApi?: RegExp[],
   *   quietPeriod?: number,
   *   timeout?: number
   * }} [options]
   *   visible    - locators that must be visible (e.g. the page heading, the data table)
   *   hidden     - locators that must be gone/hidden (e.g. spinners, skeleton loaders)
   *   conditions - anything else, as { name, wait }; `wait` rejects when the condition cannot be met in time
   * @returns {Promise<{ elapsedMs: number, met: string[] }>}
   */
  async forPageReady(options = {}) {
    const {
      label = 'page',
      loadState = 'load',
      apiIdle = true,
      domStable = true,
      visible = [],
      hidden = [],
      conditions = [],
      ignoreApi = [],
      quietPeriod = 500,
      timeout = this.defaultTimeout,
    } = options;

    const startedAt = Date.now();
    const deadline = startedAt + timeout;
    const remaining = () => Math.max(deadline - Date.now(), 1);
    const met = [];
    const unmet = [];

    const check = async (name, wait) => {
      const conditionStart = Date.now();
      try {
        await withDeadline(wait(remaining()), remaining());
        met.push(`${name} (${Date.now() - conditionStart}ms)`);
      } catch (err) {
        unmet.push(`${name} -> ${firstLine(err.message)}`);
      }
    };

    if (loadState) {
      await check(`load state "${loadState}"`, (ms) => this.page.waitForLoadState(loadState, { timeout: ms }));
    }

    const parallel = [];
    if (apiIdle) {
      parallel.push(check('API calls idle', (ms) => this.forApiIdle({ quietPeriod, timeout: ms, ignore: ignoreApi })));
    }
    for (const locator of visible) {
      parallel.push(check(`visible: ${locator}`, (ms) => locator.waitFor({ state: 'visible', timeout: ms })));
    }
    for (const locator of hidden) {
      parallel.push(check(`hidden: ${locator}`, (ms) => locator.waitFor({ state: 'hidden', timeout: ms })));
    }
    for (const condition of conditions) {
      parallel.push(check(condition.name, condition.wait));
    }
    await Promise.all(parallel);

    // Last, because everything above may still be rendering. Pointless to wait for it if something already failed.
    if (domStable && unmet.length === 0) {
      await check('DOM stable', (ms) => this.forStableDOM({ quietPeriod, timeout: ms }));
    }

    const elapsedMs = Date.now() - startedAt;
    if (unmet.length > 0) {
      throw namedError(
        'PageNotReadyError',
        `${label} was not ready after ${elapsedMs}ms (timeout ${timeout}ms).\n` +
          `Unmet:\n${unmet.map((line) => `  - ${line}`).join('\n')}` +
          (met.length ? `\nMet:\n${met.map((line) => `  - ${line}`).join('\n')}` : '')
      );
    }

    this._log(`READY: ${label} in ${elapsedMs}ms - ${met.join(', ')}`);
    return { elapsedMs, met };
  }

  // ---------------------------------------------------------------------------------------------
  // Dependent element synchronisation
  // ---------------------------------------------------------------------------------------------

  /**
   * Runs `trigger` (e.g. selecting a country) and waits until the dependent dropdown (the states) has
   * finished reloading in response: enabled, has options, has CHANGED from before the trigger (so a stale
   * list left over from the previous parent value is never accepted) and has stopped changing.
   *
   * @param {{
   *   trigger: () => Promise<any>,
   *   dependent: import('@playwright/test').Locator,
   *   label?: string,
   *   minOptions?: number,
   *   requireChange?: boolean,
   *   quietPeriod?: number,
   *   timeout?: number,
   *   readOptions?: () => Promise<{ enabled: boolean, options: string[] }>
   * }} params
   *   minOptions    - real options needed (placeholders with an empty value do not count). Use 0 if "none" is valid
   *   requireChange - when false, a list identical to the one before the trigger is accepted
   *   readOptions   - only for custom (non-<select>) dropdowns; default reads a native <select>
   * @returns {Promise<string[]>} the option labels of the loaded dropdown
   */
  async syncDependent(params) {
    const {
      trigger,
      dependent,
      label = 'dependent options',
      minOptions = 1,
      requireChange = true,
      quietPeriod = 300,
      timeout = this.defaultTimeout,
      readOptions = () =>
        dependent.evaluate(
          (select) => ({
            enabled: !select.disabled,
            options: [...select.options].filter((option) => option.value !== '').map((option) => option.text.trim()),
          }),
          undefined,
          { timeout: 1000 }
        ),
    } = params;

    const startedAt = Date.now();
    const signature = (options) => JSON.stringify(options);

    // Snapshot BEFORE the trigger: this is what "stale" means.
    let before = null;
    try {
      before = signature((await readOptions()).options);
    } catch {
      // the dependent may not be readable yet (e.g. not rendered); then there is nothing stale to compare with
    }

    await trigger();

    let sawBusy = false; // dependent was disabled or empty at some point after the trigger = it did reload
    let lastSignature = null;
    let stableSince = 0;

    const { ok, state, lastError } = await this._poll({
      timeout,
      read: readOptions,
      isDone: (current) => {
        const busy = !current.enabled || current.options.length < minOptions;
        if (busy) {
          sawBusy = true;
          stableSince = 0;
          return false;
        }
        const currentSignature = signature(current.options);
        if (requireChange && !sawBusy && currentSignature === before) return false; // still the old list

        if (currentSignature !== lastSignature) {
          lastSignature = currentSignature;
          stableSince = Date.now();
        }
        return Date.now() - stableSince >= quietPeriod;
      },
    });

    if (!ok) {
      const detail = state
        ? `enabled=${state.enabled}, ${state.options.length} option(s)` +
          (requireChange && !sawBusy && signature(state.options) === before
            ? ', still the same list as before the trigger'
            : '')
        : `could not be read: ${lastError}`;
      throw namedError('DependentNotReadyError', `"${label}" did not finish loading within ${timeout}ms (${detail})`);
    }

    this._log(`SYNCED: ${label} -> ${state.options.length} option(s) in ${Date.now() - startedAt}ms`);
    return state.options;
  }

  // ---------------------------------------------------------------------------------------------
  // Business process completion synchronisation
  // ---------------------------------------------------------------------------------------------

  /**
   * Monitors a business process (order fulfilment, payment, import job...) until it really finishes.
   * `readStatus` is supplied by the page object - it may read a status badge, an API, or both. Unlike
   * `expect.poll`, this follows every status change, fails the moment a failure status appears instead of
   * waiting out the timeout, detects a process that has stopped moving, and checks stages arrive in order.
   *
   * @param {{
   *   name: string,
   *   readStatus: () => Promise<string | null>,
   *   completeStatuses: string[],
   *   failedStatuses?: string[],
   *   expectedOrder?: string[],
   *   timeout?: number,
   *   stallTimeout?: number | null,
   *   interval?: number
   * }} params
   *   expectedOrder - the happy-path stages, e.g. ['PENDING', 'PAID', 'SHIPPED']; going backwards is an error
   *   stallTimeout  - fail if the status has not changed for this long (ms); null = only the overall timeout
   * @returns {Promise<{ status: string, timeline: Array<{ status: string, atMs: number }>, elapsedMs: number }>}
   * @throws ProcessFailedError | ProcessStalledError | ProcessTimeoutError | ProcessOutOfOrderError
   */
  async forProcessCompletion(params) {
    const {
      name,
      readStatus,
      completeStatuses,
      failedStatuses = [],
      expectedOrder = [],
      timeout = 30000,
      stallTimeout = null,
      interval = 250,
    } = params;

    const startedAt = Date.now();
    const timeline = [];
    let current = null;
    let lastChangeAt = startedAt;
    let lastReadError = null;

    for (;;) {
      let status = null;
      try {
        status = await readStatus();
        lastReadError = null;
      } catch (err) {
        lastReadError = firstLine(err.message); // e.g. the page is re-rendering; try again on the next poll
      }

      const now = Date.now();
      if (status != null && status !== current) {
        const previous = current;
        current = status;
        timeline.push({ status, atMs: now - startedAt });
        lastChangeAt = now;
        this._log(`PROCESS "${name}": ${previous ?? '(start)'} -> ${status} (+${now - startedAt}ms)`);

        const from = expectedOrder.indexOf(previous);
        const to = expectedOrder.indexOf(status);
        if (from !== -1 && to !== -1 && to < from) {
          throw namedError(
            'ProcessOutOfOrderError',
            `Process "${name}" went backwards from ${previous} to ${status}. Timeline: ${describeTimeline(timeline)}`
          );
        }
      }

      if (failedStatuses.includes(current)) {
        throw namedError(
          'ProcessFailedError',
          `Process "${name}" failed with status ${current} after ${now - startedAt}ms. Timeline: ${describeTimeline(timeline)}`
        );
      }

      if (completeStatuses.includes(current)) {
        this._log(`PROCESS "${name}" complete: ${current} after ${now - startedAt}ms`);
        return { status: current, timeline, elapsedMs: now - startedAt };
      }

      if (stallTimeout && now - lastChangeAt >= stallTimeout) {
        throw namedError(
          'ProcessStalledError',
          `Process "${name}" has been stuck at ${current ?? '(no status)'} for ${now - lastChangeAt}ms. ` +
            `Timeline: ${describeTimeline(timeline)}`
        );
      }

      if (now - startedAt >= timeout) {
        throw namedError(
          'ProcessTimeoutError',
          `Process "${name}" did not complete within ${timeout}ms (last status ${current ?? '(none)'}` +
            `${lastReadError ? `, last read error: ${lastReadError}` : ''}). Timeline: ${describeTimeline(timeline)}`
        );
      }

      await sleep(interval);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------------

  /**
   * Calls `read` every `interval` ms until `isDone(state)` is true or `timeout` passes.
   * A `read` that throws counts as "not ready yet" (the element may be mid-render), not as a failure.
   * @returns {Promise<{ ok: boolean, state: any, lastError: string | null }>} state = last successful read
   */
  async _poll({ read, isDone, timeout, interval = POLL_INTERVAL_MS }) {
    const deadline = Date.now() + timeout;
    let state;
    let lastError = null;

    for (;;) {
      try {
        state = await read();
        lastError = null;
        if (isDone(state)) return { ok: true, state, lastError };
      } catch (err) {
        lastError = firstLine(err.message);
      }
      if (Date.now() >= deadline) return { ok: false, state, lastError };
      await sleep(interval);
    }
  }

  /** Follows fetch/XHR calls from the moment the engine exists, so forApiIdle knows what is in flight. */
  _trackApiRequests() {
    const finished = (request) => {
      if (this._inFlight.delete(request)) this._lastApiActivityAt = Date.now();
    };

    this.page.on('request', (request) => {
      if (!API_RESOURCE_TYPES.has(request.resourceType())) return;
      this._inFlight.add(request);
      this._lastApiActivityAt = Date.now();
    });
    this.page.on('requestfinished', finished);
    this.page.on('requestfailed', finished);
  }

  _log(message) {
    if (this.logger) this.logger.info(message);
    else console.warn(`[WAIT] ${message}`);
  }
}

module.exports = { WaitEngine };
