-- Matching sets: a top and the trousers made to go with it, such as a native top and its trousers.
-- Run this once in the Supabase SQL Editor, after 0003_style.sql.
--
-- The planner always plans matched pieces together and never mixes either half with anything else.

alter table public.pieces
  add column match_id uuid references public.pieces (id) on delete set null
  check (match_id is null or match_id <> id);

-- Matches go both ways, so this always changes both halves together. A null partner unmatches
-- the piece and whatever it was matched with.
-- It runs as the signed-in user, so only their own pieces can be found or changed.
create function public.set_match(piece uuid, partner uuid) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  types text[];
begin
  if partner is not null then
    if piece = partner then
      raise exception 'Only a top with trousers can be a matching set.';
    end if;
    select array_agg(p.type order by p.type) into types
    from public.pieces p
    where p.id in (piece, partner);
    if coalesce(array_length(types, 1), 0) < 2 then
      raise exception 'Piece not found.';
    end if;
    if types <> array['top', 'trousers'] then
      raise exception 'Only a top with trousers can be a matching set.';
    end if;
  elsif not exists (select 1 from public.pieces p where p.id = piece) then
    raise exception 'Piece not found.';
  end if;

  -- Free both pieces, and anything either one was matched with before.
  update public.pieces p
  set match_id = null
  where p.id in (piece, partner) or p.match_id in (piece, partner);

  if partner is not null then
    update public.pieces p set match_id = partner where p.id = piece;
    update public.pieces p set match_id = piece where p.id = partner;
  end if;
end;
$$;

revoke execute on function public.set_match(uuid, uuid) from public, anon;
grant execute on function public.set_match(uuid, uuid) to authenticated;
