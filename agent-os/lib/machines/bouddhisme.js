/**
 * MACHINE BOUDDHISME — « Sagesse & Méditation »
 *
 * Vidéos contemplatives narrées : une parabole ou un enseignement dit par une voix douce,
 * sur des visuels photoréalistes lents, lit musical continu, sous-titres gravés, CTA animé.
 *
 * Tous les réglages par défaut sont MESURÉS sur 5 vidéos de 3 chaînes de la niche puis
 * validés sur un pilote de 8 min — voir agent-os/docs/niche-bouddhisme.md. Les trois
 * constantes qui font le style :
 *   - WORDS_PER_IMAGE : l'image change tous les ~25 mots (unité de sens), jamais à l'horloge
 *   - TEMPO           : Inworld n'a PAS de réglage de vitesse -> atempo + respirations calculées
 *   - MUSIC_VOL       : calibré sur le FICHIER FINI (écart voix/musique ~27 dB, niche : 29 dB)
 *
 * Pipeline : script -> voix (TTS + Whisper + découpe) -> prompts -> images -> musique -> montage -> packaging
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { DATA_DIR, ensureDir, readJSON, writeJSON } = require("../store");
const claude = require("../claude");
const vault = require("../vault");
const fal = require("../fal");
const voicesLib = require("../voices");
const ff = require("../ffmpeg");
const google = require("../google");
const tasks = require("../tasks");
const spend = require("../spend");
const bank = require("../bank");
const intro = require("../intro");
const library = require("./bouddhisme-library");

const MACHINE_ID = "bouddhisme";
const MACHINE_NAME = "Bouddhisme";
const ROOT = path.join(__dirname, "..", "..", "..");
const OUT_ROOT = path.join(__dirname, "..", "..", "output", "machines");
const REMOTION_DIR = path.join(ROOT, "remotion");
const RUNS_DIR = path.join(DATA_DIR, "machines", "runs", MACHINE_ID); // sous-dossier : listRuns ne voit que nos runs
ensureDir(RUNS_DIR);

// ---------------------------------------------------------------- constantes mesurées

const WPM = 122;                 // débit global obtenu (parole + respirations) sur le pilote
const RAW_WPM = 173;             // débit brut d'Inworld, avant ralentissement
const WORDS_PER_IMAGE = 25;      // règle de découpe (niche mesurée : 29 à 44, médiane 34)
const MAX_WORDS_IMAGE = 38;
const TEMPO = { lente: 0.85, "très lente": 0.78 };
const PAUSE_MIN = 0.8, PAUSE_MAX = 3.2;
const OUTRO_GAP = 2.0;           // silence entre la fin du récit et l'outro
const TTS_MAX_CHARS = 1900;      // l'API Inworld refuse au-delà de 2000

const W = 1920, H = 1080, FPS = 30;
const XF = 1.0;                  // fondu enchaîné entre deux images
const KEN_BURNS = 0.08;          // zoom 1.00 -> 1.08
/**
 * Échelle de travail du Ken Burns. ⚠ `zoompan` recadre en pixels ENTIERS : la saccade dépend
 * du rapport entre cette échelle et la taille de SORTIE. À 3840 pour une sortie 1920, un pixel
 * de travail vaut un demi-pixel à l'écran — l'image tremble (signalé au visionnage).
 * Mesuré sur une image réelle (écart-type du PSNR entre images consécutives, 9 s de plan) :
 *   3840 -> 3,45 dB · 1,0 s/plan   |   5120 -> 1,84 dB · 1,4 s   |   7680 -> 1,67 dB · 2,1 s
 * On retient 5120 : 47 % de saccade en moins pour 40 % de rendu en plus. 7680 ne gagne que
 * 0,17 dB de plus en doublant le temps, et la source ne fait que ~1376 px — au-delà,
 * l'interpolation travaille dans le vide.
 */
/** Logo permanent : 95 px sur une sortie 1280 chez Crime → même proportion ici (sortie 1920). */
const CORNER_LOGO_PX = Math.round(95 * 1920 / 1280);
const CORNER_LOGO_M = Math.round(26 * 1920 / 1280);
const KEN_WORK_W = 5120;
const KEN_WORK_H = Math.round(KEN_WORK_W * 1080 / 1920);
const SUB_MAX_CHARS = 46;        // au-delà, la ligne touche les bords du cadre
const SUB_MAX_SPAN = 4.2;
const SUB_MIN_FLUSH = 22;

const PRICES = { image: 0.02, voicePer1kChars: 0.015, voicePer1kCharsEleven: 0.10, whisperPerSec: 0.0008, suno: 0.06 };
const MAX_TRIES = 3;
const IMG_CONCURRENCY = 5;

/**
 * Voix Inworld par langue. Le genre n'est PAS exposé par l'API FAL (le schéma ne connaît
 * que `voice`) : il est déduit du prénom. Corriger ici si une voix est mal classée.
 */
const VOICES = {
  "Français": [["Alain", "H"], ["Mathieu", "H"], ["Étienne", "H"], ["Hélène", "F"]],
  English: [["Malcolm", "H"], ["Graham", "H"], ["Theodore", "H"], ["Edward", "H"], ["Simon", "H"], ["Elliot", "H"],
            ["James", "H"], ["Oliver", "H"], ["Rupert", "H"], ["Sebastian", "H"], ["Craig", "H"], ["Mark", "H"],
            ["Nate", "H"], ["Ethan", "H"], ["Blake", "H"], ["Carter", "H"],
            ["Serena", "F"], ["Claire", "F"], ["Victoria", "F"], ["Miranda", "F"], ["Evelyn", "F"],
            ["Celeste", "F"], ["Olivia", "F"], ["Julia", "F"], ["Sarah", "F"], ["Elizabeth", "F"]],
  "Español": [["Diego", "H"], ["Miguel", "H"], ["Rafael", "H"], ["Lupita", "F"]],
  Deutsch: [["Josef", "H"], ["Johanna", "F"]],
  Italiano: [["Gianni", "H"], ["Orietta", "F"]],
  "Português": [["Heitor", "H"], ["Maitê", "F"]],
  Nederlands: [["Erik", "H"], ["Lennart", "H"], ["Katrien", "F"], ["Lore", "F"]],
  Polski: [["Szymon", "H"], ["Wojciech", "H"]],
  "Русский": [["Dmitry", "H"], ["Nikolai", "H"], ["Svetlana", "F"], ["Elena", "F"]],
  "日本語": [["Satoshi", "H"], ["Asuka", "F"]],
  "한국어": [["Hyunwoo", "H"], ["Seojun", "H"], ["Minji", "F"], ["Yoona", "F"]],
  "中文": [["Yichen", "H"], ["Jing", "F"], ["Xiaoyin", "F"], ["Xinyi", "F"]],
};
const VOICE_SUFFIX = {
  English: "(en)", "Français": "(fr)", "Español": "(es)", Deutsch: "(de)", Italiano: "(it)",
  "Português": "(pt)", Nederlands: "(nl)", Polski: "(pl)", "Русский": "(ru)", "日本語": "(ja)",
  "한국어": "(ko)", "中文": "(zh)",
};
/**
 * Voix ElevenLabs (moteur alternatif à Inworld). Inworld ne propose que 4 voix françaises ;
 * ElevenLabs accepte n'importe quel nom OU ID de sa bibliothèque (le champ `voice` de
 * `fal-ai/elevenlabs/tts/eleven-v3` est une chaîne libre). Format : [nom affiché, genre, id].
 * Débit mesuré indiqué en commentaire — il sert à choisir l'atempo, cf. TEMPO.
 */
/**
 * ⚠ Plus de table ElevenLabs locale ici. Elle faisait DOUBLON avec `lib/voices.js` : une voix
 * ajoutée dans la page 🎙 Voix restait invisible depuis cette machine (constaté avec « Fatou »).
 * Inworld garde sa table `VOICES` — son catalogue est partitionné PAR LANGUE, une voix
 * française n'existe pas en anglais. ElevenLabs v3 est multilingue : sa liste vient donc
 * intégralement de la bibliothèque partagée.
 */
const TTS_ENGINES = ["inworld", "elevenlabs"];
/** Résout un nom de voix ElevenLabs vers sa référence (nom ou ID), via la bibliothèque partagée. */
function elevenVoiceId(language, name) {
  const hit = voicesLib.list({ engine: "elevenlabs" }).find((v) => v.name === name);
  return hit ? hit.ref : name; // repli : un ID collé directement passe tel quel
}

const WHISPER_LANG = {
  English: "en", "Français": "fr", "Español": "es", Deutsch: "de", Italiano: "it", "Português": "pt",
  Nederlands: "nl", Polski: "pl", "Русский": "ru", "日本語": "ja", "한국어": "ko", "中文": "zh",
};
const CTA_TEXT = {
  "Français": { label: "S'ABONNER", done: "ABONNÉ", tagline: "Nouvelle vidéo chaque semaine", taglineDone: "Merci — on se voit semaine prochaine" },
  English: { label: "SUBSCRIBE", done: "SUBSCRIBED", tagline: "New video every week", taglineDone: "Thanks — see you next week" },
  "Español": { label: "SUSCRIBIRSE", done: "SUSCRITO", tagline: "Un vídeo nuevo cada semana", taglineDone: "Gracias — hasta la próxima semana" },
};

/** Retourne la liste des voix d'une langue, filtrée par genre ("H", "F" ou "" pour toutes). */
function voicesFor(language, gender, engine) {
  if (engine === "elevenlabs") {
    // Multilingue : aucune restriction de langue, on expose toute la bibliothèque partagée.
    return voicesLib.list({ engine: "elevenlabs", gender })
      .map((v) => ({ name: v.name, gender: v.gender || "", wpm: v.wpm || null }));
  }
  const list = VOICES[language] || VOICES.English;
  const f = gender === "H" || gender === "F" ? list.filter(([, g]) => g === gender) : list;
  return (f.length ? f : list).map(([name, g]) => ({ name, gender: g }));
}

/** Styles musicaux Suno proposés dans l'interface (prompt adapté à chaque style). */
const MUSIC_STYLES = {
  "Bols tibétains": "ambient meditation music, tibetan singing bowls, deep resonant metal tones, soft bamboo flute, slow warm drone pad",
  "Flûte japonaise": "ambient meditation music, japanese shakuhachi bamboo flute, sparse koto notes, soft air textures, slow warm drone",
  "Nappe ambiante": "minimal ambient drone, warm analog pad, very slow evolving texture, no melody, spacious and still",
  "Nature & eau": "ambient meditation music, gentle flowing water, soft wind through trees, distant birds, subtle warm drone underneath",
  "Cordes douces": "ambient meditation music, soft guzheng and sitar, gentle plucked strings, slow warm drone pad, spacious",
};
const MUSIC_TAIL = "no drums, no percussion, extremely calm and spacious, 50-60 BPM, loopable. Purely instrumental, absolutely NO vocals, NO lyrics, NO singing, NO voice.";

/** Direction artistique : MESURÉE sur les 5 concurrents (5/5 convergent). Rappelée dans CHAQUE prompt. */
const DA_DEFAULT =
  "Cinematic photorealistic still, warm golden-hour light with soft volumetric god rays and drifting mist, " +
  "muted palette of saffron orange, deep forest green, earth brown, weathered stone grey and pale gold, " +
  "shallow depth of field, subtle film grain, serene contemplative documentary mood, 16:9 widescreen composition";
const DA_NEG =
  "no text, no letters, no watermark, no logo, no modern clothing, no distorted hands or faces, " +
  "no photobashing artefacts, no lens flare overload";

const cancelledRuns = new Set();
const activeAdvance = new Set();

// ---------------------------------------------------------------- config

function defaultNicheId() {
  const n = bank.niches().find((x) => /bouddh/i.test(x.name));
  return n ? n.id : null;
}
const DEFAULT_SETTINGS = {
  imageModel: "nano",
  wordsPerImage: WORDS_PER_IMAGE,
  narrationSpeed: "lente",
  ctaEveryMin: 2,
  ctaFirstSec: 20,
  subtitles: true,
  subtitleSize: 21,
  outro: [
    "Si ce voyage intérieur t'a touché… si quelque chose en toi a bougé pendant ces quelques minutes…",
    "Alors tu sais déjà ce que signifie s'éveiller un peu.",
    "Cette chaîne existe pour continuer ce chemin avec toi. Chaque vidéo est une invitation à regarder plus profond.",
    "Abonne-toi. Active la cloche.",
    "Pas pour nous. Pour toi.",
    "Pour que chaque nouvelle exploration te trouve au bon moment.",
    "Parce que tu mérites d'être rappelé à toi-même… encore… et encore.",
  ].join("\n\n"),
  outroVary: false,      // true = Claude reformule l'outro à chaque vidéo, en gardant sa structure
  musicLufs: -34,
  sting: true,                 // générique de chaîne de 5 s en tête
  stingLogo: "zen-harmonie-logo.png",
  stingTitle: "Zen Harmonie",
  stingSubtitle: "Sagesse bouddhiste",
  stingAccent: "#e0b255",      // or — teinte relevée sur le logo
  cornerLogo: true,            // logo de chaîne en haut à gauche, toute la vidéo        // niveau ABSOLU du lit musical (mesure : ~18,6 dB sous la voix)
  musicStyle: "Bols tibétains",
  artDirection: DA_DEFAULT,
  xfade: XF,
  chainLanguage: "Français",
  channelName: "Zen Harmonie",
  publishPrivacy: "private",
  promptModel: "",
};
function config() {
  const c = readJSON(`machines/${MACHINE_ID}.json`, null);
  if (c) {
    c.settings = Object.assign({}, DEFAULT_SETTINGS, c.settings || {});
    if (!c.nicheId) c.nicheId = defaultNicheId();
    return c;
  }
  const fresh = { id: MACHINE_ID, name: MACHINE_NAME, nicheId: defaultNicheId(), settings: { ...DEFAULT_SETTINGS } };
  writeJSON(`machines/${MACHINE_ID}.json`, fresh);
  return fresh;
}
function saveConfig(c) { writeJSON(`machines/${MACHINE_ID}.json`, c); }
function patchConfig(patch) {
  const c = config();
  if (patch.settings) Object.assign(c.settings, patch.settings);
  for (const k of ["nicheId", "name"]) if (patch[k] !== undefined) c[k] = patch[k];
  saveConfig(c);
  return c;
}

// ---------------------------------------------------------------- runs

function runPath(id) { return path.join(RUNS_DIR, id + ".json"); }
function listRuns() {
  try {
    return fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json")).map((f) => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), "utf8"));
        return {
          id: r.id, title: r.title || r.params?.subject || "Sans titre", status: r.status,
          createdAt: r.createdAt, mode: r.mode, cost: r.cost,
          shots: (r.scenes || []).length, durationSec: r.voDuration || null,
          finalRel: r.finalRel || null, published: r.published || null,
        };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  } catch { return []; }
}
function getRun(id) {
  const r = readJSON(path.relative(DATA_DIR, runPath(id)).replace(/\\/g, "/"), null);
  if (!r) throw new Error("Run introuvable");
  return r;
}
function saveRun(r) {
  r.updatedAt = new Date().toISOString();
  fs.writeFileSync(runPath(r.id), JSON.stringify(r, null, 1));
}
function log(r, msg) {
  r.logs = r.logs || [];
  r.logs.push({ t: new Date().toISOString(), msg: String(msg) });
  if (r.logs.length > 400) r.logs = r.logs.slice(-400);
  saveRun(r);
}

// ---------------------------------------------------------------- utilitaires

function genModel() { return config().settings.promptModel || undefined; }
async function genJson(prompt, { ms = 6 * 60 * 1000, tries = 3, label = "" } = {}) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      const out = await claude.ask(prompt, { timeoutMs: ms, model: genModel() });
      const j = claude.parseJson(out);
      if (j) return j;
      last = new Error("réponse illisible (JSON attendu)");
    } catch (e) { last = e; }
  }
  throw new Error(`${label || "Génération"} : ${last ? last.message : "échec"}`);
}
function runFfmpeg(args, cwd) {
  return new Promise((res, rej) => {
    const c = spawn("ffmpeg", args, cwd ? { cwd } : {});
    let err = "";
    c.stdout.on("data", () => {});           // pipe non lu = process figé
    c.stderr.on("data", (d) => (err += d));
    c.on("error", rej);
    c.on("close", (k) => (k === 0 ? res() : rej(new Error(err.slice(-600) || "ffmpeg " + k))));
  });
}
async function uploadPublic(name, absFile, mime) {
  const up = await google.driveUpload(name, mime, fs.readFileSync(absFile));
  await google.ensurePublic(up.id).catch(() => {});
  return `https://drive.google.com/uc?export=download&id=${up.id}`;
}
async function pool(items, worker, concurrency = IMG_CONCURRENCY) {
  const q = items.slice();
  const run = async () => { for (;;) { const it = q.shift(); if (!it) return; await worker(it); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}

// ---------------------------------------------------------------- recette de niche

/** Le noyau dur : ce qui survit à toutes les régénérations. */
function coreRules(run) {
  const p = run.params;
  return [
    "NICHE : sagesse bouddhiste contemplative — une parabole, un enseignement ou une leçon de vie,",
    "racontée en voix off calme sur des visuels lents. Pas de dogmatisme, pas de prosélytisme :",
    "sagesse, introspection, apaisement.",
    `LANGUE DE LA VOIX OFF : ${p.language}. Les prompts d'images restent en ANGLAIS.`,
    `DURÉE VISÉE : ${p.durationMin} minutes, soit ${Math.round(p.durationMin * WPM)} mots (débit mesuré : ${WPM} mots/min).`,
    "TON : apaisant, à la deuxième personne quand c'est pertinent (« respire », « imagine »),",
    "phrases COURTES, rythme lent. Jamais d'emphase publicitaire, jamais de promesse miracle.",
    "INTERDIT ABSOLU : inventer une citation attribuée au Bouddha ou à un maître réel. Les",
    "paraboles traditionnelles s'introduisent comme telles (« une vieille histoire zen raconte »),",
    "sans jamais les attribuer à une personne nommée.",
    "RESPIRATIONS : marquer les silences avec « … ». Un paragraphe = une respiration.",
  ].join("\n");
}

/** La structure narrative de la niche. */
function storyRecipe() {
  return [
    "STRUCTURE EN 5 TEMPS :",
    "1. ACCROCHE — une situation universelle que le spectateur reconnaît immédiatement, à la",
    "   deuxième personne. Elle nomme un poids intérieur sans le résoudre. 3 à 5 paragraphes.",
    "2. RÉCIT — la parabole ou l'histoire, racontée au passé, avec des détails sensoriels concrets",
    "   (la lumière, l'eau, le froid, le silence). C'est le cœur : ~40 % du texte.",
    "3. ENSEIGNEMENT — ce que l'histoire dit, formulé en une phrase simple puis déplié.",
    "4. APPLICATION — ce que le spectateur peut faire CE SOIR, concrètement, en une minute.",
    "   Pas de liste à puces : du texte parlé.",
    "5. CONCLUSION — apaisante, courte, qui rouvre plutôt que de refermer.",
    "",
    "RÈGLES D'ÉCRITURE :",
    "- Un paragraphe = une idée = une respiration. Paragraphes COURTS (1 à 3 phrases).",
    "- Alterner phrases très courtes et phrases moyennes. Jamais deux longues d'affilée.",
    "- Pas de titres, pas de numéros, pas de didascalies : uniquement le texte à dire.",
    "- Ne jamais s'adresser à « vous » : tutoiement constant.",
  ].join("\n");
}

async function stepScript(run) {
  if (run.script) return;
  const c = config();
  const p = run.params;
  const words = Math.round(p.durationMin * WPM);
  const inspiration = c.nicheId ? bank.inspiration(c.nicheId, { maxTitles: 14, maxVisions: 0 }) : "";
  const done = producedThemes();

  const j = await genJson([
    coreRules(run),
    "",
    storyRecipe(),
    "",
    p.subject ? `SUJET IMPOSÉ : ${p.subject}` : "SUJET : à choisir toi-même, dans l'esprit de la niche.",
    done.length ? `\nDÉJÀ PRODUIT (ne pas refaire, ni une variante proche) :\n- ${done.slice(0, 25).join("\n- ")}` : "",
    inspiration ? `\nINSPIRATION (titres des concurrents, pour le registre, PAS pour copier) :\n${inspiration}` : "",
    "",
    `Écris le texte COMPLET de la voix off : ${words} mots (±8 %), en ${p.language}.`,
    "Sépare chaque paragraphe par une ligne vide.",
    "",
    'RÉPONDS UNIQUEMENT EN JSON : {"title":"", "theme":"", "script":"le texte complet avec des lignes vides entre les paragraphes"}',
  ].join("\n"), { label: "Script", ms: 8 * 60 * 1000 });

  run.script = String(j.script || "").trim();
  if (!run.script) throw new Error("Script vide");
  run.title = j.title || run.title;
  run.theme = j.theme || p.subject || run.title;
  const n = run.script.split(/\s+/).length;
  log(run, `Script : ${n} mots (cible ${words}) — « ${run.title} »`);

  // L'OUTRO ferme CHAQUE vidéo : même voix, même rythme, sous-titré, avec ses propres visuels.
  // Il n'entre pas dans le décompte de la durée demandée (il vient après le récit).
  run.outro = await buildOutro(run);
  if (run.outro) log(run, `Outro : ${run.outro.split(/\s+/).length} mots${config().settings.outroVary ? " (reformulé)" : " (texte de référence)"}`);
  saveRun(run);
}

/**
 * Texte de fin. Par défaut le texte de référence de la chaîne, mot pour mot — c'est une
 * signature, elle doit être reconnaissable d'une vidéo à l'autre. `outroVary` la fait
 * reformuler en gardant sa structure et ses phrases-clés (« Abonne-toi », « Active la cloche »).
 */
async function buildOutro(run) {
  const c = config().settings;
  const base = String(c.outro || "").trim();
  if (!base) return "";
  if (!c.outroVary) return base;
  try {
    const j = await genJson([
      "Tu reformules le texte de fin d'une chaîne de sagesse bouddhiste.",
      "Il doit rester RECONNAISSABLE : même structure, même rythme, mêmes phrases-clés",
      "(l'invitation à s'abonner, la cloche, le « pas pour nous, pour toi », la clôture répétée).",
      `Relie-le discrètement au thème du jour : ${run.theme || run.title}`,
      "Même longueur (±15 %). Paragraphes séparés par une ligne vide, comme l'original.",
      "",
      "TEXTE DE RÉFÉRENCE :",
      base,
      "",
      'RÉPONDS EN JSON : {"outro":"le texte complet"}',
    ].join("\n"), { label: "Outro", ms: 4 * 60 * 1000, tries: 2 });
    const t = String(j.outro || "").trim();
    return t.length > 60 ? t : base;
  } catch (e) {
    log(run, "⚠ Outro non reformulé (" + e.message.slice(0, 60) + ") — texte de référence utilisé");
    return base;
  }
}

// ---------------------------------------------------------------- étape 2 : voix off

/** Découpe le texte sous la limite de l'API, sur des frontières de paragraphe. */
function chunkText(text, max = TTS_MAX_CHARS) {
  const out = [];
  let cur = "";
  for (const para of text.split(/\n\s*\n/)) {
    if ((cur + "\n\n" + para).length > max && cur) { out.push(cur.trim()); cur = para; }
    else cur = cur ? cur + "\n\n" + para : para;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function tts(text, voice, file, engine) {
  // ⚠ `engine` est OBLIGATOIRE. Il était optionnel et retombait silencieusement sur Inworld :
  // un appel qui l'oubliait envoyait un ID ElevenLabs à Inworld, qui répondait « aucun audio ».
  // L'erreur pointait le mauvais moteur et le vrai défaut — un argument manquant — restait invisible.
  if (!TTS_ENGINES.includes(engine)) {
    throw new Error(`tts() : moteur manquant ou inconnu (« ${engine} ») — appel refusé`);
  }
  // ⚠ Les deux moteurs n'attendent PAS la même chose dans `voice` :
  //   inworld    -> un nom suffixé de la langue, ex. "Alain (fr)" (catalogue fermé, 4 voix FR)
  //   elevenlabs -> un nom OU un ID de la bibliothèque, ex. "hndZlkpVm5i9lXBY9CKj"
  // Envoyer un ID à Inworld échoue silencieusement (aucun audio renvoyé).
  if (engine === "elevenlabs") {
    const r = await fal.run("fal-ai/elevenlabs/tts/eleven-v3", { text, voice });
    if (!r.audio?.url) throw new Error("ElevenLabs TTS : aucun audio renvoyé");
    return fal.download(r.audio.url, file);
  }
  const r = await fal.run("fal-ai/inworld-tts", { text, voice, sample_rate_hertz: 48000 });
  if (!r.audio?.url) throw new Error("Inworld TTS : aucun audio renvoyé");
  await fal.download(r.audio.url, file);
}

/**
 * Voix off. Inworld n'expose AUCUN réglage de vitesse (schéma FAL : text, voice, sample_rate).
 * La voix brute sort à ~173 mots/min quand la niche en demande 120-135. On combine donc :
 *   1. synthèse paragraphe par paragraphe (même coût : facturé au caractère)
 *   2. atempo léger, qui garde un timbre naturel
 *   3. respiration entre paragraphes, dont la durée est CALCULÉE pour atteindre la cible
 * Ce mécanisme sert deux besoins d'un coup : la durée demandée ET les silences de la niche.
 */
async function stepVoice(run) {
  const dir = path.join(OUT_ROOT, run.id);
  ensureDir(dir);
  const parts = path.join(dir, "parts");
  ensureDir(parts);
  const p = run.params;
  const engine = TTS_ENGINES.includes(p.ttsEngine) ? p.ttsEngine : "inworld";
  const voice = engine === "elevenlabs"
    ? elevenVoiceId(p.language, p.voice)
    : `${p.voice} ${VOICE_SUFFIX[p.language] || "(en)"}`;
  const tempo = TEMPO[p.narrationSpeed] || TEMPO.lente;
  const voFile = path.join(dir, "vo.mp3");

  // Le récit fixe la durée demandée ; l'outro vient APRÈS, séparé par un silence.
  const scriptParas = run.script.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
    .flatMap((x) => (x.length > TTS_MAX_CHARS ? chunkText(x) : [x]));
  const outroParas = (run.outro || "").split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  run.paras = scriptParas.concat(outroParas);
  saveRun(run);

  if (!fs.existsSync(voFile)) {
    const paras = run.paras;
    log(run, `Voix « ${voice} » (${p.narrationSpeed}) : ${paras.length} paragraphes${outroParas.length ? ` (dont ${outroParas.length} d'outro)` : ""}…`);
    const slow = [];
    for (let i = 0; i < paras.length; i++) {
      if (cancelledRuns.has(run.id)) throw new Error("Annulée par l'utilisateur");
      const raw = path.join(parts, `p${String(i).padStart(3, "0")}.mp3`);
      const sl = path.join(parts, `s${String(i).padStart(3, "0")}.mp3`);
      if (!fs.existsSync(raw)) await tts(paras[i], voice, raw, engine);
      if (!fs.existsSync(sl)) await runFfmpeg(["-hide_banner", "-loglevel", "error", "-i", raw, "-filter:a", `atempo=${tempo}`, "-b:a", "192k", "-y", sl]);
      slow.push(sl);
      if (i % 5 === 0) await tasks.updateTask(run.taskId, { step: `Voix off : ${i + 1}/${paras.length}` }).catch(() => {});
    }
    const nScript = scriptParas.length;
    let speech = 0;
    for (let i = 0; i < nScript; i++) speech += await ff.probeDurationSafe(slow[i]);
    const target = p.durationMin * 60;
    let pause = nScript > 1 ? (target - speech) / (nScript - 1) : 0;
    pause = Math.max(PAUSE_MIN, Math.min(PAUSE_MAX, pause));
    log(run, `Parole ${speech.toFixed(0)} s + ${nScript - 1} respirations de ${pause.toFixed(2)} s`);

    const sil = path.join(parts, "sil.mp3");
    await runFfmpeg(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(pause), "-b:a", "192k", "-y", sil]);
    const gap = path.join(parts, "gap.mp3");
    await runFfmpeg(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(OUTRO_GAP), "-b:a", "192k", "-y", gap]);
    const seq = [];
    slow.forEach((f, i) => {
      seq.push(f);
      if (i === nScript - 1 && i < slow.length - 1) seq.push(gap);   // respiration plus large avant l'outro
      else if (i < slow.length - 1) seq.push(sil);
    });
    const list = path.join(dir, "vo-concat.txt");
    fs.writeFileSync(list, seq.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
    await runFfmpeg(["-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c:a", "libmp3lame", "-b:a", "192k", "-y", voFile]);

    const per1k = engine === "elevenlabs" ? PRICES.voicePer1kCharsEleven : PRICES.voicePer1kChars;
    const cost = +((run.script.length / 1000) * per1k).toFixed(4);
    run.cost.voice = (run.cost.voice || 0) + cost;
    spend.record("FAL.ai", MACHINE_NAME, cost, "USD",
      `${engine === "elevenlabs" ? "ElevenLabs v3" : "Inworld"} TTS (${run.script.length} car.)`);
  }

  run.voDuration = await ff.probeDuration(voFile, { label: "voix off" });
  run.voRel = `agent-os/output/machines/${run.id}/vo.mp3`;
  const nw = run.script.split(/\s+/).length;
  log(run, `Voix off : ${(run.voDuration / 60).toFixed(2)} min — ${Math.round(nw / (run.voDuration / 60))} mots/min`);
  saveRun(run);

  // --- transcript mot-à-mot : c'est lui qui cale images et sous-titres sur le SENS
  if (!run.words?.length) {
    const low = path.join(dir, "vo-low.mp3");
    await runFfmpeg(["-hide_banner", "-loglevel", "error", "-i", voFile, "-ac", "1", "-b:a", "64k", "-y", low]);
    const url = await uploadPublic(`${run.id}-vo.mp3`, low, "audio/mpeg");
    const res = await fal.run("fal-ai/whisper",
      { audio_url: url, task: "transcribe", language: WHISPER_LANG[p.language] || "en", chunk_level: "word" },
      { timeoutMs: 12 * 60 * 1000, cancelled: () => cancelledRuns.has(run.id) });
    run.words = (res.chunks || [])
      .map((c) => ({ t: Number(c.timestamp?.[0] ?? 0), end: Number(c.timestamp?.[1] ?? 0), w: String(c.text || "").trim() }))
      .filter((c) => c.w && isFinite(c.t) && isFinite(c.end));
    if (run.words.length < 30) throw new Error("Whisper : transcript inexploitable");
    const wCost = +(run.voDuration * PRICES.whisperPerSec).toFixed(4);
    run.cost.voice += wCost;
    spend.record("FAL.ai", MACHINE_NAME, wCost, "USD", `Whisper (${Math.round(run.voDuration)} s)`);
    try { fs.unlinkSync(low); } catch {}
  }

  run.scenes = buildShots(run);
  const d = run.scenes.map((s) => s.dur).sort((a, b) => a - b);
  run.shotStats = {
    count: run.scenes.length,
    perMin: +(run.scenes.length / (run.voDuration / 60)).toFixed(1),
    median: d[d.length >> 1], min: d[0], max: d[d.length - 1],
  };
  log(run, `Découpage : ${run.scenes.length} visuels — médiane ${run.shotStats.median} s, ${run.shotStats.perMin}/min (niche mesurée : 2,9 à 5,1/min)`);
  saveRun(run);
}

/**
 * Découpe des visuels : sur le SENS, jamais à l'horloge.
 * Les frontières de paragraphe sont PRÉFÉRÉES mais pas obligatoires — un paragraphe court
 * (« Repose-le. Encore. ») ne mérite pas son image : on accumule jusqu'à la cible en mots.
 */
function buildShots(run) {
  const target = Number(config().settings.wordsPerImage) || WORDS_PER_IMAGE;
  const maxW = Math.max(target + 8, MAX_WORDS_IMAGE);
  const paras = run.paras && run.paras.length ? run.paras : run.script.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const words = run.words;
  const total = run.voDuration;

  // Position de chaque paragraphe dans la timeline, estimée sur le compte de mots cumulé
  // (le transcript Whisper suit le script mot pour mot).
  const counts = paras.map((p) => p.split(/\s+/).length);
  const sum = counts.reduce((a, b) => a + b, 0);
  const spans = [];
  let acc = 0;
  for (const n of counts) {
    const a = Math.min(words.length - 1, Math.round((acc / sum) * words.length));
    const b = Math.min(words.length - 1, Math.round(((acc + n) / sum) * words.length));
    spans.push([words[a].t, words[b].end]);
    acc += n;
  }

  const segs = [];
  let cur = null;
  paras.forEach((p, i) => {
    const [s, e] = spans[i];
    const nw = counts[i];
    if (nw > maxW) {                                  // paragraphe long : coupe interne aux phrases
      if (cur) { segs.push(cur); cur = null; }
      const sentences = p.match(/[^.!?…]+[.!?…]*/g) || [p];
      const groups = [];
      let g = "";
      for (const sn of sentences) {
        const cand = (g + " " + sn).trim();
        if (g && cand.split(/\s+/).length > target) { groups.push(g); g = sn.trim(); }
        else g = cand;
      }
      if (g.trim()) groups.push(g.trim());
      const tot = groups.reduce((a, x) => a + x.split(/\s+/).length, 0);
      let a = s;
      groups.forEach((x, k) => {
        const share = (e - s) * (x.split(/\s+/).length / tot);
        segs.push({ start: a, end: k === groups.length - 1 ? e : a + share, say: x });
        a += share;
      });
      return;
    }
    if (!cur) { cur = { start: s, end: e, say: p, n: nw }; }
    else if (cur.n + nw <= maxW) { cur.end = e; cur.say += " " + p; cur.n += nw; }
    else { segs.push(cur); cur = { start: s, end: e, say: p, n: nw }; }
    if (cur && cur.n >= target) { segs.push(cur); cur = null; }
  });
  if (cur) segs.push(cur);

  // Plans JOINTIFS : sinon les respirations ne sont couvertes par aucune image.
  segs[0].start = 0;
  for (let i = 0; i < segs.length - 1; i++) segs[i].end = segs[i + 1].start;
  segs[segs.length - 1].end = total;
  return segs.map((s, k) => ({
    i: k + 1,
    start: +s.start.toFixed(2), end: +s.end.toFixed(2), dur: +(s.end - s.start).toFixed(2),
    say: s.say, prompt: null, image: null,
  }));
}

// ---------------------------------------------------------------- étape 3 : bibliothèque visuelle

/**
 * Décide des entités récurrentes de la vidéo et les ancre sur des images de référence.
 * Placée AVANT les prompts : ceux-ci doivent savoir quelles identités sont ancrées, pour
 * cesser de les décrire (la référence est la seule source de vérité).
 */
async function stepLibrary(run) {
  if (run.library && run.library.length) return;
  if (run.params.useLibrary === false) { run.library = []; saveRun(run); log(run, "Bibliothèque visuelle désactivée pour ce run"); return; }

  const plan = await library.planLibrary({
    title: run.title,
    script: run.script,
    shots: run.scenes.map((s) => ({ i: s.i, say: s.say })),
  });
  log(run, `Plan visuel : ${plan.reuse.length} référence(s) réutilisée(s), ${plan.create.length} à créer`);
  const used = await library.applyPlan(plan, { onLog: (m) => log(run, m) });
  run.library = used.map((e) => ({ id: e.id, name: e.name, kind: e.kind, desc: e.desc, url: e.url, rel: e.rel }));
  run.cost.refs = (run.cost.refs || 0) + plan.create.length * library.PRICE_REF;
  saveRun(run);

  if (used.length) {
    const map = await library.assignRefs({ shots: run.scenes.map((s) => ({ i: s.i, say: s.say })), entries: used });
    let n = 0;
    for (const sc of run.scenes) {
      sc.refs = map[sc.i] || [];
      if (sc.refs.length) n++;
    }
    log(run, `Références attribuées à ${n}/${run.scenes.length} plans`);
  }
  saveRun(run);
}

// ---------------------------------------------------------------- étape 3 : prompts d'images

const BATCH = 8;

async function stepPrompts(run) {
  if (run.scenes.every((s) => s.prompt)) return;
  const da = config().settings.artDirection || DA_DEFAULT;
  const todo = run.scenes.filter((s) => !s.prompt);

  // Un plan d'ensemble d'abord : il attribue à CHAQUE visuel un lieu, un cadrage, une heure
  // et une saison UNIQUES. Sans lui, les lots parallèles refont tous le même temple.
  if (!run.visualPlan) {
    const j = await genJson([
      "Tu composes le plan visuel d'une vidéo de sagesse bouddhiste.",
      `Il faut ${run.scenes.length} visuels, un par segment de voix off.`,
      "",
      "RÈGLE ABSOLUE : chaque visuel doit être DIFFÉRENT des autres. Fais varier systématiquement :",
      "- LIEUX : temple, monastère, montagne sacrée, lac, forêt de bambous, cascade, jardin zen,",
      "  grotte, rizières, sentier de pierre, pont suspendu, cour intérieure, salle de prière, rivière",
      "- CADRAGES : plan très large, plan moyen, gros plan sur des mains / un visage / un objet, vue de dos",
      "- MOMENTS : aube, brume, plein jour, coucher de soleil, nuit étoilée, pluie douce, neige",
      "- SAISONS : printemps en fleurs, été, automne rouge, hiver enneigé",
      "- PERSONNAGES : moine âgé, jeune novice, groupe en procession, villageois, silhouette seule, AUCUN",
      "Deux visuels voisins ne partagent JAMAIS le même lieu ni le même cadrage.",
      "Si le récit suit des personnages récurrents, garde-les cohérents d'un plan à l'autre.",
      "",
      "SEGMENTS :",
      ...run.scenes.map((s) => `${s.i}. ${String(s.say).slice(0, 150)}`),
      "",
      'RÉPONDS EN JSON : {"plan":[{"i":1,"lieu":"","cadrage":"","moment":"","saison":"","personnages":""}]}',
    ].join("\n"), { label: "Plan visuel", ms: 8 * 60 * 1000 });
    run.visualPlan = j.plan || [];
    saveRun(run);
    log(run, `Plan visuel : ${run.visualPlan.length} entrées`);
  }
  const byI = new Map((run.visualPlan || []).map((x) => [Number(x.i), x]));

  const batches = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));

  await pool(batches, async (group) => {
    if (cancelledRuns.has(run.id)) return;
    const j = await genJson([
      "Tu écris des prompts d'images pour une vidéo de sagesse bouddhiste, en ANGLAIS.",
      "",
      "Chaque prompt doit :",
      "- décrire la scène qui correspond EXACTEMENT à ce que dit la voix off à cet instant",
      "- respecter le lieu, le cadrage, le moment et la saison imposés ci-dessous",
      "- faire 60 à 90 mots, TRÈS concrets (lumière, matière, distance, action)",
      "- montrer des moines CRÉDIBLES : robe safran (Theravada) ou bordeaux (tibétaine), crâne rasé,",
      "  posture correcte. Un jeune novice a l'air jeune. L'architecture est cohérente avec la région.",
      "- privilégier silhouettes, vues de dos, plans larges et gros plans d'objets quand un visage",
      "  n'apporte rien : c'est ce qui évite les mains et visages déformés.",
      "- ne JAMAIS contenir de texte, logo ou écriture dans l'image",
      "",
      "SEGMENTS À TRAITER :",
      ...group.map((s) => {
        const v = byI.get(s.i) || {};
        const refs = (s.refs || []).map((id) => (run.library || []).find((e) => e.id === id)).filter(Boolean);
        const refLine = refs.length
          ? `\n   RÉFÉRENCES FOURNIES (image-to-image) : ${refs.map((r) => `${r.name} (${r.kind})`).join(", ")}` +
            `\n   -> pour CES entités, écris « the exact same <nom> as in the reference image » et NE DÉCRIS PAS` +
            `\n      leur physique, leur tenue ni leur architecture. Décris seulement leur POSE, leur ACTION,` +
            `\n      leur PLACE dans le cadre et la lumière.`
          : "";
        return `#${s.i} | VOIX OFF : ${String(s.say).slice(0, 220)}\n   lieu: ${v.lieu || "libre"} | cadrage: ${v.cadrage || "libre"} | moment: ${v.moment || "libre"} | saison: ${v.saison || "libre"} | personnages: ${v.personnages || "libre"}${refLine}`;
      }),
      "",
      'RÉPONDS EN JSON : {"prompts":[{"i":1,"prompt":"..."}]}',
    ].join("\n"), { label: `Prompts ${group[0].i}-${group[group.length - 1].i}` });

    for (const it of j.prompts || []) {
      const sc = run.scenes.find((s) => s.i === Number(it.i));
      if (sc && it.prompt) sc.prompt = `${String(it.prompt).trim()}. ${da}. ${DA_NEG}`;
    }
    saveRun(run);
  }, 3);

  // Rattrapage : un lot peut revenir incomplet (le modèle omet des entrées, ou rend un JSON
  // illisible). Plutôt que d'échouer — ce qui condamnait le mode auto — on rejoue les manquants
  // UN PAR UN, où il n'y a plus ni omission possible ni réponse trop longue.
  let missing = run.scenes.filter((s) => !s.prompt);
  if (missing.length) {
    log(run, `Rattrapage : ${missing.length} prompt(s) manquant(s), relance un par un…`);
    await pool(missing, async (s) => {
      if (cancelledRuns.has(run.id)) return;
      const v = byI.get(s.i) || {};
      try {
        const j = await genJson([
          "Écris UN prompt d'image en ANGLAIS pour une vidéo de sagesse bouddhiste.",
          `VOIX OFF À CET INSTANT : ${String(s.say).slice(0, 260)}`,
          `Contraintes : lieu ${v.lieu || "libre"} · cadrage ${v.cadrage || "libre"} · moment ${v.moment || "libre"} · saison ${v.saison || "libre"} · personnages ${v.personnages || "libre"}.`,
          "60 à 90 mots, très concret. Moines crédibles. Aucun texte dans l'image.",
          'RÉPONDS EN JSON : {"prompt":"..."}',
        ].join("\n"), { label: `Prompt ${s.i}`, ms: 3 * 60 * 1000, tries: 2 });
        if (j.prompt) { s.prompt = `${String(j.prompt).trim()}. ${da}. ${DA_NEG}`; saveRun(run); }
      } catch (e) { log(run, `⚠ Prompt ${s.i} : ${e.message.slice(0, 80)}`); }
    }, 4);
    missing = run.scenes.filter((s) => !s.prompt);
  }
  if (missing.length) throw new Error(`${missing.length} prompt(s) manquant(s) après rattrapage — relance l'étape (⚡).`);
  log(run, `Prompts : ${run.scenes.length} écrits (${Math.round(run.scenes.reduce((a, s) => a + s.prompt.length, 0) / run.scenes.length)} car. en moyenne)`);
  saveRun(run);
}

// ---------------------------------------------------------------- étape 4 : images (Kie)

function kieKey() {
  const k = vault.get("kie");
  if (!k) throw new Error("Clé Kie absente du coffre");
  return k;
}
const KIE_MODEL = { nano: "nano-banana-2-lite", seedream: "seedream/5-lite-image-to-image", gpt: "gpt-image-2-text-to-image" };
// Avec référence(s), on bascule en image-to-image : modèle ET nom du champ changent.
const KIE_MODEL_I2I = { nano: "nano-banana-2-lite", seedream: "seedream/5-lite-image-to-image", gpt: "gpt-image-2-image-to-image" };
const KIE_IMGFIELD = { nano: "image_urls", seedream: "image_urls", gpt: "input_urls" };

async function kieCreate(model, input) {
  const r = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
    method: "POST",
    headers: { Authorization: `Bearer ${kieKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  }).then((x) => x.json());
  if (!r.data?.taskId) throw new Error(`Kie : ${r.msg || JSON.stringify(r).slice(0, 160)}`);
  return r.data.taskId;
}
async function kiePoll(taskId, runId, timeoutMs = 10 * 60 * 1000) {
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 8000));
    if (runId && cancelledRuns.has(runId)) throw new Error("Annulée par l'utilisateur");
    if (Date.now() - t0 > timeoutMs) throw new Error("Kie : délai dépassé");
    const r = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`,
      { headers: { Authorization: `Bearer ${kieKey()}` } }).then((x) => x.json());
    if (r.data?.state === "success") return JSON.parse(r.data.resultJson).resultUrls[0];
    if (r.data?.state === "fail") throw new Error(`Kie : ${r.data?.failMsg || "génération échouée"}`);
  }
}
/** Kie renvoie du JPEG même quand l'URL dit .png : on nomme d'après les octets réels. */
async function download(url, fileNoExt) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Téléchargement image ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const ext = buf[0] === 0xff && buf[1] === 0xd8 ? ".jpg" : ".png";
  const file = fileNoExt + ext;
  fs.writeFileSync(file, buf);
  return file;
}
function imgDir(run) { return path.join(OUT_ROOT, run.id, "img"); }
function imgBase(scene) { return String(scene.i).padStart(3, "0"); }

async function generateImage(run, scene) {
  const dir = imgDir(run);
  ensureDir(dir);
  const tool = config().settings.imageModel || "nano";
  const refs = (scene.refs || []).map((id) => (run.library || []).find((e) => e.id === id)).filter((e) => e && e.url);
  const model = refs.length ? (KIE_MODEL_I2I[tool] || KIE_MODEL_I2I.nano) : (KIE_MODEL[tool] || KIE_MODEL.nano);
  const input = { prompt: scene.prompt, aspect_ratio: "16:9" };
  if (refs.length) input[KIE_IMGFIELD[tool] || "image_urls"] = refs.map((e) => e.url);
  const url = await kiePoll(await kieCreate(model, input), run.id);
  const file = await download(url, path.join(dir, imgBase(scene)));
  scene.image = {
    rel: `agent-os/output/machines/${run.id}/img/${path.basename(file)}`,
    file, ts: Date.now(),
  };
  delete scene.error;
  run.cost.images = (run.cost.images || 0) + PRICES.image;
  spend.record("Kie.ai", MACHINE_NAME, PRICES.image, "USD", `Image plan ${scene.i}`);
  saveRun(run);
}

async function genWithRetry(run, scene) {
  for (let t = 1; t <= MAX_TRIES; t++) {
    try { await generateImage(run, scene); return; }
    catch (e) {
      scene.error = e.message;
      if (cancelledRuns.has(run.id)) throw e;
      if (t === MAX_TRIES) { log(run, `⚠ Plan ${scene.i} : ${e.message}`); saveRun(run); return; }
      await new Promise((r) => setTimeout(r, 4000 * t));
    }
  }
}

async function stepImages(run) {
  const todo = run.scenes.filter((s) => !s.image);
  if (!todo.length) return;
  log(run, `Images : ${todo.length} à générer (${(todo.length * PRICES.image).toFixed(2)} $)`);
  let done = 0;
  await pool(todo, async (s) => {
    if (cancelledRuns.has(run.id)) return;
    await genWithRetry(run, s);
    done++;
    await tasks.updateTask(run.taskId, { step: `Images : ${done}/${todo.length}`, progress: 46 + Math.round((24 * done) / todo.length) }).catch(() => {});
  });
  if (cancelledRuns.has(run.id)) throw new Error("Annulée par l'utilisateur");
  const miss = run.scenes.filter((s) => !s.image);
  if (miss.length) log(run, `⚠ ${miss.length} image(s) manquante(s) — régénère-les depuis le wizard.`);
  saveRun(run);
}

// ---------------------------------------------------------------- étape 5 : musique (Suno)

/**
 * Suno via Kie : POST /generate -> taskId, puis poll record-info.
 * Une requête = 2 titres. En semi-manuel on laisse choisir, en auto on garde le premier.
 */
async function sunoGenerate(run, style) {
  const body = {
    model: "V5_5", customMode: true, instrumental: true,
    style: `${MUSIC_STYLES[style] || MUSIC_STYLES["Bols tibétains"]}. ${MUSIC_TAIL}`,
    title: (run.title || "Méditation").slice(0, 70), prompt: "",
    styleWeight: 0.65, weirdnessConstraint: 0.65, audioWeight: 0.65,
    callBackUrl: "https://your-domain.com/api/callback",
  };
  const r = await fetch("https://api.kie.ai/api/v1/generate", {
    method: "POST", headers: { Authorization: `Bearer ${kieKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((x) => x.json());
  const taskId = r.data?.taskId;
  if (!taskId) throw new Error(`Suno : ${r.msg || JSON.stringify(r).slice(0, 150)}`);
  const t0 = Date.now();
  for (;;) {
    await new Promise((res) => setTimeout(res, 20000));
    if (cancelledRuns.has(run.id)) throw new Error("Annulée par l'utilisateur");
    if (Date.now() - t0 > 15 * 60 * 1000) throw new Error("Suno : délai dépassé (15 min)");
    const d = await fetch(`https://api.kie.ai/api/v1/generate/record-info?taskId=${taskId}`,
      { headers: { Authorization: `Bearer ${kieKey()}` } }).then((x) => x.json());
    const st = d.data?.status;
    if (/FAILED|SENSITIVE|ERROR/i.test(String(st || ""))) throw new Error(`Suno : ${st} — ${d.data?.errorMessage || "refusée"}`);
    const tracks = (d.data?.response?.sunoData || []).filter((t) => t.audioUrl);
    if (st === "SUCCESS" && tracks.length) return tracks.slice(0, 2);
  }
}

/** Bibliothèque de pistes réutilisables : économise une génération par vidéo. */
function musicLib() { return readJSON(`machines/${MACHINE_ID}-music.json`, []); }
function saveMusicLib(l) { writeJSON(`machines/${MACHINE_ID}-music.json`, l); }
function addToMusicLib(entry) {
  const l = musicLib();
  if (!l.some((x) => x.id === entry.id)) { l.unshift(entry); saveMusicLib(l.slice(0, 60)); }
  return l;
}
function removeFromMusicLib(id) {
  saveMusicLib(musicLib().filter((x) => x.id !== id));
  return musicLib();
}

async function stepMusic(run) {
  const dir = path.join(OUT_ROOT, run.id);
  ensureDir(dir);
  const p = run.params;
  if (p.musicStyle === "Aucune") { run.music = { none: true }; saveRun(run); log(run, "Sans musique de fond"); return; }

  // Reprise d'une piste du stock : aucune génération, aucun coût.
  if (p.musicReuseId) {
    const src = musicLib().find((x) => x.id === p.musicReuseId);
    if (!src || !fs.existsSync(src.file)) throw new Error("Piste du stock introuvable — regénère-la.");
    const dst = path.join(dir, "music.mp3");
    fs.copyFileSync(src.file, dst);
    run.music = { file: dst, rel: `agent-os/output/machines/${run.id}/music.mp3`, style: src.style, fromLib: src.id };
    log(run, `Musique reprise du stock : « ${src.title} »`);
    saveRun(run);
    return;
  }
  if (run.music?.variants?.length && run.music.chosen) return;

  if (!run.music?.variants?.length) {
    log(run, `Musique Suno (${p.musicStyle}) : 2 variantes…`);
    const tracks = await sunoGenerate(run, p.musicStyle);
    const variants = [];
    for (let i = 0; i < tracks.length; i++) {
      const f = path.join(dir, `music-${i === 0 ? "a" : "b"}.mp3`);
      const r = await fetch(tracks[i].audioUrl);
      fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
      variants.push({
        k: i === 0 ? "a" : "b", file: f,
        rel: `agent-os/output/machines/${run.id}/music-${i === 0 ? "a" : "b"}.mp3`,
        title: tracks[i].title || run.title, duration: Math.round(tracks[i].duration || 0),
      });
    }
    run.music = { variants, style: p.musicStyle, chosen: null };
    run.cost.music = (run.cost.music || 0) + PRICES.suno;
    spend.record("Kie.ai", MACHINE_NAME, PRICES.suno, "USD", `Suno V5_5 (${p.musicStyle}, 2 variantes)`);
    saveRun(run);
  }
  // En auto on garde la première ; en semi l'utilisateur choisit via chooseMusic().
  if (run.mode === "auto" && !run.music.chosen) chooseMusic(run.id, "a");
}

function chooseMusic(runId, k) {
  const run = liveRuns.has(runId) ? getLiveRun(runId) : getRun(runId);
  try {
    const v = (run.music?.variants || []).find((x) => x.k === k);
    if (!v) throw new Error("Variante introuvable");
    const dir = path.join(OUT_ROOT, run.id);
    const dst = path.join(dir, "music.mp3");
    fs.copyFileSync(v.file, dst);
    run.music.chosen = k;
    run.music.file = dst;
    run.music.rel = `agent-os/output/machines/${run.id}/music.mp3`;
    addToMusicLib({
      id: `${run.id}-${k}`, title: v.title, style: run.music.style,
      file: dst, rel: run.music.rel, duration: v.duration, createdAt: new Date().toISOString(),
    });
    log(run, `Musique retenue : variante ${k.toUpperCase()} (ajoutée au stock de pistes)`);
    saveRun(run);
    return run;
  } finally { if (liveRuns.has(runId)) releaseLiveRun(runId); }
}

// ---------------------------------------------------------------- étape 6 : montage

function srtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000)), p = (n, l = 2) => String(n).padStart(l, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))},${p(ms % 1000, 3)}`;
}
/**
 * Whisper découpe les élisions françaises en DEUX tokens (« t » + « 'a », « d » + « 'elle »)
 * et sort la ponctuation isolée (« » »). Sans recollage préalable, un saut de ligne tombe
 * AU MILIEU d'un mot — vu à l'écran : « s'approcha d » / « 'elle ».
 */
function weld(words) {
  const out = [];
  for (const w of words) {
    const t = String(w.w || "").trim();
    if (!t) continue;
    const prev = out[out.length - 1];
    if (prev && (/^['’-]/.test(t) || /^[»«",.!?;:…]+$/.test(t))) { prev.w += t; prev.end = w.end; }
    else out.push({ t: w.t, end: w.end, w: t });
  }
  return out;
}
function frClean(t) {
  return t.replace(/\s+([,.!?;:…»])/g, "$1").replace(/\s{2,}/g, " ").trim();
}
/** Lignes remplies AU CARACTÈRE : au-delà de 46, le texte touche les bords du cadre. */
function buildSrt(run, dir) {
  const ws = weld(run.words);
  const lines = [];
  let cur = [], idx = 1;
  const text = () => cur.map((w) => w.w).join(" ");
  const flush = () => {
    if (!cur.length) return;
    lines.push(String(idx++), `${srtTime(cur[0].t)} --> ${srtTime(cur[cur.length - 1].end)}`, frClean(text()), "");
    cur = [];
  };
  for (const w of ws) {
    const cand = cur.length ? text() + " " + w.w : w.w;
    if (cur.length && (cand.length > SUB_MAX_CHARS || w.end - cur[0].t > SUB_MAX_SPAN)) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.w) && text().length >= SUB_MIN_FLUSH) flush();
  }
  flush();
  fs.writeFileSync(path.join(dir, "subs.srt"), lines.join("\n"), "utf8");
  return idx - 1;
}

function renderCtaClip(run) {
  return new Promise((resolve, reject) => {
    const t = CTA_TEXT[run.params.language] || CTA_TEXT.English;
    const rel = `cta-${run.id}`;
    fs.writeFileSync(path.join(REMOTION_DIR, rel + ".json"), JSON.stringify({
      label: t.label, labelDone: t.done, channel: run.params.channelName,
      tagline: t.tagline, taglineDone: t.taglineDone, logo: "zen-harmonie-logo.png",
    }));
    const child = spawn("npx", ["remotion", "render", "BouddhismeCta", rel, "--sequence", "--image-format=png", `--props=${rel}.json`],
      { cwd: REMOTION_DIR, shell: true, windowsHide: true });
    let err = "";
    child.stdout.on("data", () => {}); // OBLIGATOIRE : un pipe non lu fige le rendu
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      const folder = path.join(REMOTION_DIR, rel);
      if (code === 0 && fs.existsSync(path.join(folder, "element-000.png"))) resolve(folder);
      else reject(new Error(err.slice(-300) || "code " + code));
    });
  });
}

async function renderMontage(run) {
  const dir = path.join(OUT_ROOT, run.id);
  const clips = path.join(dir, "clips");
  ensureDir(clips);
  const c = config().settings;
  const ready = run.scenes.filter((s) => s.image);
  if (!ready.length) throw new Error("Aucune image à monter");
  const xf = Number(c.xfade) || XF;

  // 1) un clip par image, Ken Burns lent alterné (source suréchantillonnée = pas de saccade)
  for (const s of ready) {
    const out = path.join(clips, imgBase(s) + ".mp4");
    if (fs.existsSync(out) && fs.statSync(out).size > 5000) continue;
    const len = s.dur + xf;
    const frames = Math.max(2, Math.round(len * FPS));
    const z = s.i % 2 ? `1+${KEN_BURNS}*on/${frames}` : `${1 + KEN_BURNS}-${KEN_BURNS}*on/${frames}`;
    await runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i", s.image.file,
      "-vf", `scale=${KEN_WORK_W}:${KEN_WORK_H}:force_original_aspect_ratio=increase,crop=${KEN_WORK_W}:${KEN_WORK_H},` +
             `zoompan=z='${z}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS},format=yuv420p`,
      "-frames:v", String(frames), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", String(FPS), out]);
  }
  log(run, `${ready.length} clips rendus`);

  // 2) chaîne de fondus enchaînés + fondus au noir
  const mute = path.join(dir, "video-mute.mp4");
  if (!fs.existsSync(mute)) {
    const inputs = [];
    ready.forEach((s) => inputs.push("-i", path.join(clips, imgBase(s) + ".mp4")));
    let filter = "", prev = "[0:v]", off = 0;
    for (let i = 1; i < ready.length; i++) {
      off += ready[i - 1].dur;
      const lab = i === ready.length - 1 ? "[vx]" : `[x${i}]`;
      filter += `${prev}[${i}:v]xfade=transition=fade:duration=${xf}:offset=${off.toFixed(3)}${lab};`;
      prev = lab;
    }
    if (ready.length === 1) filter = "[0:v]null[vx];";
    filter += `[vx]fade=t=in:st=0:d=2,fade=t=out:st=${Math.max(0, run.voDuration - 3).toFixed(2)}:d=3[vout]`;
    await runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", filter,
      "-map", "[vout]", "-t", String(run.voDuration), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-pix_fmt", "yuv420p", "-r", String(FPS), mute]);
  }

  // 3) sous-titres
  const subsOn = run.params.subtitles !== false;
  if (subsOn) log(run, `Sous-titres : ${buildSrt(run, dir)} lignes`);

  // 4) lit musical : boucles en acrossfade jusqu'à couvrir TOUTE la vidéo, outro compris
  const bed = path.join(dir, "bed.mp3");
  const hasMusic = !!(run.music && run.music.file && fs.existsSync(run.music.file));
  if (hasMusic && !fs.existsSync(bed)) {
    const mDur = await ff.probeDurationSafe(run.music.file);
    const loops = Math.max(1, Math.ceil((run.voDuration + 10) / Math.max(5, mDur - 3)));
    const ins = [];
    for (let i = 0; i < loops; i++) ins.push("-i", run.music.file);
    let f = "", prev = "[0:a]";
    for (let i = 1; i < loops; i++) {
      const lab = i === loops - 1 ? "[m]" : `[a${i}]`;
      f += `${prev}[${i}:a]acrossfade=d=3:c1=tri:c2=tri${lab};`;
      prev = lab;
    }
    if (loops === 1) f = "[0:a]anull[m];";
    f += `[m]atrim=0:${run.voDuration.toFixed(2)},afade=t=in:st=0:d=3,afade=t=out:st=${Math.max(0, run.voDuration - 5).toFixed(2)}:d=5[bed]`;
    await runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", ...ins, "-filter_complex", f, "-map", "[bed]", "-c:a", "libmp3lame", "-b:a", "192k", bed]);
    log(run, `Lit musical : ${loops} boucle(s) → ${run.voDuration.toFixed(0)} s`);
  }

  // 5) CTA : premier à 20 s, puis toutes les N minutes ; en plus, un CTA calé sur le mot
  //    « abonne » s'il est prononcé (l'outro le dit) — la voix prime sur la règle de fin.
  const every = Math.max(1, Number(c.ctaEveryMin) || 2) * 60;
  const first = Math.max(5, Number(c.ctaFirstSec) || 20);
  const starts = [];
  if (run.params.cta !== false) {
    for (let t = first; t < run.voDuration - 25; t += every) starts.push(+t.toFixed(2));
    const hit = weld(run.words).find((w) => /^(abonne|subscribe|suscr)/i.test(w.w.replace(/[^A-Za-zÀ-ÿ]/g, "")));
    if (hit) {
      const t = +(hit.t - 0.6).toFixed(2);
      if (t > 5 && !starts.some((x) => Math.abs(x - t) < 6)) { starts.push(t); starts.sort((a, b) => a - b); }
    }
  }
  let ctaSeq = null;
  if (starts.length) {
    try { ctaSeq = await renderCtaClip(run); log(run, `CTA : ${starts.length} apparition(s) — ${starts.join(", ")} s`); }
    catch (e) { log(run, "CTA indisponible (" + String(e.message).slice(0, 90) + ") — montage sans bouton"); }
  }

  // 6) assemblage final
  const inputs = ["-i", "video-mute.mp4", "-i", "vo.mp3"];
  const hasBed = fs.existsSync(bed);
  if (hasBed) inputs.push("-i", "bed.mp3");
  let nextIn = hasBed ? 3 : 2;
  const iCta = ctaSeq ? nextIn++ : -1;
  if (ctaSeq) inputs.push("-framerate", String(FPS), "-start_number", "0", "-i", path.join(ctaSeq, "element-%03d.png"));

  // LOGO DE CHAÎNE en haut à gauche, toute la durée — comme sur Crime et Linguistique.
  // ⚠ `-loop 1 -framerate FPS` INDISPENSABLE : en image UNIQUE, le logo s'évapore dès que la
  //   chaîne compte plusieurs incrustations (les `overlay` en cascade attendent des flux calés
  //   loin dans le futur et l'image isolée n'est jamais resservie). Vécu sur Crime.
  const logoFile = c.cornerLogo === false ? null
    : (() => { const f = path.join(REMOTION_DIR, "public", c.stingLogo || DEFAULT_SETTINGS.stingLogo);
               return fs.existsSync(f) ? f : null; })();
  const iLogo = logoFile ? nextIn++ : -1;
  if (logoFile) inputs.push("-loop", "1", "-framerate", String(FPS), "-i", logoFile);

  const style = [
    "FontName=Arial", `FontSize=${Number(c.subtitleSize) || 21}`, "Bold=1",
    "PrimaryColour=&H00FFFFFF", "OutlineColour=&H00101010", "BorderStyle=1",
    "Outline=2", "Shadow=0", "Alignment=2", "MarginV=18",
  ].join(",");
  let filter = subsOn ? `[0:v]subtitles=subs.srt:force_style='${style}'[sub]` : "";
  let cur = subsOn ? "[sub]" : "[0:v]";
  if (iLogo >= 0) {   // le logo AVANT les CTA : ceux-ci passent par-dessus, comme sur Crime
    filter += `${filter ? ";" : ""}[${iLogo}:v]format=rgba,scale=${CORNER_LOGO_PX}:-1,colorchannelmixer=aa=0.85[lg]`;
    filter += `;${cur}[lg]overlay=${CORNER_LOGO_M}:${CORNER_LOGO_M}[wlg]`;
    cur = "[wlg]";
  }
  if (ctaSeq) {
    filter += `${filter ? ";" : ""}[${iCta}:v]format=rgba,split=${starts.length}${starts.map((_, k) => `[k${k}]`).join("")}`;
    starts.forEach((S, k) => (filter += `;[k${k}]setpts=PTS+${S}/TB[c${k}]`));
    starts.forEach((S, k) => {
      const nl = k === starts.length - 1 ? "[vout]" : `[o${k}]`;
      filter += `;${cur}[c${k}]overlay=0:0:eof_action=pass:enable='between(t,${S},${S + 5})'${nl}`;
      cur = nl;
    });
  }
  // aformat + aresample EXPLICITES : loudnorm/amix imposent sinon leur format et la sortie
  // part en mono 96 kHz.
  let amap = "1:a";
  if (hasBed) {
    // Le lit est NORMALISÉ, pas multiplié : Suno rend chaque piste à un niveau différent,
    // et un multiplicateur fixe donnait un drone inaudible là où des bols passaient.
    const lufs = Number(c.musicLufs) || DEFAULT_SETTINGS.musicLufs;
    filter += `${filter ? ";" : ""}[1:a]aformat=channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=7,aresample=48000,asplit=2[vo1][vosc]`;
    filter += `;[2:a]aformat=channel_layouts=stereo,aresample=48000,loudnorm=I=${lufs},aresample=48000[bed0]`;
    filter += `;[bed0][vosc]sidechaincompress=threshold=0.03:ratio=8:attack=25:release=900:makeup=1[duck]`;
    filter += `;[vo1][duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,aresample=48000[aout]`;
    amap = "[aout]";
  }

  await runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", ...inputs,
    ...(filter ? ["-filter_complex", filter] : []),
    "-map", cur === "[0:v]" && !subsOn ? "0:v" : cur, "-map", amap, "-t", String(run.voDuration),
    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", "final.mp4"], dir);

  // GÉNÉRIQUE DE CHAÎNE — collé APRÈS coup, sans ré-encoder la vidéo.
  // ⚠ On ne l'injecte PAS dans le filter_complex ci-dessus : y faire cohabiter vidéo et audio
  //   a désynchronisé la voix sur la machine Crime. Les sous-titres sont gravés ici, donc rien
  //   à décaler. Best-effort : un échec laisse la vidéo intacte.
  {
    const st = DEFAULT_SETTINGS;
    const cfgS = (config().settings || {});
    const on = cfgS.sting !== false && st.sting !== false;
    if (on) {
      const lp = path.join(REMOTION_DIR, "public", cfgS.stingLogo || st.stingLogo);
      const added = await intro.prepend(path.join(dir, "final.mp4"), {
        logoPath: lp, title: cfgS.stingTitle || st.stingTitle,
        subtitle: cfgS.stingSubtitle || st.stingSubtitle,
        accent: cfgS.stingAccent || st.stingAccent, seconds: 5,
      }).catch(() => 0);
      if (added) log(run, `Générique de chaîne : ${added} s en tête`);
      else log(run, "Générique non ajouté (vidéo inchangée)");
    }
  }

  try {
    if (ctaSeq) fs.rmSync(ctaSeq, { recursive: true, force: true });
    fs.unlinkSync(path.join(REMOTION_DIR, `cta-${run.id}.json`));
    fs.rmSync(clips, { recursive: true, force: true });
    fs.rmSync(path.join(dir, "parts"), { recursive: true, force: true });
    fs.unlinkSync(mute);
  } catch {}
  return path.join(dir, "final.mp4");
}

// ---------------------------------------------------------------- étape 7 : packaging

/** YouTube compte +2 caractères pour CHAQUE tag contenant une espace (guillemets implicites). */
function capTags(tags, max = 470) {
  const out = [];
  let total = 0;
  for (const t of tags.map((x) => String(x).trim().toLowerCase()).filter(Boolean)) {
    const w = t.length + (t.includes(" ") ? 2 : 0) + (out.length ? 1 : 0);
    if (total + w > max) break;
    out.push(t);
    total += w;
  }
  return out;
}

/** Règles de packaging — partagées par la génération initiale ET la régénération d'un champ. */
const PACK_RULES = [
    "RÈGLES :",
    "- TITRE : 70 à 100 caractères, tutoiement, une ellipse « … » ou un paradoxe qui ouvre une",
    "  boucle de curiosité, suffixe « | <nom de chaîne> » facultatif. Il doit annoncer EXACTEMENT",
    "  ce que la miniature promet.",
    "- DESCRIPTION : 230 à 320 mots, structurée ainsi et dans cet ordre :",
    "    1. deux ou trois phrases d'accroche qui reprennent la tension du script, au tutoiement,",
    "       et qui donnent envie de rester (pas de résumé plat : on rejoue le problème du spectateur) ;",
    "    2. une ligne « Dans cette vidéo : » suivie de 4 à 5 puces commençant par un émoji,",
    "       chacune annonçant un bénéfice concret et non un chapitre ;",
    "    3. une invitation à s'abonner, chaleureuse et personnelle (2 à 3 phrases) : dire ce que",
    "       l'abonné reçoit chaque semaine et pourquoi la cloche compte. Jamais « n'oubliez pas de » ;",
    "    4. une phrase d'apaisement pour clore, à la deuxième personne ;",
    "    5. l'avertissement : cette vidéo propose une réflexion inspirée de la sagesse bouddhiste,",
    "       elle ne remplace pas un accompagnement médical ou psychologique ;",
    "    6. une dernière ligne de 8 à 12 HASHTAGS collés (#sagessebouddhiste #lâcherprise …),",
    "       sans accents dans les hashtags, séparés par des espaces.",
    "- TAGS : 18 à 24 tags, minuscules, les plus génériques de la niche d'abord.",
    "- MINIATURE : `thumbLines` (2 lignes) + `thumbAccent` (1 ligne) sont affichés L'UN SOUS L'AUTRE",
    "  et doivent se lire comme UNE SEULE PHRASE COMPLÈTE et grammaticalement correcte.",
    "  Exemple valide : [\"APPRENDS\",\"À LÂCHER\"] + \"PRISE\" -> « APPRENDS À LÂCHER PRISE ».",
    "  Exemple INVALIDE : [\"1 MINUTE\",\"AU RÉVEIL\"] + \"TOUT\" -> « 1 MINUTE AU RÉVEIL TOUT » ne veut rien dire.",
    "  1 à 3 mots par ligne, EN CAPITALES, 12 caractères MAXIMUM par ligne (au-delà le texte écrase le sujet).",
    "  RENDU : la 1re ligne s'affiche en blanc sur un BANDEAU ROUGE, la 2e en blanc, et `thumbAccent`",
    "  en JAUNE OR. Choisis donc pour la 1re ligne un mot court et frappant (il porte le bandeau),",
    "  et pour `thumbAccent` le mot le plus fort de la phrase — c'est lui que l'œil verra en premier.",
    "  Plus `thumbPrompt` : un prompt d'image en anglais décrivant UNIQUEMENT le sujet (un moine en",
    "  méditation, de profil, yeux clos…). Ne décris ni le fond ni le cadrage : la machine impose",
    "  déjà un fond noir, un cercle enso doré et le sujet dans le tiers droit.",
    "",
].join("\n");

async function generatePackaging(run) {
  if (run.pack) return;
  const c = config();
  const lang = c.settings.chainLanguage || run.params.language;
  const inspiration = c.nicheId ? bank.inspiration(c.nicheId, { maxTitles: 14, maxVisions: 0 }) : "";

  const j = await genJson([
    `Tu prépares la publication YouTube d'une vidéo de sagesse bouddhiste intitulée « ${run.title} ».`,
    `THÈME : ${run.theme || run.title}`,
    `LANGUE DU PACKAGING : ${lang} (c'est la langue du PUBLIC, pas forcément celle de la voix off).`,
    "",
    "EXTRAIT DU SCRIPT :",
    run.script.slice(0, 2500),
    inspiration ? `\nCODES DE LA NICHE (titres des concurrents) :\n${inspiration}` : "",
    "",
    PACK_RULES,
    'RÉPONDS EN JSON : {"title":"","description":"","tags":[],"thumbLines":["",""],"thumbAccent":"","thumbPrompt":""}',
  ].join("\n"), { label: "Packaging" });

  run.pack = {
    title: String(j.title || run.title).slice(0, 100),
    description: String(j.description || ""),
    tags: capTags(j.tags || []),
    thumbLines: (j.thumbLines || []).slice(0, 2).map((x) => String(x).toUpperCase()),
    thumbAccent: String(j.thumbAccent || "").toUpperCase(),
    thumbPrompt: String(j.thumbPrompt || ""),
  };
  saveRun(run);
  log(run, `Packaging : « ${run.pack.title} » · ${run.pack.tags.length} tags`);
  await generateThumbnail(run);
}

/**
 * Miniature, sur la formule relevée sur les 6 miniatures les plus vues de la niche :
 * sujet dégagé À DROITE, texte capitales à gauche, blanc + un mot en jaune-vert, contour noir.
 * Le sujet ne doit JAMAIS passer sous le texte : on recadre la source vers sa partie GAUCHE
 * (contre-intuitif — un offset vers la droite ramène le sujet au centre).
 */
/**
 * Direction artistique de la MINIATURE — distincte de celle des plans du film.
 * Reprise de la référence fournie : fond quasi noir, cercle enso doré, lumière rasante chaude,
 * feuilles en suspension, sujet dans le TIERS DROIT et deux tiers gauche laissés au texte.
 */
const THUMB_LOOK =
  "Dramatic YouTube thumbnail composition. Near-black background with warm floating dust particles and soft bokeh. " +
  "A large golden brushed enso circle glows behind the subject. A few green leaves drift in the air. " +
  "Strong warm orange rim light on the subject, deep contrast, saturated saffron and gold palette. " +
  "The subject is placed in the RIGHT THIRD of the frame, seen in profile; the LEFT TWO THIRDS are dark and " +
  "completely empty, reserved for large text. Cinematic, high contrast, very readable at small size.";

/**
 * Où se trouve le SUJET dans l'image ? On mesure le centre de gravité lumineux colonne par
 * colonne (le moine est éclairé, le fond est sombre) et on renvoie sa position en 0..1.
 *
 * ⚠ Pourquoi mesurer plutôt que décaler d'une valeur fixe : le décalage constant de 280 px
 *   corrigeait le cas où le modèle CENTRE le sujet, mais expulsait du cadre les images où il
 *   avait correctement cadré à droite — le moine se retrouvait coupé au bord. Signalé.
 * Renvoie null si la mesure échoue : on retombe alors sur le décalage historique.
 */
async function subjectCenterX(file) {
  return new Promise((resolve) => {
    const c = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file,
      "-vf", "scale=128:72,format=gray", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
      { windowsHide: true });
    const buf = [];
    c.stdout.on("data", (d) => buf.push(d));
    c.stderr.on("data", () => {});
    c.on("error", () => resolve(null));
    c.on("close", () => {
      const d = Buffer.concat(buf);
      if (d.length < 128 * 72) return resolve(null);
      let num = 0, den = 0;
      for (let x = 0; x < 128; x++) {
        let col = 0;
        for (let y = 0; y < 72; y++) col += d[y * 128 + x];
        col = Math.max(0, col / 72 - 28);        // on retranche le fond sombre
        num += col * x; den += col;
      }
      resolve(den > 0 ? num / den / 127 : null);
    });
  });
}

async function generateThumbnail(run, override) {
  const dir = path.join(OUT_ROOT, run.id);
  ensureDir(dir);
  const pack = run.pack || {};
  const prompt = override || pack.thumbPrompt ||
    "A buddhist monk in a saffron robe seated in meditation, seen in profile, eyes closed, hands joined";
  const src = path.join(dir, "thumb-src");
  const file = await download(await kiePoll(await kieCreate(KIE_MODEL[config().settings.imageModel] || KIE_MODEL.nano,
    { prompt: `${prompt}. ${THUMB_LOOK} ${DA_NEG}`, aspect_ratio: "16:9" }), run.id), src);
  run.cost.images = (run.cost.images || 0) + PRICES.image;
  spend.record("Kie.ai", MACHINE_NAME, PRICES.image, "USD", "Miniature");

  const txtDir = path.join(dir, "thumbtxt");
  ensureDir(txtDir);
  const lines = [...(pack.thumbLines || []), pack.thumbAccent].filter(Boolean).slice(0, 3);
  lines.forEach((t, i) => fs.writeFileSync(path.join(txtDir, `l${i}.txt`), t, "utf8"));

  /**
   * TRAITEMENT DU TEXTE — calqué sur la miniature de référence fournie par l'utilisateur :
   *   ligne 1  blanc sur BANDEAU ROUGE
   *   ligne 2  blanc, sans fond
   *   ligne 3  JAUNE OR (le mot fort, `thumbAccent`)
   * Le tout en capitales très grasses avec un contour noir épais, sur les deux tiers gauche.
   *
   * ⚠ `drawtext` ne sait pas mesurer son propre texte : le bandeau rouge est donc dimensionné
   * depuis la même approximation que la taille de police (Arial Black ≈ 0,62 × la taille par
   * caractère). C'est ce coefficient qui garantit que bandeau et texte restent solidaires.
   */
  const FONT = process.platform === "darwin"
    ? "/System/Library/Fonts/Supplemental/Arial Black.ttf"
    : "C\\:/Windows/Fonts/ariblk.ttf";
  const RED = "0xC8102E";      // rouge du bandeau
  const GOLD = "0xFFC72C";     // jaune or du mot fort
  // MESURÉ au pixel (rendu réel + analyse de l'image), pas estimé : Arial Black en capitales
  // occupe 0,67 à 0,78 × la taille par caractère selon le mot. L'ancienne valeur 0,62 sous-estimait
  // de 26 % dans le pire cas — le texte débordait sur le sujet. On prend le MAX pour ne jamais déborder.
  const CHAR_W = 0.78;

  // UNE SEULE taille pour toutes les lignes, dictée par la plus longue : une taille par ligne
  // donnait un bloc en escalier (« CROIS EN TOI » énorme au-dessus de « TOUT VACILLE » petit).
  const TEXT_W = 760;
  const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), "");
  const size = Math.max(46, Math.min(142, Math.floor(TEXT_W / (CHAR_W * Math.max(1, longest.length)))));
  const step = Math.round(size * 1.16);                 // interligne serré, comme la référence
  const X = 46;
  const y0 = Math.round((720 - step * lines.length) / 2) + 4;

  const draws = [];
  lines.forEach((t, i) => {
    const isAccent = i === lines.length - 1 && !!pack.thumbAccent;
    const y = y0 + i * step;
    // Bandeau rouge sur la PREMIÈRE ligne : `box=1` de drawtext se dimensionne TOUT SEUL sur le
    // texte. Un drawbox séparé exigeait d'estimer la largeur — il débordait ou flottait.
    const banner = i === 0 && lines.length > 1
      ? `:box=1:boxcolor=${RED}@0.96:boxborderw=${Math.round(size * 0.16)}`
      : "";
    draws.push(
      `drawtext=fontfile='${FONT}':textfile=thumbtxt/l${i}.txt:x=${X}:y=${y}:fontsize=${size}:` +
      `fontcolor=${isAccent ? GOLD : "white"}:borderw=${Math.max(6, Math.round(size * 0.072))}:bordercolor=black@0.94:` +
      `shadowcolor=black@0.55:shadowx=3:shadowy=4${banner}`
    );
  });
  // Filet doré sous le bloc — présent dans la référence, il ferme la composition.
  if (lines.length) {
    const w = Math.round(size * CHAR_W * longest.length * 0.62);
    draws.push(`drawbox=x=${X}:y=${y0 + step * lines.length + 6}:w=${w}:h=4:color=${GOLD}@0.85:t=fill`);
  }
  const drawChain = draws.join(",");

  // DÉCALAGE ADAPTATIF. Le sujet doit être dégagé du texte, mais un décalage FIXE se trompe une
  // fois sur deux : si le modèle a déjà cadré à droite, pousser encore coupe le sujet au bord.
  // On mesure donc où il est, et on ne décale que ce qu'il faut pour l'amener à `SUBJECT_TARGET`.
  const SUBJECT_TARGET = 0.72;                  // position visée du sujet, en largeur d'image
  const measured = await subjectCenterX(file).catch(() => null);
  const SHIFT = measured === null
    ? 280                                        // repli : l'ancien décalage fixe
    : Math.max(0, Math.min(380, Math.round((SUBJECT_TARGET - measured) * 1280)));
  log(run, `Miniature : sujet mesuré à ${measured === null ? "?" : (measured * 100).toFixed(0) + " %"} — décalage ${SHIFT} px`);

  const out = path.join(dir, "thumbnail.jpg");
  await runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-i", path.basename(file),
    "-f", "lavfi", "-i", "gradients=s=1280x720:c0=black@0.94:c1=black@0.0:x0=0:y0=360:x1=860:y1=360:type=linear:d=1",
    "-filter_complex",
    `[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,eq=contrast=1.16:saturation=1.22:brightness=-0.05,split=2[bgsrc][fg0];` +
    `[bgsrc]boxblur=26:2,eq=brightness=-0.34:saturation=0.60[bg];` +
    // bord gauche du calque fondu sur 150 px : sans ce dégradé d'alpha, la jointure formait
    // une barre verticale nette en plein milieu de l'image.
    `[fg0]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*clip(X/150,0,1)'[fg];` +
    `[bg][fg]overlay=${SHIFT}:0,vignette=PI/4.5[base];` +
    `[1:v]format=rgba,trim=end_frame=1,setpts=PTS-STARTPTS[g];[base][g]overlay=0:0:shortest=1${drawChain ? "," + drawChain : ""}[out]`,
    "-map", "[out]", "-frames:v", "1", "-q:v", "2", "thumbnail.jpg"], dir);

  run.thumbRel = `agent-os/output/machines/${run.id}/thumbnail.jpg`;
  run.thumbTs = Date.now();   // cache-buster : même nom de fichier -> sinon le navigateur ressort l'ancienne
  try { fs.unlinkSync(file); } catch {}
  saveRun(run);
  log(run, "Miniature générée");
  return out;
}

async function regenThumbnail(runId, instructions) {
  const run = getRun(runId);
  const j = await genJson([
    "Tu régénères la miniature YouTube d'une vidéo de sagesse bouddhiste.",
    `THÈME (noyau dur, à ne jamais quitter) : ${run.theme || run.title}`,
    `TEXTE ACTUEL : ${[...(run.pack?.thumbLines || []), run.pack?.thumbAccent].filter(Boolean).join(" / ")}`,
    instructions ? `\nPRIORITÉ ABSOLUE — observation de l'utilisateur : ${instructions}` : "",
    "",
    "Le sujet doit être cadré dans le TIERS DROIT, la moitié gauche restant libre pour le texte.",
    "Les 2 lignes + l'accent s'affichent l'un sous l'autre et doivent former UNE SEULE PHRASE",
    "complète et correcte (ex. « APPRENDS / À LÂCHER / PRISE »). 22 caractères max par ligne.",
    'RÉPONDS EN JSON : {"thumbLines":["",""],"thumbAccent":"","thumbPrompt":""}',
  ].join("\n"), { label: "Miniature" });
  run.pack = Object.assign(run.pack || {}, {
    thumbLines: (j.thumbLines || []).slice(0, 2).map((x) => String(x).toUpperCase()),
    thumbAccent: String(j.thumbAccent || "").toUpperCase(),
    thumbPrompt: String(j.thumbPrompt || ""),
  });
  saveRun(run);
  await generateThumbnail(run, run.pack.thumbPrompt);
  return getRun(runId);
}

async function regenTexts(runId, instructions, field) {
  const run = getRun(runId);
  const c = config();
  const j = await genJson([
    `Tu réécris le packaging YouTube de « ${run.title} » (sagesse bouddhiste).`,
    `LANGUE : ${c.settings.chainLanguage || run.params.language}`,
    `THÈME (noyau dur) : ${run.theme || run.title}`,
    field ? `Ne réécris QUE le champ : ${field}` : "Réécris titre, description et tags.",
    "",
    PACK_RULES,
    instructions ? `\nPRIORITÉ ABSOLUE — observation de l'utilisateur : ${instructions}` : "",
    'RÉPONDS EN JSON : {"title":"","description":"","tags":[]}',
  ].join("\n"), { label: "Textes" });
  run.pack = run.pack || {};
  if (!field || field === "title") run.pack.title = String(j.title || run.pack.title).slice(0, 100);
  if (!field || field === "description") run.pack.description = String(j.description || run.pack.description);
  if (!field || field === "tags") run.pack.tags = capTags(j.tags || run.pack.tags || []);
  saveRun(run);
  return getRun(runId);
}

// ---------------------------------------------------------------- stock & publication

function stock() { return readJSON(`machines/${MACHINE_ID}-stock.json`, []); }
function saveStock(s) { writeJSON(`machines/${MACHINE_ID}-stock.json`, s); }
function patchStock(entryId, patch = {}) {
  const s = stock();
  const e = s.find((x) => x.id === entryId);
  if (!e) throw new Error("Entrée de stock introuvable");
  for (const k of ["archived", "posted"]) if (patch[k] !== undefined) e[k] = !!patch[k];
  // ⚠ liste blanche : `videoId` et `channelId` étaient écrits par publishRun mais SILENCIEUSEMENT
  // ignorés ici — l'entrée de stock restait sans lien YouTube ni chaîne.
  for (const k of ["videoId", "channelId", "title"]) if (patch[k] !== undefined) e[k] = patch[k];
  saveStock(s);
  return e;
}
function addToStock(run) {
  const s = stock();
  if (s.some((x) => x.id === run.id)) return;
  s.unshift({
    id: run.id, runId: run.id, title: run.pack?.title || run.title, theme: run.theme || null,
    createdAt: new Date().toISOString(), durationSec: run.voDuration,
    finalRel: run.finalRel, thumbRel: run.thumbRel || null,
    shots: (run.scenes || []).length, cost: run.cost,
    // Champs attendus par la vue Stock (alignée sur Linguistique) : langue, chaîne et id YouTube.
    language: run.params?.language || null,
    channelId: run.published?.channelId || run.params?.publishChannelId || null,
    videoId: run.published?.id || null,
    posted: !!run.published?.id, archived: false,
  });
  saveStock(s);
}

async function publishRun(runId, opts = {}) {
  const run = getRun(runId);
  const c = config();
  const channelId = opts.channelId || run.params.publishChannelId;
  if (!channelId) throw new Error("Aucune chaîne YouTube sélectionnée");
  const file = path.join(OUT_ROOT, run.id, "final.mp4");
  if (!fs.existsSync(file)) throw new Error("Vidéo finale introuvable");
  const privacyStatus = opts.privacyStatus || run.params.publishPrivacy || c.settings.publishPrivacy || "private";
  // Signature : youtubeUpload(channelId, filePath, meta). Passer un objet en 2e position
  // faisait un fs.statSync(objet) -> « The "path" argument must be of type string ».
  const res = await google.youtubeUpload(channelId, file, {
    title: opts.title || run.pack?.title || run.title,
    description: opts.description || run.pack?.description || "",
    tags: opts.tags || run.pack?.tags || [],
    privacyStatus,
    categoryId: "22", // People & Blogs — la catégorie de la niche
  });
  const thumb = path.join(OUT_ROOT, run.id, "thumbnail.jpg");
  if (res?.id && fs.existsSync(thumb)) await google.youtubeSetThumbnail(channelId, res.id, thumb).catch(() => {});
  run.published = { id: res.id, url: `https://youtu.be/${res.id}`, privacyStatus, at: new Date().toISOString() };
  saveRun(run);
  const s = stock();
  const e = s.find((x) => x.id === run.id);
  if (e) { e.posted = true; saveStock(s); }
  // L'entrée de stock porte l'état de publication : sans ça la vue Stock affiche « en stock »
  // sur une vidéo déjà en ligne.
  try { patchStock(runId, { posted: true, videoId: run.published?.id || null, channelId }); } catch {}
  return run.published;
}

// ---------------------------------------------------------------- machine à états

function promptsComplete(run) {
  return !!run.script && !!run.scenes?.length && run.scenes.every((s) => s.prompt);
}
function deriveStatus(run) {
  if (!run.script) return "script_running";
  if (!run.scenes?.length || !run.words?.length) return "voice_running";
  if (!run.library) return "library_running";
  if (!promptsComplete(run)) return "prompts_running";
  if (run.scenes.some((s) => !s.image)) return "images_running";
  if (!run.music) return "music_running";
  if (!run.music.none && !run.music.file) return "music_running";
  if (!run.finalRel) return "montage_running";
  if (!run.pack) return "packaging_running";
  return "done";
}

const STEPS = [
  ["script", "Écriture du script (Claude)…", 8, stepScript],
  ["voice", "Voix off + transcript + découpage…", 18, stepVoice],
  ["library", "Bibliothèque visuelle : références récurrentes…", 30, stepLibrary],
  ["prompts", "Écriture des prompts d'images…", 38, stepPrompts],
  ["images", "Génération des images…", 46, stepImages],
  ["music", "Musique de fond (Suno)…", 72, stepMusic],
];

function cancelRun(id) {
  const run = getRun(id);
  cancelledRuns.add(id);
  if (run.status !== "done" && run.status !== "failed" && !run.cancelledFrom) run.cancelledFrom = run.status;
  tasks.updateTask(run.taskId, { step: "Annulée par l'utilisateur", status: "failed" }).catch(() => {});
  if (!activeAdvance.has(id)) {
    run.status = "failed";
    run.error = "Annulée par l'utilisateur";
    log(run, "Run annulé");
  } else log(run, "Annulation demandée — abandon des requêtes en cours…");
  saveRun(run);
  return getRun(id);
}
function resumeRun(id, forcedStatus) {
  if (activeAdvance.has(id)) throw new Error("Le run tourne déjà — la décharge ⚡ n'est utile que s'il est à l'arrêt.");
  const run = getRun(id);
  cancelledRuns.delete(id);
  run.status = forcedStatus || run.cancelledFrom || (run.status === "failed" ? deriveStatus(run) : run.status);
  run.error = null;
  delete run.cancelledFrom;
  (run.scenes || []).forEach((s) => { delete s.rendering; delete s.pending; delete s.error; });
  saveRun(run);
  log(run, `Reprise à l'étape « ${run.status.replace("_running", " (en cours)").replace("_ready", " (validé)")} »`);
  advance(run.id);
  return getRun(id);
}

async function advance(runId) {
  cancelledRuns.delete(runId);
  activeAdvance.add(runId);
  const run = getRun(runId);
  const auto = run.mode === "auto";
  const t = (patch) => tasks.updateTask(run.taskId, Object.assign({ status: "running" }, patch)).catch(() => {});
  try {
    await ff.ensureTools(); // préflight : ne jamais dépenser si FFmpeg manque
    for (;;) {
      if (cancelledRuns.has(runId)) throw new Error("Annulée par l'utilisateur");
      const cur = run.status;
      const step = STEPS.find(([name]) => cur === name + "_running");
      if (step) {
        await t({ step: step[1], progress: step[2] });
        await step[3](run);
        const idx = STEPS.indexOf(step);
        const next = idx + 1 < STEPS.length ? STEPS[idx + 1][0] + "_running" : "montage_running";
        run.status = auto ? next : step[0] + "_ready";
      } else if (cur === "montage_running") {
        await t({ step: "Montage final (FFmpeg)…", progress: 80 });
        const out = await renderMontage(run);
        run.finalRel = `agent-os/output/machines/${run.id}/final.mp4`;
        run.status = "packaging_running";
        log(run, "Montage terminé : " + out);
      } else if (cur === "packaging_running") {
        await t({ step: "Packaging : titre, description, tags, miniature…", progress: 92 });
        await generatePackaging(run);
        addToStock(run);
        run.status = "done";
        log(run, "Vidéo ajoutée au stock");
        if (run.params.publishChannelId) {
          await t({ step: "Publication YouTube…", progress: 97 });
          try {
            const pub = await publishRun(run.id);
            log(run, `Publiée : ${pub.url} (${pub.privacyStatus})`);
          } catch (e) { log(run, "⚠ Publication échouée : " + e.message); }
        }
      } else break;
      saveRun(run);
      if (run.status === "done") {
        await tasks.updateTask(run.taskId, { step: `Terminée — ${(run.scenes || []).length} visuels, ${(run.voDuration / 60).toFixed(1)} min`, progress: 100, status: "done" }).catch(() => {});
        break;
      }
      if (run.status.endsWith("_ready")) {
        await tasks.updateTask(run.taskId, { step: `En attente de validation (${run.status.replace("_ready", "")})`, status: "running" }).catch(() => {});
        break;
      }
    }
  } catch (e) {
    run.status = "failed";
    run.error = e.message;
    log(run, "❌ " + e.message);
    saveRun(run);
    await tasks.updateTask(run.taskId, { step: e.message.slice(0, 200), status: "failed" }).catch(() => {});
  } finally {
    activeAdvance.delete(runId);
  }
  return getRun(runId);
}

function estimate(p) {
  const c = config().settings;
  const durationMin = Number(p.durationMin) || 10;
  const outroWords = String(c.outro || "").split(/\s+/).filter(Boolean).length;
  const words = Math.round(durationMin * WPM) + outroWords;   // l'outro s'ajoute au récit
  const chars = Math.round(words * 5.7);
  const shots = Math.max(1, Math.round(words / (Number(c.wordsPerImage) || WORDS_PER_IMAGE)));
  const images = (shots + 1) * PRICES.image;              // +1 miniature
  // ⚠ Le moteur change le prix de la voix d'un facteur 6,7 (0,10 $ contre 0,015 $ / 1000 car.).
  // L'estimation l'ignorait : deux moteurs affichaient le même total, ce qui rendait le
  // chiffre trompeur au moment précis où il sert — avant de lancer.
  const engine = TTS_ENGINES.includes(p.ttsEngine) ? p.ttsEngine
    : (TTS_ENGINES.includes(c.ttsEngine) ? c.ttsEngine : "inworld");
  const per1k = engine === "elevenlabs" ? PRICES.voicePer1kCharsEleven : PRICES.voicePer1kChars;
  const tts = (chars / 1000) * per1k;
  const whisper = durationMin * 60 * PRICES.whisperPerSec;
  const voice = tts + whisper;
  const music = p.musicStyle === "Aucune" || p.musicReuseId ? 0 : PRICES.suno;
  // Références visuelles : estimation prudente de nouvelles fiches (plafonnées à MAX_NEW).
  const refs = p.useLibrary === false ? 0 : library.MAX_NEW * library.PRICE_REF;
  return {
    words, shots, chars, engine, per1k,
    images: +images.toFixed(2), voice: +voice.toFixed(3),
    tts: +tts.toFixed(3), whisper: +whisper.toFixed(3),
    music: +music.toFixed(2), refs: +refs.toFixed(2),
    total: +(images + voice + music + refs).toFixed(2),
  };
}

function createRun(params = {}) {
  const c = config();
  const id = "b" + Date.now().toString(36);
  const durationMin = Math.max(2, Math.min(30, Number(params.durationMin) || 10));
  const language = params.language || "Français";
  // Le moteur et la voix sont des choix de CHAÎNE : on retombe sur les réglages mémorisés,
  // pas sur « la première de la liste » — un repli arbitraire donne un narrateur au hasard.
  const ttsEngine = TTS_ENGINES.includes(params.ttsEngine) ? params.ttsEngine
    : (TTS_ENGINES.includes(c.settings.ttsEngine) ? c.settings.ttsEngine : "inworld");
  const voices = voicesFor(language, params.voiceGender, ttsEngine);
  const voiceDefault = c.settings.voice && voices.some((v) => v.name === c.settings.voice)
    ? c.settings.voice : (voices[0] || { name: "" }).name;
  const run = {
    id,
    machineId: MACHINE_ID,
    title: params.subject || "Sans titre",
    status: "script_running",
    mode: params.mode === "auto" ? "auto" : "semi",
    createdAt: new Date().toISOString(),
    params: {
      subject: String(params.subject || "").trim(),
      durationMin,
      language,
      voiceGender: params.voiceGender || "",
      ttsEngine,
      voice: params.voice && voices.some((v) => v.name === params.voice) ? params.voice : voiceDefault,
      narrationSpeed: TEMPO[params.narrationSpeed] ? params.narrationSpeed : "lente",
      musicStyle: params.musicStyle || c.settings.musicStyle,
      musicReuseId: params.musicReuseId || null,
      useLibrary: params.useLibrary !== false,
      subtitles: params.subtitles !== false,
      cta: params.cta !== false,
      channelName: params.channelName || c.settings.channelName,
      publishChannelId: params.publishChannelId || null,
      publishPrivacy: params.publishPrivacy || c.settings.publishPrivacy,
    },
    cost: { voice: 0, images: 0, music: 0, refs: 0 },
    scenes: [],
    logs: [],
  };
  run.estimate = estimate(run.params);
  const task = tasks.createTask({
    title: `Bouddhisme — ${run.params.subject.slice(0, 60) || "vidéo"}`,
    desc: `${durationMin} min · ~${run.estimate.shots} visuels · ~${run.estimate.total.toFixed(2)} $`,
    machine: MACHINE_NAME, machineId: MACHINE_ID, runId: id,
    kind: "video", step: "Démarrage…", progress: 2, status: "running",
  });
  run.taskId = task.id;
  saveRun(run);
  advance(id);
  return run;
}

function validate(runId) {
  const run = getRun(runId);
  if (!run.status.endsWith("_ready")) throw new Error("Rien à valider à cette étape.");
  const stuck = (run.scenes || []).filter((s) => s.pending || s.rendering);
  if (stuck.length) throw new Error(`${stuck.length} visuel(s) en cours de régénération — attends la fin.`);
  if (run.status === "images_ready") {
    const miss = run.scenes.filter((s) => !s.image);
    if (miss.length) throw new Error(`${miss.length} image(s) manquante(s) — régénère-les avant de valider.`);
  }
  if (run.status === "music_ready" && run.music && !run.music.none && !run.music.file) {
    throw new Error("Choisis une variante musicale avant de valider.");
  }
  const order = STEPS.map(([n]) => n);
  const idx = order.indexOf(run.status.replace("_ready", ""));
  run.status = idx + 1 < order.length ? order[idx + 1] + "_running" : "montage_running";
  saveRun(run);
  advance(runId);
  return getRun(runId);
}

// ---------------------------------------------------------------- régénération d'un visuel

const liveRuns = new Map();
function getLiveRun(id) {
  const e = liveRuns.get(id);
  if (e) { e.n++; return e.run; }
  const run = getRun(id);
  liveRuns.set(id, { run, n: 1 });
  return run;
}
function releaseLiveRun(id) {
  const e = liveRuns.get(id);
  if (!e) return;
  if (--e.n <= 0) liveRuns.delete(id);
}

async function regenScene(runId, sceneI, instructions) {
  if (activeAdvance.has(runId)) throw new Error("Le run avance — attends l'étape suivante avant de régénérer.");
  const run = getLiveRun(runId);
  try {
    const scene = run.scenes.find((s) => s.i === Number(sceneI));
    if (!scene) throw new Error("Visuel introuvable");
    if (scene.pending) throw new Error("Ce visuel est déjà en cours de régénération");
    scene.pending = true;
    saveRun(run);
    try {
      if (instructions) {
        const da = config().settings.artDirection || DA_DEFAULT;
        const j = await genJson([
          "Tu réécris UN prompt d'image (en anglais) pour une vidéo de sagesse bouddhiste.",
          `VOIX OFF À CET INSTANT (noyau dur, la scène doit y correspondre) : ${scene.say}`,
          `PROMPT ACTUEL : ${scene.prompt}`,
          `PRIORITÉ ABSOLUE — observation de l'utilisateur : ${instructions}`,
          "60 à 90 mots, aucun texte dans l'image.",
          'RÉPONDS EN JSON : {"prompt":"..."}',
        ].join("\n"), { label: "Prompt" });
        if (j.prompt) scene.prompt = `${String(j.prompt).trim()}. ${da}. ${DA_NEG}`;
      }
      const old = scene.image;
      scene.image = null;
      await generateImage(run, scene);           // l'ancienne image n'est écrasée qu'en cas de SUCCÈS
      if (old && old.file !== scene.image.file) { try { fs.unlinkSync(old.file); } catch {} }
    } finally {
      delete scene.pending;
      saveRun(run);
    }
    return run.scenes.find((s) => s.i === Number(sceneI));
  } finally { releaseLiveRun(runId); }
}

// ---------------------------------------------------------------- idées & sauvetage

function producedThemes() {
  const out = [];
  for (const r of listRuns()) if (r.title && r.title !== "Sans titre") out.push(r.title);
  for (const s of stock()) if (s.theme) out.push(s.theme);
  return [...new Set(out)];
}

async function suggestTheme() {
  const c = config();
  const done = producedThemes();
  const inspiration = c.nicheId ? bank.inspiration(c.nicheId, { maxTitles: 16, maxVisions: 0 }) : "";
  const j = await genJson([
    "Propose UN sujet de vidéo de sagesse bouddhiste contemplative (parabole, enseignement, leçon de vie).",
    done.length ? `DÉJÀ PRODUIT — n'en propose ni une reprise ni une variante proche :\n- ${done.slice(0, 30).join("\n- ")}` : "",
    inspiration ? `\nINSPIRATION (concurrents) :\n${inspiration}` : "",
    "Le sujet doit tenir en une phrase et porter une tension universelle (un poids intérieur reconnaissable).",
    'RÉPONDS EN JSON : {"subject":"","angle":"","pitch":""}',
  ].join("\n"), { label: "Idée" });
  return { subject: j.subject || "", angle: j.angle || "", pitch: j.pitch || "" };
}

/**
 * ⚠ RATTRAPAGE DU STOCK — au demarrage.
 * `addToStock` n'est appele qu'en sortie NORMALE de la boucle advance(). Un run interrompu
 * (serveur redemarre, advance() tue) qui atteint quand meme `done` — par reclassement ou par
 * reprise — n'y passe jamais : la video, la miniature et le packaging sont sur le disque, mais
 * AUCUNE ligne de stock n'existe. Resultat : la video est invisible dans l'onglet Stock et
 * impossible a publier. Vecu sur la machine Crime (run cmtlpl0vt).
 * `addToStock` teste deja la presence de l'id : ce rattrapage est idempotent.
 */
function backfillStock() {
  for (const r of listRuns()) {
    if (String(r.status) !== "done") continue;
    try { const f = getRun(r.id); if (f) addToStock(f); } catch {}
  }
}

function sweepRuns() {
  let n = 0;
  for (const r of listRuns()) {
    if (!r.status.endsWith("_running")) continue;
    try {
      const run = getRun(r.id);
      run.status = "failed";
      run.error = "Serveur redémarré pendant la génération";
      (run.scenes || []).forEach((s) => { delete s.rendering; delete s.pending; });
      saveRun(run);
      n++;
    } catch {}
  }
  backfillStock();
  return n;
}
function strandedRuns() {
  return listRuns()
    .filter((r) => r.status.endsWith("_running") && !activeAdvance.has(r.id))
    .map((r) => ({ id: r.id, machine: MACHINE_NAME, machineId: MACHINE_ID, theme: r.title, status: r.status }));
}

module.exports = {
  MACHINE_ID, MACHINE_NAME, VOICES, TTS_ENGINES, WPM, PRICES, MUSIC_STYLES,
  voicesFor, config, patchConfig,
  listRuns, getRun, createRun, validate, cancelRun, resumeRun, advance, estimate,
  regenScene, suggestTheme, producedThemes,
  regenThumbnail, regenTexts, generateThumbnail,
  chooseMusic, musicLib, removeFromMusicLib,
  library,
  stock, patchStock, publishRun,
  sweepRuns, strandedRuns,
};
