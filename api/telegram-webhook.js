const { bot } = require("../index");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  return bot.handleUpdate(req.body, res);
};
