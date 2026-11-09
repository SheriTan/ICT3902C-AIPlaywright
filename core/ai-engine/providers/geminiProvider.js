const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

function isConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * @param {string} prompt
 * @param {{ temperature?: number }} options
 * @returns {Promise<string>} raw text response
 */
async function generate(prompt, options = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set. Add it to your .env file to use the Gemini provider.');
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const { temperature = 0.2 } = options;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: 800 },
      }),
    });
  } catch (err) {
    const reason = err.cause?.code || err.cause?.message || err.message;
    throw new Error(`Could not reach the Gemini API (${reason}).`, { cause: err });
  }

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Gemini API error ${response.status}: ${errBody.slice(0, 500)}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';

  if (!text) {
    const finishReason = data?.candidates?.[0]?.finishReason;
    throw new Error(`Gemini returned no text (finishReason=${finishReason || 'unknown'}).`);
  }

  return text;
}

module.exports = { generate, isConfigured, name: 'gemini' };
