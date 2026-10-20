// Playwright reporter: after every run it (optionally) asks the AI provider to diagnose the failures and
// then rebuilds the AI report (reports/ai-report/index.html). Registered in playwright.config.js.
//
// Environment switches (all optional, 0/false/no/off disables):
//   AI_REPORT=0       disable this reporter entirely
//   AI_DIAGNOSE=0     skip the AI step, just rebuild the report
//   AI_DIAGNOSE=1     force the AI step even when no provider looks configured
//   AI_COMPARE=1      run every prompt variant instead of just the default
//   AI_REPORT_OPEN=1  open the report in the browser when the run finishes

const { generateReport } = require('./generateReport');
const { analyzeFailures } = require('./analyzeFailures');
const { AiClient } = require('../ai-engine/aiClient');
const { envFlag } = require('../../utils/global/env');

class AiReporter {
  /** @param {{ open?: boolean, compare?: boolean, inline?: boolean }} [options] - defaults, overridden by env switches */
  constructor(options = {}) {
    this.options = options;
    this.failed = 0;
    this.ended = 0;
    this.startedAt = Date.now();
  }

  onBegin() {
    this.startedAt = Date.now();
  }

  // Keep the terminal output to this reporter's own summary lines.
  printsToStdio() {
    return false;
  }

  onTestEnd(test, result) {
    this.ended += 1;
    const isFinalAttempt = result.retry === test.retries;
    if (result.status !== 'passed' && isFinalAttempt) this.failed += 1;
  }

  async onEnd() {
    if (envFlag('AI_REPORT') === false) return;
    if (this.ended === 0) return;

    const open = envFlag('AI_REPORT_OPEN') ?? this.options.open ?? false;
    const compare = envFlag('AI_COMPARE') ?? this.options.compare ?? false;

    try {
      await this._maybeDiagnose(compare);

      const { outPath, failed, diagnosed } = generateReport({
        open,
        inline: this.options.inline ?? false,
        since: this.startedAt,
        quiet: true,
      });

      console.log(`\n  AI report: ${outPath}`);
      if (failed > 0) {
        console.log(`  ${failed} failed test(s), ${diagnosed} with AI diagnosis`);
      }
      if (failed > 0 && diagnosed === 0) {
        console.log('  Tip: configure an AI provider in .env, then run "npm run diagnose" for root-cause analysis.');
      }
    } catch (err) {
      console.error(`\n  [ai-reporter] Could not build the AI report: ${err.message}`);
    }
  }

  async _maybeDiagnose(compare) {
    const explicit = envFlag('AI_DIAGNOSE');
    if (explicit === false) return;

    // Nothing to diagnose, or no provider set up: skip quietly
    if (this.failed === 0) return;

    let client;
    try {
      client = new AiClient();
    } catch (err) {
      console.log(`  [ai-reporter] Skipping AI diagnosis: ${err.message}`);
      return;
    }

    if (!client.isConfigured() && explicit !== true) {
      console.log('  [ai-reporter] Skipping AI diagnosis (no provider configured in .env).');
      return;
    }

    console.log(`\n  [ai-reporter] Diagnosing ${this.failed} failed test(s) with ${client.name}...`);
    try {
      await analyzeFailures({ compare, since: this.startedAt, quiet: true });
    } catch (err) {
      console.error(`  [ai-reporter] AI diagnosis failed: ${err.message}`);
    }
  }
}

module.exports = AiReporter;
