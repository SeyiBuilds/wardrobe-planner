import { LABEL_PROMPT, LABEL_SCHEMA, parseLabels, type Labeler, type LabelResult } from "./labels.js";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

type GeminiOptions = {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
};

type GeminiError = {
  error?: {
    message?: string;
    status?: string;
    details?: { "@type"?: string; retryDelay?: string; violations?: { quotaId?: string }[] }[];
  };
};

export function createGeminiLabeler({ apiKey, model = DEFAULT_GEMINI_MODEL, fetch: fetchFn = fetch }: GeminiOptions): Labeler {
  return async ({ bytes, mimeType }) => {
    let response: Response;
    try {
      response = await fetchFn(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inline_data: { mime_type: mimeType, data: Buffer.from(bytes).toString("base64") } },
                { text: LABEL_PROMPT },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: LABEL_SCHEMA,
          },
        }),
      });
    } catch {
      return { status: "failed", reason: "The AI service couldn't be reached." };
    }

    if (response.status === 429) return rateLimited(await readJson<GeminiError>(response));
    if (!response.ok) {
      const body = await readJson<GeminiError>(response);
      return { status: "failed", reason: body?.error?.message ?? `The AI service answered ${response.status}.` };
    }

    return readAnswer(await readJson(response));
  };
}

function rateLimited(body: GeminiError | null): LabelResult {
  const details = body?.error?.details ?? [];
  const delay = details.find((detail) => detail.retryDelay)?.retryDelay;
  const seconds = delay ? Number.parseFloat(delay) : Number.NaN;
  // A per-day quota won't recover in seconds, whatever retryDelay says.
  const daily = details.some((detail) =>
    detail.violations?.some((violation) => /per.?day/i.test(violation.quotaId ?? "")),
  );

  return {
    status: "waiting",
    retryAfterSeconds: Number.isFinite(seconds) ? Math.ceil(seconds) : null,
    daily,
  };
}

function readAnswer(body: unknown): LabelResult {
  const data = body as {
    promptFeedback?: { blockReason?: string };
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  } | null;

  if (data?.promptFeedback?.blockReason) {
    return { status: "failed", reason: "The AI declined to read this photo." };
  }

  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
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
