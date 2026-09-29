/**
 * BIBLIOTHÈQUE DE VOIX — partagée par toutes les machines.
 *
 * Pourquoi ici et pas dans une machine : trois machines ont déjà besoin d'une voix
 * (Bouddhisme : une par run ; Linguistique : une par personnage ; Drama : une par
 * personnage récurrent). Dupliquer la table trois fois, c'est trois divergences.
 *
 * Chaque voix porte :
 *   - son MOTEUR (`inworld` ou `elevenlabs`) — ils n'attendent PAS la même chose dans `voice` :
 *       inworld    → un nom suffixé de la langue, ex. "Alain (fr)" (catalogue fermé)
 *       elevenlabs → un nom OU un ID de bibliothèque, ex. "hndZlkpVm5i9lXBY9CKj" (chaîne libre)
 *   - son DÉBIT INDICATIF (mots/min), MÉDIANE de 3 synthèses du même texte.
 *
 * ⚠ MESURÉ LE 01/09/2026 : ElevenLabs v3 n'est PAS déterministe. Trois synthèses de la même
 * phrase par la même voix donnent 130 / 147 / 148 (Aminata) et 162 / 160 / 145 (Mila), soit
 * 12 à 14 % d'écart. Conséquences, qui commandent tout le reste :
 *   1. une mesure unique est du bruit → on prend la médiane de 3, et on stocke l'écart ;
 *   2. le débit sert à CHOISIR une voix, jamais à PRÉDIRE une durée ;
 *   3. une machine ne doit JAMAIS calculer un montage depuis un débit attendu. Elle synthétise,
 *      elle sonde le fichier obtenu (ffprobe), et elle cale la VIDÉO dessus. C'est déjà la règle
 *      d'or du journal des machines — ceci en donne la raison chiffrée.
 *   - un ÉCHANTILLON audio généré une fois, pour l'écoute dans l'interface.
 */
const fs = require("fs");
const path = require("path");
const { DATA_DIR, ensureDir, readJSON, writeJSON } = require("./store");
const fal = require("./fal");
const spend = require("./spend");
const ff = require("./ffmpeg");

const OUT_DIR = path.join(__dirname, "..", "output", "voices");
ensureDir(OUT_DIR);

const ENGINES = ["inworld", "elevenlabs"];
const PRICE_PER_1K = { inworld: 0.015, elevenlabs: 0.10 };

/** Phrase d'échantillon : neutre, ni contemplative ni dramatique, pour comparer des timbres. */
const SAMPLE_TEXT =
  "Elle poussa la porte sans frapper. Dans la pièce, personne ne l'attendait plus depuis longtemps, " +
  "et pourtant tout était resté exactement à sa place.";
const SAMPLE_WORDS = SAMPLE_TEXT.split(/\s+/).length;

function db() {
  return readJSON("voices.json", { voices: [] });
}
function save(d) {
  writeJSON("voices.json", d);
}

function list({ engine, gender, language } = {}) {
  let v = db().voices;
  if (engine) v = v.filter((x) => x.engine === engine);
  if (gender === "H" || gender === "F") v = v.filter((x) => x.gender === gender);
  if (language) v = v.filter((x) => !x.language || x.language === language);
  return v.map((x) => ({ ...x, hasSample: !!x.sampleRel && fs.existsSync(path.join(OUT_DIR, `${x.id}.mp3`)) }));
}
const get = (id) => db().voices.find((v) => v.id === id) || null;
const samplePath = (id) => path.join(OUT_DIR, `${id}.mp3`);

/** Chaîne à envoyer au moteur pour cette voix (la subtilité qui casse tout si on l'oublie). */
function engineRef(v, language) {
  if (!v) return "";
  if (v.engine === "elevenlabs") return v.ref;              // nom OU id, tel quel
  const SUF = { "Français": "(fr)", English: "(en)", "Español": "(es)", Deutsch: "(de)", Italiano: "(it)" };
  return `${v.ref} ${SUF[language || v.language || "Français"] || "(fr)"}`;
}

/** Synthétise l'échantillon, mesure le débit réel, renvoie {file, wpm, seconds}. */
async function synthSample(engine, ref, id, language = "Français") {
  const file = samplePath(id);
  // BUG CORRIGÉ : Inworld exige le suffixe de langue ("Alain (fr)"). Envoyer le nom nu
  // renvoie un audio VIDE, sans message d'erreur côté FAL.
  const sent = engine === "inworld" ? engineRef({ engine, ref, language }, language) : ref;
  let url;
  if (engine === "elevenlabs") {
    const r = await fal.run("fal-ai/elevenlabs/tts/eleven-v3", { text: SAMPLE_TEXT, voice: sent });
    url = r.audio?.url;
    if (!url) throw new Error("ElevenLabs : aucun audio renvoyé (ID ou nom de voix invalide ?)");
  } else {
    const r = await fal.run("fal-ai/inworld-tts", { text: SAMPLE_TEXT, voice: sent, sample_rate_hertz: 48000 });
    url = r.audio?.url;
    if (!url) throw new Error("Inworld : aucun audio renvoyé (le nom doit être suffixé, ex. « Alain (fr) »)");
  }
  await fal.download(url, file);
  spend.record("FAL.ai", "Bibliothèque de voix",
    +((SAMPLE_TEXT.length / 1000) * (PRICE_PER_1K[engine] || 0.1)).toFixed(4), "USD",
    `Échantillon de voix (${engine})`);
  const seconds = await ff.probeDuration(file, { label: "échantillon de voix" });
  return { file, seconds, wpm: Math.round(SAMPLE_WORDS / (seconds / 60)) };
}

/**
 * Ajoute une voix : on SYNTHÉTISE d'abord. Un ID invalide échoue ici, jamais au milieu
 * d'un run à 10 $ (piège vécu : « Alain » sans son suffixe rendait un audio vide).
 */
async function add({ name, gender, engine, ref, language = "Français", note = "" } = {}) {
  name = String(name || "").trim();
  ref = String(ref || "").trim();
  if (!name) throw new Error("Nom de voix requis");
  if (!ref) throw new Error("Référence de voix requise (nom Inworld ou ID ElevenLabs)");
  if (!ENGINES.includes(engine)) throw new Error(`Moteur inconnu : ${engine}`);
  const d = db();
  if (d.voices.some((v) => v.engine === engine && v.ref === ref)) throw new Error(`Cette voix est déjà enregistrée (${ref})`);
  const id = "v" + Date.now().toString(36);
  // 3 synthèses : la 1re est CONSERVÉE comme échantillon d'écoute, les 2 autres ne servent
  // qu'à la mesure (v3 varie de 12-14 % d'un appel à l'autre — une seule mesure est du bruit).
  const runs = [];
  const first = await synthSample(engine, ref, id, language);
  runs.push(first.wpm);
  for (let i = 0; i < 2; i++) {
    try { runs.push((await synthSample(engine, ref, id + "-probe", language)).wpm); } catch {}
  }
  try { fs.unlinkSync(samplePath(id + "-probe")); } catch {}
  const sorted = runs.slice().sort((a, b) => a - b);
  const wpm = sorted[Math.floor(sorted.length / 2)];
  const wpmSpread = sorted.length > 1 ? Math.round((100 * (sorted[sorted.length - 1] - sorted[0])) / sorted[0]) : 0;
  const seconds = first.seconds;
  const voice = {
    id, name, gender: gender === "F" ? "F" : gender === "H" ? "H" : "",
    engine, ref, language, note,
    wpm, wpmRuns: runs, wpmSpread, sampleSeconds: +seconds.toFixed(2),
    sampleRel: `agent-os/output/voices/${id}.mp3`,
    addedAt: new Date().toISOString(),
  };
  d.voices.push(voice);
  save(d);
  return voice;
}

/** Régénère l'échantillon et re-mesure le débit (si la voix a changé côté fournisseur). */
async function refresh(id) {
  const d = db();
  const v = d.voices.find((x) => x.id === id);
  if (!v) throw new Error("Voix inconnue");
  const { seconds, wpm } = await synthSample(v.engine, v.ref, v.id, v.language);
  v.wpm = wpm; v.sampleSeconds = +seconds.toFixed(2);
  save(d);
  return v;
}

function remove(id) {
  const d = db();
  d.voices = d.voices.filter((v) => v.id !== id);
  save(d);
  try { fs.unlinkSync(samplePath(id)); } catch {}
  return { ok: true };
}

function patch(id, fields = {}) {
  const d = db();
  const v = d.voices.find((x) => x.id === id);
  if (!v) throw new Error("Voix inconnue");
  for (const k of ["name", "gender", "note", "language"]) if (k in fields) v[k] = fields[k];
  save(d);
  return v;
}

/**
 * atempo INDICATIF pour approcher un débit cible (1 = ne rien toucher).
 * ⚠ À n'utiliser que pour comparer des voix. Ne JAMAIS s'en servir pour calculer une durée
 * de montage : le débit réel varie de 12-14 % d'une synthèse à l'autre (cf. en-tête).
 */
function tempoFor(id, targetWpm) {
  const v = get(id);
  if (!v || !v.wpm || !targetWpm) return 1;
  return +Math.max(0.5, Math.min(2, targetWpm / v.wpm)).toFixed(3);
}

module.exports = { ENGINES, PRICE_PER_1K, SAMPLE_TEXT, list, get, add, refresh, remove, patch, samplePath, engineRef, tempoFor };
