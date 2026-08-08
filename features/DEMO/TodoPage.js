const { BasePage } = require('../BasePage');
const { loadLocatorSpec } = require('../../utils/locatorLoader')

const PAGE_NAME = 'todoPage';

class TodoPage {
  constructor(page, executor) {
    this.base = new BasePage(page, executor);
    this.page = page;
  }

  async goto() {
    return this.base.step('Navigate to the TodoMVC page', async () => {
      await this.page.goto('');
      await this.base.wait().waitForNetworkIdle();
    });
  }

  /** @param {string} itemText */
  async addItem(itemText) {
    return this.base.step(`Add New Todo Item ("${itemText}")`, async () => {
      const newTodoInput = await this.base.locate(loadLocatorSpec(PAGE_NAME, 'newTodoInput'));
      await newTodoInput.fill(itemText);
      await newTodoInput.press('Enter');
    });
  }

  /** @param {string} itemText */
  async verifyItemVisible(itemText) {
    return this.base.step(`Verify "${itemText}" Appears in the List`, async () => {
      await this.base.wait().waitForStableDOM({ timeout: 5000 });
      const spec = loadLocatorSpec(PAGE_NAME, 'todoListItem', { dynamicValue: itemText });
      const todoItem = await this.base.locate(spec);
      return todoItem;
    });
  }

  async markFirstItemComplete() {
    return this.base.step('Mark First Todo Item Complete', async () => {
      const completeCheckbox = await this.base.locate(loadLocatorSpec(PAGE_NAME, 'todoCompleteCheckbox'));
      await completeCheckbox.check();
    });
  }

  completedItemsLocator() {
    return this.page.locator('.todo-list li.completed');
  }
}

module.exports = { TodoPage };
