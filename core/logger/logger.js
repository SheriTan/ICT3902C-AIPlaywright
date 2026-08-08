const SENSITIVE_KEYS = ['password', 'nric', 'fin', 'passport', 'username', 'userid', 'email', 'token', 'secret', 'apiKey', 'api_key', 'authorization'];

class Logger {
    constructor(testInfo) {
        this.testInfo = testInfo;
        this._trace = [];
    }

    info(message) {
        this._trace.push({ timestamp: new Date().toISOString(), message });
        console.log(`[INFO] [${this.testInfo?.title || 'unknown test'}] ${message}`);
    }

    getTrace() {
        return this._trace;
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
                out[key] = isSensitiveKey && typeof value === 'string' ? Logger.mask(value) : Logger.maskSensitive(value);
            }
            return out;
        }
        return data;
    }
}

module.exports = { Logger };