const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const LOGS_DIR = path.join(PROJECT_ROOT, 'logs');

/**
 * Artefact paths used to be written as absolute paths belonging to whatever
 * machine ran the test (e.g. C:\Users\...\trace.zip). That makes the logs
 * non-portable: the AI layer and the report cannot resolve them on another
 * machine, in CI, or after the repo is moved. 
 * 
 * Everything is stored relative to the project root with forward slashes, so the same log reads correctly
 */
function toRelative(absPath) {
    if (!absPath) return null;
    try {
        return path.relative(PROJECT_ROOT, absPath).split(path.sep).join('/');
    } catch (_) {
        return absPath;
    }
}

function collectArtefacts(result) {
    const artefacts = { screenshot: null, video: null, trace: null, errorContext: null };

    for (const attachment of result.attachments || []) {
        if (!attachment.path) continue;
        if (attachment.name === 'screenshot') artefacts.screenshot = toRelative(attachment.path);
        if (attachment.name === 'video') artefacts.video = toRelative(attachment.path);
        if (attachment.name === 'trace') artefacts.trace = toRelative(attachment.path);
        if (attachment.name === 'error-context') artefacts.errorContext = toRelative(attachment.path);
    }

    return artefacts;
}

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
        const artefacts = collectArtefacts(result);

        const attemptRecord = {
            attemptNumber,
            status,
            durationMs: result.duration,
            steps: customData.steps || [],
            locatorUsed: customData.locatorUsed || null,
            failedStep: customData.failedStep || null,
            artefacts,
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
            suite: test.parent?.title || null,
            file: test.location?.file ? toRelative(test.location.file) : null,
            line: test.location?.line ?? null,
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
            suite: test.parent?.title || null,
            browser: browserName,
            durationMs: attemptRecord.durationMs,
            executionStatus: status,
            failureType: status === 'fail' ? (attemptRecord.error?.type || 'UnknownError') : null,
            locatorUsed: attemptRecord.locatorUsed,
            artefacts: {
                ...artefacts,
                completeLog: toRelative(completeLogPath),
            },
        }, null, 2));
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
        }
        return {};
    }
}

module.exports = LogHandler;
