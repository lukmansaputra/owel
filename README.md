# Owel

Bot Telegram untuk percakapan anonim satu lawan satu.

## Menjalankan lokal

1. Buat project di Supabase, lalu jalankan isi [supabase/schema.sql](supabase/schema.sql) di **SQL Editor** Supabase.
   Jika database sudah dibuat sebelumnya, jalankan seluruh migrasi hingga [013_simplify_profile_and_plus_settings.sql](supabase/migrations/013_simplify_profile_and_plus_settings.sql) secara berurutan.
2. Salin `.env.example` menjadi `.env`, lalu isi `BOT_TOKEN`, `SUPABASE_URL`, dan `SUPABASE_SERVICE_ROLE_KEY`.
3. Jalankan `npm start`.

## Deploy Vercel dan webhook

1. Tambahkan semua variabel dari `.env` ke **Vercel Project Settings > Environment Variables**, termasuk `BOT_TOKEN`, kredensial Supabase, dan `WEBHOOK_URL` berisi domain produksi, misalnya `https://nama-proyek.vercel.app`.
2. Deploy proyek ke Vercel. Endpoint webhook tersedia di `https://nama-proyek.vercel.app/api/telegram-webhook`.
3. Dari komputer lokal, jalankan `npm run webhook:set` sekali untuk mendaftarkan endpoint tersebut ke Telegram.

Untuk pengembangan lokal, cukup gunakan `npm start`; bot memakai long polling. Setelah selesai memakai polling lokal, jalankan kembali `npm run webhook:set` agar webhook produksi aktif lagi.

## Moderasi admin

Jalankan [supabase/migrations/003_admin-moderation.sql](supabase/migrations/003_admin-moderation.sql) di SQL Editor Supabase. Setelah mengisi `ADMIN_USERNAME` dan `ADMIN_PASSWORD`, buka `http://localhost:3000/admin` saat menjalankan bot lokal. Panel ini menampilkan 100 laporan terbaru dan dapat memblokir atau membuka blokir akun secara global.

Lalu jalankan [supabase/migrations/004_evidence_based_moderation.sql](supabase/migrations/004_evidence_based_moderation.sql). Report kini membuat kasus review dan menyimpan maksimal 20 metadata/pesan terakhir dari sesi sebagai bukti terbatas selama 30 hari. Blokir global hanya dilakukan setelah review admin.

## Alur inti yang tersedia

- `/start` langsung mencari pasangan acak bagi pengguna yang sudah memilih gender; pengguna baru tetap diarahkan untuk perkenalan
- `/profile` menampilkan Telegram ID, gender, status membership, paket, dan masa aktif; gender dapat diubah dari sana
- `/settings` untuk preferensi pencarian dan sensor media, khusus Owel Plus
- `/plus` menawarkan paket 1 minggu (Rp9.900), 1 bulan (Rp29.900), 3 bulan (Rp79.900), dan 1 tahun (Rp249.000)
- Owel Plus: preferensi gender, prioritas antrean, tanpa iklan sponsor, badge pada `/profile`, dan sensor media
- tombol laporan setelah pasangan mengakhiri atau melewati percakapan
- antrean matching satu lawan satu
- relay pesan teks dan seluruh media umum secara anonim: foto, stiker, GIF, video, video note, voice note, audio, serta dokumen
- reply pesan anonim untuk teks dan media
- akhiri chat dan cari pasangan lagi
- laporkan pengguna dengan alasan; setelahnya pengguna dapat memilih untuk memblokir atau tidak
- penyaring sederhana untuk tautan, pesan berulang, dan banjir pesan

Antrean, sesi, blokir, dan laporan sekarang disimpan di Supabase. Jangan pernah membagikan atau memasukkan `SUPABASE_SERVICE_ROLE_KEY` ke kode frontend; kunci ini hanya untuk server bot.
