-- Jalankan setelah 006_user-profiles.sql.
-- Hanya gender ditanyakan saat perkenalan; kolom lain diubah melalui /profile.
alter table public.users
  add column if not exists profile_edit_field text;

-- Bila sebelumnya ada pilihan yang sudah tidak tersedia, minta pengguna memilih ulang.
update public.users
set gender = null,
    profile_step = 'gender',
    profile_completed_at = null
where gender = 'non_binary';

alter table public.users
  drop constraint if exists users_gender_check,
  add constraint users_gender_check
    check (gender is null or gender in ('male', 'female'));

alter table public.users
  drop constraint if exists users_profile_edit_field_check,
  add constraint users_profile_edit_field_check
    check (profile_edit_field is null or profile_edit_field in ('language', 'country', 'bio'));

-- Selesaikan onboarding lama yang sudah memiliki gender agar tidak muncul pertanyaan opsional lagi.
update public.users
set profile_step = 'complete',
    profile_completed_at = coalesce(profile_completed_at, now())
where gender is not null and profile_step <> 'complete';
