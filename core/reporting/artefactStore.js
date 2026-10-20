// Finds the evidence files a test left behind (screenshot, video, trace, error context) and
// publishes them next to the AI report, so the report can link to them.

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT, TEST_RESULTS_DIR } = require('../../utils/global/paths');

const INLINE_IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

class ArtefactStore {
  /** @param {string} assetsDir - folder the report links to (reports/ai-report/assets) */
  constructor(assetsDir) {
    this.assetsDir = assetsDir;
    this.published = new Map(); // source path -> href, so a file is copied once
    this._testResultsIndex = null; // basename -> [paths], built on first use
  }

  get publishedCount() {
    return this.published.size;
  }

  /**
   * Copies an artefact into the report's assets folder (or embeds small images when `inline`).
   * @param {string|null} recordedPath - the path stored in the log (usually relative to the project root)
   * @param {{ inline?: boolean }} [options] - inline: embed png/jpg/webp as base64 so the report is a single file
   * @returns {string|null} href to use in the report, or null when the file cannot be found
   */
  publish(recordedPath, { inline = false } = {}) {
    const resolved = this._resolve(recordedPath);
    if (!resolved) return null;

    const ext = path.extname(resolved).toLowerCase();
    if (inline && INLINE_IMAGE_MIME[ext]) {
      return `data:${INLINE_IMAGE_MIME[ext]};base64,${fs.readFileSync(resolved).toString('base64')}`;
    }

    if (this.published.has(resolved)) return this.published.get(resolved);

    fs.mkdirSync(this.assetsDir, { recursive: true });
    const target = `${String(this.published.size + 1).padStart(3, '0')}-${path.basename(resolved)}`;
    fs.copyFileSync(resolved, path.join(this.assetsDir, target));
    const href = `assets/${target}`;
    this.published.set(resolved, href);
    return href;
  }

  /** @returns {string} first `maxChars` of the file, or '' when it cannot be found or read */
  readText(recordedPath, maxChars) {
    const resolved = this._resolve(recordedPath);
    if (!resolved) return '';
    try {
      return fs.readFileSync(resolved, 'utf-8').slice(0, maxChars);
    } catch {
      return '';
    }
  }

  /**
   * Handles:
   *  1. repo-relative path (what logReporter writes today)
   *  2. absolute path that still exists (same machine, same location)
   *  3. legacy absolute path from another machine - falls back to a file with the same name under test-results/
   */
  _resolve(recordedPath) {
    if (!recordedPath) return null;

    const normalised = recordedPath.replace(/\\/g, '/');

    const asRelative = path.join(PROJECT_ROOT, normalised);
    if (fs.existsSync(asRelative) && fs.statSync(asRelative).isFile()) return asRelative;

    if (path.isAbsolute(recordedPath) && fs.existsSync(recordedPath)) return recordedPath;

    if (!this._testResultsIndex) this._testResultsIndex = indexFilesByName(TEST_RESULTS_DIR);
    const segments = normalised.split('/');
    const candidates = this._testResultsIndex.get(segments.pop());
    if (!candidates || candidates.length === 0) return null;

    const recordedParent = segments.pop() || '';
    return candidates.find((c) => path.basename(path.dirname(c)) === recordedParent) || candidates[0];
  }
}

function indexFilesByName(rootDir) {
  const index = new Map();

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        index.set(entry.name, [...(index.get(entry.name) || []), full]);
      }
    }
  };

  try {
    if (fs.existsSync(rootDir)) walk(rootDir);
  } catch {
    // an unreadable folder just means fewer artefacts are found
  }
  return index;
}

module.exports = { ArtefactStore };
