// Usage:
//   npm run analyze                  -> diagnose the LATEST run of each failing test (default scope)
//   npm run analyze -- --all         -> diagnose every failure in the full log history
//   npm run analyze -- --compare     -> run ALL prompt variants on every failure (experiment mode)
//   npm run analyze -- --variant=chain_of_thought
//   npm run analyze -- --force       -> re-diagnose failures that already have an .ai.json
//   npm run analyze -- --limit=5     -> only process the 5 most recent failures
//
// Reads:  logs/*.result.json + logs/*.complete.log.json  (written by utils/global/logHandler.js)
// Writes: logs/ai-diagnosis/<test>_<runId>.ai.json + .ai.md, logs/ai-diagnosis/summary.md

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { diagnoseFailure, AVAILABLE_VARIANTS } = require('../../core/ai-engine/diagnosisEngine');
const { pickLatestPerTest } = require('./logScope');
const { AiClient } = require('../../core/ai-engine/aiClient');

const ROOT = path.resolve(__dirname, '..', '..');
const LOGS_DIR = path.join(ROOT, 'logs');
const AI_DIR = path.join(LOGS_DIR, 'ai-diagnosis');

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



function findFailedRuns(limit, since, latestOnly = true) {
  if (!fs.existsSync(LOGS_DIR)) return [];

  const resultFiles = fs
    .readdirSync(LOGS_DIR)
    .filter((f) => f.endsWith('.result.json'))
    .map((f) => path.join(LOGS_DIR, f));

  const all = [];
  for (const resultPath of resultFiles) {
    let result;
    try {
      result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    } catch (_) {
      continue;
    }

    const timestampMs = new Date(result.timestamp).getTime();
    if (since && timestampMs < since) continue;

    all.push({ resultPath, result, timestampMs: timestampMs || 0 });
  }

  all.sort((a, b) => b.timestampMs - a.timestampMs);

  const scoped = latestOnly
    ? pickLatestPerTest(all, (r) => r.result.testName, (r) => r.result.browser)
    : all;

  const failed = [];
  for (const { resultPath, result } of scoped) {
    if (result.executionStatus !== 'fail') continue;

    const completeLogPath = resultPath.replace(/\.result\.json$/, '.complete.log.json');
    if (!fs.existsSync(completeLogPath)) continue;

    failed.push({ resultPath, completeLogPath, result });
  }

  return Number.isFinite(limit) ? failed.slice(0, limit) : failed;
}

function outputBaseName(resultPath) {
  return path.basename(resultPath).replace(/\.result\.json$/, '');
}

function alreadyDiagnosed(baseName) {
  return fs.existsSync(path.join(AI_DIR, `${baseName}.ai.json`));
}

function renderMarkdown({ testName, browser, provider, results }) {
  const lines = [
    `# AI Root-Cause Diagnosis`,
    ``,
    `**Test:** ${testName}  `,
    `**Browser:** ${browser}  `,
    `**AI provider:** ${provider}  `,
    `**Generated:** ${new Date().toISOString()}`,
    ``,
  ];

  for (const r of results) {
    lines.push(`## Prompt variant: ${r.label} (\`${r.variant}\`)`);
    lines.push(`_Latency: ${r.latencyMs}ms_`);
    lines.push('');

    if (r.error) {
      lines.push(`> ⚠️ Diagnosis failed: ${r.error}`);
      lines.push('');
      continue;
    }

    if (r.parsed) {
      lines.push(`| Field | Value |`);
      lines.push(`|---|---|`);
      lines.push(`| Category | ${r.parsed.category ?? 'n/a'} |`);
      lines.push(`| Confidence | ${r.parsed.confidence ?? 'n/a'} |`);
      lines.push(`| Root cause | ${(r.parsed.rootCause ?? 'n/a').toString().replace(/\|/g, '\\|')} |`);
      lines.push(`| Suggested fix | ${(r.parsed.suggestedFix ?? 'n/a').toString().replace(/\|/g, '\\|')} |`);
      lines.push(
        `| Suggested locator strategy | ${(r.parsed.suggestedLocatorStrategy ?? 'n/a').toString().replace(/\|/g, '\\|')} |`
      );
      lines.push('');
    } else {
      lines.push('> Could not parse a structured JSON answer from the model. Raw response:');
      lines.push('');
      lines.push('```');
      lines.push((r.raw || '').slice(0, 1500));
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * @param {{compare?:boolean, force?:boolean, all?:boolean, limit?:number, variant?:string, quiet?:boolean, since?:number|null}} options
 * @returns {Promise<{diagnosed:number, skipped:number, configured:boolean}>}
 */
async function analyzeFailures(options = {}) {
  const args = { compare: false, force: false, all: false, limit: Infinity, variant: 'concise', quiet: false, since: null, ...options };
  const variants = args.compare ? AVAILABLE_VARIANTS : [args.variant];

  const client = new AiClient();
  if (!client.isConfigured()) {
    console.error(
      `\n[analyzeFailures] AI provider "${client.name}" is not configured.\n` +
        `Copy .env.example to .env and set the relevant keys.\n`
    );
    return { diagnosed: 0, skipped: 0, configured: false };
  }

  fs.mkdirSync(AI_DIR, { recursive: true });

  const runs = findFailedRuns(args.limit, args.since, !args.all);
  if (runs.length === 0) {
    if (!args.quiet) {
      const scope = args.all ? 'in /logs' : 'in the latest run of each test';
      console.log(`[analyzeFailures] No failures ${scope}.`);
    }
    return { diagnosed: 0, skipped: 0, configured: true };
  }

  if (!args.quiet) {
    const scope = args.all ? 'full history' : 'latest run per test';
    console.log(`[analyzeFailures] Scope: ${scope} - ${runs.length} failure(s) to consider.`);
  }

  const summaryRows = [];
  let skipped = 0;
  let failures = 0;

  for (const run of runs) {
    const baseName = outputBaseName(run.resultPath);
    if (!args.force && alreadyDiagnosed(baseName)) {
      skipped += 1;
      if (!args.quiet) console.log(`[analyzeFailures] Skipping ${baseName} (already diagnosed, use --force to redo)`);
      continue;
    }

    const completeLog = JSON.parse(fs.readFileSync(run.completeLogPath, 'utf-8'));
    if (!args.quiet) console.log(`[analyzeFailures] Diagnosing "${completeLog.testName}" (${variants.join(', ')})...`);

    let diagnosis;
    try {
      diagnosis = await diagnoseFailure(completeLog, { variants, client });
    } catch (err) {
      console.error(`[analyzeFailures] Failed to diagnose ${baseName}: ${err.message}`);
      continue;
    }

    if (!diagnosis.results.some((r) => r.parsed)) {
      const why = diagnosis.results.find((r) => r.error)?.error || 'model returned no parseable JSON';
      console.error(`[analyzeFailures] No usable diagnosis for "${completeLog.testName}": ${why}`);
      failures += 1;

      if (failures === 1 && summaryRows.length === 0 && runs.length > 1) {
        console.error(`[analyzeFailures] Aborting remaining ${runs.length - 1} diagnosis attempt(s) - fix the provider and re-run "npm run analyze".`);
        break;
      }
      continue;
    }

    const jsonOut = { testName: completeLog.testName, browser: completeLog.browser, ...diagnosis };
    fs.writeFileSync(path.join(AI_DIR, `${baseName}.ai.json`), JSON.stringify(jsonOut, null, 2), 'utf-8');

    const markdown = renderMarkdown({
      testName: completeLog.testName,
      browser: completeLog.browser,
      provider: diagnosis.provider,
      results: diagnosis.results,
    });
    fs.writeFileSync(path.join(AI_DIR, `${baseName}.ai.md`), markdown, 'utf-8');

    const bestResult = diagnosis.results.find((r) => r.parsed) || diagnosis.results[0];
    summaryRows.push({
      testName: completeLog.testName,
      category: bestResult?.parsed?.category || 'Unknown',
      confidence: bestResult?.parsed?.confidence || 'n/a',
      rootCause: bestResult?.parsed?.rootCause || bestResult?.error || 'n/a',
    });
  }

  if (summaryRows.length > 0) {
    const summaryLines = [
      '# AI Diagnosis Summary',
      '',
      `Generated: ${new Date().toISOString()}`,
      '',
      '| Test | Category | Confidence | Root Cause |',
      '|---|---|---|---|',
      ...summaryRows.map(
        (r) => `| ${r.testName} | ${r.category} | ${r.confidence} | ${r.rootCause.replace(/\|/g, '\\|')} |`
      ),
    ];
    fs.writeFileSync(path.join(AI_DIR, 'summary.md'), summaryLines.join('\n'), 'utf-8');
    if (!args.quiet) {
      console.log(`\n[analyzeFailures] Wrote summary for ${summaryRows.length} failure(s) to logs/ai-diagnosis/summary.md`);
    }
  }

  return { diagnosed: summaryRows.length, skipped, failures, configured: true };
}

module.exports = { analyzeFailures };

// Only runs when npm run analyze
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