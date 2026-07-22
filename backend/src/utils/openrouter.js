const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";

/** Keep completions cheap — free-tier credit balances reject large max_tokens. */
const DEFAULT_CHAT_MODEL =
  process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
const DEFAULT_MAX_TOKENS = Number(process.env.OPENROUTER_MAX_TOKENS) || 2500;
const QUIZ_TEXT_CHARS = Number(process.env.OPENROUTER_QUIZ_CHARS) || 6000;

const getHeaders = () => {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }
  return {
    Authorization: `Bearer ${key}`,
    "HTTP-Referer": process.env.CLIENT_URL || "http://localhost:8080",
    "X-Title": "SkillBridge LMS",
    "Content-Type": "application/json",
  };
};

export async function chatCompletion({
  messages,
  model = DEFAULT_CHAT_MODEL,
  temperature = 0.4,
  max_tokens = DEFAULT_MAX_TOKENS,
  responseFormat,
}) {
  const body = {
    model,
    messages,
    temperature,
    max_tokens: Math.min(Number(max_tokens) || DEFAULT_MAX_TOKENS, 3999),
  };
  if (responseFormat) body.response_format = responseFormat;

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || "OpenRouter request failed";
    // Friendlier credit / token errors
    if (/credits|max_tokens|afford/i.test(msg)) {
      throw new Error(
        `${msg} Tip: use a cheaper model (e.g. openai/gpt-4o-mini) and keep question count ≤ 5.`
      );
    }
    throw new Error(msg);
  }

  return data.choices?.[0]?.message?.content || "";
}

export async function embedText(text) {
  const model = process.env.OPENROUTER_EMBED_MODEL || "openai/text-embedding-3-small";
  const res = await fetch(EMBEDDINGS_URL, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      model,
      input: text.slice(0, 8000),
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || "Embedding request failed");
  }

  return data.data?.[0]?.embedding || [];
}

export function cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return -1;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function generateQuizFromText(text, { count = 5, title = "AI Quiz" } = {}) {
  const n = Math.min(Math.max(Number(count) || 5, 1), 8);
  // ~350 tokens per MCQ as a safe budget under free-tier limits
  const maxTokens = Math.min(500 + n * 280, 3500);

  const excerpt = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, QUIZ_TEXT_CHARS);

  const content = await chatCompletion({
    messages: [
      {
        role: "system",
        content:
          'Return ONLY compact JSON: {"questions":[{"type":"mcq","prompt":"...","options":["A","B","C","D"],"answerIndex":0,"explanation":"..."}]}. No markdown.',
      },
      {
        role: "user",
        content: `Create exactly ${n} MCQs for quiz "${title}" from this text:\n\n${excerpt}`,
      },
    ],
    temperature: 0.3,
    max_tokens: maxTokens,
  });

  const cleaned = content.replace(/```json\n?|\n?```/g, "").trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Try to salvage JSON object from noisy model output
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Invalid quiz JSON from AI");
    parsed = JSON.parse(match[0]);
  }
  if (!Array.isArray(parsed.questions) || !parsed.questions.length) {
    throw new Error("Invalid quiz JSON from AI");
  }
  return parsed.questions.slice(0, n);
}
