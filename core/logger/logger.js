// Per-test logger. Every message is redacted (see sensitiveData.js), kept in memory so the
// fixture can attach it to the test as the "execution-trace", and echoed to the console.

const { redactString } = require('./sensitiveData');

class Logger {
  /** @param {import('@playwright/test').TestInfo} testInfo */
  constructor(testInfo) {
    this.testInfo = testInfo;
    this._trace = [];
  }

  info(message) {
    const safeMessage = redactString(String(message));
    this._trace.push({ timestamp: new Date().toISOString(), message: safeMessage });
    console.log(`[INFO] [${this.testInfo?.title || 'unknown test'}] ${safeMessage}`);
  }

  /** @returns {Array<{ timestamp: string, message: string }>} */
  getTrace() {
    return this._trace;
  }
}

module.exports = { Logger };
