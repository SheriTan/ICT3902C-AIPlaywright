// Turns report data into the HTML of the AI report. Pure string building: no file or network access,
// everything it needs (evidence files, CSS, client script) is handed in by generateReport.js.

const { stripAnsi } = require('../../utils/global/text');

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function formatDuration(ms) {
  if (ms == null) return 'n/a';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(iso) {
  if (!iso) return 'unknown';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

const hasDiagnosis = (run) => run.ai?.results?.some((r) => r.parsed);

function renderAiPanel(ai) {
  if (!ai || !Array.isArray(ai.results) || ai.results.length === 0) {
    return `<div class="ai-panel ai-empty">
      <div class="ai-head"><span class="ai-badge">AI diagnosis</span></div>
      <p class="muted">No AI diagnosis available for this run. Generate one with
      <code>npm run analyze</code>, then rebuild this report.</p>
    </div>`;
  }

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

function renderArtefacts(artefacts, ctx) {
  if (!artefacts) return '';

  const blocks = [];

  const screenshot = ctx.artefacts.publish(artefacts.screenshot, { inline: ctx.inline });
  if (screenshot) {
    blocks.push(`<figure class="artefact">
      <figcaption>Screenshot at failure</figcaption>
      <a href="${esc(screenshot)}" target="_blank" rel="noopener"><img src="${esc(screenshot)}" alt="Screenshot at point of failure" loading="lazy"></a>
    </figure>`);
  }

  const video = ctx.artefacts.publish(artefacts.video);
  if (video) {
    blocks.push(`<figure class="artefact">
      <figcaption>Execution video</figcaption>
      <video controls preload="none" src="${esc(video)}"></video>
    </figure>`);
  }

  const trace = ctx.artefacts.publish(artefacts.trace);
  if (trace) {
    blocks.push(`<figure class="artefact artefact-link">
      <figcaption>Playwright trace</figcaption>
      <a class="btn" href="${esc(trace)}" download>Download trace.zip</a>
      <p class="muted small">Open with <code>npx playwright show-trace &lt;file&gt;</code> or drop it into
      <a href="https://trace.playwright.dev/" target="_blank" rel="noopener">trace.playwright.dev</a>.</p>
    </figure>`);
  }

  const snapshot = ctx.artefacts.readText(artefacts.errorContext, 4000);
  if (snapshot) {
    blocks.push(`<details class="artefact artefact-wide">
      <summary>Page snapshot at failure (accessibility tree)</summary>
      <pre class="raw">${esc(snapshot)}</pre>
    </details>`);
  }

  if (blocks.length === 0) {
    return `<div class="subsection"><h4>Evidence</h4><p class="muted">No artefacts were captured or they could not be located on disk.</p></div>`;
  }

  return `<div class="subsection"><h4>Evidence</h4><div class="artefact-grid">${blocks.join('')}</div></div>`;
}

function renderAttempt(attempt, ctx, fallbackArtefacts) {
  // Step lines written by the executor start with STEP / PASSED / FAILED / ABORTED / PURPOSE;
  // tag them so failures stand out in the timeline.
  const stepClass = (message) => {
    const m = /^(STEP|PASSED|FAILED|ABORTED|PURPOSE)\b/.exec(message);
    return m ? ` class="step-${m[1].toLowerCase()}"` : '';
  };
  const steps = (attempt.steps || [])
    .map((s) => {
      const message = stripAnsi(s.message);
      return `<li${stepClass(message)}><span class="ts">${esc(new Date(s.timestamp).toLocaleTimeString())}</span><span class="msg">${esc(
        message
      )}</span></li>`;
    })
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
    ${renderArtefacts(attempt.artefacts || fallbackArtefacts, ctx)}
  </details>`;
}

function renderTestCard(run, ctx) {
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
          renderAttempt(a, ctx, i === attempts.length - 1 ? result.artefacts : null)
        )
        .join('')}
      ${attempts.length === 0 ? '<p class="muted">No detailed attempt log found for this run.</p>' : ''}
    </div>
  </article>`;
}

/**
 * @param {Array<object>} runs - from logStore.selectRuns()
 * @param {{ inline: boolean, scopeNote?: string, artefacts: import('./artefactStore').ArtefactStore,
 *   css: string, js: string, emptyStateHtml: string }} ctx
 *   inline = embed CSS, JS and screenshots in the page so the report is one portable file
 * @returns {string} the full HTML document
 */
function renderReport(runs, ctx) {
  const { inline, scopeNote, css, js, emptyStateHtml } = ctx;
  const total = runs.length;
  const failed = runs.filter((r) => r.result.executionStatus === 'fail').length;
  const passed = total - failed;
  const passRate = total ? Math.round((passed / total) * 100) : 0;
  const diagnosed = runs.filter(hasDiagnosis).length;

  const cards = runs.map((run) => renderTestCard(run, ctx)).join('\n');

  return `<!doctype html>
<html lang="en" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Diagnostic Report</title>
${inline ? `<style>${css}</style>` : '<link rel="stylesheet" href="assets/report.css">'}
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
    ${cards || emptyStateHtml}
  </main>

  <footer>
    Built from the framework's structured telemetry (<code>/logs</code>) and the AI Intelligence Layer
    (<code>/logs/ai-diagnosis</code>). Evidence is linked from <code>/test-results</code>.
  </footer>
</div>

${inline ? `<script>\n${js}</script>` : '<script src="assets/report.js"></script>'}
</body>
</html>`;
}

module.exports = { renderReport, hasDiagnosis };
