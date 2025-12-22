import { getEnv } from "../../lib/env.js";

interface AIResponse {
  content: string;
}

/**
 * Call AI provider to polish a message
 */
export async function polishMessage(
  text: string,
  tone: "neutral" | "friendly" | "playful",
  prompt: string
): Promise<string> {
  const env = getEnv();

  if (env.AI_PROVIDER === "openai") {
    return callOpenAI(prompt, env.OPENAI_API_KEY!, env.AI_MODEL);
  } else {
    return callOpenRouter(prompt, env.OPENROUTER_API_KEY!, env.AI_MODEL);
  }
}

async function callOpenAI(prompt: string, apiKey: string, model: string): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 200,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content?.trim() || text;
}

async function callOpenRouter(prompt: string, apiKey: string, model: string): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://swiip.app", // Optional: for analytics
      "X-Title": "Swiip", // Optional: for analytics
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 200,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content?.trim() || text;
}


