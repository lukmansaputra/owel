-- Jalankan setelah 002_report-reasons-and-optional-block.sql.
create table if not exists public.global_blocks (
  telegram_id bigint primary key references public.users(telegram_id),
  note text,
  blocked_at timestamptz not null default now()
);

-- Ganti fungsi matching agar akun yang diblokir admin tidak dapat mencari atau menerima pasangan.
create or replace function public.match_user(p_user_id bigint)
returns table(status text, partner_id bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate_id bigint;
  current_partner bigint;
begin
  perform pg_advisory_xact_lock(8142026);
  insert into users (telegram_id) values (p_user_id) on conflict do nothing;
  if exists (select 1 from global_blocks where telegram_id = p_user_id) then
    delete from match_queue where telegram_id = p_user_id;
    return query select 'blocked'::text, null::bigint;
    return;
  end if;
  select case when user_one = p_user_id then user_two else user_one end
  into current_partner from chat_sessions
  where ended_at is null and p_user_id in (user_one, user_two) limit 1;
  if current_partner is not null then
    return query select 'already_matched'::text, current_partner;
    return;
  end if;
  delete from match_queue where telegram_id = p_user_id;
  select q.telegram_id into candidate_id from match_queue q
  where q.telegram_id <> p_user_id
    and not exists (select 1 from global_blocks g where g.telegram_id = q.telegram_id)
    and not exists (select 1 from blocks b where b.blocker_id = p_user_id and b.blocked_id = q.telegram_id)
    and not exists (select 1 from blocks b where b.blocker_id = q.telegram_id and b.blocked_id = p_user_id)
  order by q.queued_at limit 1 for update skip locked;
  if candidate_id is null then
    insert into match_queue (telegram_id) values (p_user_id)
    on conflict (telegram_id) do update set queued_at = excluded.queued_at;
    return query select 'queued'::text, null::bigint;
    return;
  end if;
  delete from match_queue where telegram_id = candidate_id;
  insert into chat_sessions (user_one, user_two) values (p_user_id, candidate_id);
  return query select 'matched'::text, candidate_id;
end;
$$;

alter table public.global_blocks enable row level security;
