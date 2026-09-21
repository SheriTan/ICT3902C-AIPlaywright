const DEFAULT_MODEL = 'llama3.2';
const DEFAULT_BASE_URL = 'http://localhost:11434';

function isConfigured() {
  return (process.env.AI_PROVIDER || '').toLowerCase() === 'ollama';
}

/**
 * @param {string} prompt
 * @param {{ temperature?: number }} options
 * @returns {Promise<string>} raw text response
 */
async function generate(prompt, options = {}) {
  const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL;
  const model = process.env.OLLAMA_MODEL || DEFAULT_MODEL;
  const { temperature = 0.2, jsonMode = false } = options;

  let response;
  try {
    response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        ...(jsonMode ? { format: 'json' } : {}),
        options: { temperature },
      }),
    });
  } catch (err) {
    throw new Error(
      `Could not reach Ollama at ${baseUrl}. Is "ollama serve" running, and have you run "ollama pull ${model}"? (${err.message})`
    );
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Ollama error ${response.status}: ${errBody.slice(0, 500)}`);
  }

  const data = await response.json();
  if (!data.response) {
    throw new Error('Ollama returned an empty response.');
  }

  return data.response;
}

module.exports = { generate, isConfigured, name: 'ollama' };
