/**
 * MACHINE « Linguistique » — usine à vidéos d'apprentissage de langue par l'écoute.
 * Pipeline : Claude (dialogues) → image i2i (personnages) → ElevenLabs v3 (voix, FAL)
 *   → FFmpeg local (clip image fixe + audio ; lipsync présentateur optionnel via FAL)
 *   → FFmpeg (montage intro+scènes+outro + sous-titres Whisper→SRT + CTA haut-droite Remotion).
 * Modes : semi (validation étape par étape, régénération par scène) / auto (bout en bout).
 * Segments : intro (présentateur) → N dialogues (2 protagonistes) → outro (présentateur).
 * Le « noyau dur » (identités des 3 personnages, voix fixes, niveau, langue) survit aux régénérations.
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { readJSON, writeJSON, ensureDir, DATA_DIR } = require("../store");
const claude = require("../claude");
const google = require("../google");
const tasks = require("../tasks");
const spend = require("../spend");
const bank = require("../bank");
const vault = require("../vault");
const fal = require("../fal");
const ff = require("../ffmpeg");

const MACHINE_ID = "linguistique";
const MACHINE_NAME = "Linguistique";
const OUT_ROOT = path.join(__dirname, "..", "..", "output", "machines");
const intro = require("../intro");
const REMOTION_DIR = path.join(__dirname, "..", "..", "..", "remotion");
const ROOT = path.join(__dirname, "..", "..", "..");
const RUNS_DIR = path.join(DATA_DIR, "machines", "runs", MACHINE_ID); // sous-dossier propre (pas de collision avec Time Travel)
ensureDir(OUT_ROOT);
ensureDir(RUNS_DIR);

// Estimations de coût (USD) — ajustables. Image via Kie (studio), reste via FAL.
// Tarifs réels FAL : ElevenLabs v3 = 0,10 $ / 1000 caractères ENVOYÉS (contenu des dialogues) ;
// Veed = 0,40 $ / minute de vidéo traitée (seulement si le lipsync est activé).
// Whisper = 0,0008 $ / seconde de calcul (approximé par la durée d'audio transcrite).
const PRICES = { image: 0.03, voicePer1kChars: 0.1, videoPerSeg: 0.0, lipsyncPerMin: 0.4, whisperPerComputeSec: 0.0008 };
const BATCH_LONG = 6;
const BATCH_CONCURRENCY = 5;
const MAX_TRIES = 3;

// Préambule d'identité OBLIGATOIRE en tête de chaque prompt image (repris du workflow n8n de référence).
const IDENTITY_PREAMBLE =
  "Use the provided character reference images only for identity, facial consistency, body proportions, and visual continuity. Do not copy the original pose, framing, background, expression, or composition.";
const IMG_SAFETY = " No text, letters, numbers, subtitles, captions, logo or watermark anywhere in the image.";

// Voix ElevenLabs v3 (les noms SONT les voix). Filtrables par sexe côté UI.
const VOICES = {
  F: ["Aria", "Sarah", "Laura", "Charlotte", "Alice", "Matilda", "Jessica", "Lily"],
  M: ["Roger", "Charlie", "George", "Callum", "River", "Liam", "Will", "Eric", "Chris", "Brian", "Daniel", "Bill"],
};
// Langue → code Whisper (pour de meilleurs sous-titres). Absent = auto-détection.
const WHISPER_LANG = {
  English: "en", "Français": "fr", "Español": "es", Deutsch: "de", Italiano: "it", "Português": "pt",
  "日本語": "ja", "한국어": "ko", "العربية": "ar", "हिन्दी": "hi", "Русский": "ru", "中文": "zh",
};
const CTA_LABELS = {
  English: "Subscribe ▶", "Français": "Abonne-toi ▶", "Español": "¡Suscríbete! ▶", Deutsch: "Abonnieren ▶",
  Italiano: "Iscriviti ▶", "Português": "Inscreva-se ▶", "日本語": "チャンネル登録 ▶", "한국어": "구독 ▶",
  "العربية": "اشترك ▶", "हिन्दी": "सब्सक्राइब करें ▶", "Русский": "Подпишись ▶", "中文": "订阅 ▶",
};

// ---------- Claude ----------
function genModel() {
  return config().settings.promptModel || undefined;
}
const askGen = (prompt, ms = 6 * 60 * 1000) => claude.ask(prompt, { timeoutMs: ms, model: genModel() });
async function genJson(prompt, { ms = 6 * 60 * 1000, tries = 3, label = "" } = {}) {
  let last;
  for (let a = 1; a <= tries; a++) {
    try {
      return claude.parseJson(await askGen(prompt, ms));
    } catch (e) {
      if (/Annulée/.test(e.message)) throw e;
      last = e;
    }
  }
  throw new Error(`${label ? label + " : " : ""}${last ? last.message : "échec"} (après ${tries} tentatives)`);
}

// ---------- Reprise : nombre de segments attendus, complétude ----------
// sceneCount = dialogues + 2 (intro + outro), figé à la création.
function expectedSceneCount(run) {
  return run.sceneCount || (Number(run.dialogueCount || run.params.sceneCount) || 1) + 2;
}
function sceneComplete(s) {
  if (!s || !s.i || !s.image_prompt) return false;
  return s.role === "dialogue" ? Array.isArray(s.turns) && s.turns.length > 0 : !!s.narration;
}
function promptsComplete(run) {
  const exp = expectedSceneCount(run);
  const sc = run.scenes || [];
  if (sc.length < exp) return false;
  for (let i = 1; i <= exp; i++) if (!sceneComplete(sc.find((s) => s.i === i))) return false;
  return true;
}

// ---------- Config machine ----------
function defaultNicheId() {
  try {
    const n = bank.niches().find((x) => String(x.name).toLowerCase() === "english");
    return n ? n.id : null;
  } catch {
    return null;
  }
}
function config() {
  return readJSON(`machines/${MACHINE_ID}.json`, {
    id: MACHINE_ID,
    name: MACHINE_NAME,
    nicheId: defaultNicheId(),
    linkedChannelId: null,
    autoPublish: false,
    characters: [],
    settings: {
      sting: true,                        // générique de chaîne de 5 s en tête
      stingLogo: "french-talk-real-logo.png",
      stingTitle: "French Talk Real",
      stingSubtitle: "Learn French naturally",
      stingAccent: "#e05555",             // rouge du drapeau — le bleu du logo était identique
                                          // à l'accent de Crime, on prend l'autre teinte
      cornerLogo: true,                   // logo de chaîne en haut à gauche, toute la vidéo
      imageModel: "gpt",
      ctaEveryMin: 2,
      promptModel: "",
      lipsyncModel: "veed/lipsync",
    },
  });
}
function saveConfig(c) {
  writeJSON(`machines/${MACHINE_ID}.json`, c);
}
function patchConfig(patch) {
  const c = { ...config(), ...patch };
  if (patch.settings) c.settings = { ...config().settings, ...patch.settings };
  saveConfig(c);
  return c;
}
function upsertCharacter(ch) {
  const c = config();
  if (ch.id) {
    const i = c.characters.findIndex((x) => x.id === ch.id);
    if (i >= 0) c.characters[i] = { ...c.characters[i], ...ch };
  } else {
    ch.id = "p" + Date.now().toString(36);
    c.characters.push(ch);
  }
  saveConfig(c);
  return ch;
}
function removeCharacter(id) {
  const c = config();
  c.characters = c.characters.filter((x) => x.id !== id);
  saveConfig(c);
}

// ---------- Runs (sous-dossier propre à la machine) ----------
function runPath(id) {
  return `machines/runs/${MACHINE_ID}/${id}.json`;
}
function listRuns() {
  try {
    return fs
      .readdirSync(RUNS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJSON(runPath(f.replace(/\.json$/, "")), null))
      .filter(Boolean)
      .map(({ id, mode, status, params, theme, createdAt, scenes, cost, error }) => ({
        id, mode, status, params, theme, createdAt, error,
        sceneCount: scenes ? scenes.length : 0,
        cost,
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch {
    return [];
  }
}
function getRun(id) {
  const r = readJSON(runPath(id), null);
  if (!r) throw new Error("Run introuvable");
  return r;
}
function saveRun(r) {
  writeJSON(runPath(r.id), r);
}
function log(r, msg) {
  r.log = r.log || [];
  r.log.push(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
  saveRun(r);
}

// Personnages du run (présentateur + 2 protagonistes)
function castOf(run) {
  const c = config();
  const by = (id) => c.characters.find((x) => x.id === id);
  const P = by(run.params.presenterId);
  const A = by(run.params.protagonistIds && run.params.protagonistIds[0]);
  const B = by(run.params.protagonistIds && run.params.protagonistIds[1]);
  return { P, A, B };
}

// ---------- Noyau dur du prompt ----------
function coreRules(P, A, B, language, level) {
  const who = (c) => `${c.name} (${c.sex === "F" ? "femme" : "homme"}, voix fixe « ${c.voice} ») — apparence : ${c.appearance}`;
  return [
    `LANGUE CIBLE : ${language}. TOUT le texte parlé (narration ET dialogues) est en ${language}.`,
    `NIVEAU ${level} (NOYAU DUR) : phrases COURTES et simples, vocabulaire courant et concret, grammaire de base (présent surtout),`,
    "débit clair, répétition du vocabulaire clé. Pas d'argot, pas d'idiomes rares, pas de tournures complexes.",
    "PERSONNAGES (NOYAU DUR — identités et voix FIXES, ne jamais changer) :",
    `- PRÉSENTATEUR : ${who(P)}. Rôle : narrateur/professeur chaleureux et calme ; parle SEUL, face au spectateur, en intro et en outro.`,
    `- PROTAGONISTE A : ${who(A)}.`,
    `- PROTAGONISTE B : ${who(B)}.`,
    `Les DIALOGUES opposent EXACTEMENT ${A.name} (locuteur "A") et ${B.name} (locuteur "B"). Aucun autre personnage ne parle.`,
    'Chaque réplique de dialogue porte un champ speaker qui vaut EXACTEMENT "A" ou "B".',
    `PROMPTS IMAGE (ANGLAIS, >= 150 mots, style ANIMATION 3D cinématique, lumière chaude et douce, 16:9) :`,
    `ils DOIVENT COMMENCER par exactement cette phrase : « ${IDENTITY_PREAMBLE} »`,
    "puis décrire l'action des personnages, le DÉCOR précis du thème, le cadrage caméra, la lumière et l'ambiance.",
    "TENUE FIXE (NOYAU DUR) : chaque personnage porte EXACTEMENT la même tenue signature décrite dans son apparence, dans TOUTES les scènes.",
    "Redécris sa tenue à l'identique dans CHAQUE prompt et ne la change JAMAIS selon le décor : même tenue avant/après (ex. chez le coiffeur),",
    "jamais de cape, de blouse, de tenue d'époque ni de changement de vêtements d'une scène à l'autre. Cohérence vestimentaire TOTALE.",
    "CADRAGE : scènes de dialogue = plan MOYEN (buste/taille) montrant les DEUX protagonistes bien VISIBLES et proches (surtout PAS des personnages",
    "minuscules en plan large) ; intro/outro = le PRÉSENTATEUR SEUL en plan RAPPROCHÉ (buste, visage bien visible, de face) pour un bon lip-sync.",
    "AUCUN texte, sous-titre, chiffre, logo ni watermark dans l'image (les sous-titres sont ajoutés au montage).",
  ].join("\n");
}

function dialogueRecipe(language, level) {
  return [
    "RECETTE (vidéo d'apprentissage de langue par l'écoute — format le plus vu de la niche « listening ») :",
    `1. INTRO (présentateur SEUL, narration ~30-45 s en ${language}, niveau ${level}) : salue chaleureusement, PRÉSENTE le thème, le décor et met en CONTEXTE l'histoire à venir (qui, où, quoi).`,
    "   PUIS amène EN DOUCEUR l'objectif d'écoute qui DÉCOULE de ce contexte (« so today, let's follow them and listen for… ») — surtout PAS une question qui sort de nulle part : elle prolonge naturellement ce qu'il vient de dire. Ton chaleureux, lent, encourageant.",
    "2. SCÈNES : une petite HISTOIRE réaliste et positive sur le thème se déroule à travers les dialogues entre A et B. L'histoire AVANCE de scène en scène",
    "   (mise en situation → petites péripéties → résolution). Chaque scène couvre un MOMENT / une sous-situation DISTINCTE du thème (jamais deux fois la même).",
    `3. Chaque scène : 8-14 répliques COURTES et naturelles (niveau ${level}) qui font progresser l'histoire ET réemploient le vocabulaire clé du thème. Alterne A et B.`,
    "4. OUTRO (présentateur SEUL, ~30-45 s) : RÉPOND à la question de l'intro, résume le vocabulaire clé de l'épisode, félicite l'apprenant,",
    "   puis invite à s'abonner/aimer/commenter (CTA parlé léger — le CTA visuel est ajouté au montage).",
    "5. Cohérence : les MÊMES deux personnages du début à la fin, décor cohérent avec le thème, difficulté stable au niveau demandé, histoire simple et claire.",
  ].join("\n");
}

// ---------- Étape 1 : génération des dialogues (Claude) ----------
async function generatePrompts(run) {
  const c = config();
  const { P, A, B } = castOf(run);
  if (!P || !A || !B) throw new Error("Personnages du run introuvables (présentateur + 2 protagonistes)");
  const language = run.params.language || "English";
  const level = run.params.level || "A1/A2";
  const dialogueCount = Number(run.dialogueCount || run.params.sceneCount) || 1;
  run.sceneCount = dialogueCount + 2;
  run.dialogueCount = dialogueCount;
  const inspiration = c.nicheId ? bank.inspiration(c.nicheId) : "(aucune niche liée)";
  const t = run.params.theme;
  const themeAsk = t && (t.text || t.theme)
    ? `THÈME IMPOSÉ : ${t.text || t.theme}.`
    : "THÈME LIBRE : choisis une situation de la vie quotidienne, très concrète et riche en vocabulaire utile (aéroport, restaurant, marché,"
      + " visite chez le médecin, première journée de travail…), en t'inspirant des titres de la niche.";

  const common = [
    "Tu écris le script d'une vidéo d'APPRENTISSAGE DE LANGUE par l'écoute (chaîne « listening ») pour une usine à contenu YouTube.",
    coreRules(P, A, B, language, level),
    dialogueRecipe(language, level),
    `Les deux locuteurs sont ${A.name} (\"A\") et ${B.name} (\"B\"). Le présentateur ${P.name} ne parle qu'en intro/outro.`,
    "ÉMOTION — BALISES ElevenLabs v3 : insère des balises audio entre crochets dans les répliques ET la narration pour donner de la vie",
    "(ex. « [excited] That's amazing! », « [laughs] », « [whispers] I have a secret… », « [sighs] », « [nervous] Are you sure? », « [curious] »).",
    "Balises dispo : [excited] [nervous] [frustrated] [sorrowful] [calm] [tired] [hesitant] [cheerfully] [playfully] [curious] [flatly] [deadpan] [sigh] [laughs] [light chuckle] [gasps] [gulps] [whispers] [pauses] [stammers].",
    "1 à 2 balises MAX par réplique, AVANT le passage concerné, cohérentes avec le sens et l'émotion de la scène. Ce sont des DIRECTIONS audio (non prononcées, absentes des sous-titres) — les mots parlés restent niveau " + level + ".",
  ];
  const DIALOGUE_SCHEMA =
    '"scenes":[{"i":2,"role":"dialogue","scene_title":"titre court de la scène",' +
    '"image_prompt":"...>=150 mots EN, COMMENCE par le préambule d\'identité, les 2 protagonistes dans le décor...",' +
    '"dialogue":[{"speaker":"A","line":"réplique courte en ' + language + ' (niveau ' + level + ')"},{"speaker":"B","line":"..."}]}]';
  const IO_SCHEMA =
    '"intro":{"narration":"narration du présentateur (~30-45s) en ' + language + '","image_prompt":"...>=150 mots EN, préambule d\'identité, le PRÉSENTATEUR seul face caméra..."},' +
    '"outro":{"narration":"...","image_prompt":"..."}';
  // Le TITRE s'écrit dans la langue de la CHAÎNE (le public visé), pas celle des dialogues.
  const packLang = run.params.chainLanguage || language;
  const titleAsk = '"title":"titre YouTube en ' + packLang + ' (le public de la chaîne parle ' + packLang + '), calqué sur les codes de la niche (Learn ' + language + ' / Listening / niveau)"';

  // Vidéo courte : un seul appel
  if (dialogueCount <= 8) {
    const prompt = [
      ...common,
      themeAsk,
      `NOMBRE DE SCÈNES DE DIALOGUE : EXACTEMENT ${dialogueCount} (numérotées i = 2 à ${dialogueCount + 1}). L'intro est i=1, l'outro i=${dialogueCount + 2}.`,
      "",
      inspiration,
      "",
      "RÉPONDS UNIQUEMENT EN JSON (aucun texte autour, aucune fence) :",
      "{" + titleAsk + "," + IO_SCHEMA + "," + DIALOGUE_SCHEMA + "}",
    ].join("\n");
    const parsed = await genJson(prompt, { tries: 3, label: "dialogues" });
    if (!Array.isArray(parsed.scenes) || !parsed.scenes.length) throw new Error("Claude n'a pas renvoyé de scènes");
    run.theme = { title: parsed.title || (t && (t.text || t.theme)) || "Learn " + language, language, level };
    run.scenes = buildScenes(parsed, dialogueCount);
    saveRun(run);
    log(run, `Dialogues générés : ${dialogueCount} scène(s) + intro/outro — « ${run.theme.title} »`);
    return;
  }

  // Vidéo longue : phase 1 = OUTLINE (titre + intro + outro + situations distinctes), phase 2 = dialogues par lots parallèles.
  if (!run.outline || !Array.isArray(run.outline.situations) || run.outline.situations.length < dialogueCount) {
    log(run, `Vidéo longue (${dialogueCount} scènes) : écriture de la structure (intro, situations, outro)…`);
    const outlinePrompt = [
      ...common,
      themeAsk,
      `L'épisode fera ${dialogueCount} scènes de dialogue. Construis une PETITE HISTOIRE simple sur le thème, qui avance du début à la fin.`,
      `Écris un STORYBOARD : un tableau \"situations\" de EXACTEMENT ${dialogueCount} entrées (i = 2 à ${dialogueCount + 1}).`,
      "Chaque entrée = un MOMENT distinct et unique de l'histoire : { i, scene_title, summary (ce qui se passe + le vocabulaire clé de CETTE scène) }.",
      "RÈGLE ABSOLUE : chaque situation est DIFFÉRENTE des autres et l'histoire progresse (jamais deux fois le même moment). Ordre logique du début à la fin.",
      "Écris AUSSI l'intro et l'outro complètes (narration + image_prompt du présentateur).",
      "",
      inspiration,
      "",
      "RÉPONDS UNIQUEMENT EN JSON (aucun texte autour, aucune fence) :",
      "{" + titleAsk + "," + IO_SCHEMA + ',"situations":[{"i":2,"scene_title":"...","summary":"..."}]}',
    ].join("\n");
    const outline = await genJson(outlinePrompt, { tries: 3, label: "structure" });
    if (!Array.isArray(outline.situations) || outline.situations.length < dialogueCount)
      throw new Error(`Storyboard incomplet (${(outline.situations || []).length}/${dialogueCount} situations)`);
    run.theme = { title: outline.title || (t && (t.text || t.theme)) || "Learn " + language, language, level };
    run.outline = { intro: outline.intro, outro: outline.outro, situations: outline.situations };
    saveRun(run);
  }
  const outline = run.outline;

  // Scènes déjà écrites (reprise : on ne régénère QUE les lots manquants)
  const byIndex = new Map();
  for (const sc of run.scenes || []) if (sceneComplete(sc)) byIndex.set(sc.i, sc);
  // Intro / outro depuis l'outline (toujours présents)
  byIndex.set(1, introOutroScene(1, "intro", outline.intro, P));
  byIndex.set(run.sceneCount, introOutroScene(run.sceneCount, "outro", outline.outro, P));
  const assemble = () => {
    const arr = [];
    for (let i = 1; i <= run.sceneCount; i++) if (byIndex.has(i)) arr.push(byIndex.get(i));
    return arr;
  };
  const situFor = (start, end) => outline.situations.filter((x) => Number(x.i) >= start && Number(x.i) <= end).sort((a, b) => a.i - b.i);

  // Lots de scènes de dialogue (i de 2 à dialogueCount+1)
  const batches = [];
  for (let start = 2; start <= dialogueCount + 1; start += BATCH_LONG) {
    const end = Math.min(start + BATCH_LONG - 1, dialogueCount + 1);
    let need = false;
    for (let i = start; i <= end; i++) if (!byIndex.has(i)) need = true;
    if (need) batches.push({ start, end, situations: situFor(start, end) });
  }
  if (batches.length) log(run, `Écriture de ${dialogueCount} dialogues : ${batches.length} lot(s), ${Math.min(BATCH_CONCURRENCY, batches.length)} en parallèle…`);

  const genBatch = async (b) => {
    const need = b.end - b.start + 1;
    const prompt = [
      ...common,
      `THÈME : ${run.theme.title}.`,
      `STORYBOARD PRÉ-ASSIGNÉ (situation UNIQUE de chaque scène — À RESPECTER, une par "i") : ${JSON.stringify(b.situations)}`,
      "Ta tâche : ÉTOFFER chaque situation en une scène de dialogue complète. N'INVENTE PAS d'autre moment, ne répète AUCUNE autre scène.",
      `Écris les scènes ${b.start} à ${b.end} (champ "i" de ${b.start} à ${b.end}, EXACTEMENT ${need} scènes de dialogue).`,
      "RÉPONDS UNIQUEMENT EN JSON (aucun texte autour, aucune fence) : {" + DIALOGUE_SCHEMA + "}",
    ].join("\n");
    let parsed = null;
    for (let a = 1; a <= 3; a++) {
      try {
        const r = await genJson(prompt, { tries: 1, label: `dialogues ${b.start}-${b.end}` });
        if (Array.isArray(r.scenes) && r.scenes.length >= need) { parsed = r; break; }
        parsed = parsed || r;
      } catch (e) {
        if (/Annulée/.test(e.message)) throw e;
      }
    }
    if (!parsed || !Array.isArray(parsed.scenes) || !parsed.scenes.length) throw new Error(`Claude n'a pas renvoyé les scènes ${b.start}-${b.end}`);
    parsed.scenes.slice(0, need).forEach((sc, k) => {
      const i = b.start + k;
      byIndex.set(i, dialogueScene(i, sc));
    });
    run.scenes = assemble();
    saveRun(run);
    log(run, `Dialogues ${b.start}-${b.end} écrits (${byIndex.size - 2}/${dialogueCount}).`);
  };

  await pool(batches, genBatch, BATCH_CONCURRENCY);
  run.scenes = assemble();
  saveRun(run);
  const missing = [];
  for (let i = 1; i <= run.sceneCount; i++) if (!byIndex.has(i)) missing.push(i);
  if (missing.length) throw new Error(`Dialogues incomplets : ${missing.length} scène(s) manquante(s) (${missing.slice(0, 12).join(", ")}) — clique « Reprendre ».`);
  log(run, `Dialogues générés : ${dialogueCount} scène(s) + intro/outro — « ${run.theme.title} »`);
}

function dialogueScene(i, sc) {
  const turns = (Array.isArray(sc.dialogue) ? sc.dialogue : [])
    .map((d) => ({ speaker: d.speaker === "B" ? "B" : "A", text: String(d.line || d.text || "").trim() }))
    .filter((d) => d.text);
  return { i, role: "dialogue", scene_title: sc.scene_title || "", turns, image_prompt: sc.image_prompt || "", image: null, audio: null, video: null };
}
function introOutroScene(i, role, io, P) {
  const nar = io ? (Array.isArray(io.narration) ? io.narration.join(" ") : io.narration) : "";
  return { i, role, narration: String(nar || "").trim(), speaker: P ? P.voice : "", image_prompt: (io && io.image_prompt) || "", image: null, audio: null, video: null };
}
function buildScenes(parsed, dialogueCount) {
  const scenes = [];
  scenes.push(introOutroScene(1, "intro", parsed.intro, null));
  (parsed.scenes || []).slice(0, dialogueCount).forEach((sc, k) => scenes.push(dialogueScene(k + 2, sc)));
  scenes.push(introOutroScene(dialogueCount + 2, "outro", parsed.outro, null));
  // speaker (voix présentateur) rempli plus tard via castOf au besoin ; ici on laisse vide si inconnu
  return scenes;
}

// ---------- Kie (images) ----------
function kieKey() {
  const k = vault.get("kie");
  if (!k) throw new Error("Clé Kie absente du coffre");
  return k;
}
async function kieCreate(model, input) {
  const r = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
    method: "POST",
    headers: { Authorization: `Bearer ${kieKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  }).then((x) => x.json());
  if (!r.data?.taskId) throw new Error(`Kie ${model} : ${r.msg || JSON.stringify(r).slice(0, 150)}`);
  return r.data.taskId;
}
const cancelledRuns = new Set();
async function kiePoll(taskId, { timeoutMs = 10 * 60 * 1000, intervalMs = 15000, runId } = {}) {
  const t0 = Date.now();
  while (true) {
    await new Promise((res) => setTimeout(res, intervalMs));
    if (runId && cancelledRuns.has(runId)) throw new Error("Annulée par l'utilisateur");
    if (Date.now() - t0 > timeoutMs) throw new Error("Kie : délai dépassé");
    const r = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
      headers: { Authorization: `Bearer ${kieKey()}` },
    }).then((x) => x.json());
    const st = r.data?.state;
    if (st === "success") return JSON.parse(r.data.resultJson).resultUrls[0];
    if (st === "fail") throw new Error(`Kie : génération échouée — ${r.data?.failMsg || "raison inconnue"}`);
  }
}
async function download(url, file) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Téléchargement ${resp.status}`);
  fs.writeFileSync(file, Buffer.from(await resp.arrayBuffer()));
  return file;
}
/**
 * Reprise après crash/redémarrage : si une génération Kie était déjà en vol pour ce
 * MÊME prompt (taskId persisté dans le run), on tente de récupérer son résultat au
 * lieu d'en repayer une nouvelle. Retourne { url } si elle a fini, { taskId } si elle
 * tourne encore (on re-pollera sans recréer), null sinon (échec/inconnue/prompt changé).
 */
async function kieRecover(pending, prompt) {
  if (!pending?.id || pending.prompt !== prompt) return null;
  try {
    const r = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${pending.id}`, {
      headers: { Authorization: `Bearer ${kieKey()}` },
    }).then((x) => x.json());
    const st = r.data?.state;
    if (st === "success") return { url: JSON.parse(r.data.resultJson).resultUrls[0] };
    if (st && st !== "fail") return { taskId: pending.id };
  } catch {}
  return null;
}
// Durée média : ff.probeDuration LÈVE une erreur explicite quand ffprobe ne répond pas
// (ne renvoie jamais 0 en silence) ; ff.probeDurationSafe est réservé aux usages cosmétiques.

// Upload d'un fichier sur Drive rendu PUBLIC (Grok i2i exige une URL réellement téléchargeable).
async function uploadPublic(name, absFile, mime = "image/png") {
  const up = await google.driveUpload(name, mime, fs.readFileSync(absFile));
  await google.ensurePublic(up.id).catch(() => {});
  return `https://drive.google.com/uc?export=download&id=${up.id}`;
}
// Références des personnages sur Drive. `refSrc` mémorise le referenceRel uploadé : si l'image de
// référence du personnage a été régénérée (nouveau fichier), on ré-uploade (pas de version périmée).
async function ensureRefUrls(run) {
  const { P, A, B } = castOf(run);
  run.refUrls = run.refUrls || {};
  run.refSrc = run.refSrc || {};
  for (const [key, ch] of [["P", P], ["A", A], ["B", B]]) {
    if (!ch || !ch.referenceRel) throw new Error(`Le personnage ${key === "P" ? "présentateur" : key === "A" ? "protagoniste A" : "protagoniste B"} n'a pas d'image de référence`);
    if (run.refUrls[key] && run.refSrc[key] === ch.referenceRel) continue; // déjà à jour
    run.refUrls[key] = await uploadPublic(`ling-ref-${slug(ch.name)}.png`, path.join(ROOT, ch.referenceRel));
    run.refSrc[key] = ch.referenceRel;
  }
  saveRun(run);
}
// Référence DUO 16:9 (les 2 protagonistes côte à côte) — pour un modèle i2i mono-image (Grok),
// qui ne prend qu'UNE image et reproduit sa taille. On fournit donc les 2 identités en une image 16:9.
function composeDuo(aAbs, bAbs, outFile) {
  return runFfmpeg([
    "-y", "-i", aAbs, "-i", bAbs,
    "-filter_complex",
    "[0:v]scale=640:720:force_original_aspect_ratio=increase,crop=640:720[a];[1:v]scale=640:720:force_original_aspect_ratio=increase,crop=640:720[b];[a][b]hstack=inputs=2",
    "-frames:v", "1", outFile,
  ]);
}
async function ensureDuoRef(run) {
  const { A, B } = castOf(run);
  await ensureRefUrls(run); // garantit que A/B sont à jour (referenceRel courant)
  const srcKey = `${A.referenceRel}|${B.referenceRel}`;
  if (run.refUrls.duo && run.refSrc.duo === srcKey) return run.refUrls.duo;
  const dir = path.join(OUT_ROOT, run.id);
  ensureDir(dir);
  const duoFile = path.join(dir, "duo-ref.png");
  await composeDuo(path.join(ROOT, A.referenceRel), path.join(ROOT, B.referenceRel), duoFile);
  run.refUrls.duo = await uploadPublic(`${run.id}-duo.png`, duoFile);
  run.refSrc.duo = srcKey;
  saveRun(run);
  return run.refUrls.duo;
}

// ---------- Étape 2 : images ----------
async function generateImage(run, scene) {
  const c = config();
  const dir = path.join(OUT_ROOT, run.id);
  ensureDir(dir);
  await ensureRefUrls(run);
  const IMG_PRICE = { gpt: 0.03, nano: 0.02, grok: 0.02, seedream: 0.0275 };
  const toolId = IMG_PRICE[c.settings.imageModel] ? c.settings.imageModel : "gpt";
  const conf = require("../studio").TOOLS[toolId].i2i;
  // Références : dialogue = les 2 protagonistes ; intro/outro = le présentateur seul.
  // Modèle i2i mono-image (Grok, maxImages 1) : référence DUO 16:9 pour garder les 2 identités.
  let refs;
  if (scene.role === "dialogue") {
    refs = (conf.maxImages || 1) < 2 ? [await ensureDuoRef(run)] : [run.refUrls.A, run.refUrls.B];
  } else {
    refs = [run.refUrls.P];
  }
  refs = refs.slice(0, conf.maxImages || 2).map((u) => u + "&r=" + Date.now().toString(36)); // cache-buster
  const promptMax = conf.promptMax || 3000;
  let p = scene.image_prompt || "";
  if (!p.startsWith(IDENTITY_PREAMBLE)) p = IDENTITY_PREAMBLE + " " + p;
  const input = { prompt: p.slice(0, promptMax - IMG_SAFETY.length) + IMG_SAFETY };
  if (!conf.noRatio) input.aspect_ratio = "16:9"; // Grok ignore le ratio (il reproduit la taille de la réf 16:9)
  if (toolId === "gpt") input.resolution = "1K";
  input[conf.imgField || "input_urls"] = refs;
  scene.rendering = true;
  saveRun(run);
  try {
    const prev = await kieRecover(scene.pendingImg, scene.image_prompt);
    let url = prev?.url;
    if (!url) {
      const taskId = prev?.taskId || (await kieCreate(conf.model, input));
      scene.pendingImg = { id: taskId, prompt: scene.image_prompt };
      saveRun(run);
      url = await kiePoll(taskId, { timeoutMs: 8 * 60 * 1000, runId: run.id });
    }
    const file = path.join(dir, `img-${scene.i}.png`);
    await download(url, file);
    scene.image = { rel: `agent-os/output/machines/${run.id}/img-${scene.i}.png`, ts: Date.now() };
    delete scene.pendingImg;
    run.cost.images += IMG_PRICE[toolId];
    delete scene.error;
    spend.record("Kie.ai", MACHINE_NAME, IMG_PRICE[toolId], "USD", `Image scène ${scene.i} (${toolId})`);
  } finally {
    delete scene.rendering;
    saveRun(run);
  }
}

// ---------- Étape 3 : voix (ElevenLabs v3 via FAL) ----------
async function generateVoice(run, scene) {
  const dir = path.join(OUT_ROOT, run.id);
  ensureDir(dir);
  const { P, A, B } = castOf(run);
  let inputs;
  if (scene.role === "dialogue") {
    if (!scene.turns || !scene.turns.length) throw new Error(`Scène ${scene.i} : dialogue vide`);
    inputs = scene.turns.map((t) => ({ text: t.text, voice: t.speaker === "B" ? B.voice : A.voice }));
  } else {
    if (!scene.narration) throw new Error(`Scène ${scene.i} : narration vide`);
    inputs = [{ text: scene.narration, voice: P.voice }];
  }
  scene.rendering = true;
  saveRun(run);
  try {
    const file = path.join(dir, `aud-${scene.i}.mp3`);
    const sig = JSON.stringify(inputs);
    // Ne JAMAIS repayer ElevenLabs pour un échec qui n'est pas le sien : si une tentative
    // précédente a déjà téléchargé cet audio (mêmes textes, mêmes voix) et que seul le sondage
    // de durée a échoué, on réutilise le fichier au lieu de relancer la génération.
    let url = scene.pendingAudio && scene.pendingAudio.sig === sig && fs.existsSync(file) ? scene.pendingAudio.url : null;
    if (!url) {
      const res = await fal.run("fal-ai/elevenlabs/text-to-dialogue/eleven-v3", { inputs }, {
        timeoutMs: 8 * 60 * 1000,
        cancelled: () => cancelledRuns.has(run.id),
      });
      url = res?.audio?.url || res?.audio_url || (res?.audios && res.audios[0]?.url);
      if (!url) throw new Error(`ElevenLabs : pas d'audio (${JSON.stringify(res).slice(0, 120)})`);
      // AUCUNE modification de l'audio ElevenLabs : fichier livré TEL QUEL (un trim de silence de fin
      // testé en session +2 mangeait la dernière syllabe — interdit). La durée du clip vidéo est calée
      // sur la durée réelle de CE fichier (-t), donc rien n'est jamais coupé.
      await fal.download(url, file);
      scene.pendingAudio = { sig, url };
      const chars = inputs.reduce((a, t) => a + String(t.text || "").length, 0);
      const vCost = +((chars / 1000) * PRICES.voicePer1kChars).toFixed(4);
      run.cost.voices += vCost;
      saveRun(run);
      spend.record("FAL.ai", MACHINE_NAME, vCost, "USD", `Voix scène ${scene.i} (ElevenLabs v3, ${chars} car.)`);
    }
    // Une voix SANS durée mesurable n'est pas une voix valide : on refuse de l'enregistrer.
    // Sinon l'échec est masqué ici et ressort deux étapes plus loin (« durée audio introuvable »
    // au montage des clips), avec un message qui ne désigne plus la vraie cause.
    const duration = await ff.probeDuration(file, { label: `Scène ${scene.i} (voix)` });
    scene.audio = { url, rel: `agent-os/output/machines/${run.id}/aud-${scene.i}.mp3`, file, duration, ts: Date.now() };
    scene.video = null; // audio changé → clip obsolète
    delete scene.pendingAudio;
    delete scene.error;
  } finally {
    delete scene.rendering;
    saveRun(run);
  }
}

// ---------- Étape 4 : clips (FFmpeg image fixe + audio ; lipsync présentateur optionnel) ----------
function runFfmpeg(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { windowsHide: true, cwd });
    let err = "";
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => reject(new Error("FFmpeg introuvable : " + e.message)));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error("FFmpeg : " + err.slice(-400)))));
  });
}
async function generateVideo(run, scene) {
  const c = config();
  const dir = path.join(OUT_ROOT, run.id);
  ensureDir(dir);
  if (!scene.image) throw new Error(`Scène ${scene.i} : image manquante`);
  if (!scene.audio || !scene.audio.file) throw new Error(`Scène ${scene.i} : audio manquant`);
  const imgAbs = path.join(dir, `img-${scene.i}.png`);
  const audAbs = scene.audio.file;
  const out = path.join(dir, `seg-${scene.i}.mp4`);
  scene.rendering = true;
  saveRun(run);
  try {
    // Méthode n8n : 1) metadata sur l'audio (durée exacte), 2) vidéo générée à CETTE durée (-t),
    // 3) mux sans rien couper. Jamais -shortest : avec -loop 1 il déborde de 1-2 s (buffering muxer)
    // → vidéo plus longue que la voix + impression de son coupé.
    // Durée déjà mesurée à l'étape voix ; sinon on re-sonde (répare les runs d'avant
    // le durcissement, dont les audios avaient été enregistrés avec duration: 0).
    const D = scene.audio.duration > 0 ? scene.audio.duration : await ff.probeDuration(audAbs, { label: `Scène ${scene.i} (audio)` });
    await runFfmpeg([
      "-y", "-loop", "1", "-i", imgAbs, "-i", audAbs,
      "-c:v", "libx264", "-tune", "stillimage", "-pix_fmt", "yuv420p", "-r", "30",
      "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:-1:-1:color=black,setsar=1",
      "-c:a", "aac", "-b:a", "192k", "-t", D.toFixed(3), "-movflags", "+faststart", out,
    ]);
    // Lipsync du présentateur (intro/outro) si demandé
    if (run.params.lipsync && (scene.role === "intro" || scene.role === "outro")) {
      const model = c.settings.lipsyncModel || "veed/lipsync";
      log(run, `Lipsync présentateur scène ${scene.i} (${model})…`);
      const vUp = await google.driveUpload(`${run.id}-seg-${scene.i}.mp4`, "video/mp4", fs.readFileSync(out));
      await google.ensurePublic(vUp.id).catch(() => {});
      // Audio TRIMMÉ (pas l'audio FAL brut) → le lipsync se cale sur la même durée que le clip.
      const aUp = await google.driveUpload(`${run.id}-aud-${scene.i}.mp3`, "audio/mpeg", fs.readFileSync(audAbs));
      await google.ensurePublic(aUp.id).catch(() => {});
      const res = await fal.run(model, {
        video_url: `https://drive.google.com/uc?export=download&id=${vUp.id}`,
        audio_url: `https://drive.google.com/uc?export=download&id=${aUp.id}`,
      }, { timeoutMs: 12 * 60 * 1000, cancelled: () => cancelledRuns.has(run.id) });
      const lipUrl = res?.video?.url || res?.video_url;
      if (!lipUrl) throw new Error(`Lipsync : pas de vidéo (${JSON.stringify(res).slice(0, 120)})`);
      // Le lipsync réencode (et écourte parfois) la piste son → on garde SA vidéo mais on remet
      // l'audio ORIGINAL intégral. c:v copy : la durée finale = max(vidéo, audio), rien n'est coupé.
      const lipTmp = path.join(dir, `seg-${scene.i}-lip.mp4`);
      await fal.download(lipUrl, lipTmp);
      await runFfmpeg(["-y", "-i", lipTmp, "-i", audAbs, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]);
      try { fs.unlinkSync(lipTmp); } catch {}
      const lCost = +((D / 60) * PRICES.lipsyncPerMin).toFixed(4);
      run.cost.videos += lCost;
      spend.record("FAL.ai", MACHINE_NAME, lCost, "USD", `Lipsync scène ${scene.i} (${model}, ${(D / 60).toFixed(1)} min)`);
    }
    // Durée du clip : indicative (le montage re-sonde les fichiers et retombe au pire
    // sur la durée audio, désormais garantie non nulle) → sondage tolérant.
    scene.video = { rel: `agent-os/output/machines/${run.id}/seg-${scene.i}.mp4`, file: out, duration: await ff.probeDurationSafe(out), ts: Date.now() };
    delete scene.error;
  } finally {
    delete scene.rendering;
    saveRun(run);
  }
}

// ---------- Sous-titres : Whisper (FAL) → SRT ----------
function srtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const p2 = (n) => String(n).padStart(2, "0");
  return `${p2(Math.floor(ms / 3600000))}:${p2(Math.floor((ms % 3600000) / 60000))}:${p2(Math.floor((ms % 60000) / 1000))},${String(ms % 1000).padStart(3, "0")}`;
}
async function whisperChunks(audioUrl, langCode, runId) {
  const input = { audio_url: audioUrl, task: "transcribe", chunk_level: "segment" };
  if (langCode) input.language = langCode;
  const res = await fal.run("fal-ai/whisper", input, { timeoutMs: 8 * 60 * 1000, cancelled: () => cancelledRuns.has(runId) });
  const chunks = Array.isArray(res?.chunks) ? res.chunks : [];
  const norm = chunks
    .map((ch) => ({ start: Number(ch.timestamp?.[0] ?? ch.start ?? 0), end: Number(ch.timestamp?.[1] ?? ch.end ?? 0), text: String(ch.text || "").trim() }))
    .filter((c) => c.text && isFinite(c.start) && isFinite(c.end) && c.end > c.start);
  if (norm.length) return norm;
  const text = String(res?.text || "").trim();
  return text ? [{ start: 0, end: 0, text }] : [];
}
// Sous-titres en UNE passe : Whisper sur l'audio de la vidéo ASSEMBLÉE. Les timestamps rendus
// sont donc déjà ceux de la vidéo finale — plus aucun offset par scène à calculer, plus de dérive.
async function buildSrt(run, assembledFile) {
  const language = run.params.language || "English";
  const langCode = WHISPER_LANG[language];
  const dir = path.join(OUT_ROOT, run.id);
  const audFull = path.join(dir, "full-audio.mp3");
  await runFfmpeg(["-y", "-i", assembledFile, "-vn", "-c:a", "libmp3lame", "-q:a", "4", audFull]);
  const url = await uploadPublic(`${run.id}-full-audio.mp3`, audFull, "audio/mpeg");
  const chunks = await whisperChunks(url, langCode, run.id);
  // Tarif réel Whisper : 0,0008 $/seconde de calcul — approximé par la durée de l'audio transcrit.
  const wDur = await ff.probeDurationSafe(audFull); // sert au calcul du coût affiché
  const wCost = +(wDur * PRICES.whisperPerComputeSec).toFixed(4);
  run.cost.voices += wCost;
  spend.record("FAL.ai", MACHINE_NAME, wCost, "USD", `Whisper (transcript complet, ${Math.round(wDur)}s)`);
  let idx = 1;
  const lines = [];
  for (const ch of chunks) {
    const end = ch.end > ch.start ? ch.end : ch.start + 1.5;
    lines.push(String(idx++), `${srtTime(ch.start)} --> ${srtTime(end)}`, ch.text, "");
  }
  if (!lines.length) return null;
  const srt = path.join(dir, "subs.srt");
  fs.writeFileSync(srt, lines.join("\n"), "utf8");
  return srt;
}

// ---------- Étape 5 : montage (FFmpeg concat + sous-titres + CTA haut-droite) ----------
function renderCtaClip(run, label) {
  return new Promise((resolve, reject) => {
    const rel = `cta-${run.id}`;
    fs.writeFileSync(path.join(REMOTION_DIR, rel + ".json"), JSON.stringify({ label }));
    const child = spawn("npx", ["remotion", "render", "CtaTopRight", rel, "--sequence", "--image-format=png", `--props=${rel}.json`], { cwd: REMOTION_DIR, shell: true, windowsHide: true });
    let err = "";
    child.stdout.on("data", () => {}); // drainer stdout : un pipe non lu (64 Ko) fige le rendu
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      const folder = path.join(REMOTION_DIR, rel);
      if (code === 0 && fs.existsSync(path.join(folder, "element-000.png"))) resolve(folder);
      else reject(new Error(err.slice(-300) || "code " + code));
    });
  });
}
async function renderMontage(run) {
  const dir = path.join(OUT_ROOT, run.id);
  const ready = run.scenes.filter((s) => s.video).sort((a, b) => a.i - b.i);
  if (!ready.length) throw new Error("Aucun clip à monter");
  if (ready.length < run.scenes.length) log(run, `⚠ Montage de ${ready.length}/${run.scenes.length} segments (les manquants sont exclus).`);
  const c = config();
  const { P } = castOf(run);
  const label = CTA_LABELS[run.params.language] || CTA_LABELS.English;

  // Durées RÉELLES des clips (source de vérité : le montage concatène ces fichiers, donc leurs durées
  // = les positions EXACTES dans la vidéo finale, pour les sous-titres ET les CTA — plus de dérive).
  const clipDurs = [];
  for (const s of ready) clipDurs.push((await ff.probeDurationSafe(path.join(dir, `seg-${s.i}.mp4`))) || (s.video && s.video.duration) || (s.audio && s.audio.duration) || 0);
  const total = clipDurs.reduce((a, b) => a + b, 0);

  const every = (Number(c.settings.ctaEveryMin) || 2) * 60;
  const starts = [];
  for (let t = 1; t < total - 4; t += every) starts.push(t);

  // CTA haut-droite (Remotion, séquence PNG transparente) — best-effort
  let ctaSeq = null;
  if (starts.length) {
    try {
      log(run, `Rendu du bouton CTA « ${label} » (Remotion, haut-droite)…`);
      ctaSeq = await renderCtaClip(run, label);
    } catch (e) {
      log(run, "CTA Remotion indisponible (" + String(e.message).slice(0, 80) + ") — montage sans CTA");
    }
  }

  // PASSE 1 — concaténation + CTA, SANS sous-titres. L'audio de chaque clip passe INTÉGRALEMENT
  // (aresample seulement, aucune coupe). Sortie : assembled.mp4 si sous-titres à graver, sinon final.mp4.
  const outFile = path.join(dir, "final.mp4");
  const pass1Name = run.params.subtitles ? "assembled.mp4" : "final.mp4";
  const N = ready.length;

  // ════════════════════════════════════════════════════════════════════════════════════════
  // COLLAGE PAR COPIE — et non par le filtre `concat`.
  //
  // ⚠ L'ancienne version faisait décoder les N segments EN PARALLÈLE, puis les redimensionnait,
  //   recadrait et rééchantillonnait avant de les recoller. Or les segments sortent DÉJÀ au
  //   format final (vérifié : 16/16 en h264 1280x720 yuv420p 30 fps) — ce travail ne changeait
  //   rien. Mesuré sur le run rmtr2xqma : 50 min à 900 % de CPU pour 9,3 min de vidéo, machine
  //   brûlante. Le collage par copie prend quelques secondes.
  //   Même correctif que sur la machine Crime (montage passé de 51 min à 2 min).
  //
  // Un GARDE-FOU vérifie que les segments sont bien homogènes ; sinon on retombe sur l'ancienne
  // méthode, plus lente mais universelle.
  const fmt = (f) => {
    try {
      const o = require("child_process").execFileSync("ffprobe",
        ["-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=codec_name,width,height,r_frame_rate,pix_fmt", "-of", "csv=p=0", f],
        { encoding: "utf8" });
      return o.trim();
    } catch { return null; }
  };
  const segs = ready.map((s) => path.join(dir, `seg-${s.i}.mp4`));
  const formats = segs.map(fmt);
  const homogene = formats.every((x) => x && x === formats[0]);

  let filter = "";
  let vlabel = "[cbase]";
  const inputs = [];
  let brut = null;

  if (homogene) {
    const liste = path.join(dir, "segments.txt");
    fs.writeFileSync(liste, segs.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
    brut = path.join(dir, "colle.mp4");
    log(run, `Collage des ${N} segments par COPIE (formats identiques) — sans ré-encodage…`);
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", liste, "-c", "copy", "colle.mp4"], dir);
    inputs.push("-i", "colle.mp4");
    vlabel = "[0:v]";
  } else {
    log(run, `⚠ Segments hétérogènes (${new Set(formats).size} formats) — collage par filtre, plus lent`);
    const vparts = [], aparts = [];
    segs.forEach((f, i) => {
      inputs.push("-i", f);
      vparts.push(`[${i}:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:-1:-1:color=black,setsar=1,fps=30[v${i}]`);
      aparts.push(`[${i}:a]aresample=48000[a${i}]`);
    });
    const concatIns = ready.map((_, i) => `[v${i}][a${i}]`).join("");
    filter = `${vparts.join(";")};${aparts.join(";")};${concatIns}concat=n=${N}:v=1:a=1[cbase][ca]`;
  }
  // ⚠ En mode COPIE il n'y a qu'UNE entrée (le collage) ; en mode filtre il y en a N.
  //   Se tromper ici ferait pointer le logo ou le CTA sur un segment vidéo.
  let nextIn = homogene ? 1 : N;
  const sep = () => (filter ? ";" : "");   // pas de point-virgule en tête de graphe

  // LOGO DE CHAÎNE en haut à gauche, toute la durée — comme sur la machine Crime.
  // ⚠ `-loop 1 -framerate 30` est INDISPENSABLE : en image UNIQUE, le logo s'évapore dès que
  //   la chaîne compte plusieurs incrustations de CTA (les `overlay` en cascade attendent des
  //   flux calés loin dans le futur et l'image isolée n'est jamais resservie). Vécu sur Crime.
  const st = config().settings || {};
  const logoFile = st.cornerLogo === false ? null
    : (() => { const f = path.join(REMOTION_DIR, "public", st.stingLogo || "french-talk-real-logo.png");
               return fs.existsSync(f) ? f : null; })();
  if (logoFile) {
    const iLogo = nextIn++;
    inputs.push("-loop", "1", "-framerate", "30", "-i", logoFile);
    filter += `${sep()}[${iLogo}:v]format=rgba,scale=${CORNER_LOGO_PX}:-1,colorchannelmixer=aa=0.85[lg]`;
    filter += `;${vlabel}[lg]overlay=26:22[wlg]`;
    vlabel = "[wlg]";
  }

  if (ctaSeq && starts.length) {
    const iCta = nextIn++;
    inputs.push("-framerate", "30", "-start_number", "0", "-i", path.join(ctaSeq, "element-%03d.png"));
    filter += `${sep()}[${iCta}:v]format=rgba,split=${starts.length}${starts.map((_, k) => `[k${k}]`).join("")}`;
    starts.forEach((S, k) => (filter += `;[k${k}]setpts=PTS+${S}/TB[cc${k}]`));
    let cur = vlabel;
    starts.forEach((S, k) => {
      const nl = k === starts.length - 1 ? "[vout]" : `[o${k}]`;
      filter += `;${cur}[cc${k}]overlay=0:0:eof_action=pass:enable='between(t,${S},${S + 4})'${nl}`;
      cur = nl;
    });
    vlabel = "[vout]";
  }
  const amapPass1 = homogene ? "0:a" : "[ca]";
  // ⚠ `-shortest` est OBLIGATOIRE dès qu'une entrée est infinie (le logo en `-loop 1`).
  //   Sans lui, l'encodage est piloté par cette source sans fin et ne s'arrête JAMAIS :
  //   vécu sur le run rmtr2xqma — 727 Mo écrits en 57 min pour une vidéo qui en pèse 30,
  //   à 900 % de CPU. Crime et Bouddhisme bornaient déjà leur sortie par `-t`.
  const args = ["-y", ...inputs, ...(filter ? ["-filter_complex", filter] : []), "-map", vlabel, "-map", amapPass1, "-shortest", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", pass1Name];
  log(run, `Montage FFmpeg (passe 1) : ${N} segments${logoFile ? " + logo de chaîne" : ""}${ctaSeq ? ` + CTA (${starts.length}×)` : ""}…`);
  await runFfmpeg(args, dir); // cwd = dir : sorties relatives
  try {
    if (ctaSeq) fs.rmSync(ctaSeq, { recursive: true, force: true });
    fs.unlinkSync(path.join(REMOTION_DIR, `cta-${run.id}.json`));
  } catch {}

  // PASSE 2 — sous-titres : Whisper sur la vidéo assemblée entière, puis gravure (l'audio est COPIÉ
  // tel quel, -c:a copy : impossible de le couper ou de le décaler à cette étape).
  if (run.params.subtitles) {
    let srt = null;
    log(run, "Sous-titres : transcription Whisper de la vidéo assemblée (transcript complet)…");
    try {
      srt = await buildSrt(run, path.join(dir, pass1Name));
    } catch (e) {
      log(run, "Sous-titres indisponibles (" + String(e.message).slice(0, 80) + ") — vidéo livrée sans sous-titres");
    }
    if (srt) {
      const st = run.params.subStyle || {};
      // Couleur choisie (bulles UI) : hex #RRGGBB → format ASS &H00BBGGRR& (ordre inversé)
      const assColor = (hex) => {
        const h = String(hex || "#FFFFFF").replace("#", "").padEnd(6, "F");
        return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase();
      };
      const style = [
        `FontName=${(st.font || "Arial").replace(/[',]/g, "")}`,
        `FontSize=${Number(st.size) || 24}`,
        `Outline=${Number(st.outline) != null ? Number(st.outline) : 2}`,
        "Alignment=2", "MarginV=22", "BorderStyle=1",
        `PrimaryColour=${assColor(st.color)}`, `OutlineColour=${assColor(st.outlineColor || "#000000")}`,
      ].join(",");
      log(run, "Montage FFmpeg (passe 2) : gravure des sous-titres…");
      await runFfmpeg(["-y", "-i", pass1Name, "-vf", `subtitles=subs.srt:force_style='${style}'`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", "final.mp4"], dir);
      try { fs.unlinkSync(path.join(dir, pass1Name)); } catch {}
    } else {
      try { fs.renameSync(path.join(dir, pass1Name), outFile); } catch {}
    }
  }

  // GÉNÉRIQUE DE CHAÎNE — collé APRÈS coup, sans ré-encoder la vidéo.
  // ⚠ Volontairement HORS des passes de montage : y faire cohabiter vidéo et audio dans un
  //   même filter_complex a désynchronisé la voix sur la machine Crime.
  // ⚠ Sans risque ici : les sous-titres sont GRAVÉS et aucun .srt n'est envoyé à YouTube —
  //   il n'y a donc aucun horodatage à décaler. Si cela change un jour, décaler le .srt.
  {
    const st = config().settings || {};
    if (st.sting !== false) {
      const lp = path.join(REMOTION_DIR, "public", st.stingLogo || "french-talk-real-logo.png");
      const added = await intro.prepend(outFile, {
        logoPath: lp,
        title: st.stingTitle || "French Talk Real",
        subtitle: st.stingSubtitle || "Learn French naturally",
        accent: st.stingAccent || "#e05555",
        seconds: 5,
      }).catch(() => 0);
      if (added) log(run, `Générique de chaîne : ${added} s en tête`);
      else log(run, "Générique non ajouté (vidéo inchangée)");
    }
  }
  return outFile;
}

// Cap DUR des tags à 500 caractères (limite YouTube). On empile les tags tant que le total joint
// par ", " reste <= max, puis on s'arrête (plus de 700/500 → rejet ou troncature YouTube).
function capTags(tags, max = 500) {
  const out = [];
  let len = 0;
  for (const t of (tags || []).map((x) => String(x).trim()).filter(Boolean)) {
    const add = (out.length ? 2 : 0) + t.length;
    if (len + add > max) break;
    out.push(t);
    len += add;
  }
  return out;
}

// ---------- Étape 6 : packaging ----------
async function generatePackaging(run) {
  const c = config();
  const { P } = castOf(run);
  const inspiration = c.nicheId ? bank.inspiration(c.nicheId, { maxTitles: 12, maxVisions: 5 }) : "";
  const language = run.params.language || "English";
  // Langue du PACKAGING = langue de la chaîne (public visé), pas forcément celle de la vidéo.
  const packLang = run.params.chainLanguage || language;
  const prompt = [
    "Tu prépares la PUBLICATION YouTube d'une vidéo d'apprentissage de langue (listening).",
    `Thème/titre : ${JSON.stringify(run.theme)}. Langue de la vidéo : ${language}. Niveau : ${run.params.level}.`,
    `PUBLIC DE LA CHAÎNE : parle ${packLang} → titre, description et tags s'écrivent en ${packLang} (la vidéo enseigne le ${language} à des locuteurs de ${packLang}).`,
    `Résumé des scènes : ${JSON.stringify(run.scenes.map((s) => ({ i: s.i, role: s.role, t: s.scene_title || (s.role !== "dialogue" ? s.role : "") })))}`,
    inspiration,
    "Fournis :",
    `- title : titre YouTube en ${packLang}, codes de la niche listening (Learn ${language}, niveau, thème, « Listening Practice »…). Vise 70-100 caractères, max 100.`,
    `- description : description YouTube en ${packLang} — accroche 2 lignes + ce qu'on apprend + 3-5 hashtags — max 1000 caractères.`,
    `- tags : BEAUCOUP de mots-clés (en ${packLang} + anglais + longue traîne : learn, listening, A1, A2, beginner…). Vise 480-500 caractères joints par virgules (max 500).`,
    `- thumb_prompt : prompt EN (>= 250 caractères) pour une miniature YouTube TRÈS cliquable, INSPIRÉE DU STYLE des miniatures concurrentes décrites ci-dessus (mêmes codes visuels de la niche).`,
    `  Montre le PRÉSENTATEUR (${P.name}, ${P.appearance}) en GROS PLAN, visage/cheveux IDENTIQUES à la référence, avec une EXPRESSION FORTE et engageante (surprise, grand sourire, curiosité),`,
    "  un décor ou un accessoire évocateur du thème, couleurs VIVES et saturées, fort contraste, éclairage punchy. Compose comme une vraie miniature YouTube (sujet décentré, espace libre pour du texte).",
    `  OBLIGATOIRE (code visuel du concurrent) : une BULLE DE DIALOGUE de bande dessinée (comic speech bubble) qui part du présentateur. C'est la SEULE écriture autorisée dans l'image : aucun autre texte, lettre ou logo.`,
    `- thumb_bubble : le texte EXACT de cette bulle — 1 à 3 mots en ${language}, tirés du SUJET de cette histoire précise.`,
    `  ⚠ PAS de salutation générique. « Bonjour » est INTERDIT sauf si l'histoire parle vraiment de se saluer.`,
    `  Exemples du bon registre pour d'autres histoires : « On déménage », « Chez le coiffeur », « Au zoo ! ».`,
    'RÉPONDS UNIQUEMENT EN JSON (aucun texte autour) : {"title":"...","description":"...","tags":["..."],"thumb_prompt":"...","thumb_bubble":"..."}',
  ].join("\n");
  const p = claude.parseJson(await askGen(prompt));
  // ⚠ La bulle est DESSINÉE par le modèle d'image : il faut lui donner la phrase, pas un
  //   exemple. L'ancien prompt citait « Bonjour ! » comme illustration et le modèle le
  //   recopiait à chaque vidéo. Signalé après plusieurs générations identiques.
  const bulle = String(p.thumb_bubble || "").trim().slice(0, 40);
  run.pack = { title: p.title || run.theme?.title || "Learn " + language, description: p.description || "", tags: capTags(Array.isArray(p.tags) ? p.tags : []), thumbBubble: bulle };
  if (bulle) log(run, `Miniature : bulle « ${bulle} »`);
  else log(run, "⚠ Miniature : aucun texte de bulle proposé — le modèle d'image choisira seul");
  saveRun(run);
  try {
    await generateThumbnail(run, p.thumb_prompt
      ? p.thumb_prompt + (bulle ? ` The speech bubble contains EXACTLY these words, spelled exactly like this, and nothing else: "${bulle}".` : "")
      : null);
  } catch (e) {
    const scene = run.scenes.find((s) => s.image) || run.scenes[0];
    log(run, "Miniature : " + e.message + " — image de segment utilisée en secours");
    run.pack.thumbRel = scene && scene.image ? scene.image.rel : null;
    saveRun(run);
  }
  log(run, `Packaging prêt : « ${run.pack.title} »`);
}
/** Police grasse, pour l'incrustation déterministe des textes de miniature. */
const THUMB_FONT = process.platform === "darwin"
  ? "/System/Library/Fonts/Supplemental/Arial Black.ttf"
  : "C\\:/Windows/Fonts/ariblk.ttf";
const SIGNATURE = "Slow French";
/** Hauteur de la signature, en PROPORTION de l'image (les miniatures sortent en 1672x941, pas
 *  en 1280x720 : une valeur en pixels donnerait un texte minuscule ou géant selon le tirage).
 *  Portée de 0,085 à 0,135 et centrée, sur retour utilisateur — comparaison rendue à l'appui. */
const SIGNATURE_H = 0.135;
/** Taille du logo permanent en haut à gauche (sortie 1280 de large), alignée sur Crime. */
const CORNER_LOGO_PX = 95;

/**
 * Incruste la signature en bas, CENTRÉE : jaune, bordée de noir.
 * Tailles et marges exprimées EN PROPORTION de l'image — les miniatures ne sortent pas toujours
 * à la même définition (1672x941 observé, 1280x720 ailleurs) : une valeur en pixels donnerait
 * un texte minuscule ou géant selon le tirage.
 */
async function stampSignature(file) {
  const dim = await new Promise((res) => {
    const c = spawn("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries",
      "stream=width,height", "-of", "csv=p=0", file], { windowsHide: true });
    let o = ""; c.stdout.on("data", (d) => (o += d)); c.stderr.on("data", () => {});
    c.on("close", () => res(o.trim().split(",").map(Number))); c.on("error", () => res([]));
  });
  const W2 = dim[0] || 1280, H2 = dim[1] || 720;
  const size = Math.round(H2 * SIGNATURE_H);
  const tmp = file.replace(/\.png$/, "-sig.png");
  await runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-vf",
    `drawtext=fontfile='${THUMB_FONT}':text='${SIGNATURE}':` +
    `x=(w-tw)/2:y=h-th-${Math.round(H2 * 0.055)}:fontsize=${size}:` +
    `fontcolor=0xFFD400:borderw=${Math.max(4, Math.round(size * 0.11))}:bordercolor=black@0.95:` +
    `shadowcolor=black@0.5:shadowx=2:shadowy=3`,
    "-frames:v", "1", tmp]);
  fs.renameSync(tmp, file);
}

async function generateThumbnail(run, thumbPrompt) {
  await ensureRefUrls(run);
  const { P } = castOf(run);
  const conf = require("../studio").TOOLS.gpt.i2i;
  const IDENT = ` ${IDENTITY_PREAMBLE} Keep ${P.name}'s exact face and hair from the reference image.` + IMG_SAFETY;
  const base = thumbPrompt || `Bright, clickable YouTube thumbnail: warm engaging close-up of the host, cheerful expression, theme-related background, saturated colors`;
  const input = { prompt: base.slice(0, 3000 - IDENT.length) + IDENT, aspect_ratio: "16:9", resolution: "1K" };
  input[conf.imgField || "input_urls"] = [run.refUrls.P + "&r=" + Date.now().toString(36)];
  const taskId = await kieCreate(conf.model, input);
  const url = await kiePoll(taskId, { timeoutMs: 8 * 60 * 1000, runId: run.id });
  const thumbFile = path.join(OUT_ROOT, run.id, "thumbnail.png");
  await download(url, thumbFile);

  // SIGNATURE « Slow French » — incrustée par FFmpeg, JAMAIS demandée au modèle d'image.
  // ⚠ Un modèle d'image écrit le texte de travers une fois sur trois ; ici la graphie doit
  //   être identique sur toutes les miniatures. Le seul texte qu'on lui confie est la bulle,
  //   qui fait partie du dessin.
  try { await stampSignature(thumbFile); log(run, "Miniature : signature « Slow French » incrustée"); }
  catch (e) { log(run, `Signature non incrustée (${String(e.message).slice(0, 70)}) — miniature conservée`); }

  run.pack = run.pack || {};
  run.pack.thumbRel = `agent-os/output/machines/${run.id}/thumbnail.png`;
  run.pack.thumbTs = Date.now();
  run.cost.images += PRICES.image;
  spend.record("Kie.ai", MACHINE_NAME, PRICES.image, "USD", "Miniature");
  saveRun(run);
}
async function regenThumbnail(runId, instructions) {
  const run = getRun(runId);
  const c = config();
  const { P } = castOf(run);
  const inspiration = c.nicheId ? bank.inspiration(c.nicheId, { maxTitles: 8, maxVisions: 4 }) : "";
  let thumbPrompt = null;
  try {
    const p = claude.parseJson(
      await askGen(
        [
          "Écris le prompt EN d'une MINIATURE YouTube TRÈS cliquable pour une vidéo d'apprentissage de langue, INSPIRÉE DU STYLE des miniatures concurrentes ci-dessous.",
          // Le CONTEXTE de la vidéo est un NOYAU DUR : le thème et le décor de la miniature doivent
          // rester ceux de la vidéo (une régé ne change JAMAIS de sujet, elle améliore l'exécution).
          `THÈME DE LA VIDÉO (NOYAU DUR — la miniature illustre CE thème, ne jamais en changer) : ${JSON.stringify(run.theme?.title || run.theme?.text || "")}. Langue enseignée : ${run.params.language || "English"}. Niveau : ${run.params.level || ""}.`,
          `Décor/situations de la vidéo : ${JSON.stringify(run.scenes.filter((s) => s.role === "dialogue").slice(0, 6).map((s) => s.scene_title).filter(Boolean))}`,
          inspiration,
          `Présentateur (identique, à ne pas changer) : ${P.name}, ${P.appearance}.`,
          instructions ? `OBSERVATION UTILISATEUR (PRIORITÉ ABSOLUE, à appliquer littéralement) : ${instructions}` : "Rends-la chaleureuse, punchy et très cliquable, aux codes de la niche.",
          "GROS PLAN visage, EXPRESSION FORTE et engageante, décor/accessoire évocateur DU THÈME ci-dessus, couleurs vives saturées, fort contraste, sujet décentré, >= 250 caractères.",
          `OBLIGATOIRE : une BULLE DE DIALOGUE de bande dessinée partant du présentateur avec 1-2 mots très courts en ${run.params.language || "English"} (seule écriture autorisée — aucun autre texte ni logo).`,
          'RÉPONDS UNIQUEMENT EN JSON : {"thumb_prompt":"..."}',
        ].join("\n"),
        4 * 60 * 1000
      )
    );
    thumbPrompt = p.thumb_prompt;
  } catch {
    thumbPrompt = instructions || null;
  }
  await generateThumbnail(run, thumbPrompt);
  return getRun(runId);
}
async function regenTexts(runId, instructions, field) {
  const run = getRun(runId);
  const c = config();
  const language = run.params.language || "English";
  const packLang = run.params.chainLanguage || language; // langue du public de la chaîne
  const inspiration = c.nicheId ? bank.inspiration(c.nicheId, { maxTitles: 15, maxVisions: 0 }) : "";
  const SPECS = {
    title: `- title : en ${packLang}, codes listening (Learn ${language}, niveau, thème). 70-100 caractères, max 100.`,
    description: `- description : en ${packLang}, accroche 2 lignes + ce qu'on apprend + 3-5 hashtags, max 1000 caractères.`,
    tags: `- tags : BEAUCOUP de mots-clés (en ${packLang} + anglais + longue traîne). 480-500 caractères joints par virgules (max 500).`,
  };
  const one = SPECS[field] ? field : null;
  const FR = { title: "le TITRE", description: "la DESCRIPTION", tags: "les TAGS" };
  const specLines = one ? [SPECS[one]] : [SPECS.title, SPECS.description, SPECS.tags];
  const schema = one ? (one === "tags" ? '{"tags":["..."]}' : `{"${one}":"..."}`) : '{"title":"...","description":"...","tags":["..."]}';
  const p = claude.parseJson(
    await askGen(
      [
        `Tu améliores le packaging YouTube d'une vidéo d'apprentissage de langue (déjà montée). Réécris ${one ? FR[one] : "le TITRE, la DESCRIPTION et les TAGS"}.`,
        `Thème : ${JSON.stringify(run.theme)}. Langue de la vidéo : ${language}. PUBLIC de la chaîne : ${packLang} (le packaging s'écrit en ${packLang}).`,
        instructions ? `OBSERVATION (à respecter) : ${instructions}` : "Propose une NOUVELLE variante, plus accrocheuse.",
        run.pack ? `Actuel : titre « ${run.pack.title || ""} » (${(run.pack.title || "").length} car).` : "",
        inspiration,
        ...specLines,
        "RÉPONDS UNIQUEMENT EN JSON : " + schema,
      ].join("\n"),
      4 * 60 * 1000
    )
  );
  run.pack = run.pack || {};
  if ((!one || one === "title") && p.title) run.pack.title = p.title;
  if ((!one || one === "description") && typeof p.description === "string") run.pack.description = p.description;
  if ((!one || one === "tags") && Array.isArray(p.tags) && p.tags.length) run.pack.tags = capTags(p.tags);
  saveRun(run);
  log(run, `${one ? FR[one] : "Textes"} régénéré(s)` + (instructions ? ` — « ${instructions.slice(0, 50)} »` : ""));
  return getRun(runId);
}

// ---------- Stock + publication ----------
function stock() {
  return readJSON(`machines/${MACHINE_ID}-stock.json`, []);
}
// Archiver / désarchiver / marquer publiée à la main (vidéo postée hors Agentic Os).
function patchStock(entryId, patch = {}) {
  const list = stock();
  const v = list.find((x) => x.id === entryId || x.runId === entryId);
  if (!v) throw new Error("Vidéo introuvable dans le stock");
  if (patch.archived !== undefined) v.archived = !!patch.archived;
  if (patch.posted !== undefined) {
    v.posted = !!patch.posted;
    if (v.posted && !v.postedAt) v.postedAt = new Date().toISOString();
    if (!v.posted) { v.postedAt = null; v.videoId = null; v.channelId = null; }
  }
  writeJSON(`machines/${MACHINE_ID}-stock.json`, list);
  return v;
}
function addToStock(run) {
  const list = stock();
  if (list.some((v) => v.runId === run.id)) return;
  list.push({
    id: "v" + Date.now().toString(36),
    runId: run.id,
    title: run.pack?.title || run.theme?.title || run.id,
    description: run.pack?.description || "",
    tags: run.pack?.tags || [],
    thumbRel: run.pack?.thumbRel || null,
    finalRel: run.finalRel,
    language: run.params.language || "",
    durationSec: null,
    createdAt: new Date().toISOString(),
    posted: false, channelId: null, videoId: null,
  });
  writeJSON(`machines/${MACHINE_ID}-stock.json`, list);
}
async function publishRun(runId, { channelId, title, description, tags, privacyStatus } = {}) {
  const run = getRun(runId);
  if (!run.finalRel) throw new Error("Pas de vidéo finale à publier");
  if (!channelId) throw new Error("Choisis une chaîne");
  const ROOT = path.join(__dirname, "..", "..", "..");
  // Upload résumable par chunks + erreurs lisibles (scope upload manquant, quota…) — helper partagé.
  const finalTitle = (title || run.pack?.title || "Learn a language").slice(0, 100);
  const vid = await google.youtubeUpload(channelId, path.join(ROOT, run.finalRel), {
    title: finalTitle,
    description: description || run.pack?.description || "",
    tags: capTags(tags && tags.length ? tags : run.pack?.tags || []),
    privacyStatus: privacyStatus || "private",
  });
  if (run.pack?.thumbRel) {
    try { await google.youtubeSetThumbnail(channelId, vid.id, path.join(ROOT, run.pack.thumbRel)); }
    catch (e) { log(run, "⚠ " + e.message + " — la vidéo est en ligne, pose la miniature à la main."); }
  }
  const list = stock();
  const entry = list.find((v) => v.runId === run.id);
  if (entry) {
    entry.posted = true;
    entry.postedAt = new Date().toISOString();
    entry.channelId = channelId;
    entry.videoId = vid.id;
    if (title) entry.title = finalTitle;
    writeJSON(`machines/${MACHINE_ID}-stock.json`, list);
  }
  tasks.emit("video_published", { title: finalTitle, machine: MACHINE_NAME, kind: "video", detail: "https://youtube.com/watch?v=" + vid.id }).catch(() => {});
  log(run, "Publiée sur YouTube : https://youtube.com/watch?v=" + vid.id);
  return { videoId: vid.id, url: "https://youtube.com/watch?v=" + vid.id };
}

// ---------- Concurrence + relances ----------
async function pool(items, worker, concurrency = 8) {
  const q = items.slice();
  let aborted = null;
  const runOne = async () => {
    while (q.length && !aborted) {
      const item = q.shift();
      try {
        await worker(item);
      } catch (e) {
        aborted = e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, q.length) }, runOne));
  if (aborted) throw aborted;
}
async function genWithRetry(run, scene, kind) {
  const gen = { image: generateImage, voice: generateVoice, video: generateVideo }[kind];
  const FR = { image: "Image", voice: "Voix", video: "Clip" };
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      await gen(run, scene);
      return;
    } catch (e) {
      if (/Annulée/.test(e.message)) throw e;
      log(run, `${FR[kind]} scène ${scene.i} : tentative ${attempt}/${MAX_TRIES} échouée (${e.message.slice(0, 70)})`);
      if (attempt >= MAX_TRIES) {
        scene.error = e.message;
        delete scene.rendering;
        saveRun(run);
        return;
      }
      // Réécriture du prompt image sur refus de politique de contenu
      if (kind === "image") {
        try {
          const { P, A, B } = castOf(run);
          const fix = claude.parseJson(
            await askGen(
              [
                "Une génération d'IMAGE a échoué. Réécris le prompt pour qu'il PASSE, SANS changer le sens de la scène.",
                `Raison : ${e.message}`,
                coreRules(P, A, B, run.params.language, run.params.level),
                `Prompt actuel : ${scene.image_prompt}`,
                'RÉPONDS UNIQUEMENT EN JSON : {"image_prompt":"..."}',
              ].join("\n"),
              4 * 60 * 1000
            )
          );
          if (fix.image_prompt) {
            scene.image_prompt = fix.image_prompt;
            saveRun(run);
          }
        } catch {}
      }
    }
  }
}

/**
 * Fin d'étape : DEUXIÈME VAGUE, puis VERROU.
 *
 * 1) Deuxième vague — un échec en masse est presque toujours transitoire (API qui tousse,
 *    spawn ffprobe refusé quand la machine est chargée). genWithRetry a déjà réessayé 3 fois
 *    d'affilée, ce qui ne laisse rien retomber ; on attend, puis on relance UNIQUEMENT ce qui
 *    manque — jamais ce qui a déjà réussi (donc jamais de dépense en double).
 * 2) Verrou — s'il manque encore quelque chose, l'étape N'EST PAS FRANCHIE. Avant, on posait
 *    un ⚠ dans le log et le pipeline continuait quand même : c'est ainsi que le run rms69ual7
 *    est arrivé au montage avec 0 clip sur 27, en affichant l'étape « vidéos » comme validée.
 *    En mode semi c'est l'utilisateur qui arbitre (validate() bloque déjà) : on l'informe.
 */
async function finishStep(run, { kind, field, label, concurrency, tick, eligible }) {
  let missing = run.scenes.filter((s) => !s[field]);
  const retryable = () => missing.filter((s) => (eligible ? eligible(s) : true));
  if (retryable().length) {
    log(run, `⚠ ${missing.length} ${label} manquant(s) — pause de 20 s, puis deuxième vague sur ces segments seuls…`);
    await new Promise((r) => setTimeout(r, 20000));
    if (cancelledRuns.has(run.id)) throw new Error("Annulée par l'utilisateur");
    await pool(retryable(), (s) => genWithRetry(run, s, kind).then(tick), concurrency);
    missing = run.scenes.filter((s) => !s[field]);
  }
  if (!missing.length) return;
  const why = (missing.find((s) => s.error) || {}).error || "cause inconnue";
  const list = missing.slice(0, 8).map((s) => s.i).join(", ") + (missing.length > 8 ? "…" : "");
  const msg = `${missing.length}/${run.scenes.length} ${label} manquant(s) (scène ${list}) — ${why}`;
  if (run.mode === "auto") throw new Error(`${msg}. Étape non franchie : corrige la cause, puis « Reprendre ».`);
  log(run, `⚠ ${msg} — régénère-les (↻) avant de valider.`);
}

async function stepImages(run) {
  const total = run.scenes.length;
  const tick = () => {
    const done = run.scenes.filter((s) => s.image).length;
    const live = run.scenes.filter((s) => s.rendering).length;
    tasks.updateTask(run.taskId, { step: `Images : ${done}/${total} · ${live} en cours…`, progress: 25 + Math.round((18 * done) / total), status: "running" }).catch(() => {});
  };
  const pend = run.scenes.filter((s) => !s.image);
  if (pend.length) {
    await ensureRefUrls(run);
    tick();
    log(run, `Génération des images : ${pend.length} segment(s), 10 en parallèle…`);
    await pool(pend, (s) => genWithRetry(run, s, "image").then(tick), 10);
  }
  await finishStep(run, { kind: "image", field: "image", label: "image(s)", concurrency: 10, tick });
}
async function stepVoices(run) {
  const total = run.scenes.length;
  const tick = () => {
    const done = run.scenes.filter((s) => s.audio).length;
    const live = run.scenes.filter((s) => s.rendering).length;
    tasks.updateTask(run.taskId, { step: `Voix : ${done}/${total} · ${live} en cours…`, progress: 45 + Math.round((18 * done) / total), status: "running" }).catch(() => {});
  };
  const pend = run.scenes.filter((s) => !s.audio);
  if (pend.length) {
    tick();
    log(run, `Génération des voix (ElevenLabs v3) : ${pend.length} segment(s), 10 en parallèle…`);
    await pool(pend, (s) => genWithRetry(run, s, "voice").then(tick), 10);
  }
  await finishStep(run, { kind: "voice", field: "audio", label: "voix", concurrency: 10, tick });
}
async function stepVideos(run) {
  const total = run.scenes.length;
  const tick = () => {
    const done = run.scenes.filter((s) => s.video).length;
    const live = run.scenes.filter((s) => s.rendering).length;
    tasks.updateTask(run.taskId, { step: `Clips : ${done}/${total} · ${live} en cours…`, progress: 66 + Math.round((16 * done) / total), status: "running" }).catch(() => {});
  };
  const pend = run.scenes.filter((s) => !s.video && s.image && s.audio);
  if (pend.length) tick();
  log(run, `Assemblage des clips (FFmpeg${run.params.lipsync ? " + lipsync présentateur" : ""}) : ${pend.length} segment(s)…`);
  await pool(pend, (s) => genWithRetry(run, s, "video").then(tick), 3);
  // Un clip ne se retente que si sa source existe (sinon c'est l'étape d'avant qui a échoué).
  await finishStep(run, { kind: "video", field: "video", label: "clip(s)", concurrency: 3, tick, eligible: (s) => s.image && s.audio });
}

// ---------- Orchestration ----------
const activeAdvance = new Set();
function cancelRun(id) {
  const run = getRun(id);
  cancelledRuns.add(id);
  if (run.status !== "done" && run.status !== "failed" && !run.cancelledFrom) run.cancelledFrom = run.status;
  tasks.updateTask(run.taskId, { step: "Annulée par l'utilisateur", status: "failed" }).catch(() => {});
  if (!activeAdvance.has(id)) {
    run.status = "failed";
    run.error = "Annulée par l'utilisateur";
    log(run, "Run annulé");
    saveRun(run);
  } else {
    saveRun(run);
    log(run, "Annulation demandée — abandon des requêtes en cours…");
  }
  return getRun(id);
}
function deriveStatus(run) {
  if (!promptsComplete(run)) return "prompts_running";
  if (run.scenes.some((s) => !s.image)) return "images_running";
  if (run.scenes.some((s) => !s.audio)) return "voices_running";
  if (run.scenes.some((s) => !s.video)) return "videos_running";
  if (!run.finalRel) return "montage_running";
  if (!run.pack) return "packaging_running";
  return "done";
}
function resumeRun(id, forcedStatus) {
  if (activeAdvance.has(id)) throw new Error("Le run tourne déjà — la décharge ⚡ n'est utile que s'il est à l'arrêt.");
  const run = getRun(id);
  cancelledRuns.delete(id);
  // ⚠ Tout statut d'ÉCHEC doit repartir de l'état réel des données, pas de lui-même.
  //   Le test ne portait que sur le `failed` nu : un `images_failed` (posé par le balayage de
  //   démarrage) passait au travers, la reprise relançait `advance()` sur un état que la boucle
  //   ne connaît pas, et celle-ci sortait aussitôt — en répondant « ok ». Une opération qui
  //   déclare réussir sans rien faire est pire qu'une erreur.
  const estEchec = /(^|_)failed$/.test(String(run.status));
  const status = forcedStatus || run.cancelledFrom || (estEchec ? deriveStatus(run) : run.status);
  run.status = status;
  run.error = null;
  delete run.cancelledFrom;
  (run.scenes || []).forEach((s) => {
    delete s.rendering;
    delete s.pending;
    delete s.error; // erreurs de la tentative précédente : le log en garde l'historique
  });
  saveRun(run);
  log(run, `Reprise à l'étape « ${status.replace("_running", " (en cours)").replace("_ready", " (validé)")} »`);
  advance(run.id);
  return getRun(id);
}
async function advance(runId) {
  cancelledRuns.delete(runId);
  activeAdvance.add(runId);
  const run = getRun(runId);
  const auto = run.mode === "auto";
  let curStep = run.status;
  const t = (patch) => tasks.updateTask(run.taskId, Object.assign({ status: "running" }, patch)).catch(() => {});
  try {
    // Préflight : les outils locaux doivent répondre AVANT de dépenser en images et en voix.
    // Le run rms69ual7 a brûlé 1,87 $ pour mourir ensuite sur un ffprobe injoignable.
    await ff.ensureTools();
    while (true) {
      curStep = run.status;
      if (cancelledRuns.has(runId)) throw new Error("Annulée par l'utilisateur");
      if (run.status === "prompts_running") {
        await t({ step: "Écriture des dialogues (Claude)…", progress: 10 });
        await generatePrompts(run);
        run.status = auto ? "images_running" : "prompts_ready";
      } else if (run.status === "images_running") {
        await t({ step: "Génération des images…", progress: 28 });
        await stepImages(run);
        run.status = auto ? "voices_running" : "images_ready";
      } else if (run.status === "voices_running") {
        await t({ step: "Génération des voix (ElevenLabs v3)…", progress: 48 });
        await stepVoices(run);
        run.status = auto ? "videos_running" : "voices_ready";
      } else if (run.status === "videos_running") {
        await t({ step: "Assemblage des clips…", progress: 68 });
        await stepVideos(run);
        run.status = auto ? "montage_running" : "videos_ready";
      } else if (run.status === "montage_running") {
        await t({ step: "Montage final (FFmpeg)…", progress: 84 });
        const out = await renderMontage(run);
        run.finalRel = `agent-os/output/machines/${run.id}/final.mp4`;
        run.status = "packaging_running";
        log(run, "Montage terminé : " + out);
      } else if (run.status === "packaging_running") {
        await t({ step: "Packaging : titre, description, tags, miniature…", progress: 92 });
        await generatePackaging(run);
        addToStock(run);
        run.status = "done";
        log(run, "Vidéo ajoutée au stock");
        if (run.params.publishChannelId) {
          await t({ step: "Publication YouTube…", progress: 97 });
          try {
            const r = await publishRun(run.id, { channelId: run.params.publishChannelId, privacyStatus: run.params.publishPrivacy || "private" });
            run.published = { url: r.url, videoId: r.videoId, channelId: run.params.publishChannelId, privacy: run.params.publishPrivacy || "private", at: new Date().toISOString() };
            saveRun(run);
            log(run, "Publication auto : " + r.url);
          } catch (e) {
            run.published = { error: e.message, at: new Date().toISOString() };
            saveRun(run);
            log(run, "Publication auto échouée : " + e.message + " — la vidéo reste dans le stock");
          }
        }
      } else break;
      saveRun(run);
      if (!auto && ["prompts_ready", "images_ready", "voices_ready", "videos_ready"].includes(run.status)) break;
      if (run.status === "done") break;
    }
    if (run.status === "done") {
      await t({ step: `Vidéo finale prête (${run.scenes.length} segments, ${(run.cost.images + run.cost.voices + run.cost.videos).toFixed(2)}$)`, progress: 100, status: "done" });
    } else if (!auto) {
      const pcts = { prompts_ready: 22, images_ready: 44, voices_ready: 64, videos_ready: 82 };
      await t({ step: `En attente de validation (${run.status.replace("_ready", "")})`, progress: pcts[run.status] || 50 });
    }
  } catch (e) {
    const cancelled = cancelledRuns.has(runId) || /Annulée/.test(e.message);
    const fresh = getRun(runId);
    fresh.status = "failed";
    fresh.error = cancelled ? "Annulée par l'utilisateur" : e.message;
    if (cancelled && !fresh.cancelledFrom) fresh.cancelledFrom = curStep;
    (fresh.scenes || []).forEach((s) => {
      delete s.rendering;
      delete s.pending;
    });
    log(fresh, cancelled ? "Run annulé — requêtes en cours abandonnées" : "ÉCHEC : " + e.message);
    saveRun(fresh);
    await t({ step: fresh.error, status: "failed" });
  } finally {
    activeAdvance.delete(runId);
  }
  return getRun(runId);
}

function createRun(body = {}) {
  const c = config();
  const { presenterId, protagonistIds, theme, language, chainLanguage, level, sceneCount, lipsync, subtitles, subStyle, publishChannelId, publishPrivacy, mode, allowNoPublish } = body;
  const ids = Array.isArray(protagonistIds) ? protagonistIds.filter(Boolean) : [];
  if (!presenterId || !c.characters.find((x) => x.id === presenterId)) throw new Error("Choisis un présentateur");
  if (ids.length < 2) throw new Error("Choisis les 2 protagonistes");
  if (ids[0] === ids[1]) throw new Error("Les 2 protagonistes doivent être différents");
  for (const id of ids) if (!c.characters.find((x) => x.id === id)) throw new Error("Protagoniste introuvable");
  // allowNoPublish : une commande explicite « vers stock » (restock/calendrier) passe outre l'autoPublish de la config
  if (c.autoPublish && !publishChannelId && !allowNoPublish) throw new Error("Publication auto activée : choisis la chaîne de publication");
  const dialogueCount = Math.min(Math.max(Number(sceneCount) || 6, 1), 100);
  const run = {
    id: "r" + Date.now().toString(36),
    machineId: MACHINE_ID,
    mode: mode === "auto" ? "auto" : "semi",
    params: {
      presenterId,
      protagonistIds: [ids[0], ids[1]],
      theme: theme || null,
      language: language || "English",
      // Langue de la CHAÎNE (public visé) : titres/descriptions/tags — pas forcément celle de la vidéo
      // (ex. vidéos en français pour un public anglophone → packaging en anglais).
      chainLanguage: chainLanguage || language || "English",
      level: level || "A1/A2",
      sceneCount: dialogueCount,
      lipsync: !!lipsync,
      subtitles: subtitles !== false,
      subStyle: subStyle || { font: "Arial", size: 24, outline: 2, position: "bottom-center" },
      publishChannelId: publishChannelId || null,
      publishPrivacy: publishPrivacy || "private",
    },
    dialogueCount,
    sceneCount: dialogueCount + 2,
    status: "prompts_running",
    theme: theme && (theme.text || theme.theme) ? { title: theme.text || theme.theme, language: language || "English", level: level || "A1/A2" } : null,
    scenes: [],
    cost: { images: 0, voices: 0, videos: 0 },
    createdAt: new Date().toISOString(),
    log: [],
  };
  const task = tasks.createTask({
    title: `Linguistique — run ${run.id} (${run.mode})`,
    desc: `${dialogueCount} dialogue(s) · ${run.params.language} ${run.params.level}`,
    machine: MACHINE_NAME,
    machineId: MACHINE_ID,
    runId: run.id,
    kind: "video",
    step: "Démarrage…",
    progress: 5,
    status: "running",
  });
  run.taskId = task.id;
  saveRun(run);
  advance(run.id);
  return run;
}

function validate(runId) {
  const run = getRun(runId);
  const busy = (run.scenes || []).filter((s) => s.pending || s.rendering);
  if (busy.length) throw new Error(`Régénération en cours (scène${busy.length > 1 ? "s" : ""} ${busy.map((s) => s.i).join(", ")}) — attends la fin avant de valider.`);
  const missField = { images_ready: "image", voices_ready: "audio", videos_ready: "video" }[run.status];
  if (missField) {
    const miss = run.scenes.filter((s) => !s[missField]);
    if (miss.length) throw new Error(`${miss.length} ${missField === "image" ? "image(s)" : missField === "audio" ? "voix" : "clip(s)"} manquant(s) (scène ${miss.map((s) => s.i).join(", ")}) — régénère-les avant de continuer.`);
  }
  const next = { prompts_ready: "images_running", images_ready: "voices_running", voices_ready: "videos_running", videos_ready: "montage_running" }[run.status];
  if (!next) throw new Error(`Rien à valider (statut ${run.status})`);
  run.status = next;
  saveRun(run);
  advance(run.id);
  return run;
}

// ---------- Régénération par scène ----------
const liveRuns = new Map();
function getLiveRun(id) {
  let e = liveRuns.get(id);
  if (!e) {
    e = { run: getRun(id), refs: 0 };
    liveRuns.set(id, e);
  }
  e.refs++;
  return e.run;
}
function releaseLiveRun(id) {
  const e = liveRuns.get(id);
  if (!e) return;
  if (--e.refs <= 0) liveRuns.delete(id);
}
async function rewriteScenePrompts(run, scene, instructions) {
  const { P, A, B } = castOf(run);
  try {
    const schema = scene.role === "dialogue"
      ? '{"scene_title":"...","image_prompt":"...","dialogue":[{"speaker":"A","line":"..."}]}'
      : '{"narration":"...","image_prompt":"..."}';
    const parsed = await genJson(
      [
        `Tu modifies UNE scène (${scene.role}) d'une vidéo d'apprentissage de langue. GARDE LE NOYAU DUR intact :`,
        coreRules(P, A, B, run.params.language, run.params.level),
        `Thème : ${JSON.stringify(run.theme)}.`,
        `Scène actuelle ${scene.i} : ${JSON.stringify(scene.role === "dialogue" ? { scene_title: scene.scene_title, image_prompt: scene.image_prompt, dialogue: scene.turns.map((t) => ({ speaker: t.speaker, line: t.text })) } : { narration: scene.narration, image_prompt: scene.image_prompt })}`,
        `INSTRUCTIONS : ${instructions || "améliore la scène"}.`,
        "Applique les instructions SANS toucher au noyau dur (personnages, voix, langue, niveau).",
        "RÉPONDS UNIQUEMENT EN JSON : " + schema,
      ].join("\n"),
      { tries: 3, label: `réécriture scène ${scene.i}` }
    );
    if (scene.role === "dialogue") {
      if (parsed.scene_title) scene.scene_title = parsed.scene_title;
      if (Array.isArray(parsed.dialogue) && parsed.dialogue.length) {
        scene.turns = parsed.dialogue.map((d) => ({ speaker: d.speaker === "B" ? "B" : "A", text: String(d.line || d.text || "").trim() })).filter((d) => d.text);
      }
    } else if (parsed.narration) {
      scene.narration = Array.isArray(parsed.narration) ? parsed.narration.join(" ") : parsed.narration;
    }
    if (parsed.image_prompt) scene.image_prompt = parsed.image_prompt;
    saveRun(run);
    log(run, `Scène ${scene.i} réécrite (${(instructions || "").slice(0, 60) || "sans instructions"})`);
  } catch (e) {
    log(run, `Réécriture scène ${scene.i} indisponible (${e.message.slice(0, 60)})`);
  }
}
async function doRegen(run, scene, step, instructions) {
  const t = (patch) => tasks.updateTask(run.taskId, Object.assign({ status: "running" }, patch)).catch(() => {});
  await t({ step: `Régénération scène ${scene.i} (${step})…` });
  if (instructions || step === "prompts") await rewriteScenePrompts(run, scene, instructions);
  if (step === "images") {
    await genWithRetry(run, scene, "image");
    if (scene.error) throw new Error(scene.error);
    if (scene.video) { scene.video = null; saveRun(run); } // image changée → clip obsolète
  } else if (step === "voices") {
    await genWithRetry(run, scene, "voice");
    if (scene.error) throw new Error(scene.error);
  } else if (step === "videos") {
    if (!scene.image) { await genWithRetry(run, scene, "image"); if (scene.error) throw new Error(scene.error); }
    if (!scene.audio) { await genWithRetry(run, scene, "voice"); if (scene.error) throw new Error(scene.error); }
    await genWithRetry(run, scene, "video");
    if (scene.error) throw new Error(scene.error);
  }
  saveRun(run);
  await t({ step: `Scène ${scene.i} régénérée — en attente de validation (${run.status.replace("_ready", "")})` });
}
async function regenScene(runId, sceneI, step, instructions) {
  const run = getLiveRun(runId);
  try {
    const scene = run.scenes.find((s) => s.i === Number(sceneI));
    if (!scene) throw new Error("Scène introuvable");
    scene.pending = true;
    delete scene.error;
    saveRun(run);
    try {
      await doRegen(run, scene, step, instructions);
    } finally {
      delete scene.pending;
      saveRun(run);
    }
    return getRun(runId);
  } finally {
    releaseLiveRun(runId);
  }
}

// Régénération EN MASSE des IMAGES d'un sous-ensemble de scènes (ex. toutes sauf intro/outro),
// en arrière-plan, non destructif. Utilise les références À JOUR (16:9 + duo pour Grok).
function regenSceneImages(runId, indices) {
  const run = getLiveRun(runId);
  const targets = (run.scenes || []).filter((s) => indices.includes(s.i));
  if (!targets.length) {
    releaseLiveRun(runId);
    return { count: 0 };
  }
  const t = (patch) => tasks.updateTask(run.taskId, Object.assign({ status: "running" }, patch)).catch(() => {});
  targets.forEach((s) => { s.pending = true; delete s.error; });
  saveRun(run);
  log(run, `Régénération ciblée : ${targets.length} image(s) [scènes ${targets.map((s) => s.i).join(", ")}]…`);
  (async () => {
    try {
      let di = 0;
      await pool(targets, async (s) => {
        await genWithRetry(run, s, "image");
        if (s.video) { s.video = null; saveRun(run); } // image changée → clip obsolète
        await t({ step: `Régé images : ${++di}/${targets.length}…`, progress: 30 + Math.round((20 * di) / targets.length) });
      }, 10);
      const failed = targets.filter((s) => !s.image).length;
      log(run, `Régénération d'images terminée${failed ? ` (⚠ ${failed} à revoir)` : ""}.`);
    } catch (e) {
      log(run, `Régénération d'images interrompue : ${e.message}`);
    } finally {
      targets.forEach((s) => delete s.pending);
      saveRun(run);
      releaseLiveRun(runId);
    }
  })();
  return { count: targets.length };
}

// ---------- Idée de thème + complétion de personnage ----------
// Toutes les idées DÉJÀ produites (runs passés + stock) — pour ne JAMAIS reproposer la même.
function producedThemes() {
  const seen = new Set();
  for (const r of listRuns()) {
    const t = r.theme?.title || r.theme?.text || (r.params && r.params.theme && r.params.theme.text);
    if (t) seen.add(String(t));
  }
  for (const v of stock()) if (v.title) seen.add(String(v.title));
  return [...seen];
}
async function suggestTheme(sceneCount) {
  const c = config();
  const n = Math.max(1, Number(sceneCount) || 6);
  const inspiration = c.nicheId ? bank.inspiration(c.nicheId, { maxTitles: 12, maxVisions: 0 }) : "";
  const done = producedThemes();
  const parsed = claude.parseJson(
    await askGen(
      [
        "Propose UN thème de vidéo d'apprentissage de langue (par l'écoute) à fort potentiel : une SITUATION de la vie quotidienne,",
        "très concrète et riche en vocabulaire utile. Original vs les titres ci-dessous.",
        `CONTRAINTE DE TAILLE : la vidéo aura ${n} scènes de dialogue DISTINCTES. Le thème doit être assez LARGE pour nourrir ${n} sous-situations différentes sans se répéter`,
        n >= 15
          ? "(ex. « une journée entière au marché », « emménager dans un nouvel appartement », « organiser une fête d'anniversaire », « une semaine de vacances au bord de la mer » — PAS un micro-événement comme « acheter un billet »)."
          : "(un lieu ou un moment précis suffit pour ce format court).",
        done.length
          ? `IDÉES DÉJÀ PRODUITES — INTERDICTION de les reprendre, ET d'en proposer une PROCHE (même famille : si « l'aéroport » est fait, « prendre le train » ou « le bus » sont TROP proches — change carrément d'univers) :\n- ${done.slice(0, 40).join("\n- ")}`
          : "",
        inspiration,
        'RÉPONDS UNIQUEMENT EN JSON : {"theme":"la situation (2-5 mots)","pitch":"1 phrase en français sur ce qu\'on apprend"}',
      ].join("\n"),
      3 * 60 * 1000
    )
  );
  parsed.text = parsed.theme;
  return parsed;
}
async function completeCharacter({ name, appearance, sex } = {}) {
  const g = sex === "M" ? "homme" : sex === "F" ? "femme" : "personne";
  const existing = config().characters.map((c) => `${c.name} (${c.sex === "F" ? "F" : "M"}) : ${(c.appearance || "").slice(0, 140)}`);
  const parsed = claude.parseJson(
    await askGen(
      [
        `Complète la fiche d'un personnage (${g}) pour des vidéos d'apprentissage de langue (animation 3D chaleureuse et sympathique).`,
        `Fourni par l'utilisateur (à respecter et enrichir, jamais contredire) : nom=${name || "(vide)"} ; apparence=${appearance || "(vide)"}.`,
        existing.length ? `PERSONNAGES DÉJÀ CRÉÉS — rends celui-ci VISUELLEMENT TRÈS DIFFÉRENT d'eux (autre origine, autres cheveux, autre tenue) :\n- ${existing.join("\n- ")}` : "",
        "VARIÉTÉ MAXIMALE (crucial) : varie fortement l'origine et la couleur de peau, la couleur et le style de cheveux, l'âge, la morphologie,",
        "et SURTOUT la TENUE — couleurs et style franchement différents des autres personnages (surtout pas tous en pull moutarde). Look unique et mémorable.",
        "Règle : apparence en ANGLAIS (sert de prompt image), riche et précise (~40-60 mots : âge, origine, cheveux, yeux, peau, tenue moderne signature DISTINCTIVE, accessoires).",
        "Nom court et naturel si vide (et différent des noms existants).",
        'RÉPONDS UNIQUEMENT EN JSON : {"name":"...","appearance":"..."}',
      ].join("\n"),
      3 * 60 * 1000
    )
  );
  return parsed;
}

// ---------- Images de référence ----------
const CHAR_DIR = path.join(OUT_ROOT, "characters");
ensureDir(CHAR_DIR);
const slug = (s) => String(s || "perso").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);
function saveUploadedReference(name, dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(String(dataUrl));
  if (!m) throw new Error("Image invalide (png/jpg/webp attendu)");
  const file = `${slug(name)}-${Date.now().toString(36)}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
  fs.writeFileSync(path.join(CHAR_DIR, file), Buffer.from(m[2], "base64"));
  return `agent-os/output/machines/characters/${file}`;
}
// Image de référence en 16:9 (Grok i2i reproduit la taille de la référence → il FAUT du 16:9).
// Cadrage : présentateur = plan serré tête/buste (bon lip-sync) ; acteur = plan moyen (buste/taille).
async function generateReference(name, appearance, { presenter = false } = {}) {
  const framing = presenter
    ? "TIGHT presenter framing: head-and-shoulders close-up, the face and upper chest FILL most of the frame (like a TV host / news presenter), perfectly front-facing, looking straight into the camera — optimized for lip-sync. "
    : "Tight medium shot, waist-up: the character FILLS most of the frame (NOT a small full-body figure in the distance), front-facing, looking straight into the camera. ";
  const prompt =
    `Cinematic 3D animation character portrait of ${appearance}. ` +
    framing +
    "Warm friendly expression, soft warm cinematic lighting, plain soft studio background, Pixar-like polished 3D render, ultra detailed, HD, 16:9 wide. " +
    "Keep exactly the signature outfit described above. Absolutely no text, no letters, no watermark, no logo anywhere in the image.";
  const taskId = await kieCreate("gpt-image-2-text-to-image", { prompt, aspect_ratio: "16:9", resolution: "1K" });
  const url = await kiePoll(taskId, { timeoutMs: 8 * 60 * 1000, intervalMs: 10000 });
  const file = `${slug(name)}-${Date.now().toString(36)}.png`;
  await download(url, path.join(CHAR_DIR, file));
  spend.record("Kie.ai", MACHINE_NAME, PRICES.image, "USD", `Référence personnage ${name}`);
  return `agent-os/output/machines/characters/${file}`;
}
// Régénère l'image de référence d'un personnage existant (16:9, cadrage selon son rôle).
async function regenCharacterImage(id) {
  const c = config();
  const ch = c.characters.find((x) => x.id === id);
  if (!ch) throw new Error("Personnage introuvable");
  if (!ch.appearance) throw new Error("Décris d'abord l'apparence du personnage");
  ch.referenceRel = await generateReference(ch.name, ch.appearance, { presenter: !!ch.presenter });
  saveConfig(c);
  return ch;
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
  for (const meta of listRuns()) {
    let run;
    try {
      run = getRun(meta.id);
    } catch {
      continue;
    }
    let touched = false;
    for (const s of run.scenes || []) {
      if (s.rendering) (delete s.rendering, (touched = true));
      if (s.pending) (delete s.pending, (touched = true));
    }
    // ⚠ Un run resté en `*_running` a perdu son advance() avec le process : il ne travaille
    //   plus, mais l'interface l'affichait « en cours » INDÉFINIMENT — jusqu'à ce que
    //   l'utilisateur croie à une machine bloquée. On le reclasse en échec REPRENABLE (⚡).
    if (/_running$/.test(String(run.status))) {
      run.status = String(run.status).replace(/_running$/, "_failed");
      run.error = "Interrompue par un redémarrage du serveur — reprenable avec ⚡";
      touched = true;
    }
    if (touched) {
      saveRun(run);
      n++;
    }
  }
  backfillStock();
  return n;
}

// Runs plantés = statut *_running mais plus aucun advance() en mémoire (serveur redémarré, crash…).
function strandedRuns() {
  return listRuns()
    .filter((r) => String(r.status || "").endsWith("_running") && !activeAdvance.has(r.id))
    .map((r) => ({ id: r.id, status: r.status, theme: r.theme?.title || r.theme?.text || r.id, machine: MACHINE_NAME, machineId: MACHINE_ID }));
}

/**
 * Commande une vidéo SANS passer par le wizard (restock / calendrier de publication) :
 * clone les paramètres du run le plus récent, thème neuf, mode auto, chaîne cible.
 */
async function orderRun({ publishChannelId, publishPrivacy, publish, overrides, theme } = {}) {
  const last = listRuns().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if (!last || !last.params || !last.params.presenterId)
    throw new Error("Aucun run modèle : lance d'abord un run manuel sur la machine Linguistique");
  const base = { ...last.params, ...(overrides || {}) };
  const th = theme || (await suggestTheme(base.sceneCount));
  return createRun({
    ...base,
    theme: th,
    mode: "auto",
    publishChannelId: publish ? publishChannelId : null,
    publishPrivacy: publishPrivacy || "private",
    allowNoPublish: !publish,
  });
}

/** N idées d'un coup, RADICALEMENT différentes entre elles (restock multiple / calendrier). */
async function suggestThemes(count, opts = {}) {
  const c = config();
  const n = Math.max(1, Number(opts.sceneCount) || 6);
  const k = Math.min(Math.max(Number(count) || 1, 1), 8);
  const inspiration = c.nicheId ? bank.inspiration(c.nicheId, { maxTitles: 12, maxVisions: 0 }) : "";
  const done = producedThemes();
  const parsed = claude.parseJson(
    await askGen(
      [
        `Propose EXACTEMENT ${k} thèmes de vidéos d'apprentissage de langue (par l'écoute) : des SITUATIONS de la vie quotidienne concrètes et riches en vocabulaire.`,
        `RÈGLE CAPITALE : les ${k} thèmes doivent être RADICALEMENT différents ENTRE EUX — jamais deux de la même famille (pas deux transports, pas deux commerces, pas deux repas) : varie carrément d'univers (santé, nature, sport, travail, fête, voyage, maison…).`,
        `Chaque vidéo aura ${n} scènes de dialogue distinctes : thème assez large pour nourrir ${n} sous-situations.`,
        done.length
          ? `IDÉES DÉJÀ PRODUITES — interdiction de les reprendre OU d'en proposer une PROCHE (si « l'aéroport » est fait, « le train » est TROP proche) :\n- ${done.slice(0, 40).join("\n- ")}`
          : "",
        inspiration,
        `RÉPONDS UNIQUEMENT EN JSON : {"ideas":[{"theme":"la situation (2-5 mots)","pitch":"1 phrase en français"}]} — exactement ${k} entrées.`,
      ].join("\n"),
      4 * 60 * 1000
    )
  );
  return (parsed.ideas || []).slice(0, k).map((i) => ({ ...i, text: i.theme }));
}

module.exports = {
  orderRun,
  suggestThemes,
  VOICES,
  sweepRuns,
  strandedRuns,
  patchStock,
  cancelRun,
  config,
  patchConfig,
  saveUploadedReference,
  generateReference,
  regenCharacterImage,
  completeCharacter,
  upsertCharacter,
  removeCharacter,
  listRuns,
  getRun,
  createRun,
  validate,
  regenScene,
  regenSceneImages,
  regenThumbnail,
  regenTexts,
  suggestTheme,
  advance,
  resumeRun,
  stock,
  publishRun,
  PRICES,
};
