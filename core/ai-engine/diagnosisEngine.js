//   Input:      structured logs from failed test executions (/logs/*.complete.log.json)
//   Processing: failure pattern analysis + root-cause classification (via an LLM)
//   Output:     suggested locator improvements + human-readable failure explanations

const { AiClient } = require('./aiClient');
const { getVariant, PROMPT_VARIANTS } = require('./promptLibrary');

const MAX_ATTEMPT_LINES = 8; // keep prompts small - cheaper + faster on free tiers

/**
 * Converts one attempt entry from a *.complete.log.json file (see
 * logHandler.js) into the compact context object the prompt library needs.
 *
 * @param {object} completeLog - parsed *.complete.log.json
 * @returns {object} failure context
 */
function buildFailureContext(completeLog) {
  const attempts = completeLog.attempts || [];
  const finalAttempt = attempts[attempts.length - 1] || {};
  const locatorUsed = finalAttempt.locatorUsed || {};

  const locatorAttempts = Array.isArray(locatorUsed.value)
    ? locatorUsed.value.slice(-MAX_ATTEMPT_LINES).join('\n')
    : typeof locatorUsed.value === 'object'
      ? JSON.stringify(locatorUsed.value)
      : String(locatorUsed.value ?? 'n/a');

  const steps = finalAttempt.steps || [];
  const stepTrace = steps
    .slice(-MAX_ATTEMPT_LINES)
    .map((s) => `[${s.timestamp}] ${s.message}`)
    .join('\n');

  // Step messages look like: "<Step Name>" failed (attempt 1/2): <error> - retrying
  const failedStepMatch = steps
    .map((s) => s.message)
    .find((m) => /^".*" failed/.test(m));
  const failedStep = failedStepMatch ? failedStepMatch.match(/^"(.*)" failed/)[1] : undefined;

  return {
    testName: completeLog.testName,
    browser: completeLog.browser,
    totalAttempts: completeLog.totalAttempts,
    failedStep,
    errorType: finalAttempt.error?.type,
    errorMessage: (finalAttempt.error?.message || '').split('\n')[0],
    locatorName: locatorUsed.name,
    locatorAttempts,
    stepTrace,
  };
}

/**
 * Pulls a JSON object out of a model response.
 */
function parseModelResponse(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { parsed: null, parseError: 'empty response' };

  const candidates = [];

  // 1. a fenced ```json block
  const fencedJson = text.match(/```json\s*([\s\S]*?)```/i);
  if (fencedJson) candidates.push(fencedJson[1]);

  // 2. any fenced block
  const fencedAny = text.match(/```\s*([\s\S]*?)```/);
  if (fencedAny) candidates.push(fencedAny[1]);

  // 3. the whole response (JSON mode / structured_json variant)
  candidates.push(text);

  // 4. the first balanced {...} object anywhere in the text
  const balanced = extractBalancedObject(text);
  if (balanced) candidates.push(balanced);

  let lastError = null;
  for (const candidate of candidates) {
    const cleaned = candidate
      .trim()
      .replace(/,(\s*[}\]])/g, '$1');

    if (!cleaned) continue;

    try {
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { parsed, parseError: null };
      }
    } catch (err) {
      lastError = err.message;
    }
  }

  return { parsed: null, parseError: lastError || 'no JSON object found in response' };
}

/**
 * Scans for the first complete {...} object, tracking string literals and
 * escapes so braces inside strings do not end the object early.
 */
function extractBalancedObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

/**
 * Runs one or more prompt variants against a single failure and returns the
 * results for every variant, so they can be compared side by side.
 * @param {object} completeLog - parsed *.complete.log.json
 * @param {{ variants?: string[], client?: AiClient, temperature?: number }} options
 */
async function diagnoseFailure(completeLog, options = {}) {
  const { variants = ['concise'], client = new AiClient(), temperature = 0.2 } = options;

  if (!client.isConfigured()) {
    throw new Error(
      `AI provider "${client.name}" is not configured. Check your .env file (see .env.example).`
    );
  }

  const context = buildFailureContext(completeLog);
  const results = [];

  for (const variantName of variants) {
    const variant = getVariant(variantName);
    const prompt = variant.build(context);
    const startedAt = Date.now();

    try {
      // chain_of_thought asks for reasoning *before* the JSON block, so it
      // must not run under a JSON-only decoding constraint.
      const jsonMode = variantName !== 'chain_of_thought';
      const raw = await client.generate(prompt, { temperature, jsonMode });
      const { parsed, parseError } = parseModelResponse(raw);
      results.push({
        variant: variantName,
        label: variant.label,
        latencyMs: Date.now() - startedAt,
        raw,
        parsed,
        parseError,
        error: null,
      });
    } catch (err) {
      results.push({
        variant: variantName,
        label: variant.label,
        latencyMs: Date.now() - startedAt,
        raw: null,
        parsed: null,
        parseError: null,
        error: err.message,
      });
    }
  }

  return { context, provider: client.name, results };
}

module.exports = {
  diagnoseFailure,
  buildFailureContext,
  parseModelResponse,
  AVAILABLE_VARIANTS: Object.keys(PROMPT_VARIANTS),
};
