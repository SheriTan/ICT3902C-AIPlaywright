/**
 * @template T
 * @param {T[]} sortedNewestFirst
 * @param {(item: T) => string} getTestName
 * @param {(item: T) => string} getBrowser
 * @returns {T[]}
 */

function pickLatestPerTest(sortedNewestFirst, getTestName, getBrowser) {
  const seenKeys = new Set();
  const seenNames = new Set();
  const kept = [];
 
  for (const item of sortedNewestFirst) {
    const name = getTestName(item);
    const browser = getBrowser(item) || '';
 
    if (!browser && seenNames.has(name)) continue;
 
    const key = `${name}::${browser}`;
    if (seenKeys.has(key)) continue;
 
    seenKeys.add(key);
    seenNames.add(name);
    kept.push(item);
  }
 
  return kept;
}
 
module.exports = { pickLatestPerTest };