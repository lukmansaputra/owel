-- Jalankan setelah migrasi 003.
alter table public.global_blocks add column if not exists expires_at timestamptz;
alter table public.reports add column if not exists session_id uuid references public.chat_sessions(id);

create table if not exists public.chat_evidence (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  sender_id bigint not null references public.users(telegram_id),
  kind text not null,
  text_content text,
  file_unique_id text,
  created_at timestamptz not null default now()
);
create index if not exists chat_evidence_session_created on public.chat_evidence(session_id, created_at desc);

create table if not exists public.moderation_cases (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null unique references public.reports(id) on delete cascade,
  reported_id bigint not null references public.users(telegram_id),
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed', 'suspended')),
  severity text not null default 'normal' check (severity in ('normal', 'high')),
  evidence_expires_at timestamptz not null default (now() + interval '30 days'),
  admin_note text,
  actioned_at timestamptz,
  created_at timestamptz not null default now()
);

-- Akun hanya diblokir selama suspensi belum kedaluwarsa.
create or replace function public.match_user(p_user_id bigint)
returns table(status text, partner_id bigint)
language plpgsql security definer set search_path = public as $$
declare candidate_id bigint; current_partner bigint;
begin
  perform pg_advisory_xact_lock(8142026);
  insert into users (telegram_id) values (p_user_id) on conflict do nothing;
  if exists (select 1 from global_blocks where telegram_id = p_user_id and (expires_at is null or expires_at > now())) then
    delete from match_queue where telegram_id = p_user_id; return query select 'blocked'::text, null::bigint; return;
  end if;
  select case when user_one = p_user_id then user_two else user_one end into current_partner from chat_sessions where ended_at is null and p_user_id in (user_one, user_two) limit 1;
  if current_partner is not null then return query select 'already_matched'::text, current_partner; return; end if;
  delete from match_queue where telegram_id = p_user_id;
  select q.telegram_id into candidate_id from match_queue q where q.telegram_id <> p_user_id
    and not exists (select 1 from global_blocks g where g.telegram_id = q.telegram_id and (g.expires_at is null or g.expires_at > now()))
    and not exists (select 1 from blocks b where b.blocker_id = p_user_id and b.blocked_id = q.telegram_id)
    and not exists (select 1 from blocks b where b.blocker_id = q.telegram_id and b.blocked_id = p_user_id)
  order by q.queued_at limit 1 for update skip locked;
  if candidate_id is null then insert into match_queue (telegram_id) values (p_user_id) on conflict (telegram_id) do update set queued_at = excluded.queued_at; return query select 'queued'::text, null::bigint; return; end if;
  delete from match_queue where telegram_id = candidate_id; insert into chat_sessions (user_one, user_two) values (p_user_id, candidate_id); return query select 'matched'::text, candidate_id;
end; $$;

drop function if exists public.report_user(bigint, text);
create function public.report_user(p_reporter_id bigint, p_reason text default 'Tidak ada alasan')
returns table(status text, partner_id bigint, report_id uuid)
language plpgsql security definer set search_path = public as $$
declare target_id bigint; session_row chat_sessions%rowtype; new_report_id uuid;
begin
  select * into session_row from chat_sessions where ended_at is null and p_reporter_id in (user_one, user_two) order by started_at desc limit 1 for update;
  if not found then return query select 'not_matched'::text, null::bigint, null::uuid; return; end if;
  target_id := case when session_row.user_one = p_reporter_id then session_row.user_two else session_row.user_one end;
  insert into reports (reporter_id, reported_id, reason, session_id) values (p_reporter_id, target_id, p_reason, session_row.id) returning id into new_report_id;
  insert into moderation_cases (report_id, reported_id, severity) values (new_report_id, target_id, case when p_reason = 'Konten seksual di bawah umur' then 'high' else 'normal' end);
  update chat_sessions set ended_at = now(), ended_by = p_reporter_id, end_reason = 'reported' where id = session_row.id;
  return query select 'ended'::text, target_id, new_report_id;
end; $$;

create or replace function public.record_chat_evidence(p_sender_id bigint, p_kind text, p_text text default null, p_file_unique_id text default null)
returns void language plpgsql security definer set search_path = public as $$
declare active_session uuid;
begin
  select id into active_session from chat_sessions where ended_at is null and p_sender_id in (user_one, user_two) order by started_at desc limit 1;
  if active_session is not null then insert into chat_evidence (session_id, sender_id, kind, text_content, file_unique_id) values (active_session, p_sender_id, p_kind, p_text, p_file_unique_id); end if;
end; $$;

create or replace function public.get_case_evidence(p_case_id uuid)
returns table(sender_id bigint, kind text, text_content text, file_unique_id text, created_at timestamptz)
language sql security definer set search_path = public as $$
  select e.sender_id, e.kind, e.text_content, e.file_unique_id, e.created_at
  from moderation_cases c join reports r on r.id = c.report_id join chat_evidence e on e.session_id = r.session_id
  where c.id = p_case_id and e.created_at <= c.evidence_expires_at order by e.created_at desc limit 20;
$$;

create or replace function public.expire_old_evidence() returns void language sql security definer set search_path = public as $$
  delete from chat_evidence where created_at < now() - interval '30 days';
$$;

alter table public.chat_evidence enable row level security;
alter table public.moderation_cases enable row level security;
