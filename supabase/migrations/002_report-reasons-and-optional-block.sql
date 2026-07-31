-- Jalankan file ini di SQL Editor bila schema.sql versi sebelumnya sudah pernah dipakai.
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
