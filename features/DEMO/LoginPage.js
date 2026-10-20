const { BasePage } = require('../BasePage');
const { mask } = require('../../core/logger/sensitiveData');
const { getUserByName } = require('../../utils/DEMO/credentialLoader');

class LoginPage extends BasePage {
  constructor(page, executor) {
    super(page, executor, 'loginPage');
  }

  goto() {
    return this.open('/auth/login', 'Navigate to Sign in page');
  }

  /**
   * @param {string} name - label for the step title (e.g. "Jack Howe"); never the credentials themselves
   * @param {string} username
   * @param {string} password
   */
  login(name, username, password) {
    return this.step(`Login as ${name}`, async () => {
      this.executor.logger.info(`Logging in as ${mask(username)} / password ${mask(password)}`);

      await (await this.locate('usernameInput')).fill(username);
      await (await this.locate('passwordInput')).fill(password);
      await this.submit();
    });
  }

  /** Logs in with a user from the environment's credentials file (data/sensitive/...). */
  loginAs(name) {
    const user = getUserByName(name);
    return this.login(name, user.Email, user.Password);
  }

  /** Clicks the login button without touching the form. */
  async submit() {
    await (await this.locate('loginSubmitButton')).click();
  }
}

module.exports = { LoginPage };
