require("dotenv").config();

const { bot } = require("../index");
const baseUrl = process.env.WEBHOOK_URL?.replace(/\/$/, "");

if (!baseUrl)
  throw new Error("WEBHOOK_URL belum diatur. Contoh: https://nama-proyek.vercel.app");

bot.telegram
  .setWebhook(`${baseUrl}/api/telegram-webhook`)
  .then(() => console.log("Webhook Telegram berhasil diatur."));
