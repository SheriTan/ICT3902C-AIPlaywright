const { test, expect } = require('../utils/global/templateHandler');
const { LoginPage } = require('../features/DEMO/LoginPage');

test.describe('Practice Software Testing', () => {
  test('Login Success', async ({ page, executor }) => {
    const loginPage = new LoginPage(page, executor);

    await loginPage.goto();
    await loginPage.loginAs('Jack Howe')
    await loginPage.base.wait().waitForStableDOM
  });
});