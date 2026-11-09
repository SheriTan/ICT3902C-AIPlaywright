const { WaitFixturePage, NO_RETRY } = require('./WaitFixturePage');

class LocationPage extends WaitFixturePage {
  constructor(page, executor) {
    super(page, executor, 'locationPage');
  }

  /** @param {{ broken?: 'states' }} [options] - 'states' makes the states request fail */
  goto({ broken } = {}) {
    return this.openFixture('location.html', broken ? `?broken=${broken}` : '', 'Open the shipping address form');
  }

  /**
   * Selects the country and waits for the state dropdown to finish reloading.
   * @param {string} country
   * @returns {Promise<string[]>} the state options that were loaded
   */
  selectCountry(country, waitOptions) {
    return this.step(
      `Select country "${country}" and wait for its states`,
      () => this._syncStates(country, waitOptions),
      NO_RETRY
    );
  }

  /** Same, for a country whose states never load: the step passes and the error is returned instead of thrown. */
  selectCountryExpectingFailure(country, waitOptions) {
    return this.step(
      `Select country "${country}" and wait for its states (expected to fail)`,
      async () => ({
        error: await this._syncStates(country, waitOptions).then(
          () => null,
          (err) => err
        ),
      }),
      NO_RETRY
    );
  }

  async _syncStates(country, waitOptions) {
    const countrySelect = await this.locate('countrySelect');
    const stateSelect = await this.locate('stateSelect');
    return this.executor.waitEngine.syncDependent({
      trigger: () => countrySelect.selectOption({ label: country }),
      dependent: stateSelect,
      label: 'States',
      ...waitOptions,
    });
  }

  /**
   * Selects the state and waits for the city dropdown to finish loading.
   * @param {string} state
   * @returns {Promise<string[]>} the city options that were loaded
   */
  selectState(state, waitOptions) {
    return this.step(
      `Select state "${state}" and wait for its cities`,
      async () => {
        const stateSelect = await this.locate('stateSelect');
        const citySelect = await this.locate('citySelect');
        return this.executor.waitEngine.syncDependent({
          trigger: () => stateSelect.selectOption({ label: state }),
          dependent: citySelect,
          label: 'Cities',
          ...waitOptions,
        });
      },
      NO_RETRY
    );
  }

  /** @param {string} city */
  selectCity(city) {
    return this.step(`Select city "${city}"`, async () => {
      await (await this.locate('citySelect')).selectOption({ label: city });
    });
  }

  /**
   * The approach the wait engine replaces: pick the country and carry on immediately.
   * Kept as a control so a test can show what goes wrong without synchronisation.
   * @param {string} country
   */
  selectCountryWithoutWaiting(country) {
    return this.step(
      `Select country "${country}" and carry on immediately (no synchronisation)`,
      async () => {
        await (await this.locate('countrySelect')).selectOption({ label: country });
      },
      NO_RETRY
    );
  }

  saveAddress() {
    return this.step('Save the address', async () => {
      await (await this.locate('saveButton')).click();
    });
  }

  // Reads that do not wait: they return whatever is on screen right now.

  /** @returns {Promise<string[]>} state option labels currently in the dropdown (placeholder excluded) */
  async stateOptionsNow() {
    return (await this.locate('stateSelect')).evaluate((select) =>
      [...select.options].filter((option) => option.value !== '').map((option) => option.text.trim())
    );
  }

  /** @returns {Promise<string>} e.g. "Canada / Ontario / Toronto" once saved */
  async addressSummary() {
    return (await (await this.locate('addressSummary')).innerText()).trim();
  }
}

module.exports = { LocationPage };
