-- Jalankan setelah migrasi 004.
alter table public.chat_evidence add column if not exists telegram_file_id text;

drop function if exists public.record_chat_evidence(bigint, text, text, text);
create function public.record_chat_evidence(p_sender_id bigint, p_kind text, p_text text default null, p_file_unique_id text default null, p_telegram_file_id text default null)
returns void language plpgsql security definer set search_path = public as $$
declare active_session uuid;
begin
  select id into active_session from chat_sessions where ended_at is null and p_sender_id in (user_one, user_two) order by started_at desc limit 1;
  if active_session is not null then
    insert into chat_evidence (session_id, sender_id, kind, text_content, file_unique_id, telegram_file_id)
    values (active_session, p_sender_id, p_kind, p_text, p_file_unique_id, p_telegram_file_id);
  end if;
end; $$;

drop function if exists public.get_case_evidence(uuid);
create function public.get_case_evidence(p_case_id uuid)
returns table(id uuid, sender_id bigint, kind text, text_content text, file_unique_id text, telegram_file_id text, created_at timestamptz)
language sql security definer set search_path = public as $$
  select e.id, e.sender_id, e.kind, e.text_content, e.file_unique_id, e.telegram_file_id, e.created_at
  from moderation_cases c join reports r on r.id = c.report_id join chat_evidence e on e.session_id = r.session_id
  where c.id = p_case_id and e.created_at <= c.evidence_expires_at order by e.created_at desc limit 20;
$$;
