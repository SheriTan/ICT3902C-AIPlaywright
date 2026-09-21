// Usage:
//   npm run report:ai                 -> build reports/ai-report/index.html
//   npm run report:ai -- --open       -> build, then open it in the browser
//   npm run report:ai -- --latest     -> only the most recent run of each test
//   npm run report:ai -- --failed     -> only failed tests
//   npm run report:ai -- --inline     -> embed screenshots as base64 (single portable file)
//
// Reads:  logs/*.result.json, logs/*.complete.log.json, logs/ai-diagnosis/*.ai.json
// Writes: reports/ai-report/index.html (+ assets/ unless --inline)

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { pickLatestPerTest } = require('./logScope');

const ROOT = path.resolve(__dirname, '..', '..');
const LOGS_DIR = path.join(ROOT, 'logs');
const AI_DIR = path.join(LOGS_DIR, 'ai-diagnosis');
const TEST_RESULTS_DIR = path.join(ROOT, 'test-results');
const OUT_DIR = path.join(ROOT, 'reports', 'ai-report');
const ASSETS_DIR = path.join(OUT_DIR, 'assets');

// ---------------------------------------------------------------- utilities

function parseArgs(argv) {
  // "latest" (show only the newest run per test) is the default now, so the
  // flag to change behaviour is the opt-OUT: --all. --latest is still
  // accepted so any existing muscle-memory/scripts keep working; it's just a
  // no-op unless paired with something that turned latest off.
  const args = { open: false, latest: true, failedOnly: false, inline: false };
  for (const a of argv) {
    if (a === '--open') args.open = true;
    else if (a === '--latest') args.latest = true;
    else if (a === '--all') args.latest = false;
    else if (a === '--failed') args.failedOnly = true;
    else if (a === '--inline') args.inline = true;
  }
  return args;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripAnsi(value) {
  return String(value ?? '').replace(/\u001b\[[0-9;]*m/g, '');
}

function formatDuration(ms) {
  if (ms == null) return 'n/a';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(iso) {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

// ------------------------------------------------------- artefact resolution

/**
  * Handles:
 *  1. new-style repo-relative path (preferred)
 *  2. absolute path that still exists (same machine, same location)
 *  3. legacy absolute path from another machine - falls back to locating a
 *     file with the same basename under test-results/
 */
let testResultsIndex = null;

function buildTestResultsIndex() {
  const index = new Map();
  if (!fs.existsSync(TEST_RESULTS_DIR)) return index;

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const list = index.get(entry.name) || [];
        list.push(full);
        index.set(entry.name, list);
      }
    }
  };

  try {
    walk(TEST_RESULTS_DIR);
  } catch (_) {
  }
  return index;
}

function resolveArtefact(recordedPath) {
  if (!recordedPath) return null;

  const normalised = recordedPath.replace(/\\/g, '/');

  const asRelative = path.join(ROOT, normalised);
  if (fs.existsSync(asRelative) && fs.statSync(asRelative).isFile()) return asRelative;

  if (path.isAbsolute(recordedPath) && fs.existsSync(recordedPath)) return recordedPath;

  if (!testResultsIndex) testResultsIndex = buildTestResultsIndex();
  const basename = normalised.split('/').pop();
  const candidates = testResultsIndex.get(basename);
  if (!candidates || candidates.length === 0) return null;

  const recordedParent = normalised.split('/').slice(-2, -1)[0] || '';
  const exact = candidates.find((c) => path.basename(path.dirname(c)) === recordedParent);
  return exact || candidates[0];
}

let assetCounter = 0;
const copiedAssets = new Map();

function publishAsset(resolvedPath, inline) {
  if (!resolvedPath) return null;

  const ext = path.extname(resolvedPath).toLowerCase();

  if (inline && ['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const b64 = fs.readFileSync(resolvedPath).toString('base64');
    return `data:${mime};base64,${b64}`;
  }

  if (copiedAssets.has(resolvedPath)) return copiedAssets.get(resolvedPath);

  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  assetCounter += 1;
  const target = `${String(assetCounter).padStart(3, '0')}-${path.basename(resolvedPath)}`;
  fs.copyFileSync(resolvedPath, path.join(ASSETS_DIR, target));
  const href = `assets/${target}`;
  copiedAssets.set(resolvedPath, href);
  return href;
}

// ------------------------------------------------------------ data gathering

function loadRuns({ latest, failedOnly, since }) {
  if (!fs.existsSync(LOGS_DIR)) return [];

  const runs = [];
  for (const file of fs.readdirSync(LOGS_DIR)) {
    if (!file.endsWith('.result.json')) continue;

    const resultPath = path.join(LOGS_DIR, file);
    let result;
    try {
      result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    } catch (_) {
      continue;
    }

    const base = file.replace(/\.result\.json$/, '');
    const completeLogPath = path.join(LOGS_DIR, `${base}.complete.log.json`);
    let completeLog = null;
    if (fs.existsSync(completeLogPath)) {
      try {
        completeLog = JSON.parse(fs.readFileSync(completeLogPath, 'utf-8'));
      } catch (_) {
        /* ignore malformed */
      }
    }

    let ai = null;
    const aiPath = path.join(AI_DIR, `${base}.ai.json`);
    if (fs.existsSync(aiPath)) {
      try {
        ai = JSON.parse(fs.readFileSync(aiPath, 'utf-8'));
      } catch (_) {
        /* ignore malformed */
      }
    }

    runs.push({ base, result, completeLog, ai, sortKey: new Date(result.timestamp).getTime() || 0 });
  }

  runs.sort((a, b) => b.sortKey - a.sortKey);

  // When called from the reporter, scope the report to the run that just
  // finished, the way Playwright's own HTML report behaves.
  let filtered = since ? runs.filter((r) => r.sortKey >= since) : runs;
  if (latest) {
    filtered = pickLatestPerTest(filtered, (r) => r.result.testName, (r) => r.result.browser);
  }
  if (failedOnly) filtered = filtered.filter((r) => r.result.executionStatus === 'fail');

  return filtered;
}

// ----------------------------------------------------------------- rendering

function renderAiPanel(ai) {
  if (!ai || !Array.isArray(ai.results) || ai.results.length === 0) {
    return `<div class="ai-panel ai-empty">
      <div class="ai-head"><span class="ai-badge">AI diagnosis</span></div>
      <p class="muted">No AI diagnosis available for this run. Generate one with
      <code>npm run analyze</code>, then rebuild this report.</p>
    </div>`;
  }

  const usable = ai.results.filter((r) => r.parsed);
  const primary = usable[0] || ai.results[0];

  const variantTabs =
    ai.results.length > 1
      ? `<div class="variant-tabs" role="tablist">${ai.results
          .map(
            (r, i) =>
              `<button class="variant-tab${i === 0 ? ' active' : ''}" data-variant-index="${i}" role="tab">${esc(
                r.label || r.variant
              )}</button>`
          )
          .join('')}</div>`
      : '';

  const panels = ai.results
    .map((r, i) => {
      if (r.error) {
        return `<div class="variant-panel${i === 0 ? ' active' : ''}" data-variant-index="${i}">
          <p class="error-text">Diagnosis failed: ${esc(r.error)}</p></div>`;
      }
      if (!r.parsed) {
        return `<div class="variant-panel${i === 0 ? ' active' : ''}" data-variant-index="${i}">
          <p class="muted">Model did not return parseable JSON. Raw response:</p>
          <pre class="raw">${esc((r.raw || '').slice(0, 2000))}</pre></div>`;
      }

      const p = r.parsed;
      const conf = String(p.confidence || 'n/a').toLowerCase();
      return `<div class="variant-panel${i === 0 ? ' active' : ''}" data-variant-index="${i}">
        <div class="ai-meta">
          <span class="chip chip-category">${esc(p.category || 'Unknown')}</span>
          <span class="chip chip-conf chip-conf-${esc(conf)}">Confidence: ${esc(p.confidence || 'n/a')}</span>
          <span class="chip chip-muted">${esc(r.latencyMs)}ms</span>
        </div>
        <dl class="ai-dl">
          <dt>Root cause</dt><dd>${esc(p.rootCause || 'n/a')}</dd>
          <dt>Suggested fix</dt><dd>${esc(p.suggestedFix || 'n/a')}</dd>
          <dt>Suggested locator strategy</dt><dd>${esc(p.suggestedLocatorStrategy ?? 'n/a')}</dd>
        </dl>
      </div>`;
    })
    .join('');

  return `<div class="ai-panel">
    <div class="ai-head">
      <span class="ai-badge">AI diagnosis</span>
      <span class="muted">provider: ${esc(ai.provider || 'unknown')}${
        ai.results.length > 1 ? ` &middot; ${ai.results.length} prompt variants compared` : ''
      }</span>
    </div>
    ${variantTabs}
    ${panels}
  </div>`;
}

function renderLocatorTrail(locatorUsed) {
  if (!locatorUsed) return '';

  const { name, strategy, value } = locatorUsed;

  if (strategy === 'unresolved' && Array.isArray(value)) {
    const rows = value
      .map((line) => {
        const m = String(line).match(/^round (\d+): (\S+) -> (.*)$/);
        if (!m) return `<tr><td colspan="3">${esc(line)}</td></tr>`;
        return `<tr><td>${esc(m[1])}</td><td><code>${esc(m[2])}</code></td><td class="fail-cell">${esc(m[3])}</td></tr>`;
      })
      .join('');

    return `<div class="subsection">
      <h4>Locator resolution trail &mdash; <code>${esc(name)}</code> <span class="tag tag-fail">unresolved</span></h4>
      <table class="loc-table">
        <thead><tr><th>Round</th><th>Strategy</th><th>Outcome</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  const valueText = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  return `<div class="subsection">
    <h4>Last locator resolved &mdash; <code>${esc(name)}</code></h4>
    <p>Strategy <code>${esc(strategy)}</code> matched <code>${esc(valueText)}</code>.</p>
  </div>`;
}

function renderArtefacts(artefacts, inline) {
  if (!artefacts) return '';

  const blocks = [];

  const shot = resolveArtefact(artefacts.screenshot);
  if (shot) {
    const href = publishAsset(shot, inline);
    blocks.push(`<figure class="artefact">
      <figcaption>Screenshot at failure</figcaption>
      <a href="${esc(href)}" target="_blank" rel="noopener"><img src="${esc(href)}" alt="Screenshot at point of failure" loading="lazy"></a>
    </figure>`);
  }

  const video = resolveArtefact(artefacts.video);
  if (video) {
    const href = publishAsset(video, false);
    blocks.push(`<figure class="artefact">
      <figcaption>Execution video</figcaption>
      <video controls preload="none" src="${esc(href)}"></video>
    </figure>`);
  }

  const trace = resolveArtefact(artefacts.trace);
  if (trace) {
    const href = publishAsset(trace, false);
    blocks.push(`<figure class="artefact artefact-link">
      <figcaption>Playwright trace</figcaption>
      <a class="btn" href="${esc(href)}" download>Download trace.zip</a>
      <p class="muted small">Open with <code>npx playwright show-trace &lt;file&gt;</code> or drop it into
      <a href="https://trace.playwright.dev/" target="_blank" rel="noopener">trace.playwright.dev</a>.</p>
    </figure>`);
  }

  const ctx = resolveArtefact(artefacts.errorContext);
  if (ctx) {
    let snapshot = '';
    try {
      snapshot = fs.readFileSync(ctx, 'utf-8').slice(0, 4000);
    } catch (_) {
      /* ignore */
    }
    if (snapshot) {
      blocks.push(`<details class="artefact artefact-wide">
        <summary>Page snapshot at failure (accessibility tree)</summary>
        <pre class="raw">${esc(snapshot)}</pre>
      </details>`);
    }
  }

  if (blocks.length === 0) {
    return `<div class="subsection"><h4>Evidence</h4><p class="muted">No artefacts were captured or they could not be located on disk.</p></div>`;
  }

  return `<div class="subsection"><h4>Evidence</h4><div class="artefact-grid">${blocks.join('')}</div></div>`;
}

function renderAttempt(attempt, inline, fallbackArtefacts) {
  const steps = (attempt.steps || [])
    .map(
      (s) =>
        `<li><span class="ts">${esc(new Date(s.timestamp).toLocaleTimeString())}</span><span class="msg">${esc(
          stripAnsi(s.message)
        )}</span></li>`
    )
    .join('');

  const errorBlock = attempt.error
    ? `<div class="subsection">
        <h4>Error <span class="tag tag-fail">${esc(attempt.error.type || 'Error')}</span></h4>
        <pre class="raw error-text">${esc(stripAnsi(attempt.error.message))}</pre>
        <details><summary>Stack trace</summary><pre class="raw">${esc(stripAnsi(attempt.error.stack))}</pre></details>
      </div>`
    : '';

  return `<details class="attempt" ${attempt.status === 'fail' ? 'open' : ''}>
    <summary>
      <span class="tag tag-${attempt.status === 'pass' ? 'pass' : 'fail'}">Attempt ${esc(attempt.attemptNumber)}</span>
      <span class="muted">${formatDuration(attempt.durationMs)}</span>
      ${attempt.failedStep ? `<span class="muted">failed at: ${esc(attempt.failedStep)}</span>` : ''}
    </summary>
    ${steps ? `<div class="subsection"><h4>Step timeline</h4><ul class="timeline">${steps}</ul></div>` : ''}
    ${renderLocatorTrail(attempt.locatorUsed)}
    ${errorBlock}
    ${renderArtefacts(attempt.artefacts || fallbackArtefacts, inline)}
  </details>`;
}

function renderTestCard(run, inline) {
  const { result, completeLog, ai } = run;
  const failed = result.executionStatus === 'fail';
  const attempts = completeLog?.attempts || [];

  const aiCategory = ai?.results?.find((r) => r.parsed)?.parsed?.category;

  // Older logs did not record suite/duration at run level; recover what we can
  // from the attempt records instead of printing empty placeholders.
  const lastAttempt = attempts[attempts.length - 1];
  const duration = result.durationMs ?? lastAttempt?.durationMs ?? null;

  const meta = [
    completeLog?.suite || result.suite,
    result.browser || completeLog?.browser,
    duration != null ? formatDuration(duration) : null,
    formatTimestamp(result.timestamp),
  ]
    .filter(Boolean)
    .map(esc);

  if (result.failureType) meta.push(`<span class="tag tag-fail">${esc(result.failureType)}</span>`);
  if (aiCategory) meta.push(`<span class="chip chip-category">${esc(aiCategory)}</span>`);

  return `<article class="test-card" data-status="${failed ? 'fail' : 'pass'}" data-search="${esc(
    `${result.testName} ${result.browser || ''} ${result.failureType || ''} ${aiCategory || ''}`.toLowerCase()
  )}">
    <header class="test-head">
      <span class="status-dot status-${failed ? 'fail' : 'pass'}"></span>
      <div class="test-title">
        <h3>${esc(result.testName)}</h3>
        <p class="muted small">${meta.join(' &middot; ')}</p>
      </div>
      <button class="toggle" aria-expanded="${failed ? 'true' : 'false'}">${failed ? 'Hide' : 'Details'}</button>
    </header>
    <div class="test-body"${failed ? '' : ' hidden'}>
      ${failed ? renderAiPanel(ai) : ''}
      ${attempts
        .map((a, i) =>
          // Logs written before artefacts were recorded per attempt only carry
          // them at run level, and those belong to the final attempt.
          renderAttempt(a, inline, i === attempts.length - 1 ? result.artefacts : null)
        )
        .join('')}
      ${
        attempts.length === 0
          ? '<p class="muted">No detailed attempt log found for this run.</p>'
          : ''
      }
    </div>
  </article>`;
}

function renderHtml(runs, inline, scopeNote) {
  const total = runs.length;
  const failed = runs.filter((r) => r.result.executionStatus === 'fail').length;
  const passed = total - failed;
  const passRate = total ? Math.round((passed / total) * 100) : 0;
  const diagnosed = runs.filter((r) => r.ai?.results?.some((x) => x.parsed)).length;

  const cards = runs.map((r) => renderTestCard(r, inline)).join('\n');

  return `<!doctype html>
<html lang="en" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Diagnostic Report</title>
<style>
:root{
  --bg:#f7f8fa; --surface:#ffffff; --surface-2:#f1f3f7; --border:#e2e6ee;
  --text:#1b1f27; --muted:#697086;
  --pass:#1a9b5c; --pass-bg:#e6f6ed;
  --fail:#d6323f; --fail-bg:#fdeaec;
  --accent:#5b5bd6; --accent-bg:#eeeefc;
  --warn:#b7791f;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#14161c; --surface:#1c1f27; --surface-2:#232733; --border:#2e3341;
    --text:#e7e9ef; --muted:#959cb0;
    --pass:#48c98a; --pass-bg:#16301f; --fail:#f2717e; --fail-bg:#33191d;
    --accent:#9b9bf0; --accent-bg:#232346; --warn:#e0a94f;
  }
}
:root[data-theme="dark"]{
  --bg:#14161c; --surface:#1c1f27; --surface-2:#232733; --border:#2e3341;
  --text:#e7e9ef; --muted:#959cb0;
  --pass:#48c98a; --pass-bg:#16301f; --fail:#f2717e; --fail-bg:#33191d;
  --accent:#9b9bf0; --accent-bg:#232346;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
  font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:28px 20px 80px}
header.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:22px}
h1{font-size:23px;margin:0 0 4px}
h3{font-size:16px;margin:0}
h4{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:0 0 8px}
.muted{color:var(--muted)}
.small{font-size:12.5px}
code{font-family:var(--mono);font-size:12.5px;background:var(--surface-2);padding:1px 5px;border-radius:4px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px}
.stat .n{font-size:26px;font-weight:650;line-height:1.1}
.stat .l{font-size:12.5px;color:var(--muted);margin-top:2px}
.stat.fail .n{color:var(--fail)} .stat.pass .n{color:var(--pass)}
.bar{height:7px;border-radius:99px;background:var(--fail-bg);overflow:hidden;margin-bottom:22px;border:1px solid var(--border)}
.bar>span{display:block;height:100%;background:var(--pass)}
.toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:18px}
input[type=search]{flex:1;min-width:200px;padding:9px 12px;border-radius:8px;border:1px solid var(--border);
  background:var(--surface);color:var(--text);font-size:14px}
.btn{display:inline-block;padding:8px 13px;border-radius:8px;border:1px solid var(--border);
  background:var(--surface);color:var(--text);font-size:13.5px;cursor:pointer;text-decoration:none}
.btn:hover{background:var(--surface-2)}
.btn.active{background:var(--accent-bg);border-color:var(--accent);color:var(--accent)}
.test-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;margin-bottom:14px;overflow:hidden}
.test-head{display:flex;gap:12px;align-items:center;padding:14px 16px}
.test-title{flex:1;min-width:0}
.test-title p{margin:3px 0 0}
.status-dot{width:10px;height:10px;border-radius:99px;flex:none}
.status-pass{background:var(--pass)} .status-fail{background:var(--fail)}
.toggle{border:1px solid var(--border);background:var(--surface);color:var(--muted);
  border-radius:7px;padding:5px 11px;font-size:13px;cursor:pointer}
.test-body{padding:0 16px 16px;border-top:1px solid var(--border)}
.tag{display:inline-block;padding:1px 8px;border-radius:99px;font-size:11.5px;font-weight:600}
.tag-pass{background:var(--pass-bg);color:var(--pass)}
.tag-fail{background:var(--fail-bg);color:var(--fail)}
.chip{display:inline-block;padding:2px 9px;border-radius:99px;font-size:12px;font-weight:550;
  background:var(--surface-2);color:var(--muted);border:1px solid var(--border)}
.chip-category{background:var(--accent-bg);color:var(--accent);border-color:transparent}
.chip-conf-high{background:var(--pass-bg);color:var(--pass);border-color:transparent}
.chip-conf-low{background:var(--fail-bg);color:var(--fail);border-color:transparent}
.ai-panel{background:var(--accent-bg);border:1px solid var(--border);border-left:3px solid var(--accent);
  border-radius:10px;padding:14px 16px;margin:16px 0}
.ai-panel.ai-empty{background:var(--surface-2);border-left-color:var(--border)}
.ai-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
.ai-badge{font-size:11.5px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--accent)}
.ai-meta{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:10px}
.ai-dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0}
.ai-dl dt{font-size:12.5px;color:var(--muted);white-space:nowrap}
.ai-dl dd{margin:0}
.variant-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.variant-tab{border:1px solid var(--border);background:var(--surface);color:var(--muted);
  border-radius:7px;padding:4px 10px;font-size:12.5px;cursor:pointer}
.variant-tab.active{background:var(--accent);border-color:var(--accent);color:#fff}
.variant-panel{display:none} .variant-panel.active{display:block}
.attempt{border:1px solid var(--border);border-radius:10px;margin-top:12px;background:var(--surface)}
.attempt>summary{cursor:pointer;padding:10px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:13.5px}
.attempt>*:not(summary){padding:0 14px}
.attempt>*:last-child{padding-bottom:14px}
.subsection{margin-top:14px}
.timeline{list-style:none;margin:0;padding:0;border-left:2px solid var(--border)}
.timeline li{padding:5px 0 5px 14px;position:relative;font-size:13.5px}
.timeline li::before{content:"";position:absolute;left:-5px;top:12px;width:8px;height:8px;
  border-radius:99px;background:var(--border)}
.timeline .ts{color:var(--muted);font-family:var(--mono);font-size:11.5px;margin-right:9px}
.loc-table{width:100%;border-collapse:collapse;font-size:13px}
.loc-table th{text-align:left;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;
  color:var(--muted);border-bottom:1px solid var(--border);padding:6px 8px}
.loc-table td{padding:6px 8px;border-bottom:1px solid var(--border);vertical-align:top}
.fail-cell{color:var(--fail)}
pre.raw{background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:11px 13px;
  overflow-x:auto;font-family:var(--mono);font-size:12.5px;white-space:pre-wrap;word-break:break-word;margin:0}
.error-text{color:var(--fail)}
details>summary{cursor:pointer}
.artefact-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
.artefact{margin:0;background:var(--surface-2);border:1px solid var(--border);border-radius:9px;padding:11px}
.artefact-wide{grid-column:1/-1}
.artefact figcaption,.artefact>summary{font-size:12px;color:var(--muted);margin-bottom:8px;
  text-transform:uppercase;letter-spacing:.04em}
.artefact img,.artefact video{width:100%;border-radius:6px;border:1px solid var(--border);display:block;background:#000}
footer{margin-top:34px;padding-top:16px;border-top:1px solid var(--border);color:var(--muted);font-size:12.5px}
.empty{text-align:center;padding:60px 20px;color:var(--muted)}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div>
      <h1>AI Diagnostic Report</h1>
      <p class="muted small">Generated ${esc(new Date().toLocaleString())} &middot; AI-Enhanced Playwright Framework${
        scopeNote ? ` &middot; ${esc(scopeNote)}` : ''
      }</p>
    </div>
    <button class="btn" id="theme">Toggle theme</button>
  </header>

  <div class="stats">
    <div class="stat"><div class="n">${total}</div><div class="l">Test runs</div></div>
    <div class="stat pass"><div class="n">${passed}</div><div class="l">Passed</div></div>
    <div class="stat fail"><div class="n">${failed}</div><div class="l">Failed</div></div>
    <div class="stat"><div class="n">${passRate}%</div><div class="l">Pass rate</div></div>
    <div class="stat"><div class="n">${diagnosed}</div><div class="l">AI-diagnosed</div></div>
  </div>
  <div class="bar"><span style="width:${passRate}%"></span></div>

  <div class="toolbar">
    <input type="search" id="search" placeholder="Search test name, browser, error type, AI category...">
    <button class="btn active" data-filter="all">All</button>
    <button class="btn" data-filter="fail">Failed</button>
    <button class="btn" data-filter="pass">Passed</button>
    <button class="btn" id="expand">Expand all</button>
  </div>

  <main id="list">
    ${cards || '<div class="empty"><p>No test logs found under <code>/logs</code>.</p><p class="small">Run your tests first, then <code>npm run analyze</code>, then rebuild this report.</p></div>'}
  </main>

  <footer>
    Built from the framework's structured telemetry (<code>/logs</code>) and the AI Intelligence Layer
    (<code>/logs/ai-diagnosis</code>). Evidence is linked from <code>/test-results</code>.
  </footer>
</div>

<script>
(function(){
  document.getElementById('theme').addEventListener('click', function(){
    var root = document.documentElement;
    var now = root.getAttribute('data-theme');
    var isDark = now === 'dark' || (now !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.setAttribute('data-theme', isDark ? 'light' : 'dark');
  });

  document.querySelectorAll('.toggle').forEach(function(btn){
    btn.addEventListener('click', function(){
      var body = btn.closest('.test-card').querySelector('.test-body');
      var open = !body.hasAttribute('hidden');
      if (open) { body.setAttribute('hidden',''); btn.textContent = 'Details'; btn.setAttribute('aria-expanded','false'); }
      else { body.removeAttribute('hidden'); btn.textContent = 'Hide'; btn.setAttribute('aria-expanded','true'); }
    });
  });

  document.querySelectorAll('.variant-tab').forEach(function(tab){
    tab.addEventListener('click', function(){
      var panel = tab.closest('.ai-panel');
      var idx = tab.getAttribute('data-variant-index');
      panel.querySelectorAll('.variant-tab').forEach(function(t){ t.classList.toggle('active', t === tab); });
      panel.querySelectorAll('.variant-panel').forEach(function(p){
        p.classList.toggle('active', p.getAttribute('data-variant-index') === idx);
      });
    });
  });

  var activeFilter = 'all';
  var query = '';
  function apply(){
    document.querySelectorAll('.test-card').forEach(function(card){
      var okStatus = activeFilter === 'all' || card.getAttribute('data-status') === activeFilter;
      var okQuery = !query || card.getAttribute('data-search').indexOf(query) !== -1;
      card.style.display = (okStatus && okQuery) ? '' : 'none';
    });
  }
  document.querySelectorAll('[data-filter]').forEach(function(btn){
    btn.addEventListener('click', function(){
      activeFilter = btn.getAttribute('data-filter');
      document.querySelectorAll('[data-filter]').forEach(function(b){ b.classList.toggle('active', b === btn); });
      apply();
    });
  });
  document.getElementById('search').addEventListener('input', function(e){
    query = e.target.value.toLowerCase(); apply();
  });

  var expanded = false;
  document.getElementById('expand').addEventListener('click', function(){
    expanded = !expanded;
    this.textContent = expanded ? 'Collapse all' : 'Expand all';
    document.querySelectorAll('.test-card').forEach(function(card){
      var body = card.querySelector('.test-body');
      var btn = card.querySelector('.toggle');
      if (expanded) { body.removeAttribute('hidden'); btn.textContent='Hide'; }
      else { body.setAttribute('hidden',''); btn.textContent='Details'; }
    });
    document.querySelectorAll('.attempt').forEach(function(d){ d.open = expanded; });
  });
})();
</script>
</body>
</html>`;
}

// ---------------------------------------------------------------------- main
/**
 * @param {{open?:boolean, latest?:boolean, failedOnly?:boolean, inline?:boolean, quiet?:boolean, since?:number|null}} options
 * @returns {{outPath:string, total:number, failed:number, diagnosed:number}}
 */
function generateReport(options = {}) {
  const args = { open: false, latest: true, failedOnly: false, inline: false, quiet: false, since: null, ...options };

  copiedAssets.clear();
  assetCounter = 0;
  testResultsIndex = null;

  const runs = loadRuns(args);
  if (runs.length === 0 && !args.quiet) {
    console.warn('[generateReport] No logs found under /logs - generating an empty report shell.');
  }

  if (fs.existsSync(ASSETS_DIR)) fs.rmSync(ASSETS_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const scopeNote = args.since
    ? 'this run only'
    : args.latest
      ? 'latest run per test (npm run report:ai -- --all for full history)'
      : 'full history';
  const html = renderHtml(runs, args.inline, scopeNote);
  const outPath = path.join(OUT_DIR, 'index.html');
  fs.writeFileSync(outPath, html, 'utf-8');

  const failed = runs.filter((r) => r.result.executionStatus === 'fail').length;
  const diagnosed = runs.filter((r) => r.ai?.results?.some((x) => x.parsed)).length;

  if (!args.quiet) {
    console.log(`[generateReport] ${runs.length} run(s), ${failed} failed, ${diagnosed} with AI diagnosis`);
    console.log(`[generateReport] Assets copied: ${copiedAssets.size}`);
    console.log(`[generateReport] Report written to ${path.relative(ROOT, outPath)}`);

    if (failed > 0 && diagnosed === 0) {
      console.warn('[generateReport] Failures present but no AI diagnosis found - run "npm run analyze" first.');
    }
  }

  if (args.open) {
    const opener = process.platform === 'win32' ? 'start ""' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    try {
      execSync(`${opener} "${outPath}"`, { stdio: 'ignore', shell: true });
    } catch (_) {
      console.log('[generateReport] Could not auto-open; open the file manually.');
    }
  }

  return { outPath, total: runs.length, failed, diagnosed };
}

module.exports = { generateReport };

// Only builds when npm run report:ai
if (require.main === module) {
  generateReport(parseArgs(process.argv.slice(2)));
}