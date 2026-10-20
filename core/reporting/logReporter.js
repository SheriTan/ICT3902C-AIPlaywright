// Playwright reporter: writes one .result.json + .complete.log.json per finished test (after its last
// attempt) into /logs, and records which runs belonged to this `playwright test` in logs/last-run.json.
// Everything written is passed through redact(), so values from data/sensitive never reach the logs.
//
// Registered in playwright.config.js. Output is read by logStore.js.

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT, LOGS_DIR } = require('../../utils/global/paths');
const { redact } = require('../logger/sensitiveData');
const { writeLastRun } = require('./logStore');

/**
 * Artefact paths are stored relative to the project root with forward slashes, so a log reads the same on
 * another machine, in CI, or after the repo is moved (absolute paths like C:\Users\...\trace.zip would not).
 */
function toRelative(absPath) {
  if (!absPath) return null;
  return path.relative(PROJECT_ROOT, absPath).split(path.sep).join('/');
}

function collectArtefacts(result) {
  const artefacts = { screenshot: null, video: null, trace: null, errorContext: null };
  const attachmentToKey = { screenshot: 'screenshot', video: 'video', trace: 'trace', 'error-context': 'errorContext' };

  for (const attachment of result.attachments || []) {
    const key = attachmentToKey[attachment.name];
    if (key && attachment.path) artefacts[key] = toRelative(attachment.path);
  }

  return artefacts;
}

// The 'execution-trace' attachment is added by TestExecutor.finish()
function readExecutionTrace(result) {
  const attachment = (result.attachments || []).find((a) => a.name === 'execution-trace');
  if (!attachment) return {};

  try {
    if (attachment.body) return JSON.parse(attachment.body.toString('utf-8'));
    if (attachment.path && fs.existsSync(attachment.path)) return JSON.parse(fs.readFileSync(attachment.path, 'utf-8'));
  } catch {
    // unreadable trace: log the attempt without step details
  }
  return {};
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(redact(data), null, 2));
}

class LogReporter {
  constructor() {
    this._attemptsByTestId = new Map();
    this._runStartedAt = new Date().toISOString();
    this._resultBases = new Set();
  }

  onBegin() {
    this._runStartedAt = new Date().toISOString();
    this._resultBases.clear();
  }

  onEnd() {
    // Nothing ran (e.g. `playwright test --list`): keep the previous record so `npm run report` still works
    if (this._resultBases.size === 0) return;

    writeLastRun({
      startedAt: this._runStartedAt,
      finishedAt: new Date().toISOString(),
      results: [...this._resultBases],
    });
  }

  onTestEnd(test, result) {
    const totalAttempts = test.retries + 1;
    const attemptNumber = result.retry + 1;
    const status = result.status === 'passed' ? 'pass' : 'fail';
    const isFinalAttempt = status === 'pass' || attemptNumber === totalAttempts;

    const trace = readExecutionTrace(result);
    const artefacts = collectArtefacts(result);

    const attempt = {
      attemptNumber,
      status,
      durationMs: result.duration,
      steps: trace.steps || [],
      locatorUsed: trace.locatorUsed || null,
      failedStep: trace.failedStep || null,
      artefacts,
      error: result.error
        ? { type: trace.errorType || 'Error', message: result.error.message, stack: result.error.stack }
        : null,
    };

    const attempts = [...(this._attemptsByTestId.get(test.id) || []), attempt];
    if (!isFinalAttempt) {
      this._attemptsByTestId.set(test.id, attempts);
      return;
    }
    this._attemptsByTestId.delete(test.id);

    this._writeFinalLogs(test, { status, totalAttempts, attempts, attempt, artefacts });
  }

  _writeFinalLogs(test, { status, totalAttempts, attempts, attempt, artefacts }) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });

    const safeTitle = test.title.replace(/[^a-z0-9]/gi, '_');
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `${safeTitle}_${runId}`;
    const timestamp = new Date().toISOString();
    const browser = test.parent?.project?.()?.name || 'unknown';
    const suite = test.parent?.title || null;

    const completeLogPath = path.join(LOGS_DIR, `${base}.complete.log.json`);
    writeJson(completeLogPath, {
      runId,
      timestamp,
      testName: test.title,
      suite,
      file: test.location?.file ? toRelative(test.location.file) : null,
      line: test.location?.line ?? null,
      browser,
      totalAttempts,
      overallStatus: status,
      attempts,
    });

    this._resultBases.add(base);
    writeJson(path.join(LOGS_DIR, `${base}.result.json`), {
      runId,
      timestamp,
      testName: test.title,
      suite,
      browser,
      durationMs: attempt.durationMs,
      executionStatus: status,
      failureType: status === 'fail' ? attempt.error?.type || 'UnknownError' : null,
      locatorUsed: attempt.locatorUsed,
      artefacts: { ...artefacts, completeLog: toRelative(completeLogPath) },
    });
  }
}

module.exports = LogReporter;
