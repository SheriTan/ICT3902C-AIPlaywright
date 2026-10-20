// Loads ranked locator specs from locators/<pageName>.locators.json.

const fs = require('fs');
const path = require('path');
const { LOCATORS_DIR } = require('./paths');

const DYNAMIC_PLACEHOLDER = '__DYNAMIC__';
const cache = new Map();

function loadLocatorFile(pageName) {
  if (cache.has(pageName)) return cache.get(pageName);

  const filePath = path.join(LOCATORS_DIR, `${pageName}.locators.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`No locator file found for "${pageName}" at ${filePath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  cache.set(pageName, parsed);
  return parsed;
}

/**
 * @param {string} pageName - matches the JSON filename, e.g. 'todoPage'
 * @param {string} locatorName - a key inside that file, e.g. 'newTodoInput'
 * @param {{ dynamicValue?: string }} [substitutions] - runtime value that replaces every strategy
 *   value equal to "__DYNAMIC__" in the JSON
 * @returns {{ name: string, strategies: Array<{ type: string, value: any }> }}
 */
function loadLocatorSpec(pageName, locatorName, substitutions = {}) {
  const entry = loadLocatorFile(pageName)[locatorName];
  if (!entry) {
    throw new Error(`Locator "${locatorName}" not found in locators/${pageName}.locators.json`);
  }

  // Clone so substitutions never leak into the cached file
  const strategies = structuredClone(entry.strategies).map((strategy) =>
    strategy.value === DYNAMIC_PLACEHOLDER && 'dynamicValue' in substitutions
      ? { ...strategy, value: substitutions.dynamicValue }
      : strategy
  );

  return { name: locatorName, strategies };
}

module.exports = { loadLocatorSpec };
