/**
 * Transport FAL.ai (queue.fal.run) — pattern asynchrone submit → poll status → get result.
 * Clé : coffre (fal) ou ../.env (FAL). Auth « Authorization: Key <clé> ».
 * Utilisé par la machine Linguistique : ElevenLabs v3 (voix), Whisper (sous-titres), lipsync.
 */
const fs = require("fs");
const path = require("path");
const vault = require("./vault");

function falKey() {
  const k = vault.get("fal");
  if (k) return k;
  try {
    const txt = fs.readFileSync(path.join(__dirname, "..", "..", ".env"), "utf8");
    const m = /^FAL=(.+)$/m.exec(txt);
    if (m) return m[1].trim();
  } catch {}
  throw new Error("Clé FAL absente (coffre « FAL.ai » ou .env)");
}
function configured() {
  try { return !!falKey(); } catch { return false; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Soumet un job FAL et attend le résultat.
 * @param model  ex. "fal-ai/elevenlabs/text-to-dialogue/eleven-v3"
 * @param input  corps JSON du modèle
 * @param opts   { timeoutMs, intervalMs, cancelled: () => bool }
 * @returns le JSON de sortie du modèle (ex. { audio:{url} }, { video:{url} }, { chunks:[...] })
 */
async function run(model, input, { timeoutMs = 12 * 60 * 1000, intervalMs = 4000, cancelled } = {}) {
  const key = falKey();
  const auth = { Authorization: `Key ${key}` };
  const submit = await fetch(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const sub = await submit.json().catch(() => ({}));
  if (!submit.ok && !sub.response_url) {
    throw new Error(`FAL ${model} : ${sub.detail ? JSON.stringify(sub.detail).slice(0, 200) : (sub.error || submit.status)}`);
  }
  // Certains modèles renvoient directement le résultat (pas de file d'attente)
  if (!sub.response_url && !sub.status_url) return sub;

  const statusUrl = sub.status_url;
  const responseUrl = sub.response_url;
  const t0 = Date.now();
  while (true) {
    await sleep(intervalMs);
    if (cancelled && cancelled()) {
      if (sub.cancel_url) fetch(sub.cancel_url, { method: "PUT", headers: auth }).catch(() => {});
      throw new Error("Annulée par l'utilisateur");
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`FAL ${model} : délai dépassé`);
    let st = {};
    try {
      st = await fetch(statusUrl, { headers: auth }).then((r) => r.json());
    } catch {
      continue; // erreur réseau ponctuelle : on retente au prochain tick
    }
    const state = String(st.status || "").toUpperCase();
    if (state === "COMPLETED") {
      const res = await fetch(responseUrl, { headers: auth }).then((r) => r.json());
      if (res && res.error) throw new Error(`FAL ${model} : ${JSON.stringify(res.error).slice(0, 200)}`);
      return res;
    }
    if (state === "FAILED" || state === "ERROR" || st.error) {
      throw new Error(`FAL ${model} : échec — ${JSON.stringify(st.error || st.detail || st).slice(0, 200)}`);
    }
    // IN_QUEUE / IN_PROGRESS → on continue
  }
}

async function download(url, file) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Téléchargement FAL ${resp.status}`);
  fs.writeFileSync(file, Buffer.from(await resp.arrayBuffer()));
  return file;
}

module.exports = { run, download, configured, falKey };
