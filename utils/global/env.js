// Reads on/off switches from environment variables.

const OFF_VALUES = new Set(['0', 'false', 'no', 'off', '']);

/**
 * @param {string} name - environment variable name
 * @returns {boolean|undefined} true/false when the variable is set, undefined when it is not
 *   (so callers can tell "explicitly off" apart from "not specified")
 */
function envFlag(name) {
  const value = process.env[name];
  if (value === undefined) return undefined;
  return !OFF_VALUES.has(value.trim().toLowerCase());
}

module.exports = { envFlag };
