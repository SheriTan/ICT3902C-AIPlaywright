const { test, expect } = require('../core/fixtures');
const { LocationPage } = require('../features/WaitFixture/LocationPage');

// Wait engine - dependent element synchronisation (WaitEngine.syncDependent).
// Country -> state -> city: each dropdown loads from the server after its parent changes
// (states take 0.6s, cities 0.5s).

test.describe('Wait engine - dependent element synchronisation', () => {
  test('Country, state and city load one after the other', async ({ page, executor }) => {
    const locationPage = new LocationPage(page, executor);

    executor.logger.info(
      'PURPOSE: prove each dependent dropdown is waited for before it is used. ' +
        'Expected result: the saved address is United States / California / Los Angeles.'
    );

    await locationPage.goto();

    expect(await locationPage.selectCountry('United States')).toEqual(['California', 'Texas']);
    expect(await locationPage.selectState('California')).toEqual(['Los Angeles', 'San Francisco']);
    await locationPage.selectCity('Los Angeles');

    await locationPage.saveAddress();
    expect(await locationPage.addressSummary()).toBe('United States / California / Los Angeles');
  });

  test('Changing the country never leaves a stale state list behind', async ({ page, executor }) => {
    const locationPage = new LocationPage(page, executor);

    executor.logger.info(
      'PURPOSE: when the country changes, the old states stay on screen until the new ones arrive. ' +
        'Expected result: without synchronisation the stale list is visible; with it, only the new list is used.'
    );

    await locationPage.goto();
    await locationPage.selectCountry('United States');

    await locationPage.selectCountryWithoutWaiting('Canada');
    expect(await locationPage.stateOptionsNow(), "control: the previous country's states are still shown").toEqual([
      'California',
      'Texas',
    ]);

    const states = await locationPage.selectCountry('Malaysia');
    expect(states).toEqual(['Selangor', 'Johor']);
    expect(await locationPage.stateOptionsNow()).toEqual(['Selangor', 'Johor']);

    await locationPage.selectState('Johor');
    await locationPage.selectCity('Johor Bahru');
    await locationPage.saveAddress();
    expect(await locationPage.addressSummary()).toBe('Malaysia / Johor / Johor Bahru');
  });

  test('A dropdown that never loads fails with a clear message', async ({ page, executor }) => {
    const locationPage = new LocationPage(page, executor);

    executor.logger.info(
      'PURPOSE: the states request fails, so the state dropdown stays on "Loading...". ' +
        'Expected result: DependentNotReadyError naming the dropdown, not a vague timeout further down the test.'
    );

    await locationPage.goto({ broken: 'states' });
    const { error } = await locationPage.selectCountryExpectingFailure('United States', { timeout: 2000 });

    expect(error, 'the dependent wait should have failed').not.toBeNull();
    expect(error.name).toBe('DependentNotReadyError');
    expect(error.message).toContain('"States" did not finish loading');
    expect(error.message).toContain('enabled=false');
  });
});
