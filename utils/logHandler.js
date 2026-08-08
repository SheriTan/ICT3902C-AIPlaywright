const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');

class LogHandler {
    constructor() {
        this._attemptsByTestId = new Map();
    }

    onTestEnd(test, result) {
        const totalAttempts = test.retries + 1;
        const attemptNumber = result.retry + 1;
        const status = result.status === 'passed' ? 'pass' : 'fail';
        const isFinalAttempt = status === 'pass' || attemptNumber === totalAttempts;

        const customData = this._readExecutionTrace(result);

        const finalAttachments = { screenshot: null, video: null, trace: null };
        for (const a of result.attachments || []) {
            if (a.name === 'screenshot' && a.path) finalAttachments.screenshot = a.path;
            if (a.name === 'video' && a.path) finalAttachments.video = a.path;
            if (a.name === 'trace' && a.path) finalAttachments.trace = a.path;
        }

        const attemptRecord = {
            attemptNumber,
            status,
            durationMs: result.duration,
            steps: customData.steps || [],
            locatorUsed: customData.locatorUsed || null,
            error: result.error
                ? { type: customData.errorType || 'Error', message: result.error.message, stack: result.error.stack }
                : null,
        };

        const key = test.id;
        const attempts = this._attemptsByTestId.get(key) || [];
        attempts.push(attemptRecord);
        this._attemptsByTestId.set(key, attempts);

        if (!isFinalAttempt) return;

        this._attemptsByTestId.delete(key);

        if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

        const safeTitle = test.title.replace(/[^a-z0-9]/gi, '_');
        const runId = new Date().toISOString().replace(/[:.]/g, '-');
        const browserName = test.parent?.project?.()?.name || 'unknown';

        const completeLogPath = path.join(LOGS_DIR, `${safeTitle}_${runId}.complete.log.json`);
        fs.writeFileSync(completeLogPath, JSON.stringify({
            runId,
            timestamp: new Date().toISOString(),
            testName: test.title,
            browser: browserName,
            totalAttempts,
            overallStatus: status,
            attempts,
        }, null, 2));

        const resultPath = path.join(LOGS_DIR, `${safeTitle}_${runId}.result.json`);
        fs.writeFileSync(resultPath, JSON.stringify({
            runId,
            timestamp: new Date().toISOString(),
            testName: test.title,
            executionStatus: status,
            failureType: status === 'fail' ? (attemptRecord.error?.type || 'UnknownError') : null,
            locatorUsed: attemptRecord.locatorUsed,
            artefacts: {
                screenshot: finalAttachments.screenshot,
                video: finalAttachments.video,
                trace: finalAttachments.trace,
                completeLog: completeLogPath,
            },
        }, null, 2));

        this._cleanupOlderAttemptDirs(result.outputDir);
    }

    _readExecutionTrace(result) {
        const attachment = (result.attachments || []).find((a) => a.name === 'execution-trace');
        if (!attachment) return {};

        try {
            if (attachment.body) {
                return JSON.parse(attachment.body.toString('utf-8'));
            }
            if (attachment.path && fs.existsSync(attachment.path)) {
                return JSON.parse(fs.readFileSync(attachment.path, 'utf-8'));
            }
        } catch (_) {
            // Malformed/missing trace attachment should not break reporting
        }
        return {};
    }

    _cleanupOlderAttemptDirs(currentOutputDir) {
        if (!currentOutputDir) return;
        try {
            const parent = path.dirname(currentOutputDir);
            const currentBase = path.basename(currentOutputDir);
            const rootName = currentBase.replace(/-retry\d+$/, '');
            if (!fs.existsSync(parent)) return;

            const familyPattern = new RegExp(`^${rootName}(-retry\\d+)?$`);
            for (const name of fs.readdirSync(parent)) {
                if (name !== currentBase && familyPattern.test(name)) {
                    fs.rmSync(path.join(parent, name), { recursive: true, force: true });
                }
            }
        } catch (_) {
        }
    }
}

module.exports = LogHandler;
