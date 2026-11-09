const { WaitFixturePage, NO_RETRY } = require('./WaitFixturePage');

// What must be true before the dashboard may be used (names in locators/dashboardPage.locators.json)
const READY = { visible: ['dashboardTitle', 'salesChart'], hidden: ['loadingSpinner'], label: 'Dashboard' };

class DashboardPage extends WaitFixturePage {
  constructor(page, executor) {
    super(page, executor, 'dashboardPage');
  }

  /** @param {{ broken?: 'spinner' }} [options] - 'spinner' keeps the spinner on screen forever */
  goto({ broken } = {}) {
    return this.openFixture(
      'dashboard.html',
      broken ? `?broken=${broken}` : '',
      'Open the dashboard (without waiting for it to finish loading)'
    );
  }

  /** Smart page readiness: one call for spinner, API calls, heading, chart and DOM stability. */
  waitUntilDashboardReady(waitOptions) {
    return this.waitUntilReady(READY, waitOptions, NO_RETRY);
  }

  /** Same wait, for a page that is meant to never become ready: the error is returned instead of thrown. */
  waitUntilDashboardReadyExpectingFailure(waitOptions) {
    return this.waitUntilReadyExpectingFailure(READY, waitOptions);
  }

  // The reads below deliberately do NOT wait (count() and evaluate() have no auto-wait), so they only give
  // the right answer once the page really is ready.

  /** @returns {Promise<number>} how many widgets have received their data */
  loadedWidgetCount() {
    return this.page.locator('.widget .value[data-loaded="true"]').count();
  }

  /** @returns {Promise<Record<string, string>>} e.g. { revenue: '$48,200', orders: '312', users: '1,874' } */
  widgetValues() {
    return this.page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll('.widget .value')].map((el) => [
          el.dataset.testid.replace('widget-', ''),
          el.textContent.trim(),
        ])
      )
    );
  }

  spinnerCount() {
    return this.page.getByTestId('loading-spinner').count();
  }

  /** The welcome banner is injected after the spinner is gone, so it is only there if the DOM really settled. */
  welcomeBannerCount() {
    return this.page.getByTestId('welcome-banner').count();
  }
}

module.exports = { DashboardPage };
