-- Jalankan setelah 010_owel_plus.sql.
-- Preferensi gender hanya dapat dipilih dari bot oleh membership Owel Plus aktif.
alter table public.users
  add column if not exists match_gender_preference text not null default 'all';

alter table public.users
  drop constraint if exists users_premium_plan_check,
  add constraint users_premium_plan_check
    check (premium_plan is null or premium_plan in ('weekly', 'monthly', 'quarterly', 'yearly')),
  drop constraint if exists users_match_gender_preference_check,
  add constraint users_match_gender_preference_check
    check (match_gender_preference in ('male', 'female', 'all'));

-- Plus dipilih lebih dahulu dari antrean; preferensi gender kedua pengguna harus cocok.
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
