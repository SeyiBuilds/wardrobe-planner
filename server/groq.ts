import { INSPIRATION_PROMPT, INSPIRATION_SCHEMA, parseInspiration, type InspirationReading } from "./inspiration.js";
import { LABEL_PROMPT, LABEL_SCHEMA, parseLabels, type Labeler } from "./labels.js";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
export const DEFAULT_GROQ_MODEL = "qwen/qwen3.8-27b";

type GroqOptions = {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
};

type Photo = { bytes: Uint8Array; mimeType: string };

export type ReadResult<T> =
  | { status: "done"; value: T }
  | { status: "waiting"; retryAfterSeconds: number | null; daily: boolean }
  | { status: "failed"; reason: string };

// What one kind of reading asks for, and how its answer is checked.
type Task<T> = {
  prompt: string;
  schema: object;
  schemaName: string;
  parse: (raw: unknown) => T | null;
  // Said when the answer arrives but doesn't hold what was asked for.
  incomplete: string;
};

type GroqError = { error?: { message?: string; code?: string; type?: string } };

// How the request asks for the answer: as the strict schema or plain JSON, and with or without thinking first.
type Attempt = { mode: "schema" | "json"; think: boolean };

// Thinking first reads the photo more carefully, at the cost of a few seconds and more of the free allowance.
export const THINKING_EFFORT = "medium";

function createGroqReader<T>(task: Task<T>, { apiKey, model = DEFAULT_GROQ_MODEL, fetch: fetchFn = fetch }: GroqOptions) {
  return async ({ bytes, mimeType }: Photo): Promise<ReadResult<T>> => {
    const image = `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;

    // Start with the strict schema and thinking. Groq's docs disagree on which models support each,
    // so if the model refuses one, drop just that one and ask again.
    let attempt: Attempt = { mode: "schema", think: true };
    let response = await send(fetchFn, apiKey, body(task, model, image, attempt));
    for (let fallbacks = 0; response?.status === 400 && fallbacks < 2; fallbacks++) {
      const message = (await readJson<GroqError>(response.clone()))?.error?.message ?? "";
      const next = fallback(attempt, message);
      if (!next) break;
      console.warn(`Groq refused a setting, trying again without it: ${message}`);
      attempt = next;
      response = await send(fetchFn, apiKey, body(task, model, image, attempt));
    }

    if (!response) return { status: "failed", reason: "The AI service couldn't be reached." };
    if (response.status === 429) return rateLimited(response, await readJson<GroqError>(response));
    if (!response.ok) {
      const error = await readJson<GroqError>(response);
      return { status: "failed", reason: error?.error?.message ?? `The AI service answered ${response.status}.` };
    }

    return readAnswer(task, await readJson(response));
  };
}

export function createGroqLabeler(options: GroqOptions): Labeler {
  const read = createGroqReader(
    {
      prompt: LABEL_PROMPT,
      schema: LABEL_SCHEMA,
      schemaName: "piece_labels",
      parse: parseLabels,
      incomplete: "The AI's answer was incomplete.",
    },
    options,
  );
  return async (photo) => {
    const result = await read(photo);
    return result.status === "done" ? { status: "done", labels: result.value } : result;
  };
}

export type InspirationResult =
  | { status: "done"; reading: InspirationReading }
  | { status: "waiting"; retryAfterSeconds: number | null; daily: boolean }
  | { status: "failed"; reason: string };

export type InspirationReader = (photo: Photo) => Promise<InspirationResult>;

export function createGroqInspirationReader(options: GroqOptions): InspirationReader {
  const read = createGroqReader(
    {
      prompt: INSPIRATION_PROMPT,
      schema: INSPIRATION_SCHEMA,
      schemaName: "inspiration_reading",
      parse: parseInspiration,
      incomplete: "The AI couldn't find an outfit in this picture.",
    },
    options,
  );
  return async (photo) => {
    const result = await read(photo);
    return result.status === "done" ? { status: "done", reading: result.value } : result;
  };
}

// Give up the schema before thinking: plain JSON still works with thinking, and the answer is checked either way.
function fallback(attempt: Attempt, message: string): Attempt | null {
  if (attempt.mode === "schema" && /json_schema|response_format|strict/i.test(message)) return { ...attempt, mode: "json" };
  if (attempt.think && /reasoning/i.test(message)) return { ...attempt, think: false };
  return null;
}

function body<T>(task: Task<T>, model: string, image: string, { mode, think }: Attempt) {
  const instructions =
    mode === "schema"
      ? task.prompt
      : `${task.prompt}\n\nAnswer with only a JSON object matching this JSON Schema:\n${JSON.stringify(task.schema)}`;

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
    // Hidden thinking keeps the reply to just the JSON answer. Qwen's guidance is a temperature
    // of 0.6 when thinking, since very low values can make it repeat itself.
    ...(think
      ? { reasoning_effort: THINKING_EFFORT, reasoning_format: "hidden", temperature: 0.6, top_p: 0.95 }
      : { reasoning_effort: "none", temperature: 0.2 }),
    response_format:
      mode === "schema"
        ? { type: "json_schema", json_schema: { name: task.schemaName, strict: true, schema: task.schema } }
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

function rateLimited(response: Response, body: GroqError | null): { status: "waiting"; retryAfterSeconds: number | null; daily: boolean } {
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

function readAnswer<T>(task: Task<T>, body: unknown): ReadResult<T> {
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

  const value = task.parse(parsed);
  return value ? { status: "done", value } : { status: "failed", reason: task.incomplete };
}

async function readJson<T = unknown>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
