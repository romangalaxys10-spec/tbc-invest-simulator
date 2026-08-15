// Telegram Bot notification proxy: tests credentials and sends trade/signal alerts.
// Paper trading & alert notifications only. Users supply their own bot token + chat ID.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { botToken, chatId, message, testOnly } = req.body || {};

  const cleanToken = typeof botToken === "string" ? botToken.trim() : "";
  const cleanChatId = typeof chatId === "string" || typeof chatId === "number" ? String(chatId).trim() : "";

  if (!cleanToken || !/^[0-9]+:[A-Za-z0-9_-]{30,50}$/.test(cleanToken)) {
    return res.status(400).json({ error: "Invalid Telegram Bot Token format (expected 123456:ABC-DEF...)" });
  }

  if (!cleanChatId || !/^-?[0-9]{5,20}$/.test(cleanChatId)) {
    return res.status(400).json({ error: "Invalid Chat ID format (expected numeric ID like 123456789 or -100...)" });
  }

  const tgUrl = `https://api.telegram.org/bot${cleanToken}/sendMessage`;
  const textToSend = testOnly
    ? `🔔 <b>TBC Invest Simulator</b>\n\n✅ <b>Telegram Notifications Connected!</b>\nYour bot is now attached to your TBC account token.\n\nYou will receive live updates for:\n• ⚡ Order fills & executions\n• 🛑 Stop-loss & 🎯 Take-profit triggers\n• ⏳ Pending order fills\n• 🚨 High-strength Radar market alerts`
    : String(message || "🔔 TBC Invest Notification").slice(0, 4000);

  try {
    const r = await fetch(tgUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: cleanChatId,
        text: textToSend,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    const j = await r.json();
    if (!r.ok || !j.ok) {
      return res.status(400).json({
        error: j.description || `Telegram API error (${r.status})`,
        details: j,
      });
    }

    return res.status(200).json({ ok: true, messageId: j.result?.message_id });
  } catch (e) {
    return res.status(502).json({ error: `Could not reach Telegram API (${e.message})` });
  }
}
