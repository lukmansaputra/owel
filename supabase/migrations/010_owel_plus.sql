-- Jalankan migrasi ini setelah 009_post-chat-report.sql.
-- Menyimpan masa aktif membership yang diaktifkan setelah pembayaran Telegram berhasil.
alter table public.users
  add column if not exists premium_until timestamptz,
  add column if not exists premium_plan text;

alter table public.users
  drop constraint if exists users_premium_plan_check,
  add constraint users_premium_plan_check
    check (premium_plan is null or premium_plan in ('monthly'));
