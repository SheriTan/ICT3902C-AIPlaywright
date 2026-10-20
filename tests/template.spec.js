// COPY THIS FILE to start a new test. Rename it to e.g. "login.spec.js".
// Run with: npm run test:[env/browser] [test spec file]
const { test, expect } = require('../core/fixtures');

// == Sample Import Feature ==
// const { LoginPage } = require('../features/DEMO/LoginPage');

test.describe('SUITE NAME HERE', () => {
  test('TEST NAME HERE', async ({ page, executor }) => {
    // == Sample Feature Method ==
    // const loginPage = new LoginPage(page, executor);
    // await loginPage.goto();
    // await loginPage.loginAs('Jack Howe');
  });
});
