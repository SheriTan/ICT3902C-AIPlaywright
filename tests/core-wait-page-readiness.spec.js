const { test, expect } = require('../core/fixtures');
const { DashboardPage } = require('../features/WaitFixture/DashboardPage');

// Wait engine - smart page readiness (WaitEngine.forPageReady).
// The dashboard on the local fixture site loads in stages: three widgets arrive after 0.4s / 0.9s / 1.3s,
// then the chart is drawn, then the spinner goes, then a welcome banner is injected.

test.describe('Wait engine - smart page readiness', () => {
  test('One readiness call waits for spinner, API calls, chart and DOM', async ({ page, executor }) => {
    const dashboard = new DashboardPage(page, executor);

    executor.logger.info(
      'PURPOSE: prove one reusable readiness call replaces a hand-written chain of waits. ' +
        'Expected result: after it returns, every widget, the chart and the late banner are already there.'
    );

    await dashboard.goto();
    expect(await dashboard.loadedWidgetCount(), 'control: nothing has loaded straight after navigation').toBe(0);

    const readiness = await dashboard.waitUntilDashboardReady();

    expect(await dashboard.loadedWidgetCount()).toBe(3);
    expect(await dashboard.widgetValues()).toEqual({ revenue: '$48,200', orders: '312', users: '1,874' });
    expect(await dashboard.spinnerCount()).toBe(0);
    expect(await dashboard.welcomeBannerCount()).toBe(1);

    expect(readiness.met.some((condition) => condition.startsWith('API calls idle'))).toBe(true);
    expect(readiness.met.some((condition) => condition.startsWith('DOM stable'))).toBe(true);
  });

  test('A page that never becomes ready fails and names the unmet condition', async ({ page, executor }) => {
    const dashboard = new DashboardPage(page, executor);

    executor.logger.info(
      'PURPOSE: the spinner never goes away on this page. Expected result: PageNotReadyError that says the ' +
        'spinner is the problem and does not blame the conditions that were met.'
    );

    await dashboard.goto({ broken: 'spinner' });
    const { error } = await dashboard.waitUntilDashboardReadyExpectingFailure({ timeout: 3000 });

    expect(error, 'the readiness wait should have failed').not.toBeNull();
    expect(error.name).toBe('PageNotReadyError');
    expect(error.message).toContain('Unmet:');
    expect(error.message).toContain('hidden: loadingSpinner');
    expect(error.message).toContain('Met:');
    expect(error.message).toContain('visible: salesChart');
  });
});
