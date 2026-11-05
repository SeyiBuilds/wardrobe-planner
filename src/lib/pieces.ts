import type { SupabaseClient } from "@supabase/supabase-js";
import type { MeasuredColour } from "./colours";
import type { LabelResponse } from "./labelQueue";
import type { PreparedPhoto } from "./photo";
import type { Formality, Occasion, Pattern, PieceType } from "./pieceTypes";

export type Piece = {
  id: string;
  user_id: string;
  type: PieceType;
  name: string;
  colour_name: string;
  colours: MeasuredColour[];
  formality: Formality | null;
  occasions: Occasion[];
  pattern: Pattern | null;
  wears_before_wash: number | null;
  wears_since_wash: number;
  photo_path: string;
  label_status: "waiting" | "done" | "failed";
  reviewed: boolean;
  created_at: string;
  updated_at: string;
};

export type PieceChanges = Partial<
  Pick<
    Piece,
    "type" | "name" | "colour_name" | "formality" | "occasions" | "pattern" | "wears_before_wash" | "reviewed" | "label_status"
  >
>;

export class WardrobeError extends Error {}

const BUCKET = "wardrobe";
const PHOTO_LINK_SECONDS = 60 * 60 * 24;
const CONNECTION = "Check your connection and try again.";

export async function listPieces(client: SupabaseClient): Promise<Piece[]> {
  const { data, error } = await client.from("pieces").select("*").order("created_at", { ascending: false });
  if (error) throw new WardrobeError(`Your wardrobe couldn't be loaded. ${CONNECTION}`);
  return data as Piece[];
}

export async function addPiece(client: SupabaseClient, photo: PreparedPhoto): Promise<Piece> {
  const { data } = await client.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) throw new WardrobeError("You've been signed out. Sign in again to add photos.");

  const id = crypto.randomUUID();
  const path = `${userId}/${id}.jpg`;

  const upload = await client.storage.from(BUCKET).upload(path, photo.blob, { contentType: "image/jpeg", upsert: false });
  if (upload.error) throw new WardrobeError(`The photo couldn't be uploaded. ${CONNECTION}`);

  const { data: piece, error } = await client
    .from("pieces")
    .insert({ id, photo_path: path, colours: photo.colours })
    .select("*")
    .single();
  if (error || !piece) {
    await client.storage.from(BUCKET).remove([path]);
    throw new WardrobeError(`The piece couldn't be saved. ${CONNECTION}`);
  }
  return piece as Piece;
}

export async function savePiece(client: SupabaseClient, id: string, changes: PieceChanges): Promise<Piece> {
  const { data, error } = await client.from("pieces").update(changes).eq("id", id).select("*").single();
  if (error || !data) throw new WardrobeError(`Your changes couldn't be saved. ${CONNECTION}`);
  return data as Piece;
}

export async function removePiece(client: SupabaseClient, piece: Piece): Promise<void> {
  const { error } = await client.from("pieces").delete().eq("id", piece.id);
  if (error) throw new WardrobeError(`The piece couldn't be deleted. ${CONNECTION}`);
  // The row is gone either way; a photo left behind stays private in its owner's folder.
  await client.storage.from(BUCKET).remove([piece.photo_path]);
}

// Private photos are shown through short-lived signed links.
export async function photoLinks(client: SupabaseClient, paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await client.storage.from(BUCKET).createSignedUrls(paths, PHOTO_LINK_SECONDS);
  if (error || !data) return {};
  return Object.fromEntries(data.flatMap((entry) => (entry.path && entry.signedUrl ? [[entry.path, entry.signedUrl]] : [])));
}

export async function requestLabel(client: SupabaseClient, pieceId: string): Promise<LabelResponse> {
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { status: "error", reason: "You've been signed out. Sign in again." };

  let response: Response;
  try {
    response = await fetch("/api/label-piece", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ pieceId }),
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
  if (response.ok && body?.status === "done") return { status: "done", piece: body.piece as Piece };
  if (response.ok && body?.status === "failed") {
    return { status: "failed", reason: String(body.reason ?? ""), piece: body.piece as Piece | undefined };
  }
  return { status: "error", reason: typeof body?.reason === "string" ? body.reason : `The AI reader had a problem. ${CONNECTION}` };
}
