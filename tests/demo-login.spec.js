const { test, expect } = require('../utils/global/templateHandler');

// == Sample Import Feature ==
const { LoginPage } = require('../features/DEMO/LoginPage');

test.describe('Practice Software Testing', () => {
  test('Login Success', async ({ page, executor }) => {
    // == Sample Feature Method ==
    const loginPage = new LoginPage(page, executor);

    await loginPage.goto();
    await loginPage.loginAs('Jack Howe')
    await loginPage.base.wait().waitForStableDOM
  });
});