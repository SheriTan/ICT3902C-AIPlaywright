# AI Playwright Framework

Playwright test framework with ranked locator fallback, step-level retry/recovery, structured logs,
sensitive-data masking and AI root-cause diagnosis of failed tests.

## Folder map

| Folder            | What belongs here                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/`          | Spec files. Import `test`/`expect` from `core/fixtures`, never from `@playwright/test`. `core-*.spec.js` test the framework itself; `demo-*` / `sit-*` test an application. |
| `features/`       | Page objects. One class per page, extends `BasePage`. `features/<ENV>/` is for pages that only exist in one environment.                                                    |
| `locators/`       | `<pageName>.locators.json`: ranked locator strategies per element (first = preferred, the rest are fallbacks).                                                              |
| `config/<ENV>/`   | `config.json` per environment (baseURL, timeout, retries, credentialsFile). Picked with the `ENV` variable.                                                                 |
| `data/sensitive/` | Git-ignored secrets. Everything in here is auto-masked in logs.                                                                                                             |
| `core/`           | The framework itself: the engines and the reporting pipeline. Knows nothing about a specific application.                                                                   |
| `utils/global/`   | Small helpers used everywhere: paths, env switches, text helpers, config + locator loaders. No framework logic.                                                             |
| `utils/<ENV>/`    | Helpers that only make sense for one environment (e.g. `DEMO/credentialLoader.js`).                                                                                         |

### Inside `core/`

| Folder / file                       | Responsibility                                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `fixtures.js`                       | Adds the `executor` fixture to Playwright's `test`. Entry point for every spec.                          |
| `executor/testExecutor.js`          | Named, retryable steps; records failed step, error and locator used.                                     |
| `locator-engine/locatorEngine.js`   | Tries ranked strategies top to bottom, scrolls and retries, fails with a full attempt list.              |
| `locator-engine/strategyChecker.js` | Test helper that proves every rank of a locator works, targets the same element and falls back in order. |
| `recovery/recoveryEngine.js`        | Retry-with-recovery for transient failures, plus `waitForStableDOM`.                                     |
| `logger/logger.js`                  | Per-test logger; every message is redacted.                                                              |
| `logger/sensitiveData.js`           | Masks values from `data/sensitive/` (`redact`, `redactString`) and partial masking (`mask`).             |
| `ai-engine/`                        | Provider-agnostic AI client (`providers/`), prompt variants, response parsing, diagnosis.                |
| `reporting/`                        | Everything that happens after tests run (see below).                                                     |

### Reporting pipeline (`core/reporting/`)

```
playwright test
  logReporter.js     writes logs/*.result.json, logs/*.complete.log.json, logs/last-run.json
  aiReporter.js      -> analyzeFailures.js  (AI diagnosis -> logs/ai-diagnosis/*.ai.json)
                     -> generateReport.js   (-> reports/ai-report/index.html)
logStore.js          reads the logs and decides which runs a report/analysis covers
artefactStore.js     finds screenshots/videos/traces and copies them next to the report
reportRenderer.js    HTML structure of the report
report-assets/       report.css, report.js, empty-state.html
```

## Conventions

- CommonJS, Node 18+. Formatting is enforced by Prettier (`npm run format`), settings in `.prettierrc.json`:
  2 spaces, single quotes, semicolons, 120 columns, LF line endings.
- Files are `camelCase.js`, folders are `kebab-case`, classes are `PascalCase`.
- Every file starts with a short comment saying what it is for; exported functions have JSDoc.
- A folder path is never built with `__dirname` outside `utils/global/paths.js`. Import it from there.
- No empty `catch` blocks: say in a comment why the error is safe to ignore.
- Do not wrap what Playwright already does (auto-waiting, `expect.poll`, `toPass`, `waitForLoadState`).
  Add framework code only when it does something Playwright does not.

## Adding things

- **New page:** `locators/<name>Page.locators.json`, then `features/[ENV/]<Name>Page.js` extending `BasePage`
  (`super(page, executor, '<name>Page')`), using `this.step(...)`, `this.locate('<locatorName>')`, `this.open(url, stepName)`.
- **New test:** copy `tests/template.spec.js`.
- **New AI provider:** add `core/ai-engine/providers/<name>Provider.js` exporting `{ generate, isConfigured, name }` and register it in `aiClient.js`.

## Scripts

| Command                          | What it does                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm test` / `npm run test:demo` | Run all tests (`ENV` from `.env`, or DEMO).                                                        |
| `npm run report`                 | Build and open the AI report for the last test run (`-- --all` for full history).                  |
| `npm run analyze`                | Run AI diagnosis on the last run's failures (`-- --compare`, `-- --force`, `-- --all`, ...).       |
| `npm run diagnose`               | `analyze` then `report`.                                                                           |
| `npm run report:html`            | Open Playwright's own HTML report (needs `HTML_REPORT=1` during the run, see `npm run test:html`). |
| `npm run format`                 | Format everything with Prettier.                                                                   |

Environment variables are documented in `.env.example`.
