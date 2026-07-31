require("dotenv").config();

const express = require("express");
const { Telegraf, Markup } = require("telegraf");
const { SupabaseChatService } = require("./supabase-chat-service");
const { createAdminRouter } = require("./admin");

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN belum diatur. Tambahkan ke file .env.");

const bot = new Telegraf(token);
const chats = new SupabaseChatService(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const spamPatterns = [/https?:\/\//i, /t\.me\//i, /(.)\1{9,}/i];
const recentMessages = new Map();
const paymentProviderToken = process.env.TELEGRAM_PAYMENT_PROVIDER_TOKEN;
const plusPlans = {
  weekly: { label: "1 Minggu", days: 7, price: 9900 },
  monthly: { label: "1 Bulan", days: 30, price: 29900, popular: true },
  quarterly: { label: "3 Bulan", days: 90, price: 79900 },
  yearly: { label: "1 Tahun", days: 365, price: 249000 },
};

const controls = () =>
  Markup.keyboard([
    ["⏹ Akhiri chat"],
    ["⏭ Lewati", "🚩 Laporkan"],
  ]).resize();
const queueControls = () =>
  Markup.keyboard([["⏹ Akhiri pencarian"]]).resize();
const postChatReportButton = (partnerId) =>
  Markup.inlineKeyboard([
    Markup.button.callback("🚩 Laporkan", `post_report:${partnerId}`),
  ]);
const postChatReportReasons = (partnerId) =>
  Markup.inlineKeyboard([
    [Markup.button.callback("Spam / promosi", `post_report_reason:${partnerId}:spam`)],
    [Markup.button.callback("VCS tidak pantas", `post_report_reason:${partnerId}:vcs`)],
    [Markup.button.callback("Konten seksual", `post_report_reason:${partnerId}:seksual`)],
    [Markup.button.callback("Konten seksual di bawah umur", `post_report_reason:${partnerId}:seksual_bawah_umur`)],
    [Markup.button.callback("Pelecehan / kebencian", `post_report_reason:${partnerId}:pelecehan`)],
    [Markup.button.callback("Lainnya", `post_report_reason:${partnerId}:lainnya`)],
    [Markup.button.callback("Batal", "post_report_cancel")],
  ]);
const findButton = () =>
  Markup.keyboard([["🔎 Cari teman bicara"]]).resize();
const html = (markup = {}) => ({ parse_mode: "HTML", ...markup });
const reportReasons = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback("Spam / promosi", "report:spam"),
      Markup.button.callback("VCS tidak pantas", "report:vcs"),
    ],
    [Markup.button.callback("Konten seksual", "report:seksual")],
    [
      Markup.button.callback(
        "Konten seksual di bawah umur",
        "report:seksual_bawah_umur",
      ),
    ],
    [
      Markup.button.callback("Pelecehan / kebencian", "report:pelecehan"),
      Markup.button.callback("Lainnya", "report:lainnya"),
    ],
    [Markup.button.callback("Batal", "report:cancel")],
  ]);
const reportReasonLabels = {
  spam: "Spam / promosi",
  vcs: "VCS tidak pantas",
  seksual: "Konten seksual",
  seksual_bawah_umur: "Konten seksual di bawah umur",
  pelecehan: "Pelecehan / kebencian",
  lainnya: "Lainnya",
};

const genderButtons = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("Perempuan", "profile:gender:female")],
    [Markup.button.callback("Laki-laki", "profile:gender:male")],
  ]);
const profileButtons = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("Ubah gender", "profile:edit:gender")],
  ]);
const settingsButtons = (isPlus, mediaFilterEnabled) =>
  Markup.inlineKeyboard([
    ...(isPlus
      ? [
          [Markup.button.callback("Preferensi pencarian", "settings:preference")],
          [Markup.button.callback(
            mediaFilterEnabled ? "Sensor media: aktif" : "Sensor media: nonaktif",
            "settings:media-filter",
          )],
        ]
      : [[Markup.button.callback("✨ Buka Owel Plus", "settings:plus")]]),
  ]);
const plusButtons = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("1 Minggu — Rp9.900", "plus:buy:weekly")],
    [Markup.button.callback("1 Bulan — Rp29.900 ⭐", "plus:buy:monthly")],
    [Markup.button.callback("3 Bulan — Rp79.900", "plus:buy:quarterly")],
    [Markup.button.callback("1 Tahun — Rp249.000", "plus:buy:yearly")],
  ]);
const genderLabel = (gender) =>
  gender === "female" ? "Perempuan" : gender === "male" ? "Laki-laki" : "Belum diisi";
const preferenceLabel = (preference) =>
  preference === "male" ? "Laki-laki" : preference === "female" ? "Perempuan" : "Semua gender";
const isPlusActive = (profile) =>
  Boolean(profile.premium_until && new Date(profile.premium_until) > new Date());

async function promptProfile(ctx, profile) {
  if (profile.profile_step === "gender")
    return ctx.reply(
      "🦉 <i>Halo, aku Owel. Senang kamu datang.</i>\n\nSebelum kita mulai, pilih gendermu dulu ya. Ini wajib agar profilmu siap digunakan.",
      html(genderButtons()),
    );
  return ctx.reply(
    "🦉 <i>Profilmu sudah siap.</i>\n\nDi sini kamu bisa bertemu seseorang baru dengan nyaman. Kalau obrolannya terasa tidak nyaman, kamu selalu bisa melewati, mengakhiri, atau melaporkannya.\n\nSaat kamu siap, aku akan mencarikan teman ngobrol untukmu.",
    html(findButton()),
  );
}

async function ensureProfileReady(ctx) {
  let profile = await chats.ensureProfile(ctx.from.id);
  if (profile.gender) {
    if (profile.profile_step !== "complete")
      profile = await chats.updateProfile(ctx.from.id, {
        profile_step: "complete",
        profile_completed_at: profile.profile_completed_at || new Date().toISOString(),
      });
    return true;
  }
  await promptProfile(ctx, profile);
  return false;
}

async function showProfile(ctx, profile, notice = "") {
  const prefix = notice ? `<i>${notice}</i>\n\n` : "";
  const plus = isPlusActive(profile);
  const remainingDays = plus
    ? Math.max(1, Math.ceil((new Date(profile.premium_until).getTime() - Date.now()) / 86_400_000))
    : 0;
  const membership = plus
    ? `🦉 <b>Owel Plus</b>\nPaket: ${plusPlans[profile.premium_plan]?.label || profile.premium_plan || "-"}\nSisa durasi: ${remainingDays} hari\nAktif hingga: ${new Date(profile.premium_until).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}`
    : "Free";
  return ctx.reply(
    `${prefix}<b>Profil kamu</b>\n\nTelegram ID: <code>${profile.telegram_id}</code>\nGender: ${genderLabel(profile.gender)}\nMembership: ${membership}`,
    html(profileButtons()),
  );
}

async function showSettings(ctx, profile, notice = "") {
  const prefix = notice ? `<i>${notice}</i>\n\n` : "";
  const plus = isPlusActive(profile);
  if (!plus)
    return ctx.reply(
      `${prefix}<b>Pengaturan</b>\n\nPreferensi pencarian dan sensor media tersedia untuk Owel Plus.`,
      html(settingsButtons(false, false)),
    );
  return ctx.reply(
    `${prefix}<b>Pengaturan Owel Plus</b>\n\nPreferensi gender: ${preferenceLabel(profile.match_gender_preference)}\nSensor media: ${profile.media_filter_enabled ? "Aktif" : "Nonaktif"}\n\nSensor media menyembunyikan semua media dari teman bicara.`,
    html(settingsButtons(true, profile.media_filter_enabled)),
  );
}

async function showPlus(ctx, profile) {
  const activeUntil = profile.premium_until && new Date(profile.premium_until);
  if (activeUntil && activeUntil > new Date())
    return ctx.reply(
      `✨ <b>Owel Plus aktif</b>\n\n🦉 Badge Owel Plus aktif di /profile.\n🎯 Preferensi pencarian: <b>${preferenceLabel(profile.match_gender_preference)}</b>\n⚡ Kamu diprioritaskan saat antrean ramai.\n🚫 Tanpa iklan sponsor.\n\nMembership kamu aktif sampai <b>${activeUntil.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}</b>.`,
      html(),
    );
  return ctx.reply(
    "✨ <b>Owel Plus</b>\n\n🎯 Pilih preferensi gender: laki-laki, perempuan, atau semua.\n⚡ Prioritas pencarian saat antrean ramai.\n🚫 Tanpa iklan sponsor.\n🦉 Badge Owel Plus di /profile.\n\nPilih durasi membership:",
    html(plusButtons()),
  );
}

function isSuspicious(userId, text) {
  const now = Date.now();
  const previous = recentMessages.get(userId) || [];
  const valid = previous.filter((time) => now - time < 10_000);
  valid.push(now);
  recentMessages.set(userId, valid);
  return spamPatterns.some((pattern) => pattern.test(text)) || valid.length > 8;
}

async function findMatch(ctx) {
  if (!(await ensureProfileReady(ctx))) return;
  const result = await chats.requestMatch(ctx.from.id);
  if (result.status === "blocked")
    return ctx.reply(
      "🦉 <i>Maaf, untuk saat ini aku belum bisa mencarikan teman ngobrol untukmu.</i>",
      html(),
    );
  if (result.status === "already_matched")
    return ctx.reply(
      "<i>Kamu masih bersama teman bicaramu.</i>\n\n/next — cari teman baru\n/stop — akhiri obrolan",
      html(controls()),
    );
  if (result.status === "queued")
    return ctx.reply(
      "🦉 <i>Sebentar ya...</i>\n\n<i>Aku sedang mencarikan teman ngobrol untukmu.</i>",
      html(queueControls()),
    );

  const matchedMessage =
    "🦉 <i>Yeay!</i>\n\n<i>Aku berhasil menemukan teman ngobrolmu. Selamat mengobrol!</i>\n\n/next — cari teman baru\n/stop — akhiri obrolan";
  await Promise.all([
    ctx.telegram.sendMessage(ctx.from.id, matchedMessage, html(controls())),
    ctx.telegram.sendMessage(
      result.partnerId,
      matchedMessage,
      html(controls()),
    ),
  ]);
}

async function finishChat(ctx) {
  const result = await chats.endChat(ctx.from.id);
  if (result.status === "not_matched")
    return ctx.reply(
      "🦉 <i>Kamu belum sedang mengobrol dengan siapa pun.</i>\n\nKalau kamu mau, aku bisa mencarikan teman ngobrol.",
      html(findButton()),
    );

  await ctx.reply(
    "🦉 <i>Obrolannya sudah selesai.</i>\n\n<i>Semoga harimu menyenangkan.</i>\n\nKalau mau, aku bisa mencarikan teman baru.",
    html(findButton()),
  );
  await ctx.telegram.sendMessage(
    result.partnerId,
    "<i>Teman ngobrolmu sudah mengakhiri obrolan ini.</i>\n\nKalau ada hal yang perlu kami ketahui, kamu masih bisa melaporkannya lewat tombol di bawah.",
    html(postChatReportButton(ctx.from.id)),
  );
  await ctx.telegram.sendMessage(result.partnerId, "Kalau kamu ingin, aku bisa mencarikan teman baru.", html(findButton()));
}

async function skipChat(ctx) {
  const result = await chats.endChat(ctx.from.id);
  if (result.status === "ended") {
    await ctx.telegram.sendMessage(
      result.partnerId,
      "<i>Teman ngobrolmu telah mencari obrolan lain.</i>\n\nKalau ada hal yang perlu kami ketahui, kamu masih bisa melaporkannya lewat tombol di bawah.",
      html(postChatReportButton(ctx.from.id)),
    );
    await ctx.telegram.sendMessage(result.partnerId, "Kalau kamu masih ingin mengobrol, aku bisa mencarikan teman baru.", html(findButton()));
  }
  return findMatch(ctx);
}

async function stopSearching(ctx) {
  await chats.endChat(ctx.from.id);
  return ctx.reply(
    "🦉 <i>Pencarian teman ngobrol sudah dihentikan.</i>\n\nKalau kamu siap lagi, aku bisa mencarikan teman ngobrol.",
    html(findButton()),
  );
}

bot.start(async (ctx) => {
  const profile = await chats.ensureProfile(ctx.from.id);
  if (!profile.gender) return promptProfile(ctx, profile);
  return findMatch(ctx);
});
bot.command("profile", async (ctx) => {
  const profile = await chats.ensureProfile(ctx.from.id);
  if (!profile.gender) return promptProfile(ctx, profile);
  return showProfile(ctx, profile);
});
bot.command("settings", async (ctx) => {
  const profile = await chats.ensureProfile(ctx.from.id);
  if (!profile.gender) return promptProfile(ctx, profile);
  return showSettings(ctx, profile);
});
bot.command("plus", async (ctx) => showPlus(ctx, await chats.ensureProfile(ctx.from.id)));

bot.action(/^profile:gender:(.+)$/, async (ctx) => {
  const value = ctx.match[1];
  if (!["male", "female"].includes(value))
    return ctx.answerCbQuery("Pilihan itu sudah tidak tersedia.");

  const profile = await chats.ensureProfile(ctx.from.id);
  const wasReady = Boolean(profile.gender);
  const updated = await chats.updateProfile(ctx.from.id, {
    gender: value,
    profile_step: "complete",
    profile_completed_at: new Date().toISOString(),
  });
  await ctx.answerCbQuery("Tersimpan.");
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  if (wasReady) return showProfile(ctx, updated, "Gender kamu sudah diperbarui.");
  return promptProfile(ctx, updated);
});

bot.action("profile:edit:gender", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  return ctx.reply("Pilih gender yang ingin ditampilkan di profilmu.", html(genderButtons()));
});

bot.action("settings:plus", async (ctx) => {
  await ctx.answerCbQuery();
  return showPlus(ctx, await chats.ensureProfile(ctx.from.id));
});

bot.action("settings:preference", async (ctx) => {
  const profile = await chats.ensureProfile(ctx.from.id);
  if (!isPlusActive(profile)) return ctx.answerCbQuery("Fitur ini khusus untuk Owel Plus.");
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  return ctx.reply(
    "🎯 <b>Preferensi gender</b>\n\nSiapa yang ingin kamu cari? Preferensi ini berlaku saat pencarian berikutnya.",
    html(Markup.inlineKeyboard([
      [Markup.button.callback("👨 Laki-laki", "settings:preference:male")],
      [Markup.button.callback("👩 Perempuan", "settings:preference:female")],
      [Markup.button.callback("🌍 Semua", "settings:preference:all")],
    ])),
  );
});

bot.action(/^settings:preference:(male|female|all)$/, async (ctx) => {
  const profile = await chats.ensureProfile(ctx.from.id);
  if (!isPlusActive(profile)) return ctx.answerCbQuery("Fitur ini khusus untuk Owel Plus.");
  const preference = ctx.match[1];
  const updated = await chats.updateProfile(ctx.from.id, { match_gender_preference: preference });
  await ctx.answerCbQuery("Preferensi disimpan.");
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  return showSettings(ctx, updated, `Pencarian akan diprioritaskan ke ${preferenceLabel(preference).toLowerCase()}.`);
});

bot.action("settings:media-filter", async (ctx) => {
  const profile = await chats.ensureProfile(ctx.from.id);
  if (!isPlusActive(profile)) return ctx.answerCbQuery("Fitur ini khusus untuk Owel Plus.");
  const updated = await chats.updateProfile(ctx.from.id, {
    media_filter_enabled: !profile.media_filter_enabled,
  });
  await ctx.answerCbQuery(updated.media_filter_enabled ? "Sensor media diaktifkan." : "Sensor media dinonaktifkan.");
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  return showSettings(ctx, updated);
});

bot.action(/^plus:buy:(weekly|monthly|quarterly|yearly)$/, async (ctx) => {
  const planKey = ctx.match[1];
  const plan = plusPlans[planKey];
  await ctx.answerCbQuery();
  if (!paymentProviderToken)
    return ctx.reply("Pembayaran Owel Plus belum tersedia. Silakan hubungi admin Owel untuk informasi aktivasi membership.");
  return ctx.replyWithInvoice({
    title: `Owel Plus — ${plan.label}`,
    description: `Membership Owel Plus selama ${plan.label}`,
    payload: `owel_plus_${planKey}`,
    provider_token: paymentProviderToken,
    currency: "IDR",
    prices: [{ label: `Owel Plus ${plan.label}`, amount: plan.price }],
    start_parameter: `owel-plus-${planKey}`,
  });
});

bot.on("pre_checkout_query", async (ctx) => {
  const query = ctx.update.pre_checkout_query;
  if (!/^owel_plus_(weekly|monthly|quarterly|yearly)$/.test(query.invoice_payload))
    return ctx.answerPreCheckoutQuery(false, "Produk ini sudah tidak tersedia.");
  return ctx.answerPreCheckoutQuery(true);
});

bot.on("successful_payment", async (ctx) => {
  const payment = ctx.message.successful_payment;
  const planKey = payment.invoice_payload.replace("owel_plus_", "");
  const plan = plusPlans[planKey];
  if (!plan) return;
  const profile = await chats.activatePremium(ctx.from.id, plan.days, planKey);
  const activeUntil = new Date(profile.premium_until).toLocaleDateString("id-ID", {
    day: "numeric", month: "long", year: "numeric",
  });
  return ctx.reply(`✨ <b>Owel Plus aktif!</b>\n\nTerima kasih. Membership kamu aktif sampai <b>${activeUntil}</b>. Kamu sekarang bisa mengatur preferensi gender di /settings.`, html());
});

bot.action("find", async (ctx) => {
  await ctx.answerCbQuery();
  await findMatch(ctx);
});
bot.action(/^post_report:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.editMessageText(
    "🦉 <i>Terima kasih sudah memberi tahu aku.</i>\n\nPilih alasan yang paling sesuai. Laporanmu akan kami tinjau.",
    html(postChatReportReasons(ctx.match[1])),
  );
});
bot.action("post_report_cancel", async (ctx) => {
  await ctx.answerCbQuery("Laporan dibatalkan.");
  return ctx.editMessageText("🦉 <i>Baik, laporan dibatalkan.</i>", html());
});
bot.action(/^post_report_reason:(\d+):(.+)$/, async (ctx) => {
  const [, partnerId, reasonCode] = ctx.match;
  const reason = reportReasonLabels[reasonCode];
  if (!reason) return ctx.answerCbQuery("Pilihan itu sudah tidak tersedia.");
  const result = await chats.reportEndedChat(ctx.from.id, Number(partnerId), reason);
  if (result.status !== "ended")
    return ctx.answerCbQuery("Waktu untuk melaporkan percakapan ini sudah berakhir.");
  await ctx.answerCbQuery("Terima kasih.");
  return ctx.editMessageText(
    "🦉 <i>Laporanmu sudah aku terima.</i>\n\nTerima kasih sudah membantu menjaga Owel tetap aman.",
    html(
      Markup.inlineKeyboard([
        [Markup.button.callback("🚫 Ya, blokir", `block:${result.reportId}`)],
        [Markup.button.callback("Tidak, hanya laporkan", "block:skip")],
      ]),
    ),
  );
});
bot.action(/^report:(.+)$/, async (ctx) => {
  const reasonCode = ctx.match[1];
  if (reasonCode === "cancel") {
    await ctx.answerCbQuery("Laporan dibatalkan.");
    return ctx.editMessageText("🦉 <i>Baik, laporan dibatalkan.</i>", html());
  }
  const reason = reportReasonLabels[reasonCode];
  if (!reason) return ctx.answerCbQuery("Pilihan itu sudah tidak tersedia.");
  const result = await chats.report(ctx.from.id, reason);
  if (result.status === "not_matched")
    return ctx.answerCbQuery("Obrolan ini sudah selesai.");

  await ctx.answerCbQuery("Terima kasih.");
  await ctx.editMessageText(
    `🦉 <i>Terima kasih.</i>\n\n<i>Laporanmu sudah aku terima dan obrolan ini sudah selesai.</i>\n\nApakah kamu juga ingin memblokir orang ini?`,
    html(
      Markup.inlineKeyboard([
        [Markup.button.callback("🚫 Ya, blokir", `block:${result.reportId}`)],
        [Markup.button.callback("Tidak, hanya laporkan", "block:skip")],
      ]),
    ),
  );
  await ctx.telegram.sendMessage(
    result.partnerId,
    "<i>Teman ngobrolmu sudah mengakhiri obrolan ini.</i>\n\nKalau kamu ingin, aku bisa mencarikan teman baru.",
    html(findButton()),
  );
});
bot.action(/^block:(.+)$/, async (ctx) => {
  const reportId = ctx.match[1];
  if (reportId === "skip") {
    await ctx.answerCbQuery("Baik, orang ini tidak diblokir.");
    await ctx.editMessageText(
      "🦉 <i>Laporanmu tetap tersimpan.</i>\n\nOrang ini tidak akan diblokir.",
      html(),
    );
    return ctx.reply("Kalau kamu mau, aku bisa mencarikan teman ngobrol.", html(findButton()));
  }
  const blocked = await chats.blockReportedUser(ctx.from.id, reportId);
  await ctx.answerCbQuery(
    blocked
      ? "Orang ini sudah diblokir."
      : "Permintaan ini sudah tidak tersedia.",
  );
  await ctx.editMessageText(
    blocked
      ? "🦉 <i>Laporanmu sudah aku terima.</i>\n\nOrang ini sudah diblokir dan tidak akan dipasangkan denganmu lagi."
      : "<i>Laporan ini sudah diproses sebelumnya.</i>",
    html(),
  );
  return ctx.reply("Kalau kamu mau, aku bisa mencarikan teman ngobrol.", html(findButton()));
});
bot.hears("🔎 Cari teman bicara", findMatch);
bot.hears("⏹ Akhiri chat", finishChat);
bot.hears("⏹ Akhiri pencarian", stopSearching);
bot.hears("⏭ Lewati", skipChat);
bot.hears("🚩 Laporkan", (ctx) =>
  ctx.reply(
    "🦉 <i>Aku di sini untuk membantumu merasa aman.</i>\n\nPilih alasan yang paling sesuai. Setelah laporan dikirim, obrolan ini akan selesai.",
    html(reportReasons()),
  ),
);
bot.command("next", skipChat);
bot.command("stop", finishChat);

bot.on("text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return;
  let profile = await chats.ensureProfile(ctx.from.id);
  if (profile.gender && profile.profile_step !== "complete")
    profile = await chats.updateProfile(ctx.from.id, {
      profile_step: "complete",
      profile_completed_at:
        profile.profile_completed_at || new Date().toISOString(),
    });
  if (profile.profile_step !== "complete" || !profile.gender) {
    return ctx.reply(
      "Pilih salah satu tombol gender di atas dulu ya.",
      html(genderButtons()),
    );
  }
  const partnerId = await chats.getPartner(ctx.from.id);
  if (!partnerId)
    return ctx.reply(
      "🦉 <i>Kamu belum mengobrol dengan siapa pun.</i>\n\nKalau kamu mau, aku bisa mencarikan teman ngobrol.",
      html(findButton()),
    );
  if (isSuspicious(ctx.from.id, text))
    return ctx.reply(
      "<i>Pesanmu belum bisa dikirim.</i>\n\nCoba kirim pesan yang lebih sederhana, tanpa tautan atau pengulangan berlebihan.",
      html(),
    );
  await chats.recordEvidence(ctx.from.id, "text", text);
  const delivered = await ctx.telegram.sendMessage(partnerId, text, await replyOptions(ctx));
  await chats.saveMessageLink(
    ctx.from.id,
    ctx.message.message_id,
    partnerId,
    delivered.message_id,
  );
});

async function getActivePartnerOrNotify(ctx) {
  const partnerId = await chats.getPartner(ctx.from.id);
  if (partnerId) return partnerId;
  await ctx.reply(
    "🦉 <i>Kamu belum sedang mengobrol dengan siapa pun.</i>\n\nKalau kamu mau, aku bisa mencarikan teman ngobrol.",
    html(findButton()),
  );
  return null;
}

async function replyOptions(ctx) {
  const repliedMessageId = ctx.message.reply_to_message?.message_id;
  if (!repliedMessageId) return {};
  const target = await chats.getReplyTarget(ctx.from.id, repliedMessageId);
  if (!target) return {};
  return { reply_parameters: { message_id: target.messageId } };
}

const mediaFields = [
  "photo",
  "sticker",
  "animation",
  "video",
  "video_note",
  "voice",
  "audio",
  "document",
];

bot.on("message", async (ctx) => {
  // Pesan teks diproses oleh handler di atas. Hanya media yang diteruskan di sini.
  if (!mediaFields.some((field) => ctx.message[field])) return;
  const partnerId = await getActivePartnerOrNotify(ctx);
  if (!partnerId) return;

  const caption = ctx.message.caption;
  if (caption && isSuspicious(ctx.from.id, caption)) {
    return ctx.reply(
      "<i>Media ini belum bisa dikirim.</i>\n\nCoba kirim ulang tanpa tautan atau pengulangan berlebihan.",
      html(),
    );
  }
  const mediaType = mediaFields.find((field) => ctx.message[field]);
  const media =
    mediaType === "photo" ? ctx.message.photo.at(-1) : ctx.message[mediaType];
  await chats.recordEvidence(
    ctx.from.id,
    mediaType,
    caption || null,
    media.file_unique_id || null,
    media.file_id || null,
  );
  const partnerProfile = await chats.getProfile(partnerId);
  if (isPlusActive(partnerProfile) && partnerProfile.media_filter_enabled)
    return ctx.reply(
      "Media tidak diteruskan karena sensor media teman bicara sedang aktif.",
      html(),
    );
  const copied = await ctx.telegram.copyMessage(
    partnerId,
    ctx.chat.id,
    ctx.message.message_id,
    await replyOptions(ctx),
  );
  await chats.saveMessageLink(
    ctx.from.id,
    ctx.message.message_id,
    partnerId,
    copied.message_id,
  );
});

bot.catch((error) => console.error("Telegram update gagal:", error));

const app = express();
app.get("/", (_req, res) => res.status(200).send("Owel bot aktif."));
app.use(express.urlencoded({ extended: false }));
createAdminRouter(app, chats, bot.telegram);
app.use(bot.webhookCallback("/telegram-webhook"));

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () =>
    console.log(`Server Owel berjalan di http://localhost:${port}.`),
  );

  if (process.env.NODE_ENV !== "production") {
    bot
      .launch()
      .then(() => console.log("Bot Owel berjalan dengan polling lokal."));
  }
}

// Ekspor Express app sebagai default agar Vercel dapat menjalankannya sebagai
// serverless function. Properti tambahan tetap tersedia untuk webhook dan skrip lokal.
module.exports = app;
module.exports.bot = bot;
module.exports.chats = chats;
