
const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', '..', 'logs');
const SENSITIVE_KEYS = ['password', 'pass', 'token', 'secret', 'apiKey', 'api_key', 'authorization'];
const DOM_EXCERPT_LIMIT = 2000;

class Logger {
    constructor(testInfo) {
        this.testInfo = testInfo;
        this._trace = [];
    }

    info(message) {
        const entry = { timestamp: new Date().toISOString(), message };
        this._trace.push(entry);
        console.log(`[INFO] [${this.testInfo?.title || 'unknown test'}] ${message}`);
    }

    // Masking
    static mask(value, visibleChars = 2) {
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
                out[key] = isSensitiveKey && typeof value === 'string' ? Logger.mask(value) : Logger.maskSensitive(value);
            }
            return out;
        }
        return data;
    }

    // Helpers
    _safeTitle() {
        return (this.testInfo?.title || 'test').replace(/[^a-z0-9]/gi, '_');
    }

    _ensureLogsDir() {
        if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
    }

    _existingAttachments() {
        const attachments = { screenshot: null, video: null, trace: null };
        for (const a of this.testInfo?.attachments || []) {
            if (a.name === 'screenshot' && a.path) attachments.screenshot = a.path;
            if (a.name === 'video' && a.path) attachments.video = a.path;
            if (a.name === 'trace' && a.path) attachments.trace = a.path;
        }
        return attachments;
    }

    // Log Writing
    /**
     * @param {object} params
     * @param {'pass'|'fail'} params.status
     * @param {Error|null} params.error
     * @param {object|null} params.locatorUsed
     * @param {import('@playwright/test').Page|null} params.page
     * @param {number} params.attemptNumber - testInfo.retry + 1
     */
    async writeRunLog({ status, error = null, locatorUsed = null, page = null, attemptNumber = 1 }) {
        this._ensureLogsDir();

        let domExcerpt = null;
        if (status === 'fail' && page) {
            try {
                const fullDom = await page.content();
                domExcerpt = fullDom.slice(0, DOM_EXCERPT_LIMIT);
            } catch (e) {
                domExcerpt = `<unable to capture DOM: ${e.message}>`;
            }
        }

        const record = {
            timestamp: new Date().toISOString(),
            testName: this.testInfo?.title,
            browser: this.testInfo?.project?.name,
            attemptNumber,
            status,
            steps: this._trace,
            error: status === 'fail' && error
                ? { type: error.name, message: error.message, stack: error.stack, domExcerpt }
                : null,
            locatorUsed: locatorUsed ? Logger.maskSensitive(locatorUsed) : null,
        };

        const logFilePath = path.join(LOGS_DIR, `${this._safeTitle()}_attempt${attemptNumber}.log.json`);
        fs.writeFileSync(logFilePath, JSON.stringify(record, null, 2));
        return logFilePath;
    }

    // Test Result Writing
    /**
     * @param {object} params
     * @param {'pass'|'fail'} params.status
     * @param {Error|null} params.error
     * @param {object|null} params.locatorUsed
     * @param {string|null} params.runLogPath - path returned by writeRunLog()
     */
    async writeTestResult({ status, error = null, locatorUsed = null, runLogPath = null }) {
        this._ensureLogsDir();

        const attachments = this._existingAttachments();

        const record = {
            timestamp: new Date().toISOString(),
            testName: this.testInfo?.title,
            executionStatus: status,
            failureType: status === 'fail' ? error?.name || 'UnknownError' : null,
            locatorUsed: locatorUsed ? Logger.maskSensitive(locatorUsed) : null,
            artefacts: {
                screenshot: attachments.screenshot,
                video: attachments.video,
                trace: attachments.trace,
                runLog: runLogPath,
            },
        };

        const logFilePath = path.join(LOGS_DIR, `${this._safeTitle()}.result.json`);
        fs.writeFileSync(logFilePath, JSON.stringify(record, null, 2));
        return logFilePath;
    }
}

module.exports = { Logger };