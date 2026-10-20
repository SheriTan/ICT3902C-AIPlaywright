// Small string helpers shared by the executor, locator engine and report.

/** Removes terminal colour codes (Playwright error messages contain them). */
function stripAnsi(value) {
  return String(value ?? '').replace(/\u001b\[[0-9;]*m/g, '');
}

/** First non-empty line of a message, without colour codes. Used for one-line log summaries. */
function firstLine(message) {
  return (
    stripAnsi(message)
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) || ''
  );
}

module.exports = { stripAnsi, firstLine };
