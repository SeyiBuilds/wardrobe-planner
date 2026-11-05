-- Wardrobe pieces and their photos.
-- Run this once in the Supabase SQL Editor.
--
-- The publishable key is public, so these rules are what keep the wardrobe private:
-- a signed-in user can only reach their own rows and photos, and nobody else can reach any.

create table public.pieces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type text not null default 'top'
    check (type in (
      'top', 'trousers', 'jacket', 'suit', 'native_set',
      'shoes', 'socks', 'watch', 'belt', 'accessory'
    )),
  name text not null default '',
  colour_name text not null default '',
  -- Measured from the photo: [{ "hex": "#1b2a4a", "share": 0.82 }, ...]
  colours jsonb not null default '[]'::jsonb,
  formality text check (formality in ('relaxed', 'smart', 'formal')),
  occasions text[] not null default '{}'
    check (occasions <@ array['casual', 'corporate', 'native', 'church']),
  pattern text check (pattern in ('plain', 'patterned')),
  -- Null means the piece can repeat and never leaves rotation.
  wears_before_wash integer check (wears_before_wash > 0),
  wears_since_wash integer not null default 0 check (wears_since_wash >= 0),
  photo_path text not null,
  label_status text not null default 'waiting'
    check (label_status in ('waiting', 'done', 'failed')),
  reviewed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index pieces_user_created_idx on public.pieces (user_id, created_at desc);

create function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger pieces_touch_updated_at
  before update on public.pieces
  for each row execute function public.touch_updated_at();

alter table public.pieces enable row level security;

revoke all on public.pieces from anon;
grant select, insert, update, delete on public.pieces to authenticated;

create policy "Read own pieces" on public.pieces
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Add own pieces" on public.pieces
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Change own pieces" on public.pieces
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Remove own pieces" on public.pieces
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Photos live in a private bucket, in a folder named after their owner.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wardrobe', 'wardrobe', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

create policy "Read own wardrobe photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Add own wardrobe photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Remove own wardrobe photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'wardrobe' and (storage.foldername(name))[1] = (select auth.uid())::text);
