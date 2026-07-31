-- Jalankan setelah 011_owel_plus_benefits.sql.
-- Menyimpan hubungan pesan anonim agar fitur reply tetap berfungsi setelah bot di-restart.
create table if not exists public.chat_message_links (
  sender_id bigint not null references public.users(telegram_id),
  sender_message_id bigint not null,
  recipient_id bigint not null references public.users(telegram_id),
  recipient_message_id bigint not null,
  created_at timestamptz not null default now(),
  primary key (sender_id, sender_message_id),
  unique (recipient_id, recipient_message_id)
);

create index if not exists chat_message_links_recipient
  on public.chat_message_links (recipient_id, recipient_message_id);

alter table public.chat_message_links enable row level security;
