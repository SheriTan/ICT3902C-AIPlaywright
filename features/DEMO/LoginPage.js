const { BasePage } = require('../BasePage');
const { Logger } = require('../../core/logger/logger');
const { loadLocatorSpec } = require('../../utils/global/locatorLoader')
const { getUserByName } = require('../../utils/DEMO/credentialLoader')

const PAGE_NAME = 'loginPage';

class LoginPage {
  constructor(page, executor) {
    this.base = new BasePage(page, executor);
    this.page = page;
  }

  async goto() {
    return this.base.step('Navigate to Sign in page', async () => {
      await this.page.goto('/auth/login');
      await this.base.wait().waitForNetworkIdle();
    });
  }

  /**
   * @param {string} username
   * @param {string} password
   */
  async login(name, username, password) {
    return this.base.step(`Login as ${name}`, async () => {
      this.base.executor.logger.info(
        `Logging in as ${Logger.mask(username)} / password ${Logger.mask(password)}`
      );

      const usernameInput = await this.base.locate(loadLocatorSpec(PAGE_NAME, 'usernameInput'));
      await usernameInput.fill(username);

      const passwordInput = await this.base.locate(loadLocatorSpec(PAGE_NAME, 'passwordInput'));
      await passwordInput.fill(password);

      const submitButton = await this.base.locate(loadLocatorSpec(PAGE_NAME, 'loginSubmitButton'));
      await submitButton.click();
    });
  }

  async loginAs(name) {
    const user = getUserByName(name);
    return this.login(name, user.Email, user.Password);
  }
}

module.exports = { LoginPage };
