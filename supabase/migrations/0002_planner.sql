-- The planner: your usual week, planned outfits and the weekly check.
-- Run this once in the Supabase SQL Editor, after 0001_wardrobe.sql.
--
-- Like the pieces table, every row belongs to one signed-in user and nobody else can reach it.

-- Laundry: a piece waits here from when its wears run out (or you send it early) until you mark it clean.
alter table public.pieces add column in_wash boolean not null default false;

-- Your usual week, Monday first. Each day is casual, corporate, native, church or none (no outfit).
create table public.settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  usual_week text[] not null
    default array['corporate', 'corporate', 'corporate', 'corporate', 'corporate', 'casual', 'church']
    check (
      cardinality(usual_week) = 7
      and usual_week <@ array['casual', 'corporate', 'native', 'church', 'none']
    ),
  updated_at timestamptz not null default now()
);

create trigger settings_touch_updated_at
  before update on public.settings
  for each row execute function public.touch_updated_at();

alter table public.settings enable row level security;

revoke all on public.settings from anon;
grant select, insert, update on public.settings to authenticated;

create policy "Read own settings" on public.settings
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Add own settings" on public.settings
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Change own settings" on public.settings
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- One outfit per day. Planned outfits hold their pieces until the weekly check says what was worn,
-- and checked ones are the history that keeps weeks from repeating.
create table public.outfits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  day_type text not null check (day_type in ('casual', 'corporate', 'native', 'church', 'none')),
  -- An empty slot is null. Deleting a piece empties its slots rather than losing the outfit.
  top_id uuid references public.pieces (id) on delete set null,
  trousers_id uuid references public.pieces (id) on delete set null,
  suit_id uuid references public.pieces (id) on delete set null,
  native_set_id uuid references public.pieces (id) on delete set null,
  shoes_id uuid references public.pieces (id) on delete set null,
  watch_id uuid references public.pieces (id) on delete set null,
  belt_id uuid references public.pieces (id) on delete set null,
  -- Why a slot is empty, or that a combination repeats: [{ "slot": "trousers", "text": "..." }]
  notes jsonb not null default '[]'::jsonb,
  -- Set by the weekly check: the pieces you actually wore that day.
  worn uuid[],
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);

create trigger outfits_touch_updated_at
  before update on public.outfits
  for each row execute function public.touch_updated_at();

alter table public.outfits enable row level security;

revoke all on public.outfits from anon;
grant select, insert, update, delete on public.outfits to authenticated;

create policy "Read own outfits" on public.outfits
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Add own outfits" on public.outfits
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Change own outfits" on public.outfits
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Remove own outfits" on public.outfits
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- The weekly check, saved in one go so a dropped connection can't leave it half done.
--   checked: [{ "id": outfit id, "worn": [piece ids you wore that day] }]
--   washed:  piece ids that are clean again
-- It runs as the signed-in user, so the rules above still decide which rows it can touch.
create function public.finish_check(checked jsonb, washed uuid[]) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Each outfit is counted once: only days not already checked are updated, and only
  -- pieces that were really in that day's outfit count as worn.
  with updated as (
    update public.outfits o
    set worn = array(
          select distinct piece_id::uuid
          from jsonb_array_elements_text(entry -> 'worn') as piece_id
          where piece_id::uuid in (
            o.top_id, o.trousers_id, o.suit_id, o.native_set_id, o.shoes_id, o.watch_id, o.belt_id
          )
        ),
        checked_at = now()
    from jsonb_array_elements(checked) as entry
    where o.id = (entry ->> 'id')::uuid
      and o.checked_at is null
    returning o.worn
  ),
  wears as (
    select piece_id, count(*)::integer as times
    from updated, unnest(updated.worn) as piece_id
    group by piece_id
  )
  update public.pieces p
  set wears_since_wash = p.wears_since_wash + wears.times,
      in_wash = p.in_wash
        or (p.wears_before_wash is not null and p.wears_since_wash + wears.times >= p.wears_before_wash)
  from wears
  where p.id = wears.piece_id;

  update public.pieces
  set in_wash = false, wears_since_wash = 0
  where id = any(washed);
end;
$$;

revoke execute on function public.finish_check(jsonb, uuid[]) from public, anon;
grant execute on function public.finish_check(jsonb, uuid[]) to authenticated;
