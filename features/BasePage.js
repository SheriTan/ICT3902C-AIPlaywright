class BasePage {
  /**
   * @param {import('@playwright/test').Page} page
   * @param {import('../core/executor/testExecutor').TestExecutor} executor
   */
  constructor(page, executor) {
    this.page = page;
    this.executor = executor;
  }

  async locate(spec, options) {
    return this.executor.locate(spec, options);
  }

  async step(name, fn) {
    return this.executor.step(name, fn);
  }

  wait() {
    return this.executor.wait();
  }
}

module.exports = { BasePage };
