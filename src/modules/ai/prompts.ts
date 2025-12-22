/**
 * AI prompt templates for message polishing
 */

export function getPolishPrompt(
  originalText: string,
  tone: "neutral" | "friendly" | "playful"
): string {
  const toneInstructions = {
    neutral: "Keep the tone professional and neutral.",
    friendly: "Make it warm and friendly, like talking to a friend.",
    playful: "Add a bit of playfulness and light humor, but keep it appropriate.",
  };

  const hasEmojis = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(originalText);

  return `You are a helpful assistant that polishes messages for a language exchange dating app. Rewrite the following message to make it smoother and more engaging while keeping the original meaning.

Original message: "${originalText}"

Requirements:
- Keep the exact same meaning and intent
- ${toneInstructions[tone]}
- ${hasEmojis ? "Keep emojis if they fit naturally, but don't add new ones." : "Do not add emojis."}
- Make it concise: aim for 1-2 short sentences maximum
- Keep it natural and conversational
- Don't make it too formal or robotic

Return only the polished message, nothing else.`;
}


