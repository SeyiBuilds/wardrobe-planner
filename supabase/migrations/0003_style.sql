-- Your style: what was learned from each inspiration picture.
-- Run this once in the Supabase SQL Editor, after 0002_planner.sql.
--
-- Pictures are only kept until the AI has read them. After that, photo_path is cleared,
-- the file is deleted, and only the reading below stays.

create table public.inspirations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The picture, waiting privately in your folder until it's read. Null once it's gone.
  photo_path text,
  status text not null default 'waiting' check (status in ('waiting', 'done', 'failed')),
  -- Suggested by the AI; you can change it.
  day_type text check (day_type in ('casual', 'corporate', 'native', 'church')),
  formality text check (formality in ('relaxed', 'smart', 'formal')),
  -- What was worn: [{ "kind": "top", "colour": "navy", "patterned": false }, ...]
  pieces jsonb not null default '[]'::jsonb check (jsonb_typeof(pieces) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index inspirations_user_created_idx on public.inspirations (user_id, created_at desc);

create trigger inspirations_touch_updated_at
  before update on public.inspirations
  for each row execute function public.touch_updated_at();

alter table public.inspirations enable row level security;

revoke all on public.inspirations from anon;
grant select, insert, update, delete on public.inspirations to authenticated;

create policy "Read own inspirations" on public.inspirations
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Add own inspirations" on public.inspirations
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Change own inspirations" on public.inspirations
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Remove own inspirations" on public.inspirations
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- How the planner uses your style, if you change it: { "tonal": "always", "bold": "less", ... }.
-- Empty means it goes by your pictures.
alter table public.settings add column style jsonb not null default '{}'::jsonb
  check (jsonb_typeof(style) = 'object');
