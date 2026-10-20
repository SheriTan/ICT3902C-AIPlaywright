// Asks the AI provider to diagnose failed tests and saves the answers next to the logs.
//
// Usage:
//   npm run analyze                    -> diagnose the failures of the last test run (same scope as the report)
//   npm run analyze -- --all           -> diagnose every failure in the full log history
//   npm run analyze -- --compare       -> run ALL prompt variants on every failure (experiment mode)
//   npm run analyze -- --variant=chain_of_thought
//   npm run analyze -- --force         -> re-diagnose failures that already have an .ai.json
//   npm run analyze -- --limit=5       -> only process the 5 most recent failures
//
// Reads:  logs/*.result.json + logs/*.complete.log.json  (written by logReporter.js)
// Writes: logs/ai-diagnosis/<test>_<runId>.ai.json + .ai.md, logs/ai-diagnosis/summary.md

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { diagnoseFailure, AVAILABLE_VARIANTS } = require('../ai-engine/diagnosisEngine');
const { AiClient } = require('../ai-engine/aiClient');
const { selectRuns } = require('./logStore');
const { AI_DIAGNOSIS_DIR } = require('../../utils/global/paths');

const escapeTableCell = (value) => String(value ?? 'n/a').replace(/\|/g, '\\|');

function parseArgs(argv) {
  const args = { compare: false, force: false, all: false, limit: Infinity, variant: 'concise' };
  for (const arg of argv) {
    if (arg === '--compare') args.compare = true;
    else if (arg === '--force') args.force = true;
    else if (arg === '--all') args.all = true;
    else if (arg.startsWith('--limit=')) args.limit = Number(arg.split('=')[1]) || Infinity;
    else if (arg.startsWith('--variant=')) args.variant = arg.split('=')[1];
  }
  return args;
}

function renderMarkdown({ testName, browser, provider, results }) {
  const lines = [
    '# AI Root-Cause Diagnosis',
    '',
    `**Test:** ${testName}  `,
    `**Browser:** ${browser}  `,
    `**AI provider:** ${provider}  `,
    `**Generated:** ${new Date().toISOString()}`,
    '',
  ];

  for (const r of results) {
    lines.push(`## Prompt variant: ${r.label} (\`${r.variant}\`)`, `_Latency: ${r.latencyMs}ms_`, '');

    if (r.error) {
      lines.push(`> ⚠️ Diagnosis failed: ${r.error}`, '');
    } else if (r.parsed) {
      lines.push(
        '| Field | Value |',
        '|---|---|',
        `| Category | ${escapeTableCell(r.parsed.category)} |`,
        `| Confidence | ${escapeTableCell(r.parsed.confidence)} |`,
        `| Root cause | ${escapeTableCell(r.parsed.rootCause)} |`,
        `| Suggested fix | ${escapeTableCell(r.parsed.suggestedFix)} |`,
        `| Suggested locator strategy | ${escapeTableCell(r.parsed.suggestedLocatorStrategy)} |`,
        ''
      );
    } else {
      lines.push(
        '> Could not parse a structured JSON answer from the model. Raw response:',
        '',
        '```',
        (r.raw || '').slice(0, 1500),
        '```',
        ''
      );
    }
  }

  return lines.join('\n');
}

function writeSummary(rows) {
  const lines = [
    '# AI Diagnosis Summary',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '| Test | Category | Confidence | Root Cause |',
    '|---|---|---|---|',
    ...rows.map((r) => `| ${r.testName} | ${r.category} | ${r.confidence} | ${escapeTableCell(r.rootCause)} |`),
  ];
  fs.writeFileSync(path.join(AI_DIAGNOSIS_DIR, 'summary.md'), lines.join('\n'), 'utf-8');
}

/**
 * @param {{ compare?: boolean, force?: boolean, all?: boolean, limit?: number, variant?: string,
 *   quiet?: boolean, since?: number|null }} [options]
 * @returns {Promise<{ diagnosed: number, skipped: number, failures?: number, configured: boolean }>}
 */
async function analyzeFailures(options = {}) {
  const args = {
    compare: false,
    force: false,
    all: false,
    limit: Infinity,
    variant: 'concise',
    quiet: false,
    since: null,
    ...options,
  };
  const variants = args.compare ? AVAILABLE_VARIANTS : [args.variant];
  const log = (message) => {
    if (!args.quiet) console.log(message);
  };

  const client = new AiClient();
  if (!client.isConfigured()) {
    console.error(
      `\n[analyzeFailures] AI provider "${client.name}" is not configured.\n` +
        'Copy .env.example to .env and set the relevant keys.\n'
    );
    return { diagnosed: 0, skipped: 0, configured: false };
  }

  fs.mkdirSync(AI_DIAGNOSIS_DIR, { recursive: true });

  const runs = selectRuns({ since: args.since, all: args.all, failedOnly: true })
    .filter((run) => run.completeLog)
    .slice(0, args.limit);

  if (runs.length === 0) {
    log(`[analyzeFailures] No failures ${args.all ? 'in /logs' : 'in the latest run of each test'}.`);
    return { diagnosed: 0, skipped: 0, configured: true };
  }

  log(
    `[analyzeFailures] Scope: ${args.all ? 'full history' : 'latest run per test'} - ${runs.length} failure(s) to consider.`
  );

  const summaryRows = [];
  let skipped = 0;
  let failures = 0;

  for (const run of runs) {
    const { base, completeLog } = run;

    if (!args.force && fs.existsSync(run.aiPath)) {
      skipped += 1;
      log(`[analyzeFailures] Skipping ${base} (already diagnosed, use --force to redo)`);
      continue;
    }

    log(`[analyzeFailures] Diagnosing "${completeLog.testName}" (${variants.join(', ')})...`);

    let diagnosis;
    try {
      diagnosis = await diagnoseFailure(completeLog, { variants, client });
    } catch (err) {
      console.error(`[analyzeFailures] Failed to diagnose ${base}: ${err.message}`);
      continue;
    }

    const best = diagnosis.results.find((r) => r.parsed);
    if (!best) {
      const why = diagnosis.results.find((r) => r.error)?.error || 'model returned no parseable JSON';
      console.error(`[analyzeFailures] No usable diagnosis for "${completeLog.testName}": ${why}`);
      failures += 1;

      // First attempt failed outright: the provider itself is probably misconfigured, so stop instead of repeating it.
      if (failures === 1 && summaryRows.length === 0 && runs.length > 1) {
        console.error(
          `[analyzeFailures] Aborting remaining ${runs.length - 1} diagnosis attempt(s) - fix the provider and re-run "npm run analyze".`
        );
        break;
      }
      continue;
    }

    const { testName, browser } = completeLog;
    fs.writeFileSync(
      path.join(AI_DIAGNOSIS_DIR, `${base}.ai.json`),
      JSON.stringify({ testName, browser, ...diagnosis }, null, 2),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(AI_DIAGNOSIS_DIR, `${base}.ai.md`),
      renderMarkdown({ testName, browser, provider: diagnosis.provider, results: diagnosis.results }),
      'utf-8'
    );

    summaryRows.push({
      testName,
      category: best.parsed.category || 'Unknown',
      confidence: best.parsed.confidence || 'n/a',
      rootCause: best.parsed.rootCause || 'n/a',
    });
  }

  if (summaryRows.length > 0) {
    writeSummary(summaryRows);
    log(`\n[analyzeFailures] Wrote summary for ${summaryRows.length} failure(s) to logs/ai-diagnosis/summary.md`);
  }

  return { diagnosed: summaryRows.length, skipped, failures, configured: true };
}

module.exports = { analyzeFailures };

// Only runs when started from the command line (npm run analyze)
if (require.main === module) {
  analyzeFailures(parseArgs(process.argv.slice(2)))
    .then((res) => {
      if (!res.configured) process.exitCode = 1;
    })
    .catch((err) => {
      console.error('[analyzeFailures] Unexpected error:', err);
      process.exitCode = 1;
    });
}
