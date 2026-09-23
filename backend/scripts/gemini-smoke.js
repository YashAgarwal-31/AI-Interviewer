import { createGeminiClient } from '../utils/geminiClient.js';

const expected = 'INTERVIEWBUDDY_GEMINI_OK';
const client = createGeminiClient();

const output = await client.generateText({
  systemInstruction: 'Follow the user instruction exactly and return plain text only.',
  input: `Reply with exactly ${expected} and nothing else.`,
  temperature: 0,
  maxOutputTokens: 40
});

if (!output.includes(expected)) {
  throw new Error('Gemini smoke test returned an unexpected response.');
}

console.log(`GEMINI_API_SMOKE_OK model=${client.model}`);
