-- Jalankan setelah migrasi 004. Memungkinkan laporan setelah pasangan mengakhiri chat.
create or replace function public.report_ended_chat(
  p_reporter_id bigint,
  p_reported_id bigint,
  p_reason text
)
returns table(status text, report_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.chat_sessions%rowtype;
  new_report_id uuid;
begin
  select * into session_row
  from public.chat_sessions
  where ended_at is not null
    and ended_at >= now() - interval '24 hours'
    and ((user_one = p_reporter_id and user_two = p_reported_id)
      or (user_two = p_reporter_id and user_one = p_reported_id))
  order by ended_at desc
  limit 1;

  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  insert into public.reports (reporter_id, reported_id, reason, session_id)
  values (p_reporter_id, p_reported_id, p_reason, session_row.id)
  returning id into new_report_id;

  insert into public.moderation_cases (report_id, reported_id, severity)
  values (
    new_report_id,
    p_reported_id,
    case when p_reason = 'Konten seksual di bawah umur' then 'high' else 'normal' end
  );

  return query select 'ended'::text, new_report_id;
end;
$$;
