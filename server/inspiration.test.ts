// @vitest-environment node
import { createGroqInspirationReader } from "./groq";
import { INSPIRATION_PROMPT, INSPIRATION_SCHEMA, parseInspiration } from "./inspiration";

const photo = { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" };

const goodReading = {
  kindOfDay: "corporate",
  formality: "smart",
  pieces: [
    { kind: "top", colour: "white", patterned: false },
    { kind: "trousers", colour: "navy", patterned: false },
    { kind: "shoes", colour: "brown", patterned: false },
  ],
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("parseInspiration", () => {
  it("accepts a complete reading", () => {
    expect(parseInspiration(goodReading)).toEqual(goodReading);
  });

  it("drops pieces with unknown kinds or colours, but keeps the rest", () => {
    const reading = parseInspiration({
      ...goodReading,
      pieces: [...goodReading.pieces, { kind: "cape", colour: "navy", patterned: false }, { kind: "top", colour: "sparkly", patterned: false }],
    });

    expect(reading?.pieces).toEqual(goodReading.pieces);
  });

  it("reads a missing pattern as plain", () => {
    const reading = parseInspiration({ ...goodReading, pieces: [{ kind: "top", colour: "white" }] });

    expect(reading?.pieces).toEqual([{ kind: "top", colour: "white", patterned: false }]);
  });

  it.each([
    ["no pieces at all", { ...goodReading, pieces: [] }],
    ["an unknown kind of day", { ...goodReading, kindOfDay: "beach" }],
    ["an unknown formality", { ...goodReading, formality: "black tie" }],
    ["something that isn't an object", "an outfit"],
  ])("rejects %s", (_name, raw) => {
    expect(parseInspiration(raw)).toBeNull();
  });

  it("keeps at most eight pieces", () => {
    const pieces = Array.from({ length: 12 }, () => ({ kind: "accessory", colour: "gold", patterned: false }));

    expect(parseInspiration({ ...goodReading, pieces })?.pieces).toHaveLength(8);
  });
});

describe("the inspiration prompt", () => {
  it("tells the AI to describe one outfit, ignore text and never copy", () => {
    expect(INSPIRATION_PROMPT).toMatch(/one outfit/i);
    expect(INSPIRATION_PROMPT).toMatch(/Ignore any text/);
    expect(INSPIRATION_PROMPT).toMatch(/- formal:/);
  });

  it("only allows colours from the shared list", () => {
    const colour = INSPIRATION_SCHEMA.properties.pieces.items.properties.colour;
    expect(colour.enum).toContain("navy");
    expect(colour.enum).toContain("light blue");
  });
});

describe("createGroqInspirationReader", () => {
  it("sends the picture with the inspiration prompt and returns the reading", async () => {
    const fetch = vi.fn(async () => reply({ choices: [{ message: { content: JSON.stringify(goodReading) } }] }));

    const result = await createGroqInspirationReader({ apiKey: "k", fetch })(photo);

    expect(result).toEqual({ status: "done", reading: goodReading });
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages[0].content[0].text).toBe(INSPIRATION_PROMPT);
    expect(body.response_format.json_schema.name).toBe("inspiration_reading");
    expect(body.reasoning_format).toBe("hidden");
  });

  it("says when it couldn't find an outfit", async () => {
    const fetch = vi.fn(async () =>
      reply({ choices: [{ message: { content: JSON.stringify({ ...goodReading, pieces: [] }) } }] }),
    );

    const result = await createGroqInspirationReader({ apiKey: "k", fetch })(photo);

    expect(result).toEqual({ status: "failed", reason: "The AI couldn't find an outfit in this picture." });
  });

  it("passes on a wait when the allowance runs out", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: "Rate limit reached on tokens per day (TPD)" } }), {
          status: 429,
          headers: { "retry-after": "600" },
        }),
    );

    const result = await createGroqInspirationReader({ apiKey: "k", fetch })(photo);

    expect(result).toEqual({ status: "waiting", retryAfterSeconds: 600, daily: true });
  });
});
