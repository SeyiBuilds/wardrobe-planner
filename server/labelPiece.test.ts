// @vitest-environment node
import { handleLabelRequest } from "./labelPiece";
import type { LabelResult } from "./labels";

const SUPABASE = "https://test-project.supabase.co";
const PIECE_ID = "33333333-3333-4333-8333-333333333333";
const env = {
  VITE_SUPABASE_URL: SUPABASE,
  VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  GROQ_API_KEY: "test-groq-key",
};

const waitingPiece = {
  id: PIECE_ID,
  type: "top",
  name: "",
  photo_path: "user-1/piece.jpg",
  label_status: "waiting",
  reviewed: false,
  wears_before_wash: 1,
};

// A stand-in for Supabase's sign-in, database and storage endpoints.
function fakeSupabase(options: { piece?: Record<string, unknown> | null; signedIn?: boolean } = {}) {
  const piece = options.piece === undefined ? { ...waitingPiece } : options.piece;
  const patches: Record<string, unknown>[] = [];

  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

    if (url.includes("/auth/v1/user")) {
      return options.signedIn === false ? json({ msg: "invalid JWT" }, 401) : json({ id: "user-1", aud: "authenticated" });
    }
    if (url.includes("/storage/v1/")) return new Response(new Uint8Array([9, 9, 9]), { status: 200 });
    if (url.includes("/rest/v1/pieces") && method === "GET") {
      const wantsObject = headers.get("accept")?.includes("vnd.pgrst.object");
      if (wantsObject) return piece ? json(piece) : json({ message: "no rows" }, 406);
      return json(piece ? [piece] : []);
    }
    if (url.includes("/rest/v1/pieces") && method === "PATCH") {
      const changes = JSON.parse(init?.body as string);
      patches.push(changes);
      return json({ ...piece, ...changes });
    }
    return json({ message: `unexpected ${method} ${url}` }, 500);
  });

  return { fetch, patches };
}

function post(body: unknown, token: string | null = "user-token") {
  return new Request("https://app.test/api/label-piece", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

function labelerReturning(result: LabelResult) {
  const label = vi.fn(async () => result);
  return { label, createLabeler: () => label };
}

const doneResult: LabelResult = {
  status: "done",
  labels: {
    type: "trousers",
    name: "Grey wool trousers",
    colourName: "grey",
    formality: "formal",
    occasions: ["corporate"],
    pattern: "plain",
  },
};

describe("handleLabelRequest", () => {
  it("only accepts POST", async () => {
    const response = await handleLabelRequest(new Request("https://app.test/api/label-piece"), { env });

    expect(response.status).toBe(405);
  });

  it("refuses requests without a sign-in token", async () => {
    const response = await handleLabelRequest(post({ pieceId: PIECE_ID }, null), { env });

    expect(response.status).toBe(401);
  });

  it("refuses a malformed piece id", async () => {
    const response = await handleLabelRequest(post({ pieceId: "../../etc" }), { env });

    expect(response.status).toBe(400);
  });

  it("says the AI is unavailable until its key is set", async () => {
    const response = await handleLabelRequest(post({ pieceId: PIECE_ID }), {
      env: { ...env, GROQ_API_KEY: undefined },
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });

  it("refuses a token Supabase doesn't accept", async () => {
    const supabase = fakeSupabase({ signedIn: false });
    const { label, createLabeler } = labelerReturning(doneResult);

    const response = await handleLabelRequest(post({ pieceId: PIECE_ID }), { env, fetch: supabase.fetch, createLabeler });

    expect(response.status).toBe(401);
    expect(label).not.toHaveBeenCalled();
  });

  it("says when the piece doesn't exist or isn't yours", async () => {
    const supabase = fakeSupabase({ piece: null });

    const response = await handleLabelRequest(post({ pieceId: PIECE_ID }), {
      env,
      fetch: supabase.fetch,
      createLabeler: labelerReturning(doneResult).createLabeler,
    });

    expect(response.status).toBe(404);
  });

  it("saves the labels and the type's usual wear count", async () => {
    const supabase = fakeSupabase();
    const { label, createLabeler } = labelerReturning(doneResult);

    const response = await handleLabelRequest(post({ pieceId: PIECE_ID }), { env, fetch: supabase.fetch, createLabeler });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(label).toHaveBeenCalledWith({ bytes: new Uint8Array([9, 9, 9]), mimeType: "image/jpeg" });
    expect(supabase.patches).toEqual([
      {
        type: "trousers",
        name: "Grey wool trousers",
        colour_name: "grey",
        formality: "formal",
        occasions: ["corporate"],
        pattern: "plain",
        wears_before_wash: 2,
        label_status: "done",
      },
    ]);
    expect(body.status).toBe("done");
    expect(body.piece.name).toBe("Grey wool trousers");
  });

  it("never overwrites a piece you've already checked", async () => {
    const supabase = fakeSupabase({ piece: { ...waitingPiece, reviewed: true, name: "My shirt" } });
    const { label, createLabeler } = labelerReturning(doneResult);

    const response = await handleLabelRequest(post({ pieceId: PIECE_ID }), { env, fetch: supabase.fetch, createLabeler });

    expect((await response.json()).piece.name).toBe("My shirt");
    expect(label).not.toHaveBeenCalled();
    expect(supabase.patches).toEqual([]);
  });

  it("passes a rate limit back without changing the piece", async () => {
    const supabase = fakeSupabase();
    const { createLabeler } = labelerReturning({ status: "waiting", retryAfterSeconds: 30, daily: false });

    const response = await handleLabelRequest(post({ pieceId: PIECE_ID }), { env, fetch: supabase.fetch, createLabeler });

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ status: "waiting", retryAfterSeconds: 30, daily: false });
    expect(supabase.patches).toEqual([]);
  });

  it("marks the piece so you can fill it in yourself when reading fails", async () => {
    const supabase = fakeSupabase();
    const { createLabeler } = labelerReturning({ status: "failed", reason: "The AI declined to read this photo." });

    const response = await handleLabelRequest(post({ pieceId: PIECE_ID }), { env, fetch: supabase.fetch, createLabeler });
    const body = await response.json();

    expect(supabase.patches).toEqual([{ label_status: "failed" }]);
    expect(body).toMatchObject({ status: "failed", reason: "The AI declined to read this photo." });
  });
});
