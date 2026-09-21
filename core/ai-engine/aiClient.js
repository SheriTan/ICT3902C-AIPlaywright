const geminiProvider = require('./providers/geminiProvider');
const ollamaProvider = require('./providers/ollamaProvider');

const PROVIDERS = {
  gemini: geminiProvider,
  ollama: ollamaProvider,
};

function resolveProvider() {
  const requested = (process.env.AI_PROVIDER || 'ollama').toLowerCase();
  const provider = PROVIDERS[requested];
  if (!provider) {
    throw new Error(`Unknown AI_PROVIDER "${requested}". Supported: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return provider;
}

class AiClient {
  constructor(provider = resolveProvider()) {
    this.provider = provider;
  }

  get name() {
    return this.provider.name;
  }

  isConfigured() {
    return this.provider.isConfigured();
  }

  /**
   * @param {string} prompt
   * @param {{ temperature?: number }} [options]
   * @returns {Promise<string>}
   */
  async generate(prompt, options = {}) {
    return this.provider.generate(prompt, options);
  }
}

module.exports = { AiClient, PROVIDERS };
