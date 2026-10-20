// Single source of truth for every folder the framework reads from or writes to.
// If a folder moves, change it here and nowhere else.

const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const LOGS_DIR = path.join(PROJECT_ROOT, 'logs');
const REPORTS_DIR = path.join(PROJECT_ROOT, 'reports');

module.exports = {
  PROJECT_ROOT,
  CONFIG_DIR: path.join(PROJECT_ROOT, 'config'),
  LOCATORS_DIR: path.join(PROJECT_ROOT, 'locators'),
  SENSITIVE_DIR: path.join(PROJECT_ROOT, 'data', 'sensitive'),
  LOGS_DIR,
  AI_DIAGNOSIS_DIR: path.join(LOGS_DIR, 'ai-diagnosis'),
  LAST_RUN_PATH: path.join(LOGS_DIR, 'last-run.json'),
  TEST_RESULTS_DIR: path.join(PROJECT_ROOT, 'test-results'),
  REPORTS_DIR,
  JSON_RESULTS_PATH: path.join(REPORTS_DIR, 'results.json'),
  HTML_REPORT_DIR: path.join(REPORTS_DIR, 'html-report'),
  AI_REPORT_DIR: path.join(REPORTS_DIR, 'ai-report'),
};
