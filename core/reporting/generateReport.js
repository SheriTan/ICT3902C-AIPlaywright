// Builds the AI report (reports/ai-report/index.html) from the logs in /logs.
//
// Usage:
//   npm run report                   -> build the report for the last test run
//   npm run report -- --open         -> build, then open it in the browser
//   npm run report -- --all          -> full log history instead of the last run
//   npm run report -- --failed       -> only failed tests
//   npm run report -- --inline       -> embed CSS, JS and screenshots (single portable file)
//
// Reads:  logs/*.result.json, logs/*.complete.log.json, logs/ai-diagnosis/*.ai.json (via logStore.js)
// Writes: reports/ai-report/index.html (+ assets/ unless --inline)
// The HTML structure is in reportRenderer.js; CSS, client script and the empty-state fragment are in report-assets/.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { selectRuns } = require('./logStore');
const { ArtefactStore } = require('./artefactStore');
const { renderReport, hasDiagnosis } = require('./reportRenderer');
const { PROJECT_ROOT, AI_REPORT_DIR } = require('../../utils/global/paths');

const ASSET_SOURCE_DIR = path.join(__dirname, 'report-assets');
const ASSETS_DIR = path.join(AI_REPORT_DIR, 'assets');

function parseArgs(argv) {
  const args = { open: false, all: false, failedOnly: false, inline: false };
  for (const arg of argv) {
    if (arg === '--open') args.open = true;
    else if (arg === '--all') args.all = true;
    else if (arg === '--failed') args.failedOnly = true;
    else if (arg === '--inline') args.inline = true;
  }
  return args;
}

function readAsset(name) {
  return fs.readFileSync(path.join(ASSET_SOURCE_DIR, name), 'utf-8');
}

function describeScope({ since, all }) {
  if (since) return 'this run only';
  if (all) return 'full history';
  return 'most recent Playwright run (npm run report -- --all for full history)';
}

function openInBrowser(filePath) {
  const opener = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    execSync(`${opener} "${filePath}"`, { stdio: 'ignore', shell: true });
  } catch {
    console.log('[generateReport] Could not auto-open; open the file manually.');
  }
}

/**
 * @param {{ open?: boolean, all?: boolean, failedOnly?: boolean, inline?: boolean, quiet?: boolean,
 *   since?: number|null }} [options] since = only runs finished at/after this time (ms), used by the reporter
 * @returns {{ outPath: string, total: number, failed: number, diagnosed: number }}
 */
function generateReport(options = {}) {
  const args = { open: false, all: false, failedOnly: false, inline: false, quiet: false, since: null, ...options };

  const runs = selectRuns({ since: args.since, all: args.all, failedOnly: args.failedOnly });
  if (runs.length === 0 && !args.quiet) {
    console.warn('[generateReport] No logs found under /logs - generating an empty report shell.');
  }

  // Start from a clean assets folder so evidence from older reports does not pile up
  fs.rmSync(ASSETS_DIR, { recursive: true, force: true });
  fs.mkdirSync(AI_REPORT_DIR, { recursive: true });

  const artefacts = new ArtefactStore(ASSETS_DIR);
  const html = renderReport(runs, {
    inline: args.inline,
    scopeNote: describeScope(args),
    artefacts,
    css: readAsset('report.css'),
    js: readAsset('report.js'),
    emptyStateHtml: readAsset('empty-state.html').trim(),
  });

  const outPath = path.join(AI_REPORT_DIR, 'index.html');
  fs.writeFileSync(outPath, html, 'utf-8');
  if (!args.inline) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
    for (const file of ['report.css', 'report.js']) {
      fs.copyFileSync(path.join(ASSET_SOURCE_DIR, file), path.join(ASSETS_DIR, file));
    }
  }

  const failed = runs.filter((r) => r.result.executionStatus === 'fail').length;
  const diagnosed = runs.filter(hasDiagnosis).length;

  if (!args.quiet) {
    console.log(`[generateReport] ${runs.length} run(s), ${failed} failed, ${diagnosed} with AI diagnosis`);
    console.log(`[generateReport] Assets copied: ${artefacts.publishedCount}`);
    console.log(`[generateReport] Report written to ${path.relative(PROJECT_ROOT, outPath)}`);

    if (failed > 0 && diagnosed === 0) {
      console.warn('[generateReport] Failures present but no AI diagnosis found - run "npm run analyze" first.');
    }
  }

  if (args.open) openInBrowser(outPath);

  return { outPath, total: runs.length, failed, diagnosed };
}

module.exports = { generateReport };

// Only runs when started from the command line (npm run report)
if (require.main === module) {
  generateReport(parseArgs(process.argv.slice(2)));
}
