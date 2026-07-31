-- Jalankan seluruh file ini sekali di Supabase Dashboard > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.users (
  telegram_id bigint primary key,
  created_at timestamptz not null default now(),
  gender text,
  profile_step text not null default 'gender',
  profile_completed_at timestamptz,
  premium_until timestamptz,
  premium_plan text,
  match_gender_preference text not null default 'all',
  media_filter_enabled boolean not null default false,
  constraint users_gender_check check (gender is null or gender in ('male', 'female')),
  constraint users_profile_step_check check (profile_step in ('gender', 'complete')),
  constraint users_premium_plan_check check (premium_plan is null or premium_plan in ('weekly', 'monthly', 'quarterly', 'yearly')),
  constraint users_match_gender_preference_check check (match_gender_preference in ('male', 'female', 'all'))
);

create table if not exists public.match_queue (
  telegram_id bigint primary key references public.users(telegram_id) on delete cascade,
  queued_at timestamptz not null default now()
);

create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_one bigint not null references public.users(telegram_id),
  user_two bigint not null references public.users(telegram_id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by bigint references public.users(telegram_id),
  end_reason text,
  constraint different_chat_users check (user_one <> user_two)
);
create index if not exists active_sessions_user_one on public.chat_sessions (user_one) where ended_at is null;
create index if not exists active_sessions_user_two on public.chat_sessions (user_two) where ended_at is null;

create table if not exists public.chat_message_links (
  sender_id bigint not null references public.users(telegram_id),
  sender_message_id bigint not null,
  recipient_id bigint not null references public.users(telegram_id),
  recipient_message_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (sender_id, sender_message_id),
  unique (recipient_id, recipient_message_id)
);
create index if not exists chat_message_links_recipient on public.chat_message_links (recipient_id, recipient_message_id);

create table if not exists public.blocks (
  blocker_id bigint not null references public.users(telegram_id),
  blocked_id bigint not null references public.users(telegram_id),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint different_block_users check (blocker_id <> blocked_id)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id bigint not null references public.users(telegram_id),
  reported_id bigint not null references public.users(telegram_id),
  reason text not null default 'Tidak ada alasan',
  created_at timestamptz not null default now()
);


-- Mencari pasangan dalam satu transaksi. Advisory lock membuat pemilihan antrean aman
-- ketika beberapa webhook tiba bersamaan.
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

  select case when user_one = p_user_id then user_two else user_one end
  into current_partner
  from chat_sessions
  where ended_at is null and p_user_id in (user_one, user_two)
  limit 1;
  if current_partner is not null then
    return query select 'already_matched'::text, current_partner;
    return;
  end if;

  delete from match_queue where telegram_id = p_user_id;
  select q.telegram_id into candidate_id
  from match_queue q
  join users candidate on candidate.telegram_id = q.telegram_id
  join users requester on requester.telegram_id = p_user_id
  where q.telegram_id <> p_user_id
    and candidate.gender is not null
    and (requester.match_gender_preference = 'all' or candidate.gender = requester.match_gender_preference)
    and (candidate.match_gender_preference = 'all' or requester.gender = candidate.match_gender_preference)
    and not exists (select 1 from blocks b where b.blocker_id = p_user_id and b.blocked_id = q.telegram_id)
    and not exists (select 1 from blocks b where b.blocker_id = q.telegram_id and b.blocked_id = p_user_id)
  order by case when candidate.premium_until > now() then 0 else 1 end, q.queued_at
  limit 1
  for update of q skip locked;

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

create or replace function public.end_chat(p_user_id bigint, p_reason text default 'ended')
returns table(status text, partner_id bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row chat_sessions%rowtype;
begin
  delete from match_queue where telegram_id = p_user_id;
  select * into session_row from chat_sessions
  where ended_at is null and p_user_id in (user_one, user_two)
  order by started_at desc limit 1 for update;
  if not found then
    return query select 'not_matched'::text, null::bigint;
    return;
  end if;
  update chat_sessions set ended_at = now(), ended_by = p_user_id, end_reason = p_reason where id = session_row.id;
  return query select 'ended'::text, case when session_row.user_one = p_user_id then session_row.user_two else session_row.user_one end;
end;
$$;

drop function if exists public.report_user(bigint, text);
create function public.report_user(p_reporter_id bigint, p_reason text default 'Tidak ada alasan')
returns table(status text, partner_id bigint, report_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id bigint;
  new_report_id uuid;
begin
  select case when user_one = p_reporter_id then user_two else user_one end into target_id
  from chat_sessions where ended_at is null and p_reporter_id in (user_one, user_two)
  order by started_at desc limit 1 for update;
  if target_id is null then
    return query select 'not_matched'::text, null::bigint, null::uuid;
    return;
  end if;
  insert into reports (reporter_id, reported_id, reason) values (p_reporter_id, target_id, p_reason)
  returning id into new_report_id;
  update chat_sessions set ended_at = now(), ended_by = p_reporter_id, end_reason = 'reported'
  where ended_at is null and p_reporter_id in (user_one, user_two);
  return query select 'ended'::text, target_id, new_report_id;
end;
$$;

create or replace function public.block_reported_user(p_reporter_id bigint, p_report_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id bigint;
begin
  select reported_id into target_id from reports where id = p_report_id and reporter_id = p_reporter_id;
  if target_id is null then return false; end if;
  insert into blocks (blocker_id, blocked_id) values (p_reporter_id, target_id) on conflict do nothing;
  return true;
end;
$$;

-- Bot mengakses database melalui service-role key, bukan dari aplikasi pengguna.
alter table public.users enable row level security;
alter table public.match_queue enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_message_links enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;
