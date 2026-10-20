// Prompt Library for the AI Intelligence Layer
//
// Runs the same failure log through several prompting strategies and
// compare the outputs side-by-side (see core/reporting/analyzeFailures.js --compare)
//
// Every variant is required to end its instructions by demanding a single
// fenced ```json block so DiagnosisEngine can parse the result the same way.

const RESPONSE_SCHEMA = `{
  "category": "one of: LocatorFragility | Timing/Flakiness | EnvironmentOrNetwork | ApplicationBug | TestScriptDefect | Unknown",
  "rootCause": "1-3 sentence plain-English explanation of why the step most likely failed",
  "confidence": "High | Medium | Low",
  "suggestedFix": "concrete, actionable next step for the test automation engineer",
  "suggestedLocatorStrategy": "if this was a locator failure, propose a better strategy/value; otherwise null"
}`;

/**
 * Builds a compact, masked-safe description of a failure for prompting.
 * Expects the shape produced by diagnosisEngine.buildFailureContext().
 */
function describeFailure(ctx) {
  return [
    `Test name: ${ctx.testName}`,
    `Browser: ${ctx.browser}`,
    `Failed step: ${ctx.failedStep || 'unknown'}`,
    `Error type: ${ctx.errorType || 'unknown'}`,
    `Error message: ${ctx.errorMessage || 'none'}`,
    `Locator involved: ${ctx.locatorName || 'n/a'}`,
    `Locator strategy attempts (most recent attempt only):\n${ctx.locatorAttempts || 'n/a'}`,
    `Step trace (chronological, most recent attempt only):\n${ctx.stepTrace || 'n/a'}`,
  ].join('\n');
}

const PROMPT_VARIANTS = {
  /**
   * Fast + cheap. Minimises tokens so it is safe to run on every CI
   * failure without burning through a free-tier rate limit. Good default
   * for "always-on" diagnosis shown in the AI report.
   */
  concise: {
    label: 'Concise Direct-Answer',
    description:
      'Single short instruction, no reasoning shown. Optimised for low token usage / fast turnaround so it can run on every failed test.',
    build: (ctx) => `You are a senior QA automation engineer reviewing a Playwright test failure.
Analyse the failure below and respond with ONLY the JSON object described, no other text.

${describeFailure(ctx)}

Respond with exactly one fenced json block matching this schema:
\`\`\`json
${RESPONSE_SCHEMA}
\`\`\``,
  },

  /**
   * Slower + more tokens, but asks the model to reason through the
   * timeline before concluding. Useful when the concise variant produces
   * a vague or low-confidence answer, or for the handful of failures you
   * want to write up in detail for the report.
   */
  chain_of_thought: {
    label: 'Chain-of-Thought Root Cause',
    description:
      'Asks the model to reason step-by-step through the attempt timeline before committing to a conclusion. Slower/more tokens, generally higher-quality reasoning on ambiguous failures.',
    build: (ctx) => `You are a senior QA automation engineer performing root-cause analysis on a Playwright
test failure. Think through the evidence step by step:
1. What was the test trying to do at the failed step?
2. What do the locator strategy attempts and their timeouts suggest?
3. Does the error look like a genuine application/UI change, a timing issue, a network/
   environment problem, or a defect in the test script itself?
4. What is the single most likely root cause, and how confident are you?

Show your brief reasoning, then finish your response with exactly one fenced json block
(and nothing after it) matching this schema:
\`\`\`json
${RESPONSE_SCHEMA}
\`\`\`

Failure evidence:
${describeFailure(ctx)}`,
  },

  /**
   * Strict structured-output variant. No reasoning at all, no prose,
   * temperature should be kept low by the caller. Useful for batch/
   * programmatic comparison since it is the cheapest to parse reliably.
   */
  structured_json: {
    label: 'Strict Structured JSON',
    description:
      'Zero prose, JSON-only output enforced via explicit instruction. Optimised for reliable machine parsing across large batches of logs.',
    build: (ctx) => `Return ONLY valid JSON. Do not include markdown, prose, or explanation outside the JSON.
Schema:
${RESPONSE_SCHEMA}

Failure data:
${describeFailure(ctx)}`,
  },
};

function getVariant(name) {
  const variant = PROMPT_VARIANTS[name];
  if (!variant) {
    const available = Object.keys(PROMPT_VARIANTS).join(', ');
    throw new Error(`Unknown prompt variant "${name}". Available: ${available}`);
  }
  return variant;
}

module.exports = { PROMPT_VARIANTS, getVariant, describeFailure, RESPONSE_SCHEMA };
