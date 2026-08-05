const { BasePage } = require('../BasePage');
const { Logger } = require('../../core/logger/logger');

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
    return this.base.step('Step 1: Log in', async () => {
      this.base.executor.logger.info(
        `Logging in as ${username} / password ${Logger.mask(password)}`
      );

      const usernameInput = await this.base.locate({
        name: 'usernameInput',
        strategies: [
          { type: 'testId', value: 'username' },
          { type: 'label', value: 'Username' },
        ],
      });
      await usernameInput.fill(username);

      const passwordInput = await this.base.locate({
        name: 'passwordInput',
        strategies: [
          { type: 'testId', value: 'password' },
          { type: 'label', value: 'Password' },
        ],
      });
      await passwordInput.fill(password);

      const submitButton = await this.base.locate({
        name: 'loginSubmitButton',
        strategies: [
          { type: 'role', value: { role: 'button', name: 'Log in' } },
          { type: 'testId', value: 'login-submit' },
        ],
      });
      await submitButton.click();
    });
  }
}

module.exports = { LoginPage };
