import { LABEL_PROMPT, LABEL_SCHEMA, parseLabels, type Labeler, type LabelResult } from "./labels.js";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
export const DEFAULT_GROQ_MODEL = "qwen/qwen3.8-27b";

type GroqOptions = {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
};

type GroqError = { error?: { message?: string; code?: string; type?: string } };

export function createGroqLabeler({ apiKey, model = DEFAULT_GROQ_MODEL, fetch: fetchFn = fetch }: GroqOptions): Labeler {
  return async ({ bytes, mimeType }) => {
    const image = `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;

    // Strict schema mode first. Groq's docs disagree on which models support it,
    // so if this model refuses the schema, ask for plain JSON and rely on parseLabels.
    let response = await send(fetchFn, apiKey, body(model, image, "schema"));
    if (response && response.status === 400) {
      const error = await readJson<GroqError>(response.clone());
      if (/json_schema|response_format|strict/i.test(error?.error?.message ?? "")) {
        response = await send(fetchFn, apiKey, body(model, image, "json"));
      }
    }

    if (!response) return { status: "failed", reason: "The AI service couldn't be reached." };
    if (response.status === 429) return rateLimited(response, await readJson<GroqError>(response));
    if (!response.ok) {
      const error = await readJson<GroqError>(response);
      return { status: "failed", reason: error?.error?.message ?? `The AI service answered ${response.status}.` };
    }

    return readAnswer(await readJson(response));
  };
}

function body(model: string, image: string, mode: "schema" | "json") {
  const instructions =
    mode === "schema"
      ? LABEL_PROMPT
      : `${LABEL_PROMPT}\n\nAnswer with only a JSON object matching this JSON Schema:\n${JSON.stringify(LABEL_SCHEMA)}`;

  return {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: instructions },
          { type: "image_url", image_url: { url: image } },
        ],
      },
    ],
    // Answer directly instead of thinking out loud first: faster, and keeps the reply pure JSON.
    reasoning_effort: "none",
    temperature: 0.2,
    response_format:
      mode === "schema"
        ? { type: "json_schema", json_schema: { name: "piece_labels", strict: true, schema: LABEL_SCHEMA } }
        : { type: "json_object" },
  };
}

async function send(fetchFn: typeof fetch, apiKey: string, payload: unknown): Promise<Response | null> {
  try {
    return await fetchFn(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    });
  } catch {
    return null;
  }
}

function rateLimited(response: Response, body: GroqError | null): LabelResult {
  const seconds = Number.parseFloat(response.headers.get("retry-after") ?? "");
  const message = body?.error?.message ?? "";
  // Groq names the limit it hit; a per-day one won't recover in seconds.
  const daily = /per day|\b(RPD|TPD)\b/i.test(message) || response.headers.get("x-ratelimit-remaining-requests") === "0";

  return {
    status: "waiting",
    retryAfterSeconds: Number.isFinite(seconds) ? Math.ceil(seconds) : null,
    daily,
  };
}

function readAnswer(body: unknown): LabelResult {
  const data = body as { choices?: { message?: { content?: string | null } }[] } | null;
  const content = data?.choices?.[0]?.message?.content ?? "";
  // Some models still put their reasoning first; keep only the JSON object.
  const text = content.replace(/<think>[\s\S]*?<\/think>/g, "");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { status: "failed", reason: "The AI's answer couldn't be read." };
  }

  const labels = parseLabels(parsed);
  return labels ? { status: "done", labels } : { status: "failed", reason: "The AI's answer was incomplete." };
}

async function readJson<T = unknown>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
