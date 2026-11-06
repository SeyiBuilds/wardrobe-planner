// @vitest-environment node
import { createGroqLabeler } from "./groq";
import { parseLabels } from "./labels";

const photo = { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" };

const goodLabels = {
  type: "top",
  name: "Navy Oxford shirt",
  colourName: "navy",
  formality: "smart",
  occasions: ["corporate", "casual"],
  pattern: "plain",
};

function reply(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function answer(content: string) {
  return { choices: [{ message: { role: "assistant", content } }] };
}

// Answers each request in turn from `responses`.
function fakeFetch(...responses: Response[]) {
  return vi.fn(async () => responses.shift() ?? reply({ error: { message: "no more replies" } }, 500));
}

function sentBody(fetch: ReturnType<typeof fakeFetch>, call = 0) {
  const [, init] = fetch.mock.calls[call] as unknown as [string, RequestInit];
  return JSON.parse(init.body as string);
}

describe("parseLabels", () => {
  it("accepts a complete answer", () => {
    expect(parseLabels(goodLabels)).toEqual(goodLabels);
  });

  it("tidies spacing and drops repeated or unknown occasions", () => {
    const labels = parseLabels({
      ...goodLabels,
      name: "  Navy   Oxford shirt ",
      occasions: ["casual", "casual", "beach"],
    });

    expect(labels?.name).toBe("Navy Oxford shirt");
    expect(labels?.occasions).toEqual(["casual"]);
  });

  it.each([
    ["an unknown type", { ...goodLabels, type: "cape" }],
    ["a missing name", { ...goodLabels, name: "   " }],
    ["an unknown formality", { ...goodLabels, formality: "black tie" }],
    ["no occasions list", { ...goodLabels, occasions: "casual" }],
    ["something that isn't an object", "a shirt"],
  ])("rejects %s", (_name, raw) => {
    expect(parseLabels(raw)).toBeNull();
  });
});

describe("createGroqLabeler", () => {
  it("sends the photo with the key in a header and asks for the strict schema", async () => {
    const fetch = fakeFetch(reply(answer(JSON.stringify(goodLabels))));
    await createGroqLabeler({ apiKey: "test-key", model: "test-model", fetch })(photo);

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const body = sentBody(fetch);
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(url).not.toContain("test-key");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    expect(body.model).toBe("test-model");
    expect(body.messages[0].content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,AQID" } });
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.reasoning_effort).toBe("none");
  });

  it("returns the labels from a good answer", async () => {
    const result = await createGroqLabeler({ apiKey: "k", fetch: fakeFetch(reply(answer(JSON.stringify(goodLabels)))) })(photo);

    expect(result).toEqual({ status: "done", labels: goodLabels });
  });

  it("ignores reasoning the model writes before its answer", async () => {
    const content = `<think>It looks like a shirt.</think>\n${JSON.stringify(goodLabels)}`;

    const result = await createGroqLabeler({ apiKey: "k", fetch: fakeFetch(reply(answer(content))) })(photo);

    expect(result).toEqual({ status: "done", labels: goodLabels });
  });

  it("falls back to plain JSON when the model won't take the schema", async () => {
    const fetch = fakeFetch(
      reply({ error: { message: "response_format json_schema is not supported for this model" } }, 400),
      reply(answer(JSON.stringify(goodLabels))),
    );

    const result = await createGroqLabeler({ apiKey: "k", fetch })(photo);

    expect(result).toEqual({ status: "done", labels: goodLabels });
    expect(sentBody(fetch, 1).response_format).toEqual({ type: "json_object" });
    expect(sentBody(fetch, 1).messages[0].content[0].text).toContain('"colourName"');
  });

  it("doesn't retry other bad requests", async () => {
    const fetch = fakeFetch(reply({ error: { message: "Invalid API Key" } }, 400));

    const result = await createGroqLabeler({ apiKey: "k", fetch })(photo);

    expect(result).toEqual({ status: "failed", reason: "Invalid API Key" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("reports a short wait when the per-minute limit is hit", async () => {
    const fetch = fakeFetch(
      reply(
        { error: { message: "Rate limit reached for model on requests per minute (RPM)", code: "rate_limit_exceeded" } },
        429,
        { "retry-after": "7.2" },
      ),
    );

    const result = await createGroqLabeler({ apiKey: "k", fetch })(photo);

    expect(result).toEqual({ status: "waiting", retryAfterSeconds: 8, daily: false });
  });

  it("recognises the daily limit", async () => {
    const fetch = fakeFetch(
      reply({ error: { message: "Rate limit reached for model on requests per day (RPD): Limit 1000" } }, 429, {
        "retry-after": "30",
      }),
    );

    const result = await createGroqLabeler({ apiKey: "k", fetch })(photo);

    expect(result).toEqual({ status: "waiting", retryAfterSeconds: 30, daily: true });
  });

  it.each([
    ["an answer that isn't JSON", answer("It's a navy shirt."), /couldn't be read/],
    ["an incomplete answer", answer(JSON.stringify({ type: "top" })), /incomplete/],
    ["an empty answer", { choices: [] }, /couldn't be read/],
  ])("fails cleanly on %s", async (_name, body, reason) => {
    const result = await createGroqLabeler({ apiKey: "k", fetch: fakeFetch(reply(body)) })(photo);

    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.reason).toMatch(reason);
  });

  it("fails cleanly when the service is unreachable", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("offline");
    });

    const result = await createGroqLabeler({ apiKey: "k", fetch })(photo);

    expect(result).toEqual({ status: "failed", reason: "The AI service couldn't be reached." });
  });
});
