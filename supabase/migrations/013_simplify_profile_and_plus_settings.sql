-- Jalankan setelah 012_message_replies.sql.
-- Menghapus data profil yang tidak lagi digunakan dan menambahkan sensor media Owel Plus.
alter table public.users
  add column if not exists media_filter_enabled boolean not null default false;

alter table public.users
  drop constraint if exists users_profile_edit_field_check,
  drop constraint if exists users_profile_step_check,
  add constraint users_profile_step_check
    check (profile_step in ('gender', 'complete'));

alter table public.users
  drop column if exists language,
  drop column if exists country,
  drop column if exists bio,
  drop column if exists profile_edit_field;
