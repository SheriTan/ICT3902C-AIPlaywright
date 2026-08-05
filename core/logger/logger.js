// Build JSON log whenever encounter failure:
// - errorType      : name of error
// - errorMessage   : human-readable message
// - domSnapshot    : the page's HTML at the moment of failure
// - screenshotPath : saved image of what the browser looked like
// - context        : which test, which step, which browser, timestamp

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', '..', 'logs');
const SENSITIVE_KEYS = ['password', 'pass', 'token', 'secret', 'apiKey', 'api_key', 'authorization'];

class Logger {
    constructor(testInfo) {
        this.testInfo = testInfo;
    }

    info(message) {
        console.log(`[INFO] [${this.testInfo?.title || 'unknown test'}] ${message}`);
    }

    // Masking
    static mask(value, visibleChars = 1) {
        if (typeof value !== 'string' || value.length === 0) return value;
        if (value.length <= visibleChars * 2) return '*'.repeat(value.length);
        const head = value.slice(0, visibleChars);
        const tail = value.slice(-visibleChars);
        return `${head}${'*'.repeat(value.length - visibleChars * 2)}${tail}`;
    }

    static maskSensitive(data) {
        if (Array.isArray(data)) return data.map((item) => Logger.maskSensitive(item));
        if (data && typeof data === 'object') {
            const out = {};
            for (const [key, value] of Object.entries(data)) {
                const isSensitiveKey = SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k));
                if (isSensitiveKey && typeof value === 'string') {
                    out[key] = Logger.mask(value);
                } else {
                    out[key] = Logger.maskSensitive(value);
                }
            }
            return out;
        }
        return data;
    }

    /**
    * @param {object} params
    * @param {'pass'|'fail'} params.executionStatus
    * @param {Error|null} params.error - the failure, if any
    * @param {object|null} params.locatorUsed - { name, strategy, value } of the last locator resolved by the LocatorEngine, or null
    * @param {import('@playwright/test').Page} params.page
    */
    async logResult({ executionStatus, error = null, locatorUsed = null, page = null }) {
        if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

        const timestamp = new Date().toISOString();
        const safeTitle = (this.testInfo?.title || 'Test').replace(/[^a-z0-9]/gi, '_');
        const baseName = `${safeTitle}_${Date.now()}`;

        const artefacts = {
            screenshot: null,
            video: null,
            trace: null,
            diagnostics: null, // path to the deep logError() record, fail only
        };

        if (this.testInfo?.attachments) {
            const video = this.testInfo.attachments.find((a) => a.name === 'video');
            const trace = this.testInfo.attachments.find((a) => a.name === 'trace');
            if (video) artefacts.video = video.path;
            if (trace) artefacts.trace = trace.path;
        }

        if (executionStatus === 'fail' && error) {
            artefacts.diagnostics = await this.logError(error, page, 'test execution');
            artefacts.screenshot = this._lastScreenshotPath || null;
        }

        const record = {
            timestamp,
            testName: this.testInfo?.title,
            executionStatus,
            failureType: executionStatus === 'fail' ? error?.name || 'UnknownError' : null,
            locatorUsed: locatorUsed ? Logger.maskSensitive(locatorUsed) : null,
            artefacts,
        };

        const logFilePath = path.join(LOGS_DIR, `${baseName}.result.json`);
        fs.writeFileSync(logFilePath, JSON.stringify(record, null, 2));

        return logFilePath;
    }

    /**
     * @param {Error} error - the thrown error
     * @param {import('@playwright/test').Page} page - current page, for DOM/screenshot capture
     * @param {string} step - a short label for what you were doing ("clicking submit")
     */

    async logError(error, page, step = 'unspecified step') {
        if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

        const timestamp = new Date().toISOString();
        const safeTitle = (this.testInfo?.title || 'Test').replace(/[^a-z0-9]/gi, '_');
        const baseName = `${safeTitle}_${Date.now()}`;

        // 1. DOM state - the full rendered HTML at the moment of failure.
        let domSnapshot = null;
        try {
            domSnapshot = page ? await page.content() : null;
        } catch (e) {
            domSnapshot = `<unable to capture DOM: ${e.message}>`;
        }

        // 2. Screenshot evidence.
        let screenshotPath = null;
        try {
            if (page) {
                screenshotPath = path.join(LOGS_DIR, `${baseName}.png`);
                await page.screenshot({ path: screenshotPath, fullPage: true });
            }
        } catch (e) {
            screenshotPath = null;
        }

        // 3. The structured record itself.
        const record = {
            timestamp,
            testTitle: this.testInfo?.title,
            browser: this.testInfo?.project?.name,
            step,
            errorType: error.name,
            errorMessage: error.message,
            stack: error.stack,
            domSnapshot,
            screenshotPath,
        };

        const logFilePath = path.join(LOGS_DIR, `${baseName}.json`);
        fs.writeFileSync(logFilePath, JSON.stringify(record, null, 2));

        console.error(`[ERROR] Logged failure to ${logFilePath}`);

        // Attach the screenshot to HTML report
        if (this.testInfo && screenshotPath) {
            await this.testInfo.attach('failure-screenshot', { path: screenshotPath });
        }

        return logFilePath;
    }
}

module.exports = { Logger };