const { BasePage } = require('../BasePage');
const { Logger } = require('../../core/logger/logger');
const { loadLocatorSpec } = require('../../utils/locatorLoader')

const PAGE_NAME = 'loginPage';

class LoginPage {
  constructor(page, executor) {
    this.base = new BasePage(page, executor);
    this.page = page;
  }

  /**
   * @param {string} username
   * @param {string} password
   */
  async login(username, password) {
    return this.base.step('Log in', async () => {
      this.base.executor.logger.info(
        `Logging in as ${username} / password ${Logger.mask(password)}`
      );

      const usernameInput = await this.base.locate(loadLocatorSpec(PAGE_NAME, 'usernameInput'));
      await usernameInput.fill(username);

      const passwordInput = await this.base.locate(loadLocatorSpec(PAGE_NAME, 'passwordInput'));
      await passwordInput.fill(password);

      const submitButton = await this.base.locate(loadLocatorSpec(PAGE_NAME, 'loginSubmitButton'));
      await submitButton.click();
    });
  }
}

module.exports = { LoginPage };
