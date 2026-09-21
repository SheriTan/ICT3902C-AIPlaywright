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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: 800 },
      }),
    });
  } catch (err) {
    console.error('\n========== GEMINI FETCH ERROR ==========');
    console.error('name:', err?.name);
    console.error('message:', err?.message);
    console.error('cause:', err?.cause);
    console.error('cause code:', err?.cause?.code);
    console.error('cause message:', err?.cause?.message);
    console.error('stack:', err?.stack);
    console.error('URL:', url.replace(apiKey, '[REDACTED]'));
    throw err;
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
