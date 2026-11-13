import type { SupabaseClient } from "@supabase/supabase-js";
import type { LabelResponse } from "./labelQueue";
import type { PreparedPhoto } from "./photo";
import { WardrobeError } from "./pieces";
import type { Formality, Occasion } from "./pieceTypes";
import type { ReadingPiece, StyleOverrides } from "./styleProfile";

// One inspiration picture: waiting to be read, or what was learned from it once the picture is gone.
export type Inspiration = {
  id: string;
  user_id: string;
  photo_path: string | null;
  status: "waiting" | "done" | "failed";
  day_type: Occasion | null;
  formality: Formality | null;
  pieces: ReadingPiece[];
  created_at: string;
  updated_at: string;
};

const BUCKET = "wardrobe";
const CONNECTION = "Check your connection and try again.";

async function session(client: SupabaseClient) {
  const { data } = await client.auth.getSession();
  if (!data.session) throw new WardrobeError("You've been signed out. Sign in again.");
  return data.session;
}

export async function listInspirations(client: SupabaseClient): Promise<Inspiration[]> {
  const { data, error } = await client.from("inspirations").select("*").order("created_at", { ascending: false });
  if (error) throw new WardrobeError(`Your inspiration couldn't be loaded. ${CONNECTION}`);
  return data as Inspiration[];
}

// The picture waits privately in your own folder until it's read, then it's deleted.
export async function addInspiration(client: SupabaseClient, photo: PreparedPhoto): Promise<Inspiration> {
  const userId = (await session(client)).user.id;
  const id = crypto.randomUUID();
  const path = `${userId}/inspiration/${id}.jpg`;

  const upload = await client.storage.from(BUCKET).upload(path, photo.blob, { contentType: "image/jpeg", upsert: false });
  if (upload.error) throw new WardrobeError(`The picture couldn't be uploaded. ${CONNECTION}`);

  const { data, error } = await client.from("inspirations").insert({ id, photo_path: path }).select("*").single();
  if (error || !data) {
    await client.storage.from(BUCKET).remove([path]);
    throw new WardrobeError(`The picture couldn't be saved. ${CONNECTION}`);
  }
  return data as Inspiration;
}

export async function updateInspiration(
  client: SupabaseClient,
  id: string,
  changes: Partial<Pick<Inspiration, "day_type" | "status">>,
): Promise<Inspiration> {
  const { data, error } = await client.from("inspirations").update(changes).eq("id", id).select("*").single();
  if (error || !data) throw new WardrobeError(`That change couldn't be saved. ${CONNECTION}`);
  return data as Inspiration;
}

export async function removeInspiration(client: SupabaseClient, item: Inspiration): Promise<void> {
  const { error } = await client.from("inspirations").delete().eq("id", item.id);
  if (error) throw new WardrobeError(`That picture couldn't be removed. ${CONNECTION}`);
  if (item.photo_path) await client.storage.from(BUCKET).remove([item.photo_path]);
}

// Asks the server to read one waiting picture, in the shape the reading queue understands.
export async function requestRead(client: SupabaseClient, id: string): Promise<LabelResponse<Inspiration>> {
  const token = (await client.auth.getSession()).data.session?.access_token;
  if (!token) return { status: "error", reason: "You've been signed out. Sign in again." };

  let response: Response;
  try {
    response = await fetch("/api/read-inspiration", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ inspirationId: id }),
    });
  } catch {
    return { status: "error", reason: `The app couldn't reach the AI reader. ${CONNECTION}` };
  }

  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (response.status === 503) return { status: "unavailable" };
  if (response.status === 429) {
    return {
      status: "waiting",
      retryAfterSeconds: typeof body?.retryAfterSeconds === "number" ? body.retryAfterSeconds : null,
      daily: body?.daily === true,
    };
  }
  if (response.ok && body?.status === "done") return { status: "done", piece: body.inspiration as Inspiration };
  if (response.ok && body?.status === "failed") {
    return { status: "failed", reason: String(body.reason ?? ""), piece: body.inspiration as Inspiration | undefined };
  }
  return { status: "error", reason: typeof body?.reason === "string" ? body.reason : `The AI reader had a problem. ${CONNECTION}` };
}

export async function loadOverrides(client: SupabaseClient): Promise<StyleOverrides> {
  const { data, error } = await client.from("settings").select("style").maybeSingle();
  if (error) throw new WardrobeError(`Your style settings couldn't be loaded. ${CONNECTION}`);
  return (data?.style as StyleOverrides | undefined) ?? {};
}

export async function saveOverrides(client: SupabaseClient, overrides: StyleOverrides): Promise<StyleOverrides> {
  const userId = (await session(client)).user.id;
  const { data, error } = await client
    .from("settings")
    .upsert({ user_id: userId, style: overrides }, { onConflict: "user_id" })
    .select("style")
    .single();
  if (error || !data) throw new WardrobeError(`Your style settings couldn't be saved. ${CONNECTION}`);
  return data.style as StyleOverrides;
}
