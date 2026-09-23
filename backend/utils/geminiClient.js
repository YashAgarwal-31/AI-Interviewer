const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

function positiveInteger(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function outputText(interaction) {
  if (!interaction || interaction.status !== 'completed' || !Array.isArray(interaction.steps)) return '';
  return interaction.steps
    .filter(step => step?.type === 'model_output' && Array.isArray(step.content))
    .flatMap(step => step.content)
    .filter(content => content?.type === 'text' && typeof content.text === 'string')
    .map(content => content.text)
    .join('')
    .trim();
}

function retryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

export function createGeminiClient({
  apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  model = process.env.GEMINI_INTERVIEW_MODEL || 'gemini-3.8-flash',
  timeoutMs = positiveInteger(process.env.GEMINI_TIMEOUT_MS, 45000, { min: 5000, max: 120000 }),
  maxRetries = positiveInteger(process.env.GEMINI_MAX_RETRIES, 2, { min: 0, max: 5 }),
  endpoint = DEFAULT_ENDPOINT,
  fetchImpl = globalThis.fetch,
  sleepImpl = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
} = {}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is required');
  if (typeof fetchImpl !== 'function') throw new Error('A Fetch API implementation is required');

  return {
    model,
    async generateText({
      input,
      systemInstruction = '',
      temperature = 0.4,
      maxOutputTokens = 900,
      responseSchema = null,
      thinkingLevel = 'low'
    }) {
      const generationConfig = {
        max_output_tokens: positiveInteger(maxOutputTokens, 900, { min: 1, max: 8192 }),
        thinking_level: ['low', 'medium', 'high'].includes(thinkingLevel) ? thinkingLevel : 'low'
      };
      if (!model.startsWith('gemini-3')) generationConfig.temperature = temperature;

      const body = {
        model,
        store: false,
        input: String(input || ''),
        generation_config: generationConfig
      };
      if (systemInstruction) body.system_instruction = String(systemInstruction);
      if (responseSchema) body.response_format = { type: 'text', mime_type: 'application/json', schema: responseSchema };

      let lastError = null;
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify(body),
            signal: controller.signal
          });
          if (!response.ok) {
            const details = (await response.text().catch(() => '')).slice(0, 1000);
            const error = new Error(`Gemini API request failed with HTTP ${response.status}${details ? `: ${details}` : ''}`);
            error.status = response.status;
            throw error;
          }
          const interaction = await response.json();
          const text = outputText(interaction);
          if (!text) throw new Error(`Gemini API returned no text output (status: ${interaction?.status || 'unknown'})`);
          return text;
        } catch (error) {
          lastError = error;
          const canRetry = error?.name === 'AbortError' || retryableStatus(error?.status || 0) || error instanceof TypeError;
          if (!canRetry || attempt >= maxRetries) throw error;
          await sleepImpl(Math.min(2000, 250 * (2 ** attempt)));
        } finally {
          clearTimeout(timeout);
        }
      }
      throw lastError || new Error('Gemini API request failed');
    }
  };
}
