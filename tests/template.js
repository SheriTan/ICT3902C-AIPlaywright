// COPY THIS FILE to start a new test. Rename it to e.g. "login.spec.js".
// OBSOLETE COMMAND: Run with: npx playwright test tests/[filename] --project=[browser type]
// Run with: npx playwright test
const { test, expect } = require('../utils/templateHandler');

// == Sample Import Feature ==
// const { LoginPage } = require('../features/LoginPage');

test.describe('SUITE NAME HERE', () => {
  test('TEST NAME HERE', async ({ page, executor }) => {
    // == Sample Feature Method ==
    // const loginPage = new LoginPage(page, executor);
    // await loginPage.login('someUser', 'somePassword');F
  });
});