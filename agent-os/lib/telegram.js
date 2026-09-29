/**
 * Notifications Telegram (bot token + chat id lus dans le coffre).
 * - send(text) : message simple.
 * - sendWithButtons(text, buttons) : message avec boutons inline (callback_data).
 * - startCallbackLoop(handler) : long-poll getUpdates (1 seul consommateur par bot) pour
 *   recevoir les clics sur les boutons — permet p.ex. de relancer un run depuis Telegram.
 */
const vault = require("./vault");

function creds() {
  return { token: vault.get("telegram_token"), chatId: vault.get("telegram_chat_id") };
}

async function send(text) {
  const { token, chatId } = creds();
  if (!token || !chatId) {
    return { ok: false, error: "Telegram non configuré (token ou chat id manquant dans le coffre)" };
  }
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    const data = await resp.json();
    return { ok: !!data.ok, error: data.ok ? null : data.description };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** buttons = [{text, data}] — affichés sur une ligne sous le message. */
async function sendWithButtons(text, buttons) {
  const { token, chatId } = creds();
  if (!token || !chatId) return { ok: false, error: "Telegram non configuré" };
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [buttons.map((b) => ({ text: b.text, callback_data: String(b.data).slice(0, 64) }))] },
      }),
    });
    const data = await resp.json();
    return { ok: !!data.ok, error: data.ok ? null : data.description };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Long-poll getUpdates : PAS un polling agressif — une requête bloquante de 50 s en continu
// (le standard Telegram pour un bot sans webhook). Un seul loop par processus.
let loopStarted = false;
function startCallbackLoop(handler) {
  if (loopStarted) return;
  loopStarted = true;
  let offset = 0;
  (async () => {
    while (true) {
      const { token } = creds();
      if (!token) {
        await new Promise((r) => setTimeout(r, 60000)); // pas configuré : on re-vérifie dans 1 min
        continue;
      }
      try {
        const resp = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=50&offset=${offset}&allowed_updates=%5B%22callback_query%22%5D`);
        const data = await resp.json();
        for (const u of data.result || []) {
          offset = u.update_id + 1;
          const q = u.callback_query;
          if (!q) continue;
          let answer = "OK";
          try {
            answer = (await handler(q.data, q)) || "OK";
          } catch (e) {
            answer = "Erreur : " + e.message.slice(0, 150);
          }
          await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ callback_query_id: q.id, text: answer.slice(0, 190) }),
          }).catch(() => {});
        }
      } catch {
        await new Promise((r) => setTimeout(r, 15000)); // réseau KO : on retente dans 15 s
      }
    }
  })();
}

module.exports = { send, sendWithButtons, startCallbackLoop };
