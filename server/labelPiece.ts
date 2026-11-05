import { createClient } from "@supabase/supabase-js";
import { defaultWearsFor } from "../src/lib/pieceTypes.js";
import { createGroqLabeler } from "./groq.js";
import type { Labeler } from "./labels.js";

type Env = Record<string, string | undefined>;

type Deps = {
  env: Env;
  // Tests swap in a fake; production uses Groq.
  createLabeler?: (env: Env) => Labeler;
  fetch?: typeof fetch;
};

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

const defaultLabeler = (env: Env) =>
  createGroqLabeler({ apiKey: env.GROQ_API_KEY ?? "", model: env.GROQ_MODEL || undefined });

// Reads one waiting piece's photo with AI and saves the labels. Runs as the signed-in user,
// so Supabase's row rules still decide what it can see and change.
export async function handleLabelRequest(request: Request, deps: Deps): Promise<Response> {
  const { env } = deps;

  if (request.method !== "POST") return reply(405, { status: "failed", reason: "Use POST." });

  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return reply(401, { status: "failed", reason: "Sign in first." });

  let pieceId: unknown;
  try {
    pieceId = ((await request.json()) as { pieceId?: unknown }).pieceId;
  } catch {
    pieceId = null;
  }
  if (typeof pieceId !== "string" || !ID_PATTERN.test(pieceId)) {
    return reply(400, { status: "failed", reason: "Send the piece's id." });
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

  const { data: piece, error: pieceError } = await supabase
    .from("pieces")
    .select("*")
    .eq("id", pieceId)
    .maybeSingle();
  if (pieceError) return reply(502, { status: "failed", reason: "The wardrobe couldn't be read." });
  if (!piece) return reply(404, { status: "failed", reason: "That piece doesn't exist." });

  // Never overwrite what you've already checked or filled in yourself.
  if (piece.reviewed || piece.label_status === "done") return reply(200, { status: "done", piece });

  const { data: photo, error: photoError } = await supabase.storage.from("wardrobe").download(piece.photo_path);
  if (photoError || !photo) return reply(502, { status: "failed", reason: "The photo couldn't be loaded." });

  const label = (deps.createLabeler ?? defaultLabeler)(env);
  const result = await label({ bytes: new Uint8Array(await photo.arrayBuffer()), mimeType: "image/jpeg" });

  if (result.status === "waiting") return reply(429, result);

  const changes =
    result.status === "done"
      ? {
          type: result.labels.type,
          name: result.labels.name,
          colour_name: result.labels.colourName,
          formality: result.labels.formality,
          occasions: result.labels.occasions,
          pattern: result.labels.pattern,
          wears_before_wash: defaultWearsFor(result.labels.type),
          label_status: "done",
        }
      : { label_status: "failed" };

  const { data: saved, error: saveError } = await supabase
    .from("pieces")
    .update(changes)
    .eq("id", pieceId)
    .select("*")
    .single();
  if (saveError || !saved) return reply(502, { status: "failed", reason: "The labels couldn't be saved." });

  return result.status === "done"
    ? reply(200, { status: "done", piece: saved })
    : reply(200, { status: "failed", reason: result.reason, piece: saved });
}
