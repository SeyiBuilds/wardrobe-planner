// @vitest-environment node
import type { InspirationResult } from "./groq";
import { handleInspirationRequest } from "./readInspiration";

const SUPABASE = "https://test-project.supabase.co";
const ID = "44444444-4444-4444-8444-444444444444";
const env = {
  VITE_SUPABASE_URL: SUPABASE,
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  GROQ_API_KEY: "test-groq-key",
};

const waiting = { id: ID, status: "waiting", photo_path: "user-1/inspiration/a.jpg", pieces: [] };

const reading = {
  kindOfDay: "church",
  formality: "formal",
  pieces: [{ kind: "suit", colour: "navy", patterned: false }],
} as const;

// A stand-in for Supabase's sign-in, database and storage endpoints.
function fakeSupabase(options: { row?: Record<string, unknown> | null; signedIn?: boolean } = {}) {
  const row = options.row === undefined ? { ...waiting } : options.row;
  const patches: Record<string, unknown>[] = [];
  const deleted: string[] = [];

  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    if (url.includes("/auth/v1/user")) {
      return options.signedIn === false ? json({ msg: "invalid JWT" }, 401) : json({ id: "user-1", aud: "authenticated" });
    }
    if (url.includes("/storage/v1/") && method === "DELETE") {
      deleted.push(...(JSON.parse(init?.body as string).prefixes as string[]));
      return json([]);
    }
    if (url.includes("/storage/v1/")) return new Response(new Uint8Array([9, 9, 9]), { status: 200 });
    if (url.includes("/rest/v1/inspirations") && method === "GET") {
      const wantsObject = headers.get("accept")?.includes("vnd.pgrst.object");
      if (wantsObject) return row ? json(row) : json({ message: "no rows" }, 406);
      return json(row ? [row] : []);
    }
    if (url.includes("/rest/v1/inspirations") && method === "PATCH") {
      const changes = JSON.parse(init?.body as string);
      patches.push(changes);
      return json({ ...row, ...changes });
    }
    return json({ message: `unexpected ${method} ${url}` }, 500);
  });

  return { fetch, patches, deleted };
}

function post(body: unknown, token: string | null = "user-token") {
  return new Request("https://app.test/api/read-inspiration", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

function readerReturning(result: InspirationResult) {
  const read = vi.fn(async () => result);
  return { read, createReader: () => read };
}

describe("handleInspirationRequest", () => {
  it("only takes POST", async () => {
    const response = await handleInspirationRequest(new Request("https://app.test/api/read-inspiration"), { env });

    expect(response.status).toBe(405);
  });

  it("asks you to sign in first", async () => {
    const response = await handleInspirationRequest(post({ inspirationId: ID }, null), { env });

    expect(response.status).toBe(401);
  });

  it("needs a real picture id", async () => {
    const response = await handleInspirationRequest(post({ inspirationId: "../../etc" }), { env });

    expect(response.status).toBe(400);
  });

  it("says when AI reading isn't set up", async () => {
    const response = await handleInspirationRequest(post({ inspirationId: ID }), { env: { ...env, GROQ_API_KEY: "" } });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });

  it("asks you to sign in again when your session has expired", async () => {
    const supabase = fakeSupabase({ signedIn: false });

    const response = await handleInspirationRequest(post({ inspirationId: ID }), { env, fetch: supabase.fetch });

    expect(response.status).toBe(401);
  });

  it("says when the picture doesn't exist", async () => {
    const supabase = fakeSupabase({ row: null });

    const response = await handleInspirationRequest(post({ inspirationId: ID }), { env, fetch: supabase.fetch });

    expect(response.status).toBe(404);
  });

  it("saves the reading, then deletes the picture", async () => {
    const supabase = fakeSupabase();
    const { read, createReader } = readerReturning({ status: "done", reading });

    const response = await handleInspirationRequest(post({ inspirationId: ID }), {
      env,
      fetch: supabase.fetch,
      createReader,
    });

    expect(read).toHaveBeenCalledWith({ bytes: new Uint8Array([9, 9, 9]), mimeType: "image/jpeg" });
    expect(supabase.patches).toEqual([
      { status: "done", day_type: "church", formality: "formal", pieces: reading.pieces, photo_path: null },
    ]);
    expect(supabase.deleted).toEqual(["user-1/inspiration/a.jpg"]);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "done", inspiration: { status: "done", photo_path: null } });
  });

  it("keeps the picture when the AI couldn't read it, so you can try again", async () => {
    const supabase = fakeSupabase();
    const { createReader } = readerReturning({ status: "failed", reason: "The AI couldn't find an outfit in this picture." });

    const response = await handleInspirationRequest(post({ inspirationId: ID }), {
      env,
      fetch: supabase.fetch,
      createReader,
    });

    expect(supabase.patches).toEqual([{ status: "failed" }]);
    expect(supabase.deleted).toEqual([]);
    expect(await response.json()).toMatchObject({ status: "failed", reason: "The AI couldn't find an outfit in this picture." });
  });

  it("passes on a wait when the allowance is used up, changing nothing", async () => {
    const supabase = fakeSupabase();
    const { createReader } = readerReturning({ status: "waiting", retryAfterSeconds: 30, daily: false });

    const response = await handleInspirationRequest(post({ inspirationId: ID }), {
      env,
      fetch: supabase.fetch,
      createReader,
    });

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ status: "waiting", retryAfterSeconds: 30, daily: false });
    expect(supabase.patches).toEqual([]);
  });

  it("doesn't read a picture twice", async () => {
    const supabase = fakeSupabase({ row: { ...waiting, status: "done", photo_path: null } });
    const { read, createReader } = readerReturning({ status: "done", reading });

    const response = await handleInspirationRequest(post({ inspirationId: ID }), {
      env,
      fetch: supabase.fetch,
      createReader,
    });

    expect(read).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ status: "done" });
  });

  it("says so when the picture has already gone", async () => {
    const supabase = fakeSupabase({ row: { ...waiting, photo_path: null } });
    const { read, createReader } = readerReturning({ status: "done", reading });

    const response = await handleInspirationRequest(post({ inspirationId: ID }), {
      env,
      fetch: supabase.fetch,
      createReader,
    });

    expect(read).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ status: "failed", reason: "This picture is gone. Add it again." });
  });
});
