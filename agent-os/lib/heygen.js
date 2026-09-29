/**
 * HEYGEN — avatar parlant, brique PARTAGÉE (comme lib/voices.js et lib/music.js).
 *
 * Sert à incruster un présentateur dans une vidéo. Conçue autour d'une contrainte dure :
 * le plan gratuit autorise **3 vidéos par mois, 60 secondes maximum chacune**. Une machine
 * qui l'ignore échoue au milieu d'un run — on préfère le savoir AVANT de lancer.
 *
 * ⚠ API v3 obligatoire. `/v2/video/generate` est LEGACY et retiré le 31 octobre 2026 ;
 * son propre avertissement dit aux agents de ne pas l'employer.
 *   POST https://api.heygen.com/v3/videos      { type:"avatar", avatar_id, audio_url|script, voice, ... }
 *   GET  https://api.heygen.com/v3/videos/:id  -> status, video_url
 *
 * ARCHITECTURE RETENUE — l'avatar ne parle pas, il MIME :
 *   1. une seule voix (ElevenLabs) narre TOUT le script ;
 *   2. les 60 premières secondes de cet audio sont envoyées ici en `audio_url` ;
 *   3. HeyGen se contente d'animer le visage dessus.
 * La voix est donc identique du début à la fin de la vidéo, et on ne dépend pas de la TTS
 * de HeyGen — inaccessible sur le plan gratuit (403 sur /v1/tts.generate).
 */
const fs = require("fs");
const path = require("path");
const { readJSON, writeJSON, ensureDir } = require("./store");
const vault = require("./vault");
const spend = require("./spend");

const API = "https://api.heygen.com";
const OUT_DIR = path.join(__dirname, "..", "output", "heygen");
ensureDir(OUT_DIR);

/** Plafonds du plan. Modifiables si l'abonnement change. */
const LIMITS = { perMonth: 3, maxSeconds: 60 };

const key = () => {
  const k = vault.get("heygen");
  if (!k) throw new Error("Clé HeyGen absente du coffre");
  return k;
};
const H = (json) => ({ "X-Api-Key": key(), accept: "application/json", ...(json ? { "Content-Type": "application/json" } : {}) });

// ---------------------------------------------------------------- registre local

/**
 * Registre LOCAL des générations. On ne se repose pas uniquement sur l'API : le comptage
 * mensuel doit rester juste même si un endpoint de liste disparaît (v1 y est candidat).
 * data/heygen-ledger.json : [{ id, at, seconds, machine, note }]
 */
const ledger = () => readJSON("heygen-ledger.json", []);
const saveLedger = (l) => writeJSON("heygen-ledger.json", l.slice(-200));
const monthKey = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const thisMonth = () => ledger().filter((x) => String(x.at).slice(0, 7) === monthKey()).length;

// ---------------------------------------------------------------- état

/** Crédits restants côté HeyGen + générations du mois (registre local, recoupé avec l'API). */
async function quota() {
  let credits = null;
  try {
    const q = await fetch(`${API}/v2/user/remaining_quota`, { headers: H() }).then((r) => r.json());
    credits = q.data?.remaining_quota ?? null;
  } catch {}
  let apiMonth = null;
  try {
    const l = await fetch(`${API}/v1/video.list?limit=50`, { headers: H() }).then((r) => r.json());
    // ⚠ Ne compter QUE les vidéos réellement produites : une génération `failed` ne consomme
    //   rien (vérifié : crédits inchangés) et ne doit donc pas amputer le quota mensuel.
    apiMonth = (l.data?.videos || []).filter((v) =>
      v.status === "completed" &&
      new Date((v.created_at || 0) * 1000).toISOString().slice(0, 7) === monthKey()
    ).length;
  } catch {}
  const local = thisMonth();
  // On retient le PLUS GRAND des deux : sous-estimer conduirait à un appel refusé en plein run.
  const used = Math.max(local, apiMonth ?? 0);
  return {
    credits, usedThisMonth: used, localCount: local, apiCount: apiMonth,
    perMonth: LIMITS.perMonth, remaining: Math.max(0, LIMITS.perMonth - used),
    maxSeconds: LIMITS.maxSeconds, month: monthKey(),
  };
}

/** Peut-on générer ? Rend toujours une RAISON lisible — jamais un simple false. */
async function canGenerate(seconds) {
  const q = await quota();
  if (seconds != null && seconds > LIMITS.maxSeconds)
    return { ok: false, reason: `Durée ${seconds.toFixed(1)} s > ${LIMITS.maxSeconds} s autorisées par le plan`, quota: q };
  if (q.remaining <= 0)
    return { ok: false, reason: `Quota mensuel atteint (${q.usedThisMonth}/${q.perMonth} ce mois-ci)`, quota: q };
  return { ok: true, quota: q };
}

// ---------------------------------------------------------------- catalogue

/** Groupes d'avatars personnels (un avatar créé par l'utilisateur est un GROUPE, pas un avatar). */
async function avatarGroups() {
  const g = await fetch(`${API}/v2/avatar_group.list`, { headers: H() }).then((r) => r.json());
  return (g.data?.avatar_group_list || []).map((x) => ({
    id: x.id, name: x.name, looks: x.num_looks, preview: x.preview_image, defaultVoiceId: x.default_voice_id,
  }));
}
/** Déclinaisons d'un groupe. ⚠ C'est le `id` d'un LOOK qui sert d'`avatar_id` à la génération. */
async function looks(groupId) {
  const l = await fetch(`${API}/v2/avatar_group/${groupId}/avatars`, { headers: H() }).then((r) => r.json());
  // ⚠ Le champ d'identifiant n'est pas uniforme selon les entrées (`id` ou `avatar_id`), et
  //   certaines n'en ont aucun. On normalise et on écarte les inexploitables.
  return (l.data?.avatar_list || [])
    .map((x) => ({ id: x.id || x.avatar_id || null, name: x.name || "", status: x.status || "", preview: x.image_url || x.preview_image_url || null }))
    .filter((x) => x.id);
}

// ---------------------------------------------------------------- génération

/**
 * Génère un clip d'avatar. `audioUrl` (recommandé) OU `script` + `voiceId`.
 * Refuse AVANT tout appel si le quota ou la durée ne passent pas — un run ne doit jamais
 * mourir au milieu pour une limite connue d'avance.
 */
async function generate({ avatarId, audioUrl = null, script = null, voiceId = null,
                          seconds = null, machine = "HeyGen", note = "", timeoutMs = 15 * 60 * 1000 } = {}) {
  if (!avatarId) throw new Error("avatarId requis (id d'un LOOK, pas du groupe)");
  if (!audioUrl && !script) throw new Error("audioUrl ou script requis");
  const gate = await canGenerate(seconds);
  if (!gate.ok) throw new Error(`HeyGen : ${gate.reason}`);

  const body = { type: "avatar", avatar_id: avatarId, aspect_ratio: "auto", resolution: "1080p" };
  if (audioUrl) body.audio_url = audioUrl;
  else { body.script = script; if (voiceId) body.voice = { voice_id: voiceId }; }

  const r = await fetch(`${API}/v3/videos`, { method: "POST", headers: H(true), body: JSON.stringify(body) }).then((x) => x.json());
  if (r.error) throw new Error(`HeyGen : ${r.error.message || JSON.stringify(r.error).slice(0, 160)}`);
  const id = r.data?.video_id;
  if (!id) throw new Error(`HeyGen : aucun video_id (${JSON.stringify(r).slice(0, 160)})`);

  const t0 = Date.now();
  for (;;) {
    await new Promise((s) => setTimeout(s, 8000));
    if (Date.now() - t0 > timeoutMs) throw new Error("HeyGen : délai dépassé");
    const st = await fetch(`${API}/v3/videos/${id}`, { headers: H() }).then((x) => x.json()).catch(() => ({}));
    const d = st.data || {};
    if (d.status === "completed") {
      const l = ledger();
      l.push({ id, at: new Date().toISOString(), seconds: d.duration || seconds || null, machine, note });
      saveLedger(l);
      spend.record("HeyGen", machine, 0, "USD", `Avatar ${(d.duration || 0).toFixed?.(1) || "?"} s (quota plan, hors facturation)`);
      return { id, url: d.video_url, seconds: d.duration || null, thumbnail: d.thumbnail_url || null };
    }
    if (d.status === "failed") throw new Error(`HeyGen : échec — ${JSON.stringify(d.error || d).slice(0, 200)}`);
  }
}

async function download(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Téléchargement HeyGen ${r.status}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  return file;
}

module.exports = { LIMITS, quota, canGenerate, avatarGroups, looks, generate, download, ledger, OUT_DIR };
