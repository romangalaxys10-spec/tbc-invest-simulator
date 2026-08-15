// Telegram Bot notification proxy & webhook setup:
// 1. Tests credentials and registers bot webhook URL with Telegram.
// 2. Sends trade/signal alerts (paper trading notifications).
// Users supply their own bot token + chat ID.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { botToken, chatId, message, testOnly, token: accountToken, webhookOrigin } = req.body || {};

  const cleanToken = typeof botToken === "string" ? botToken.trim() : "";
  const cleanChatId = typeof chatId === "string" || typeof chatId === "number" ? String(chatId).trim() : "";

  if (!cleanToken || !/^[0-9]+:[A-Za-z0-9_-]{30,50}$/.test(cleanToken)) {
    return res.status(400).json({ error: "Invalid Telegram Bot Token format (expected 123456:ABC-DEF...)" });
  }

  if (!cleanChatId || !/^-?[0-9]{5,20}$/.test(cleanChatId)) {
    return res.status(400).json({ error: "Invalid Chat ID format (expected numeric ID like 123456789 or -100...)" });
  }

  // 1. Register Webhook with Telegram if origin provided (enables 2-way commands)
  if (testOnly && webhookOrigin) {
    try {
      const cleanOrigin = String(webhookOrigin).replace(/\/$/, "");
      const webhookUrl = `${cleanOrigin}/api/telegram-webhook?botToken=${encodeURIComponent(cleanToken)}${accountToken ? `&token=${encodeURIComponent(accountToken)}` : ""}`;
      
      await fetch(`https://api.telegram.org/bot${cleanToken}/setWebhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          drop_pending_updates: true,
          allowed_updates: ["message", "callback_query"],
        }),
      });

      // Register bot commands menu with Telegram
      await fetch(`https://api.telegram.org/bot${cleanToken}/setMyCommands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commands: [
            { command: "portfolio", description: "Live equity, cash & open positions" },
            { command: "price", description: "Live price & day change (e.g. /price AAPL)" },
            { command: "radar", description: "Top high-strength market breakouts" },
            { command: "shreds", description: "Real-time flow & buy/sell cans pressure" },
            { command: "help", description: "Command guide & account info" },
          ],
        }),
      });
    } catch (e) {
      console.warn("setWebhook failed (non-fatal):", e.message);
    }
  }

  const tgUrl = `https://api.telegram.org/bot${cleanToken}/sendMessage`;
  const textToSend = testOnly
    ? `🔔 <b>TBC Invest Simulator</b>\n\n✅ <b>Telegram Bot Connected!</b>\nYour bot is now attached to your account token (<code>${accountToken ? `••••${accountToken.slice(-4)}` : "local account"}</code>).\n\n⚡ <b>Interactive Two-Way Commands are Active:</b>\n• <code>/portfolio</code> or <code>/p</code> — Live equity, cash & open positions\n• <code>/price AAPL</code> or <code>/q BTC-USD</code> — Live quotes & change\n• <code>/radar</code> — Top market breakout signals\n• <code>/shreds SOL-USD</code> — Live buy/sell cans & flow\n• <code>/help</code> — Full command reference\n\n🔔 <i>You will also receive instant alerts for trade executions, stop-loss/take-profit triggers, and radar alerts!</i>`
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
