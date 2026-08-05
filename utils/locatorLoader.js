// To load locators in pattern files

const fs = require('fs');
const path = require('path');

const LOCATORS_DIR = path.join(__dirname, '..', 'locators');
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
 * @param {Record<string, string>} [substitutions] - replaces any strategy value equal to `__DYNAMIC__` (or `__PLACEHOLDER__`) with a runtime value      
 * @returns {{ name: string, strategies: Array<object> }}
 */
function loadLocatorSpec(pageName, locatorName, substitutions = {}) {
  const file = loadLocatorFile(pageName);
  const entry = file[locatorName];
  if (!entry) {
    throw new Error(`Locator "${locatorName}" not found in resources/locators/${pageName}.locators.json`);
  }

  const strategies = JSON.parse(JSON.stringify(entry.strategies)).map((strategy) => {
    if (strategy.value === '__DYNAMIC__' && 'dynamicValue' in substitutions) {
      strategy.value = substitutions.dynamicValue;
    }
    return strategy;
  });

  return { name: locatorName, strategies };
}

module.exports = { loadLocatorSpec };