// Base class of the wait-engine fixture pages (DashboardPage, LocationPage, OrderPage): serves the fake site
// and opens a page on it WITHOUT waiting for it to finish loading, so the test can show the wait engine
// doing that job.

const { BasePage } = require('../BasePage');
const { installWaitFixtureServer, WAIT_FIXTURE_ORIGIN } = require('./waitFixtureServer');

// Deterministic checks: a failure must surface at the step that caused it, not be silently retried.
const NO_RETRY = { retries: 0 };

class WaitFixturePage extends BasePage {
  /**
   * @param {string} file - fixture file, e.g. 'dashboard.html'
   * @param {string} query - e.g. '?broken=spinner'
   * @param {string} stepName
   */
  openFixture(file, query, stepName) {
    return this.step(
      stepName,
      async () => {
        await installWaitFixtureServer(this.page);
        await this.page.goto(`${WAIT_FIXTURE_ORIGIN}/${file}${query}`, { waitUntil: 'commit' });
      },
      NO_RETRY
    );
  }
}

module.exports = { WaitFixturePage, NO_RETRY };
