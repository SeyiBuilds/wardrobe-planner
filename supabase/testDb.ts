import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const OWNER = "11111111-1111-4111-8111-111111111111";
export const STRANGER = "22222222-2222-4222-8222-222222222222";

// A small stand-in for the parts of Supabase the migrations rely on.
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
  -- Supabase hands new tables and functions to both roles; the migrations must take back what they don't want.
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

// A database with the Supabase stand-in, two users and the named migrations applied in order.
export async function createTestDb(migrations: string[]) {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(`insert into auth.users (id) values ('${OWNER}'), ('${STRANGER}');`);
  for (const name of migrations) {
    await db.exec(readFileSync(join(__dirname, "migrations", name), "utf8"));
  }

  // Runs a query as a signed-in user (or signed out, with "anon"), the way Supabase does.
  async function as(role: "anon" | "authenticated", userId: string, query: string, params: unknown[] = []) {
    await db.exec(`reset role; select set_config('request.jwt.sub', '${userId}', false); set role ${role};`);
    try {
      return await db.query<Record<string, unknown>>(query, params);
    } finally {
      await db.exec("reset role;");
    }
  }

  return { db, as };
}
