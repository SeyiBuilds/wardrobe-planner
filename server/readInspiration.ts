import { createClient } from "@supabase/supabase-js";
import { createGroqInspirationReader, type InspirationReader } from "./groq.js";

type Env = Record<string, string | undefined>;

type Deps = {
  env: Env;
  // Tests swap in a fake; production uses Groq.
  createReader?: (env: Env) => InspirationReader;
  fetch?: typeof fetch;
};

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

const defaultReader = (env: Env) =>
  createGroqInspirationReader({ apiKey: env.GROQ_API_KEY ?? "", model: env.GROQ_MODEL || undefined });

// Reads one waiting inspiration picture with AI, saves what was learned and deletes the picture.
// Runs as the signed-in user, so Supabase's row rules still decide what it can see and change.
export async function handleInspirationRequest(request: Request, deps: Deps): Promise<Response> {
  const { env } = deps;

  if (request.method !== "POST") return reply(405, { status: "failed", reason: "Use POST." });

  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return reply(401, { status: "failed", reason: "Sign in first." });

  let inspirationId: unknown;
  try {
    inspirationId = ((await request.json()) as { inspirationId?: unknown }).inspirationId;
  } catch {
    inspirationId = null;
  }
  if (typeof inspirationId !== "string" || !ID_PATTERN.test(inspirationId)) {
    return reply(400, { status: "failed", reason: "Send the picture's id." });
  }

  const supabaseUrl = env.VITE_SUPABASE_URL;
  const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey || !env.GROQ_API_KEY) {
    return reply(503, { status: "unavailable" });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: deps.fetch },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return reply(401, { status: "failed", reason: "Sign in again." });

  const { data: row, error: rowError } = await supabase
    .from("inspirations")
    .select("*")
    .eq("id", inspirationId)
    .maybeSingle();
  if (rowError) return reply(502, { status: "failed", reason: "Your inspiration couldn't be loaded." });
  if (!row) return reply(404, { status: "failed", reason: "That picture doesn't exist." });

  if (row.status === "done") return reply(200, { status: "done", inspiration: row });
  if (!row.photo_path) return reply(200, { status: "failed", reason: "This picture is gone. Add it again.", inspiration: row });

  const { data: photo, error: photoError } = await supabase.storage.from("wardrobe").download(row.photo_path);
  if (photoError || !photo) return reply(502, { status: "failed", reason: "The picture couldn't be loaded." });

  const read = (deps.createReader ?? defaultReader)(env);
  const result = await read({ bytes: new Uint8Array(await photo.arrayBuffer()), mimeType: "image/jpeg" });

  if (result.status === "waiting") return reply(429, result);

  // A picture the AI couldn't read is kept, so it can be tried again or removed.
  const changes =
    result.status === "done"
      ? {
          status: "done",
          day_type: result.reading.kindOfDay,
          formality: result.reading.formality,
          pieces: result.reading.pieces,
          photo_path: null,
        }
      : { status: "failed" };

  const { data: saved, error: saveError } = await supabase
    .from("inspirations")
    .update(changes)
    .eq("id", inspirationId)
    .select("*")
    .single();
  if (saveError || !saved) return reply(502, { status: "failed", reason: "The reading couldn't be saved." });

  if (result.status === "failed") return reply(200, { status: "failed", reason: result.reason, inspiration: saved });

  // Learn, then delete: once the reading is safe, the picture goes.
  const { error: removeError } = await supabase.storage.from("wardrobe").remove([row.photo_path]);
  if (removeError) console.warn(`An inspiration picture couldn't be deleted: ${removeError.message}`);

  return reply(200, { status: "done", inspiration: saved });
}
