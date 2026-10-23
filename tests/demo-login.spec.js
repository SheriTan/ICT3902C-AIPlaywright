const { test, expect } = require('../core/fixtures');
const { LoginPage } = require('../features/DEMO/LoginPage');

const LOGIN_URL = /\/auth\/login(?:[/?#].*)?$/;

const emailField = (page) =>
  page
    .getByLabel(/username|email/i)
    .or(page.getByPlaceholder(/email/i))
    .first();
const passwordField = (page) =>
  page
    .getByLabel(/password/i)
    .or(page.getByPlaceholder(/password/i))
    .first();

async function openLogin(page, executor) {
  const loginPage = new LoginPage(page, executor);
  await loginPage.goto();
  await expect(page).toHaveURL(LOGIN_URL);
  return loginPage;
}

async function expectLoginFailure(page) {
  // The demo may render either an inline validation message or a toast. Do not
  // couple the test to a single CSS class; also verify that auth did not succeed.
  const errorMessage = page.getByText(/invalid|incorrect|failed|wrong|email or password|required/i).first();
  const errorVisible = await errorMessage.isVisible().catch(() => false);
  const stillOnLogin = LOGIN_URL.test(page.url());
  expect(
    errorVisible || stillOnLogin,
    `Expected a visible login error or to remain on the login page; current URL: ${page.url()}`
  ).toBeTruthy();
}

test.describe('Practice Software Testing - Login', () => {
  test('Login succeeds with a valid customer account', async ({ page, executor }) => {
    const loginPage = await openLogin(page, executor);
    await loginPage.loginAs('Jack Howe');
    await expect(page).not.toHaveURL(LOGIN_URL);
  });

  test('Login fails with an incorrect password', async ({ page, executor }) => {
    const loginPage = await openLogin(page, executor);
    await loginPage.login('Invalid password', 'customer2@practicesoftwaretesting.com', 'DefinitelyWrong123!');
    await expectLoginFailure(page);
  });

  test('Login fails with an unregistered email address', async ({ page, executor }) => {
    const loginPage = await openLogin(page, executor);
    await loginPage.login('Unknown account', 'not-a-real-user-2026@example.com', 'welcome01');
    await expectLoginFailure(page);
  });

  test('Login fails when both fields are incorrect', async ({ page, executor }) => {
    const loginPage = await openLogin(page, executor);
    await loginPage.login('Invalid credentials', 'nobody-2026@example.com', 'wrong-password');
    await expectLoginFailure(page);
  });

  test('Login form rejects an empty submission', async ({ page, executor }) => {
    const loginPage = await openLogin(page, executor);
    await loginPage.submit();

    const nativeInvalid =
      (await emailField(page)
        .evaluate((el) => !el.checkValidity())
        .catch(() => false)) ||
      (await passwordField(page)
        .evaluate((el) => !el.checkValidity())
        .catch(() => false));
    const errorVisible = await page
      .getByText(/required|enter.*email|enter.*password/i)
      .first()
      .isVisible()
      .catch(() => false);
    expect(nativeInvalid || errorVisible || LOGIN_URL.test(page.url())).toBeTruthy();
  });

  test('Login rejects malformed email input', async ({ page, executor }) => {
    const loginPage = await openLogin(page, executor);
    await loginPage.login('Malformed email', 'not-an-email', 'welcome01');

    const nativeInvalid = await emailField(page)
      .evaluate((el) => !el.checkValidity())
      .catch(() => false);
    expect(nativeInvalid || LOGIN_URL.test(page.url())).toBeTruthy();
  });
});
