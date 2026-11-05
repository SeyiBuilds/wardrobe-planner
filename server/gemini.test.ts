// @vitest-environment node
import { createGeminiLabeler } from "./gemini";
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

function answer(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

function geminiReply(labels: unknown) {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(labels) }] } }] };
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

describe("createGeminiLabeler", () => {
  it("sends the photo with the key in a header, not the address", async () => {
    const fetch = answer(geminiReply(goodLabels));
    await createGeminiLabeler({ apiKey: "test-key", model: "test-model", fetch })(photo);

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent");
    expect(url).not.toContain("test-key");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
    expect(body.contents[0].parts[0].inline_data).toEqual({ mime_type: "image/jpeg", data: "AQID" });
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("returns the labels from a good answer", async () => {
    const result = await createGeminiLabeler({ apiKey: "k", fetch: answer(geminiReply(goodLabels)) })(photo);

    expect(result).toEqual({ status: "done", labels: goodLabels });
  });

  it("reports a short wait when the per-minute limit is hit", async () => {
    const fetch = answer(
      { error: { status: "RESOURCE_EXHAUSTED", details: [{ "@type": "RetryInfo", retryDelay: "32.5s" }] } },
      429,
    );

    const result = await createGeminiLabeler({ apiKey: "k", fetch })(photo);

    expect(result).toEqual({ status: "waiting", retryAfterSeconds: 33, daily: false });
  });

  it("recognises the daily limit even when it suggests a short wait", async () => {
    const fetch = answer(
      {
        error: {
          details: [
            { "@type": "QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] },
            { "@type": "RetryInfo", retryDelay: "20s" },
          ],
        },
      },
      429,
    );

    const result = await createGeminiLabeler({ apiKey: "k", fetch })(photo);

    expect(result).toEqual({ status: "waiting", retryAfterSeconds: 20, daily: true });
  });

  it.each([
    ["a blocked photo", { promptFeedback: { blockReason: "OTHER" } }, /declined/],
    ["an answer that isn't JSON", { candidates: [{ content: { parts: [{ text: "a shirt" }] } }] }, /couldn't be read/],
    ["an incomplete answer", geminiReply({ type: "top" }), /incomplete/],
  ])("fails cleanly on %s", async (_name, body, reason) => {
    const result = await createGeminiLabeler({ apiKey: "k", fetch: answer(body) })(photo);

    expect(result.status).toBe("failed");
    expect(result.status === "failed" && result.reason).toMatch(reason);
  });

  it("fails cleanly when the service is unreachable", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("offline");
    });

    const result = await createGeminiLabeler({ apiKey: "k", fetch })(photo);

    expect(result).toEqual({ status: "failed", reason: "The AI service couldn't be reached." });
  });

  it("passes on the service's own error message", async () => {
    const fetch = answer({ error: { message: "API key not valid." } }, 400);

    const result = await createGeminiLabeler({ apiKey: "k", fetch })(photo);

    expect(result).toEqual({ status: "failed", reason: "API key not valid." });
  });
});
