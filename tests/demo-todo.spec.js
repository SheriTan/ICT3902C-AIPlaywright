const { test, expect } = require('../utils/global/templateHandler');
const { TodoPage } = require('../features/DEMO/TodoPage');

test.describe('TodoMVC - add and complete an item', () => {
  test('adds a todo item and marks it complete', async ({ page, executor }) => {
    const todoPage = new TodoPage(page, executor);

    await todoPage.goto();
    await todoPage.addItem('Buy milk');

    const todoItem = await todoPage.verifyItemVisible('Buy milk');
    await expect(todoItem).toBeVisible();

    await todoPage.markFirstItemComplete();
    await expect(todoPage.completedItemsLocator()).toHaveCount(1);
  });
});