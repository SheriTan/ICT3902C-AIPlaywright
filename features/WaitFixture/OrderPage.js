const { WaitFixturePage, NO_RETRY } = require('./WaitFixturePage');

// The happy path of an order, in order. Used to check the process never goes backwards.
const ORDER_FLOW = ['PENDING', 'PAYMENT_CONFIRMED', 'PACKED', 'SHIPPED'];

class OrderPage extends WaitFixturePage {
  constructor(page, executor) {
    super(page, executor, 'orderPage');
  }

  /** @param {{ scenario?: 'success' | 'decline' | 'stall' }} [options] */
  goto({ scenario = 'success' } = {}) {
    return this.openFixture('order.html', `?scenario=${scenario}`, `Open the checkout page (scenario: ${scenario})`);
  }

  /**
   * Clicks "Place order" and waits for the order request to be answered and the confirmation to show.
   * This is the point where a simple test would carry on - the order is received, but NOT fulfilled yet.
   * @returns {Promise<string>} the order id
   */
  placeOrder() {
    return this.step(
      'Place the order and wait for the confirmation',
      async () => {
        const placeOrderButton = await this.locate('placeOrderButton');
        const orderPlaced = this.page.waitForResponse(
          (response) => response.url().endsWith('/api/orders') && response.request().method() === 'POST'
        );
        await placeOrderButton.click();
        await orderPlaced;
        return (await (await this.locate('orderId')).innerText()).trim();
      },
      NO_RETRY
    );
  }

  /** @returns {Promise<string>} the status shown on the page right now, e.g. 'PACKED' */
  async currentStatus() {
    return (await (await this.locate('orderStatus')).innerText()).trim().toUpperCase();
  }

  /**
   * Business process completion synchronisation: waits until the order is SHIPPED, fails at once if payment
   * fails, and fails if the order stops moving. Never retried - repeating the wait cannot fix a failed order.
   * @param {string} orderId
   * @param {{ timeout?: number, stallTimeout?: number }} [waitOptions]
   * @returns {Promise<{ status: string, timeline: Array<{ status: string, atMs: number }>, elapsedMs: number }>}
   */
  waitForOrderShipped(orderId, waitOptions = {}) {
    return this.step(`Wait for order ${orderId} to be shipped`, () => this._forShipped(orderId, waitOptions), NO_RETRY);
  }

  /**
   * Same wait, for an order that is meant to fail: the step passes and the error is returned instead of thrown.
   * @returns {Promise<{ error: Error | null, elapsedMs: number }>}
   */
  waitForOrderShippedExpectingFailure(orderId, waitOptions) {
    return this.step(
      `Wait for order ${orderId} to be shipped (expected to fail)`,
      async () => {
        const startedAt = Date.now();
        const error = await this._forShipped(orderId, waitOptions).then(
          () => null,
          (err) => err
        );
        return { error, elapsedMs: Date.now() - startedAt };
      },
      NO_RETRY
    );
  }

  async _forShipped(orderId, waitOptions) {
    const statusLocator = await this.locate('orderStatus');
    return this.executor.waitEngine.forProcessCompletion({
      name: `Order ${orderId}`,
      readStatus: async () => (await statusLocator.innerText({ timeout: 1000 })).trim().toUpperCase(),
      completeStatuses: ['SHIPPED'],
      failedStatuses: ['PAYMENT_FAILED'],
      expectedOrder: ORDER_FLOW,
      ...waitOptions,
    });
  }

  /** @returns {Promise<string>} e.g. "Tracking: TRK-1001" */
  async trackingText() {
    return (await (await this.locate('trackingNumber')).innerText()).trim();
  }
}

module.exports = { OrderPage, ORDER_FLOW };
