const { test, expect } = require('../core/fixtures');
const { OrderPage, ORDER_FLOW } = require('../features/WaitFixture/OrderPage');

// Wait engine - business process completion synchronisation (WaitEngine.forProcessCompletion).
// An order is accepted at once, then moves PENDING -> PAYMENT_CONFIRMED -> PACKED -> SHIPPED over about 2.4s.

test.describe('Wait engine - business process completion', () => {
  test('Waits for the order to be shipped, not just for the order request', async ({ page, executor }) => {
    const orderPage = new OrderPage(page, executor);

    executor.logger.info(
      'PURPOSE: the order request returns almost immediately, but the order is not fulfilled until later. ' +
        'Expected result: the test only carries on once the order is SHIPPED, having seen every stage in order.'
    );

    await orderPage.goto();
    const orderId = await orderPage.placeOrder();

    expect(await orderPage.currentStatus(), 'control: right after the confirmation the order is not shipped').not.toBe(
      'SHIPPED'
    );

    const result = await orderPage.waitForOrderShipped(orderId, { timeout: 8000 });

    expect(result.status).toBe('SHIPPED');
    expect(result.timeline.map((entry) => entry.status)[0]).toBe('PENDING');
    expect(result.timeline.map((entry) => entry.status).at(-1)).toBe('SHIPPED');
    expect(result.timeline.map((entry) => entry.status).every((status) => ORDER_FLOW.includes(status))).toBe(true);
    expect(await orderPage.trackingText()).toBe(`Tracking: TRK-${orderId.slice(4)}`);
  });

  test('A declined payment fails immediately instead of waiting for the timeout', async ({ page, executor }) => {
    const orderPage = new OrderPage(page, executor);

    executor.logger.info(
      'PURPOSE: the payment is declined. Expected result: ProcessFailedError as soon as the failure status ' +
        'appears, long before the 8s timeout.'
    );

    await orderPage.goto({ scenario: 'decline' });
    const orderId = await orderPage.placeOrder();
    const { error, elapsedMs } = await orderPage.waitForOrderShippedExpectingFailure(orderId, { timeout: 8000 });

    expect(error, 'the process wait should have failed').not.toBeNull();
    expect(error.name).toBe('ProcessFailedError');
    expect(error.message).toContain('PAYMENT_FAILED');
    expect(elapsedMs).toBeLessThan(5000);
  });

  test('An order that stops moving is reported as stalled', async ({ page, executor }) => {
    const orderPage = new OrderPage(page, executor);

    executor.logger.info(
      'PURPOSE: the order gets stuck at PACKED. Expected result: ProcessStalledError that says where it is ' +
        'stuck and what stages it went through.'
    );

    await orderPage.goto({ scenario: 'stall' });
    const orderId = await orderPage.placeOrder();
    const { error } = await orderPage.waitForOrderShippedExpectingFailure(orderId, {
      timeout: 15000,
      stallTimeout: 1500,
    });

    expect(error, 'the process wait should have failed').not.toBeNull();
    expect(error.name).toBe('ProcessStalledError');
    expect(error.message).toContain('stuck at PACKED');
    expect(error.message).toContain('PAYMENT_CONFIRMED');
  });
});
