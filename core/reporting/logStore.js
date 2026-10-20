// Reads what the log reporter wrote to /logs and decides which runs a report or an AI analysis should cover.
//
// Files (written by logReporter.js, one set per finished test):
//   logs/<test>_<runId>.result.json        short summary of the run
//   logs/<test>_<runId>.complete.log.json  every attempt, step, error and artefact
//   logs/ai-diagnosis/<test>_<runId>.ai.json   AI diagnosis (written by analyzeFailures.js)
//   logs/last-run.json                     which runs belonged to the most recent `playwright test`
//
// Scope rules (selectRuns):
//   since   -> runs finished at or after that time (used by the reporter, same process as the test run)
//   default -> only the runs listed in last-run.json, so one test run = one test, N tests = N results
//   all     -> the full history in /logs
//   Unless `all` is set, only the newest run of each test (per browser) is kept.

const fs = require('fs');
const path = require('path');
const { LOGS_DIR, AI_DIAGNOSIS_DIR, LAST_RUN_PATH } = require('../../utils/global/paths');

const RESULT_SUFFIX = '.result.json';
const COMPLETE_LOG_SUFFIX = '.complete.log.json';

// ---------------------------------------------------------------- last-run manifest

/** @param {{ startedAt: string, finishedAt: string, results: string[] }} manifest */
function writeLastRun(manifest) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.writeFileSync(LAST_RUN_PATH, JSON.stringify(manifest, null, 2), 'utf-8');
  } catch {
    // The manifest is a convenience; never fail a test run because of it.
  }
}

/** @returns {{ startedAt?: string, finishedAt?: string, results: string[] } | null} */
function readLastRun() {
  const manifest = readJson(LAST_RUN_PATH);
  return manifest && Array.isArray(manifest.results) ? manifest : null;
}

// ---------------------------------------------------------------- reading runs

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null; // missing or malformed
  }
}

/**
 * Every run that has a .result.json, newest first. Detail files are not read yet (see attachDetails).
 * @returns {Array<{ base: string, result: object, sortKey: number, completeLogPath: string, aiPath: string }>}
 */
function listRuns() {
  if (!fs.existsSync(LOGS_DIR)) return [];

  const runs = [];
  for (const file of fs.readdirSync(LOGS_DIR)) {
    if (!file.endsWith(RESULT_SUFFIX)) continue;

    const result = readJson(path.join(LOGS_DIR, file));
    if (!result) continue;

    const base = file.slice(0, -RESULT_SUFFIX.length);
    runs.push({
      base,
      result,
      sortKey: new Date(result.timestamp).getTime() || 0,
      completeLogPath: path.join(LOGS_DIR, `${base}${COMPLETE_LOG_SUFFIX}`),
      aiPath: path.join(AI_DIAGNOSIS_DIR, `${base}.ai.json`),
    });
  }

  return runs.sort((a, b) => b.sortKey - a.sortKey);
}

/**
 * Keeps the newest run of each test per browser. Input must be sorted newest first.
 * Logs written before the browser was recorded are skipped when the same test name was already kept.
 */
function pickLatestPerTest(runsNewestFirst) {
  const seenKeys = new Set();
  const seenNames = new Set();
  const kept = [];

  for (const run of runsNewestFirst) {
    const name = run.result.testName;
    const browser = run.result.browser || '';

    if (!browser && seenNames.has(name)) continue;

    const key = `${name}::${browser}`;
    if (seenKeys.has(key)) continue;

    seenKeys.add(key);
    seenNames.add(name);
    kept.push(run);
  }

  return kept;
}

function attachDetails(run) {
  return { ...run, completeLog: readJson(run.completeLogPath), ai: readJson(run.aiPath) };
}

/**
 * @param {{ since?: number|null, all?: boolean, failedOnly?: boolean }} [options]
 * @returns {Array<{ base: string, result: object, sortKey: number, completeLog: object|null, ai: object|null,
 *   completeLogPath: string, aiPath: string }>} newest first
 */
function selectRuns({ since = null, all = false, failedOnly = false } = {}) {
  let runs = listRuns();

  if (since) {
    runs = runs.filter((run) => run.sortKey >= since);
  } else if (!all) {
    const lastRun = readLastRun();
    if (lastRun) {
      const bases = new Set(lastRun.results);
      runs = runs.filter((run) => bases.has(run.base));
    }
  }

  if (!all) runs = pickLatestPerTest(runs);
  if (failedOnly) runs = runs.filter((run) => run.result.executionStatus === 'fail');

  return runs.map(attachDetails);
}

module.exports = { writeLastRun, readLastRun, selectRuns };
