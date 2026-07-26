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

const DOC_CHAT_CHARS = Number(process.env.OPENROUTER_DOC_CHAT_CHARS) || 8000;
const DOC_CHAT_MAX_TOKENS = Number(process.env.OPENROUTER_DOC_CHAT_MAX_TOKENS) || 320;

/**
 * Minimal-token Q&A over a document, with few-shot format (headings + bullets).
 */
export async function answerFromDocument({
  documentTitle = "Lesson document",
  documentText = "",
  question = "",
} = {}) {
  const excerpt = String(documentText || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DOC_CHAT_CHARS);

  const q = String(question || "").trim().slice(0, 500);

  const system = `You are a concise LMS tutor. Answer ONLY from the document.
Rules:
- Use minimal words; no fluff or repetition.
- Structure with short Markdown headings (##) when the answer has sections.
- Use bullet lists (- ) for steps, items, or multiple points.
- If the answer is a single short fact, reply in 1–3 sentences (no forced headings).
- If not in the document, reply exactly: "Not found in this document."
- Do not invent facts.`;

  // Few-shot examples for consistent formatting
  const messages = [
    { role: "system", content: system },
    {
      role: "user",
      content:
        'Document: "Intro to HTTP"\nText: HTTP methods include GET to read data and POST to create resources. Status 404 means not found.\n\nQ: What are the main HTTP methods mentioned?',
    },
    {
      role: "assistant",
      content: `## Main HTTP methods
- **GET** — read data
- **POST** — create resources

## Related
- **404** — resource not found`,
    },
    {
      role: "user",
      content:
        'Document: "Course syllabus"\nText: Week 1 covers setup. Week 2 covers React basics.\n\nQ: When is the final exam?',
    },
    {
      role: "assistant",
      content: "Not found in this document.",
    },
    {
      role: "user",
      content:
        'Document: "Sorting notes"\nText: Bubble sort repeatedly swaps adjacent items if they are in the wrong order.\n\nQ: What is bubble sort?',
    },
    {
      role: "assistant",
      content:
        "Bubble sort repeatedly swaps adjacent items that are out of order until the list is sorted.",
    },
    {
      role: "user",
      content: `Document: "${documentTitle}"\nText: ${excerpt}\n\nQ: ${q}`,
    },
  ];

  return chatCompletion({
    messages,
    temperature: 0.15,
    max_tokens: Math.min(DOC_CHAT_MAX_TOKENS, 400),
  });
}

/**
 * AI grades an open answer out of maxMarks. Returns { marks, feedback }.
 */
export async function gradeWithAi({
  title = "Assessment",
  instructions = "",
  contextText = "",
  studentAnswer = "",
  maxMarks = 10,
} = {}) {
  const max = Math.max(1, Math.min(Number(maxMarks) || 10, 100));
  const excerpt = String(contextText || instructions || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);
  const answer = String(studentAnswer || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);

  const raw = await chatCompletion({
    messages: [
      {
        role: "system",
        content: `You are a strict but fair grader. Return ONLY compact JSON: {"marks":number,"feedback":"short reason"}. marks must be 0..${max}. No markdown.`,
      },
      {
        role: "user",
        content: `Title: ${title}\nMax marks: ${max}\nRubric/context: ${excerpt || "Grade quality and completeness."}\n\nStudent answer:\n${answer || "(empty)"}`,
      },
    ],
    temperature: 0.1,
    max_tokens: 180,
  });

  const cleaned = String(raw || "")
    .replace(/```json\n?|\n?```/g, "")
    .trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      return { marks: 0, feedback: "AI grading failed to parse response" };
    }
    parsed = JSON.parse(match[0]);
  }
  let marks = Number(parsed.marks);
  if (!Number.isFinite(marks)) marks = 0;
  marks = Math.max(0, Math.min(max, Math.round(marks * 100) / 100));
  return {
    marks,
    feedback: String(parsed.feedback || "").slice(0, 500),
  };
}
