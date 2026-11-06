// @vitest-environment node
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const OWNER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";

// A small stand-in for the parts of Supabase the migration relies on.
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;

  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;

  create schema storage;
  create table storage.buckets (
    id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text, name text
  );
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  grant usage on schema storage to anon, authenticated;
  grant select, insert, delete on storage.objects to anon, authenticated;
  grant execute on function storage.foldername(text) to anon, authenticated;

  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
`;

let db: PGlite;

async function as(role: "anon" | "authenticated", userId: string, query: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.sub', '${userId}', false); set role ${role};`);
  try {
    return await db.query<Record<string, unknown>>(query, params);
  } finally {
    await db.exec("reset role;");
  }
}

function addPiece(userId: string, path = `${userId}/photo.jpg`) {
  return as(
    "authenticated",
    userId,
    "insert into public.pieces (photo_path) values ($1) returning id, user_id",
    [path],
  );
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(`insert into auth.users (id) values ('${OWNER}'), ('${STRANGER}');`);
  await db.exec(readFileSync(join(__dirname, "migrations", "0001_wardrobe.sql"), "utf8"));
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec("reset role; delete from public.pieces; delete from storage.objects;");
});

describe("pieces table", () => {
  it("files a new piece under the signed-in user without being told", async () => {
    const { rows } = await addPiece(OWNER);

    expect(rows[0].user_id).toBe(OWNER);
  });

  it("shows you your own pieces", async () => {
    await addPiece(OWNER);

    const { rows } = await as("authenticated", OWNER, "select id from public.pieces");

    expect(rows).toHaveLength(1);
  });

  it("hides your pieces from another signed-in user", async () => {
    await addPiece(OWNER);

    const { rows } = await as("authenticated", STRANGER, "select id from public.pieces");

    expect(rows).toHaveLength(0);
  });

  it("refuses anyone who isn't signed in", async () => {
    await addPiece(OWNER);

    await expect(as("anon", "", "select id from public.pieces")).rejects.toThrow(/permission denied/);
    await expect(
      as("anon", "", "insert into public.pieces (photo_path) values ('x')"),
    ).rejects.toThrow(/permission denied/);
  });

  it("stops another user changing or deleting your pieces", async () => {
    const { rows } = await addPiece(OWNER);
    const id = rows[0].id;

    const changed = await as("authenticated", STRANGER, "update public.pieces set name = 'mine now' where id = $1", [id]);
    const removed = await as("authenticated", STRANGER, "delete from public.pieces where id = $1", [id]);

    expect(changed.affectedRows).toBe(0);
    expect(removed.affectedRows).toBe(0);
  });

  it("stops you filing a piece under someone else", async () => {
    await expect(
      as("authenticated", OWNER, "insert into public.pieces (user_id, photo_path) values ($1, 'x')", [STRANGER]),
    ).rejects.toThrow(/row-level security/);
  });

  it("stops you handing your piece to someone else", async () => {
    const { rows } = await addPiece(OWNER);

    await expect(
      as("authenticated", OWNER, "update public.pieces set user_id = $1 where id = $2", [STRANGER, rows[0].id]),
    ).rejects.toThrow(/row-level security/);
  });

  it("rejects values outside the agreed lists", async () => {
    await expect(
      as("authenticated", OWNER, "insert into public.pieces (photo_path, type) values ('x', 'cape')"),
    ).rejects.toThrow(/check constraint/);
    await expect(
      as("authenticated", OWNER, "insert into public.pieces (photo_path, occasions) values ('x', '{beach}')"),
    ).rejects.toThrow(/check constraint/);
    await expect(
      as("authenticated", OWNER, "insert into public.pieces (photo_path, wears_before_wash) values ('x', 0)"),
    ).rejects.toThrow(/check constraint/);
  });

  it("updates the timestamp when a piece changes", async () => {
    const { rows } = await addPiece(OWNER);
    await db.exec(`update public.pieces set updated_at = '2020-01-01' where id = '${rows[0].id}'`);

    const after = await as(
      "authenticated",
      OWNER,
      "update public.pieces set name = 'Navy shirt' where id = $1 returning updated_at",
      [rows[0].id],
    );

    expect((after.rows[0].updated_at as Date).getFullYear()).toBeGreaterThan(2020);
  });
});

describe("wardrobe photos", () => {
  const insert = "insert into storage.objects (bucket_id, name) values ($1, $2)";
  const select = "select name from storage.objects";

  it("creates a private bucket that only takes small JPEGs", async () => {
    const { rows } = await db.query<Record<string, unknown>>(
      "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'wardrobe'",
    );

    expect(rows[0]).toEqual({
      public: false,
      file_size_limit: 2097152,
      allowed_mime_types: ["image/jpeg"],
    });
  });

  it("lets you add and read photos in your own folder", async () => {
    await as("authenticated", OWNER, insert, ["wardrobe", `${OWNER}/shirt.jpg`]);

    const { rows } = await as("authenticated", OWNER, select);

    expect(rows).toEqual([{ name: `${OWNER}/shirt.jpg` }]);
  });

  it("stops you adding photos to someone else's folder", async () => {
    await expect(
      as("authenticated", STRANGER, insert, ["wardrobe", `${OWNER}/planted.jpg`]),
    ).rejects.toThrow(/row-level security/);
  });

  it("hides your photos from other users and from anyone signed out", async () => {
    await as("authenticated", OWNER, insert, ["wardrobe", `${OWNER}/shirt.jpg`]);

    const stranger = await as("authenticated", STRANGER, select);
    const signedOut = await as("anon", "", select);

    expect(stranger.rows).toHaveLength(0);
    expect(signedOut.rows).toHaveLength(0);
  });

  it("stops another user deleting your photos", async () => {
    await as("authenticated", OWNER, insert, ["wardrobe", `${OWNER}/shirt.jpg`]);

    const removed = await as("authenticated", STRANGER, "delete from storage.objects");

    expect(removed.affectedRows).toBe(0);
  });

  it("only covers the wardrobe bucket", async () => {
    await expect(
      as("authenticated", OWNER, insert, ["other", `${OWNER}/shirt.jpg`]),
    ).rejects.toThrow(/row-level security/);
  });
});
