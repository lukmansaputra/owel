-- Jalankan migrasi ini setelah schema.sql dan migrasi sebelumnya.
-- Gender wajib dipilih sebelum pengguna dapat mencari teman bicara.
alter table public.users
  add column if not exists gender text,
  add column if not exists language text,
  add column if not exists country text,
  add column if not exists bio text,
  add column if not exists profile_step text not null default 'gender',
  add column if not exists profile_completed_at timestamptz;

alter table public.users
  drop constraint if exists users_gender_check,
  add constraint users_gender_check
    check (gender is null or gender in ('male', 'female'));

alter table public.users
  drop constraint if exists users_profile_step_check,
  add constraint users_profile_step_check
    check (profile_step in ('gender', 'language', 'country', 'bio', 'complete'));

-- Akun yang sudah ada akan melalui perkenalan pada kali berikutnya membuka bot.
update public.users
set profile_step = 'gender'
where profile_step is null or profile_step <> 'complete';
