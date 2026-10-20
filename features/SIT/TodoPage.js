const { BasePage } = require('../BasePage');

class TodoPage extends BasePage {
  constructor(page, executor) {
    super(page, executor, 'todoPage');
  }

  goto() {
    return this.open('/', 'Navigate to the TodoMVC page');
  }

  /** @param {string} itemText */
  addItem(itemText) {
    return this.step(`Add New Todo Item ("${itemText}")`, async () => {
      const newTodoInput = await this.locate('newTodoInput');
      await newTodoInput.fill(itemText);
      await newTodoInput.press('Enter');
    });
  }

  /**
   * @param {string} itemText
   * @returns {Promise<import('@playwright/test').Locator>} the list item, once it is visible
   */
  verifyItemVisible(itemText) {
    return this.step(`Verify "${itemText}" Appears in the List`, async () => {
      await this.executor.waitForStableDOM({ timeout: 5000 });
      return this.locate('todoListItem', { dynamicValue: itemText });
    });
  }

  markFirstItemComplete() {
    return this.step('Mark First Todo Item Complete', async () => {
      await (await this.locate('todoCompleteCheckbox')).check();
    });
  }

  completedItemsLocator() {
    return this.page.locator('.todo-list li.completed');
  }
}

module.exports = { TodoPage };
