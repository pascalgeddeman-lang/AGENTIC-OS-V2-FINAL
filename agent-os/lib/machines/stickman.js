/**
 * MACHINE STICKMAN — documentaires de vulgarisation anthropologique en stickman.
 *
 * Recette dérivée de la banque de niche « Stickman » (7 chaînes, 66 vidéos analysées) et du
 * décorticage image par image de 5 vidéos concurrentes : voir stickman-lab/RECETTE-NICHE-STICKMAN.md.
 * Chiffres qui pilotent la machine : 165 mots/min, un plan toutes les 3,4 s (médiane), 60 % des
 * coupes sur une fin de phrase, ~62 % de scènes narratives / ~26 % de schémas, aucun texte à l'écran.
 *
 * Différence structurelle avec Time Travel / Linguistique : ici l'identité de la chaîne n'est PAS
 * un personnage unique, c'est le STYLE. Les personnages sont une ressource partagée, servie par
 * lib/machines/stickman-cast.js — la machine pioche dans la bibliothèque et n'y ajoute que ce qui
 * manque au thème du jour.
 *
 * Étapes : script → voix + découpage → casting → prompts d'images → images → montage → packaging.
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { DATA_DIR, ensureDir, readJSON, writeJSON } = require("../store");
const claude = require("../claude");
const vault = require("../vault");
const fal = require("../fal");
const ff = require("../ffmpeg");
const google = require("../google");
const tasks = require("../tasks");
const spend = require("../spend");
const bank = require("../bank");
const cast = require("./stickman-cast");

const MACHINE_ID = "stickman";
const MACHINE_NAME = "Stickman";
const ROOT = path.join(__dirname, "..", "..", "..");
const OUT_ROOT = path.join(__dirname, "..", "..", "output", "machines");
const REMOTION_DIR = path.join(ROOT, "remotion");
const RUNS_DIR = path.join(DATA_DIR, "machines", "runs", MACHINE_ID); // sous-dossier : listRuns ne voit que nos runs
ensureDir(OUT_ROOT);
ensureDir(RUNS_DIR);

// ---------------------------------------------------------------- constantes de niche

// Mesures de la banque de niche — ne pas modifier sans re-mesurer.
const WPM = 165;            // débit voix off observé (155-175 sur 5 chaînes)
const SHOT_TARGET = 3.4;    // durée médiane d'un plan chez les 2 meilleures performeuses
const SHOT_MIN = 1.30;
const SHOT_MAX = 7.00;
const BURST_MIN = 0.75;     // rafales d'énumération

const PRICES = { image: 0.02, sheet: 0.02, voicePer1kChars: 0.015, whisperPerSec: 0.0008 };
const MAX_TRIES = 3;
const IMG_CONCURRENCY = 5;
const TTS_MAX_CHARS = 1900; // l'API Inworld refuse au-delà de 2000

const W = 1920, H = 1080, FPS = 30;

// Voix Inworld TTS (FAL) — les noms SONT les voix.
const VOICES = {
  English: ["Malcolm", "Graham", "Theodore", "Edward", "Simon", "Elliot", "James", "Oliver", "Rupert", "Sebastian", "Craig", "Mark", "Nate", "Ethan", "Blake", "Carter", "Serena", "Claire", "Victoria", "Miranda", "Evelyn", "Celeste", "Olivia", "Julia", "Sarah", "Elizabeth"],
  "Français": ["Alain", "Mathieu", "Étienne", "Hélène"],
  "Español": ["Diego", "Miguel", "Rafael", "Lupita"],
  Deutsch: ["Josef", "Johanna"],
  Italiano: ["Gianni", "Orietta"],
  "Português": ["Heitor", "Maitê"],
  Nederlands: ["Erik", "Lennart", "Katrien", "Lore"],
  Polski: ["Szymon", "Wojciech"],
  "Русский": ["Dmitry", "Nikolai", "Svetlana", "Elena"],
  "日本語": ["Satoshi", "Asuka"],
  "한국어": ["Hyunwoo", "Seojun", "Minji", "Yoona"],
  "中文": ["Yichen", "Jing", "Xiaoyin", "Xinyi"],
};
const VOICE_SUFFIX = {
  English: "(en)", "Français": "(fr)", "Español": "(es)", Deutsch: "(de)", Italiano: "(it)",
  "Português": "(pt)", Nederlands: "(nl)", Polski: "(pl)", "Русский": "(ru)", "日本語": "(ja)",
  "한국어": "(ko)", "中文": "(zh)",
};
const WHISPER_LANG = {
  English: "en", "Français": "fr", "Español": "es", Deutsch: "de", Italiano: "it", "Português": "pt",
  Nederlands: "nl", Polski: "pl", "Русский": "ru", "日本語": "ja", "한국어": "ko", "中文": "zh",
};
const CTA_TEXT = {
  English: { label: "SUBSCRIBE", done: "SUBSCRIBED" },
  "Français": { label: "S'ABONNER", done: "ABONNÉ" },
  "Español": { label: "SUSCRIBIRSE", done: "SUSCRITO" },
  Deutsch: { label: "ABONNIEREN", done: "ABONNIERT" },
  Italiano: { label: "ISCRIVITI", done: "ISCRITTO" },
  "Português": { label: "INSCREVA-SE", done: "INSCRITO" },
};

/** Style martelé sur TOUS les plans : c'est lui qui tient la cohérence de la série. */
const IMG_STYLE = `Flat 2D minimalist stickman cartoon illustration for a documentary explainer video, drawn in exactly the same art style as the reference image. Characters have plain round off-white heads with a thick black outline, two small black dot eyes and a single thin line for the mouth, thin solid black stick arms and legs, and small solid black oval hands and feet. No skin tone, no nose, no ears, no facial detail beyond eyes and mouth. Every element is drawn with thick uniform black outlines and filled with flat matte desaturated colour: no gradients, no textures, no cross-hatching, no rendering, at most one single darker tone for shadow. Muted earthy palette of bone white, warm beige, brown, slate blue-grey, olive green and charcoal. Simple uncluttered composition with generous empty space, ground drawn as a single horizontal line or one flat band. Clean 16:9 widescreen framing.`;

const IMG_NEG = `Absolutely no text of any kind: no letters, no words, no numbers, no captions, no subtitles, no labels, no signage, no watermark, no logo, no signature, no UI, no frame border. No photorealism, no 3D render, no anime, no manga, no detailed or shaded faces, no realistic skin, no lens effects, no film grain.`;

// ---------------------------------------------------------------- Claude

function genModel() {
  return config().settings.promptModel || "";
}
async function genJson(prompt, { ms = 6 * 60 * 1000, tries = 3, label = "" } = {}) {
  let last;
  for (let a = 1; a <= tries; a++) {
    try {
      const out = await claude.ask(prompt, { timeoutMs: ms, model: genModel() || undefined });
      const j = claude.parseJson(out);
      if (j) return j;
      last = new Error("réponse illisible (JSON absent)");
    } catch (e) {
      last = e;
    }
    if (a < tries) await new Promise((r) => setTimeout(r, 3000 * a));
  }
  throw new Error(`${label || "Génération"} : ${last.message}`);
}

// ---------------------------------------------------------------- config

function defaultNicheId() {
  const n = bank.niches().find((x) => /stickman/i.test(x.name));
  return n ? n.id : null;
}
function config() {
  const c = readJSON(`machines/${MACHINE_ID}.json`, null);
  if (c) {
    c.settings = Object.assign(
      { imageModel: "nano", ctaEveryMin: 2, subtitles: true, promptModel: "", chainLanguage: "English", publishPrivacy: "private" },
      c.settings || {}
    );
    if (!c.nicheId) c.nicheId = defaultNicheId();
    return c;
  }
  const fresh = {
    id: MACHINE_ID,
    name: MACHINE_NAME,
    nicheId: defaultNicheId(),
    settings: { imageModel: "nano", ctaEveryMin: 2, subtitles: true, promptModel: "", chainLanguage: "English", publishPrivacy: "private" },
  };
  writeJSON(`machines/${MACHINE_ID}.json`, fresh);
  return fresh;
}
function saveConfig(c) {
  writeJSON(`machines/${MACHINE_ID}.json`, c);
}
function patchConfig(patch) {
  const c = config();
  if (patch.settings) Object.assign(c.settings, patch.settings);
  for (const k of ["nicheId", "name"]) if (patch[k] !== undefined) c[k] = patch[k];
  saveConfig(c);
  return c;
}

// ---------------------------------------------------------------- runs

function runPath(id) {
  return path.join(RUNS_DIR, id + ".json");
}
function listRuns() {
  try {
    return fs
      .readdirSync(RUNS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          const r = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), "utf8"));
          return {
            id: r.id, title: r.title || r.params?.subject || "Sans titre", status: r.status,
            createdAt: r.createdAt, mode: r.mode, cost: r.cost,
            shots: (r.scenes || []).length, durationSec: r.voDuration || null,
            finalRel: r.finalRel || null, published: r.published || null,
          };
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
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

// ---------------------------------------------------------------- recette de niche

/** Le noyau dur : survit à toutes les régénérations. */
function coreRules(run) {
  const p = run.params;
  return [
    "NICHE : documentaire de vulgarisation anthropologique, animé en « stickman » (bonshommes allumettes).",
    `LANGUE DE LA VOIX OFF : ${p.language}. Tous les prompts d'images restent en ANGLAIS.`,
    `DURÉE VISÉE : ${p.durationMin} minutes, soit ~${Math.round(p.durationMin * WPM)} mots (débit mesuré : ${WPM} mots/min).`,
    "TON : calme, posé, factuel. Jamais de blague appuyée, jamais d'emphase publicitaire.",
    "PHRASES COURTES : 9 à 12 mots en moyenne. Les chaînes qui écrivent long sont celles qui performent le moins.",
    "Une question rhétorique toutes les 30 à 45 secondes — c'est le moteur de rétention de la niche.",
    "Aucun jargon sans traduction immédiate. Les noms de sites archéologiques servent de PREUVE, pas d'érudition.",
    "AUCUN appel à s'abonner dans la voix off : le CTA est un élément VISUEL ajouté au montage.",
  ].join("\n");
}

/** La structure narrative canonique, relevée sur le n°1 de la banque. */
function storyRecipe() {
  return [
    "STRUCTURE OBLIGATOIRE (relevée sur les vidéos les plus vues de la niche) :",
    "1. HOOK UNIVERSEL — une affirmation que personne ne peut contester (le spectateur est concerné avant la 1re phrase), puis LA question que personne ne pose.",
    "2. FAUSSE RÉPONSE ÉVIDENTE — on propose la réponse naïve et on la rend crédible.",
    "3. PATTERN INTERRUPT — « But here's the strange part » : la fausse réponse s'effondre sur une contradiction.",
    "4. LE PROBLÈME DE LA PREUVE — pourquoi c'est difficile à savoir. Crée l'enquête.",
    "5. LE RETOURNEMENT DE MÉTHODE — ce n'est pas la réponse qui arrive, c'est une nouvelle FAÇON DE CHERCHER. C'est le plus fort levier de rétention de la niche.",
    "6. LES PREUVES PAR VAGUES — 3 à 5 blocs, chacun clos par une relance (« But here's the catch », « And that's when they turned to something unexpected »).",
    "7. LE MYTHE DÉMONTÉ — « So when did X change everything? The answer is that it didn't. »",
    "8. ÉLARGISSEMENT FINAL — le sujet trivial devient une histoire sur l'espèce, puis UNE dernière phrase courte, sèche, mémorable.",
    "",
    "PROCÉDÉS À UTILISER : répétition d'ancrage (la question du hook revient mot pour mot 2-3 fois), anaphores en rafale",
    "(« no rules, no parents, no civilization »), adresse directe (« Imagine living beside a river »).",
    "Les faits doivent être RÉELS et vérifiables : sites archéologiques, études nommées, chiffres exacts. Jamais d'invention.",
  ].join("\n");
}

// ---------------------------------------------------------------- étape 1 : script

async function stepScript(run) {
  const c = config();
  const p = run.params;
  const words = Math.round(p.durationMin * WPM);
  const inspiration = c.nicheId ? (() => { try { return bank.inspiration(c.nicheId, { maxTitles: 20, maxVisions: 2 }); } catch { return ""; } })() : "";

  const j = await genJson(
    [
      "Tu écris le SCRIPT COMPLET d'une vidéo de documentaire animé en stickman.",
      "",
      coreRules(run),
      "",
      storyRecipe(),
      "",
      inspiration ? "CONTEXTE CONCURRENTIEL (à ne PAS copier, à égaler) :\n" + inspiration : "",
      "",
      `SUJET IMPOSÉ : ${p.subject}`,
      p.characters ? `PERSONNAGES SOUHAITÉS PAR L'UTILISATEUR : ${p.characters}` : "",
      "",
      "CONTRAINTES DE SORTIE :",
      `- \`voiceover\` : le bloc de voix off COMPLET, d'un seul tenant, en ${p.language}, ${words} mots ± 5 %.`,
      "  Pas de didascalies, pas de noms de locuteur, pas de balises, pas de titres de section : uniquement le texte lu.",
      "  Il sera envoyé tel quel à la synthèse vocale.",
      `- \`title\` : titre YouTube en ${c.settings.chainLanguage}, sur la formule de la niche :`,
      "  [mot interrogatif] + le sujet + la chose intime du quotidien, terminé par « ? ». 50-80 caractères.",
      "- `angle` : en une phrase française, le mythe que la vidéo démonte.",
      "",
      'RÉPONDS UNIQUEMENT EN JSON : {"title":"","angle":"","voiceover":""}',
    ].filter(Boolean).join("\n"),
    { ms: 10 * 60 * 1000, label: "Écriture du script" }
  );

  if (!j.voiceover || String(j.voiceover).split(/\s+/).length < 80) throw new Error("Script trop court ou vide");
  run.title = j.title || p.subject;
  run.angle = j.angle || "";
  run.script = String(j.voiceover).replace(/\s+/g, " ").trim();
  const n = run.script.split(/\s+/).length;
  log(run, `Script écrit : « ${run.title} » — ${n} mots (~${(n / WPM).toFixed(1)} min estimées)`);
  saveRun(run);
}

// ---------------------------------------------------------------- étape 2 : voix + découpage

function chunkText(text, max = TTS_MAX_CHARS) {
  const sentences = text.match(/[^.!?]+[.!?]+["»)]?\s*/g) || [text];
  const out = [];
  let cur = "";
  for (const s of sentences) {
    if (cur.length + s.length > max && cur) { out.push(cur.trim()); cur = ""; }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function runFfmpeg(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { cwd, windowsHide: true });
    let err = "";
    child.stdout.on("data", () => {}); // pipe non lu = process figé (piège connu)
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => reject(new Error("FFmpeg introuvable : " + e.message)));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error("FFmpeg : " + err.slice(-500)))));
  });
}

async function uploadPublic(name, absFile, mime) {
  const up = await google.driveUpload(name, mime, fs.readFileSync(absFile));
  await google.ensurePublic(up.id).catch(() => {});
  return `https://drive.google.com/uc?export=download&id=${up.id}`;
}

/** Découpe le plan de visuels : on coupe sur le SENS, jamais sur l'horloge. */
function buildShots(words, audioDur) {
  const boundary = words.map((w) => {
    if (/[.!?]["»)]?$/.test(w.w)) return "phrase";
    if (/[,;:]$/.test(w.w)) return "virgule";
    return null;
  });
  const commas = words.filter((_, i) => boundary[i] === "virgule").map((w) => w.end);
  // Énumération = au moins 3 virgules dans une fenêtre de 6 s -> rafale autorisée
  const inBurst = (t) => commas.filter((c) => Math.abs(c - t) <= 3).length >= 3;

  const raw = [];
  let start = 0;
  for (let i = 0; i < words.length; i++) {
    const dur = words[i].end - words[start].t;
    const b = boundary[i];
    const last = i === words.length - 1;
    let cut = false;
    if (last) cut = true;
    else if (b === "phrase" && dur >= 2.0) cut = true;
    else if (b === "phrase" && dur >= 1.0 && inBurst(words[i].end)) cut = true;
    else if (b === "virgule" && dur >= SHOT_TARGET) cut = true;
    else if (b === "virgule" && dur >= BURST_MIN && inBurst(words[i].end)) cut = true;
    else if (dur >= SHOT_MAX) cut = true;
    if (!cut) continue;
    raw.push({ start: words[start].t, end: words[i].end, say: words.slice(start, i + 1).map((w) => w.w).join(" ") });
    start = i + 1;
  }

  // Refonte des plans trop courts hors rafale
  const merged = [];
  for (const s of raw) {
    const prev = merged[merged.length - 1];
    const d = s.end - s.start;
    if (prev && d < SHOT_MIN && !inBurst(s.start) && prev.end - prev.start + d <= SHOT_MAX) {
      prev.end = s.end;
      prev.say += " " + s.say;
    } else merged.push({ ...s });
  }

  // Plan STRICTEMENT JOINTIF : sinon les silences de respiration ne sont couverts par aucune image.
  merged[0].start = 0;
  for (let k = 0; k < merged.length - 1; k++) merged[k].end = merged[k + 1].start;
  merged[merged.length - 1].end = audioDur;

  return merged.map((s, k) => ({
    i: k + 1,
    start: +s.start.toFixed(2),
    end: +s.end.toFixed(2),
    dur: +(s.end - s.start).toFixed(2),
    say: s.say,
    scene: null, castIds: [], type: null, image: null,
  }));
}

async function stepVoice(run) {
  const dir = path.join(OUT_ROOT, run.id);
  ensureDir(dir);
  const p = run.params;
  const voice = `${p.voice} ${VOICE_SUFFIX[p.language] || "(en)"}`;

  // --- synthèse (par morceaux, l'API plafonne à 2000 caractères)
  const voFile = path.join(dir, "vo.mp3");
  if (!fs.existsSync(voFile)) {
    const parts = chunkText(run.script);
    log(run, `Voix off « ${voice} » : ${run.script.length} caractères en ${parts.length} morceau(x)…`);
    const files = [];
    for (let i = 0; i < parts.length; i++) {
      const r = await fal.run("fal-ai/inworld-tts", { text: parts[i], voice, sample_rate_hertz: 48000 }, { cancelled: () => cancelledRuns.has(run.id) });
      const url = r.audio?.url;
      if (!url) throw new Error("Inworld TTS : aucun audio renvoyé");
      const f = path.join(dir, `vo-part${i}.mp3`);
      await fal.download(url, f);
      files.push(f);
      await tasks.updateTask(run.taskId, { step: `Voix off : ${i + 1}/${parts.length}`, progress: 16 + Math.round((8 * (i + 1)) / parts.length) }).catch(() => {});
    }
    if (files.length === 1) fs.copyFileSync(files[0], voFile);
    else {
      const list = path.join(dir, "vo-concat.txt");
      fs.writeFileSync(list, files.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
      await runFfmpeg(["-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c:a", "libmp3lame", "-b:a", "192k", "-y", voFile]);
    }
    files.forEach((f) => { try { fs.unlinkSync(f); } catch {} });
    const cost = +((run.script.length / 1000) * PRICES.voicePer1kChars).toFixed(4);
    run.cost.voice = (run.cost.voice || 0) + cost;
    spend.record("FAL.ai", MACHINE_NAME, cost, "USD", `Inworld TTS (${run.script.length} car.)`);
  }

  run.voDuration = await ff.probeDuration(voFile, { label: "voix off" });
  run.voRel = `agent-os/output/machines/${run.id}/vo.mp3`;
  log(run, `Voix off : ${run.voDuration.toFixed(1)} s (${(run.voDuration / 60).toFixed(2)} min)`);
  saveRun(run);

  // --- transcript mot-à-mot (Whisper) : c'est lui qui cale les images sur le sens
  if (!run.words || !run.words.length) {
    const low = path.join(dir, "vo-low.mp3");
    await runFfmpeg(["-hide_banner", "-loglevel", "error", "-i", voFile, "-ac", "1", "-b:a", "64k", "-y", low]);
    const url = await uploadPublic(`${run.id}-vo.mp3`, low, "audio/mpeg");
    const res = await fal.run(
      "fal-ai/whisper",
      { audio_url: url, task: "transcribe", language: WHISPER_LANG[p.language] || "en", chunk_level: "word" },
      { timeoutMs: 10 * 60 * 1000, cancelled: () => cancelledRuns.has(run.id) }
    );
    const chunks = Array.isArray(res?.chunks) ? res.chunks : [];
    run.words = chunks
      .map((c) => ({ t: Number(c.timestamp?.[0] ?? c.start ?? 0), end: Number(c.timestamp?.[1] ?? c.end ?? 0), w: String(c.text || "").trim() }))
      .filter((c) => c.w && isFinite(c.t) && isFinite(c.end));
    if (run.words.length < 20) throw new Error("Whisper : transcript inexploitable");
    const wCost = +(run.voDuration * PRICES.whisperPerSec).toFixed(4);
    run.cost.voice = (run.cost.voice || 0) + wCost;
    spend.record("FAL.ai", MACHINE_NAME, wCost, "USD", `Whisper (${Math.round(run.voDuration)} s)`);
    try { fs.unlinkSync(low); } catch {}
  }

  // --- plan de visuels
  run.scenes = buildShots(run.words, run.voDuration);
  const d = run.scenes.map((s) => s.dur).sort((a, b) => a - b);
  run.shotStats = {
    count: run.scenes.length,
    perMin: +(run.scenes.length / (run.voDuration / 60)).toFixed(1),
    median: d[Math.floor(d.length / 2)],
    min: d[0], max: d[d.length - 1],
  };
  log(run, `Découpage : ${run.scenes.length} visuels — médiane ${run.shotStats.median} s, ${run.shotStats.perMin} plans/min (référence niche : 3,4 s / 17 plans/min)`);
  saveRun(run);
}

// ---------------------------------------------------------------- étape 3 : casting

async function stepCasting(run) {
  if (run.cast && run.cast.length) return;
  const plan = await cast.planCast({
    title: run.title,
    script: run.script,
    shots: run.scenes.map((s) => ({ i: s.i, say: s.say })),
  });
  log(run, `Plan de casting : ${plan.reuse.length} réutilisé(s), ${plan.create.length} à créer`);
  for (const r of plan.rejected || []) {
    log(run, `  ⤷ création refusée « ${r.name} » (${r.reason})${r.fallback ? ` → joué par ${r.fallback}` : ""}`);
  }
  const troupe = await cast.applyPlan(plan, { onLog: (m) => log(run, m) });

  // Les fiches ⭐ universelles (l'hôte) sont toujours disponibles au prompteur d'images.
  const byId = new Map(troupe.map((c) => [c.id, c]));
  for (const u of cast.universals()) if (!byId.has(u.id)) byId.set(u.id, u);

  run.cast = [...byId.values()].map((c) => ({ id: c.id, name: c.name, era: c.era, role: c.role, look: c.look, url: c.url, rel: c.rel }));
  run.cost.sheets = (run.cost.sheets || 0) + plan.create.length * PRICES.sheet;
  log(run, `Distribution : ${run.cast.map((c) => c.name).join(", ")}`);
  saveRun(run);
}

// ---------------------------------------------------------------- étape 4 : prompts d'images

const BATCH = 12;

async function stepPrompts(run) {
  const todo = run.scenes.filter((s) => !s.scene);
  if (!todo.length) return;
  const p = run.params;
  const roster = run.cast.map((c) => `- ${c.id} : ${c.name} (${c.era || "?"}) — ${c.look.slice(0, 160)}`).join("\n");

  // Répartition des types de plan mesurée sur la niche (1 428 images décrites).
  const mix = [
    "RÉPARTITION À RESPECTER SUR L'ENSEMBLE DE LA VIDÉO (mesurée sur la niche) :",
    "- ~60 % `scene` : une scène narrative, le récit se joue devant nous",
    `- ~${Math.round((config().settings.diagramShare ?? 20))} % \`diagram\` : schéma, coupe, barre de proportion, frise. DÈS QU'UN CHIFFRE, UNE DURÉE OU UNE PROPORTION EST PRONONCÉ, on le dessine.`,
    "- ~6 % `panels` : composition en 2 cases séparées par un trait noir épais (comparaison, avant/après)",
    "- ~6 % `closeup` : l'indice, la preuve, le détail",
    "- ~5 % `montage` : 1 à 3 objets isolés sur fond plat (énumération)",
    "- ~2 % `map` : carte plate, continents en aplat, points rouges",
  ].join("\n");

  const lots = [];
  for (let i = 0; i < todo.length; i += BATCH) lots.push(todo.slice(i, i + BATCH));

  let done = 0;
  const worker = async (lot) => {
    const j = await genJson(
      [
        "Tu écris les DESCRIPTIONS D'IMAGES d'un documentaire animé en stickman.",
        "Chaque description sera transformée en illustration par un modèle image-to-image.",
        "",
        coreRules(run),
        "",
        `SUJET : ${run.title}`,
        "",
        "DISTRIBUTION DISPONIBLE (n'utilise QUE ces identifiants) :",
        roster,
        "",
        mix,
        "",
        "RÈGLES ABSOLUES :",
        "1. `scene` est en ANGLAIS, 40 à 90 mots, concrète et dessinable : décor, position et action de chaque personnage,",
        "   lumière, cadrage. On doit pouvoir la dessiner sans rien inventer.",
        "2. Tu ne décris JAMAIS le corps d'un personnage (tête ronde, membres en traits) ni sa tenue : sa fiche s'en charge.",
        "   Tu l'appelles par son nom en majuscules (ex. THE PREHISTORIC MAN) et tu décris sa POSE, son ÉMOTION, son ACTION.",
        "3. `castIds` liste les identifiants présents, 0 à 3 maximum. Un schéma, une carte ou un montage d'objets a `castIds` vide",
        "   et sa description COMMENCE par « NO PEOPLE IN THIS SHOT AT ALL. ».",
        "4. AUCUN texte, chiffre ou étiquette dans l'image : les schémas sont muets (formes et couleurs seules).",
        "5. Les plans consécutifs doivent être VISUELLEMENT DIFFÉRENTS : change de décor, d'échelle ou d'angle.",
        "",
        "PLANS À DÉCRIRE (le texte est ce qui est dit PENDANT le plan) :",
        lot.map((s) => `${s.i}. [${s.dur}s] ${s.say}`).join("\n"),
        "",
        `RÉPONDS UNIQUEMENT EN JSON : {"shots":[{"i":${lot[0].i},"type":"scene","castIds":[],"scene":""}]}`,
      ].join("\n"),
      { ms: 8 * 60 * 1000, label: `Prompts d'images (plans ${lot[0].i}-${lot[lot.length - 1].i})` }
    );
    const known = new Set(run.cast.map((c) => c.id));
    for (const sh of j.shots || []) {
      const s = run.scenes.find((x) => x.i === Number(sh.i));
      if (!s || !sh.scene) continue;
      s.scene = String(sh.scene);
      s.type = sh.type || "scene";
      s.castIds = (sh.castIds || []).filter((id) => known.has(id)).slice(0, 3);
    }
    done += lot.length;
    await tasks.updateTask(run.taskId, { step: `Prompts d'images : ${Math.min(done, todo.length)}/${todo.length}`, progress: 34 + Math.round((10 * done) / todo.length) }).catch(() => {});
    saveRun(run);
  };

  await pool(lots, worker, 4);
  const missing = run.scenes.filter((s) => !s.scene);
  if (missing.length) throw new Error(`${missing.length} plan(s) sans description (plans ${missing.slice(0, 6).map((s) => s.i).join(", ")}) — relance l'étape.`);
  log(run, `Prompts d'images écrits pour ${run.scenes.length} plans`);
  saveRun(run);
}

// ---------------------------------------------------------------- étape 5 : images

function kieKey() {
  const k = vault.get("kie");
  if (!k) throw new Error("Clé Kie absente du coffre");
  return k;
}
const KIE_MODEL = { nano: "nano-banana-2-lite", seedream: "seedream/5-lite-image-to-image", gpt: "gpt-image-2-image-to-image" };
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
  while (true) {
    await new Promise((r) => setTimeout(r, 8000));
    if (runId && cancelledRuns.has(runId)) throw new Error("Annulée par l'utilisateur");
    if (Date.now() - t0 > timeoutMs) throw new Error("Kie : délai dépassé");
    const r = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, { headers: { Authorization: `Bearer ${kieKey()}` } }).then((x) => x.json());
    if (r.data?.state === "success") return JSON.parse(r.data.resultJson).resultUrls[0];
    if (r.data?.state === "fail") throw new Error(`Kie : ${r.data?.failMsg || "génération échouée"}`);
  }
}
async function download(url, file) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Téléchargement image ${resp.status}`);
  fs.writeFileSync(file, Buffer.from(await resp.arrayBuffer()));
}

/** Le prompt d'un plan : style + fiches des personnages présents + scène + garde-fous. */
function buildImagePrompt(run, scene) {
  const byId = new Map(run.cast.map((c) => [c.id, c]));
  const present = (scene.castIds || []).map((id) => byId.get(id)).filter(Boolean);
  const hostIds = new Set(run.cast.filter((c) => /narrateur|host|hôte/i.test(c.role || c.name)).map((c) => c.id));

  const castBlock = present.length
    ? `CHARACTER REFERENCES — ${present.length} character sheet${present.length > 1 ? "s are" : " is"} attached, in this order:\n` +
      present.map((c, n) => `  [${n + 1}] ${c.name.toUpperCase()} — ${c.look}`).join("\n") +
      `\nDraw each of these characters EXACTLY as their sheet shows them: same clothing, same hair, same accessories, same colours, same proportions. ` +
      `They keep their own outfit in every pose and from every angle. ` +
      `Any ADDITIONAL background people must be dressed in the same world as these characters — never in another era's clothing.`
    : `NO CHARACTER SHEET APPLIES HERE. The attached image is a blank neutral stickman provided ONLY as a style guide for line weight, head shape and colour. This shot contains no people at all.`;

  // Le garde-fou qui a réglé le défaut n°1 de la niche : sans lui le modèle rhabille tout
  // le monde avec la tenue de la référence.
  const guard = present.some((c) => hostIds.has(c.id))
    ? ""
    : "CRITICAL: nobody in this shot wears the modern narrator's outfit. The modern host character does NOT appear here.";

  return `${IMG_STYLE}\n\n${castBlock}\n\nSCENE TO DRAW: ${scene.scene}\n\n${guard}\n\n${IMG_NEG}`;
}

async function generateImage(run, scene) {
  const dir = path.join(OUT_ROOT, run.id, "img");
  ensureDir(dir);
  const file = path.join(dir, String(scene.i).padStart(3, "0") + ".png");
  const tool = config().settings.imageModel || "nano";
  const model = KIE_MODEL[tool] || KIE_MODEL.nano;
  const field = KIE_IMGFIELD[tool] || "image_urls";

  const byId = new Map(run.cast.map((c) => [c.id, c]));
  const urls = (scene.castIds || []).map((id) => byId.get(id)?.url).filter(Boolean);
  const refs = urls.length ? urls : [(await cast.ensureNeutral()).url];

  const input = { prompt: buildImagePrompt(run, scene), aspect_ratio: "16:9" };
  input[field] = refs.slice(0, 8);

  const url = await kiePoll(await kieCreate(model, input), run.id);
  await download(url, file);
  scene.image = { rel: `agent-os/output/machines/${run.id}/img/${String(scene.i).padStart(3, "0")}.png`, file, ts: Date.now() };
  delete scene.error;
  run.cost.images = (run.cost.images || 0) + PRICES.image;
  spend.record("Kie.ai", MACHINE_NAME, PRICES.image, "USD", `Image plan ${scene.i}`);
  saveRun(run);
}

// ---------------------------------------------------------------- étape 6 : montage

function srtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const p2 = (n, k = 2) => String(n).padStart(k, "0");
  return `${p2(Math.floor(ms / 3600000))}:${p2(Math.floor((ms % 3600000) / 60000))}:${p2(Math.floor((ms % 60000) / 1000))},${p2(ms % 1000, 3)}`;
}

function buildSrt(run, dir) {
  const MAXW = 8, MAXD = 3.2;
  const lines = [];
  let cur = [];
  const w = run.words;
  for (let i = 0; i < w.length; i++) {
    cur.push(w[i]);
    const dur = w[i].end - cur[0].t;
    const endsSentence = /[.!?]["»)]?$/.test(w[i].w);
    const endsClause = /[,;:]$/.test(w[i].w);
    if (i === w.length - 1 || endsSentence || cur.length >= MAXW || dur >= MAXD || (endsClause && cur.length >= 5)) {
      lines.push({ start: cur[0].t, end: w[i].end, text: cur.map((x) => x.w).join(" ").replace(/\s+([,.!?;:])/g, "$1") });
      cur = [];
    }
  }
  for (let i = 0; i < lines.length - 1; i++) if (lines[i + 1].start - lines[i].end < 0.25) lines[i].end = lines[i + 1].start - 0.02;
  const srt = lines.map((l, i) => `${i + 1}\n${srtTime(l.start)} --> ${srtTime(l.end)}\n${l.text}\n`).join("\n");
  fs.writeFileSync(path.join(dir, "subs.srt"), srt, "utf8");
  return lines.length;
}

/** Bouton d'abonnement animé : Remotion rend une SÉQUENCE PNG (l'encodage vidéo écrase l'alpha). */
function renderCtaClip(run, labels) {
  return new Promise((resolve, reject) => {
    const rel = `cta-${run.id}`;
    fs.writeFileSync(path.join(REMOTION_DIR, rel + ".json"), JSON.stringify({ label: labels.label, labelDone: labels.done, channel: run.params.channelName || "Stickman Explains" }));
    const child = spawn("npx", ["remotion", "render", "StickmanCta", rel, "--sequence", "--image-format=png", `--props=${rel}.json`], { cwd: REMOTION_DIR, shell: true, windowsHide: true });
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
  const c = config();

  // 1) un clip par plan, léger mouvement d'appareil alterné (la niche est quasi statique)
  const ready = run.scenes.filter((s) => s.image);
  if (!ready.length) throw new Error("Aucune image à monter");
  for (const s of ready) {
    const out = path.join(clips, String(s.i).padStart(3, "0") + ".mp4");
    if (fs.existsSync(out) && fs.statSync(out).size > 5000) continue;
    const frames = Math.max(2, Math.round(s.dur * FPS));
    const amp = Math.min(0.06, 0.012 * s.dur);
    const z = s.i % 2 ? `1+${amp.toFixed(4)}*on/${frames}` : `${(1 + amp).toFixed(4)}-${amp.toFixed(4)}*on/${frames}`;
    await runFfmpeg([
      "-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i", s.image.file,
      "-vf",
        `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},` +
        `zoompan=z='${z}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${W}x${H}:fps=${FPS},format=yuv420p`,
      "-frames:v", String(frames), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", String(FPS), out,
    ]);
  }
  log(run, `${ready.length} clips rendus`);

  // 2) concaténation
  const list = path.join(dir, "clips.txt");
  fs.writeFileSync(list, ready.map((s) => `file 'clips/${String(s.i).padStart(3, "0")}.mp4'`).join("\n"));
  const mute = path.join(dir, "video-mute.mp4");
  await runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", "clips.txt", "-c", "copy", "video-mute.mp4"], dir);

  // 3) CTA animé (best-effort : un échec Remotion ne doit pas tuer le montage)
  const every = Math.max(1, Number(c.settings.ctaEveryMin) || 2) * 60;
  const starts = [];
  for (let t = Math.min(35, run.voDuration / 6); t < run.voDuration - 8; t += every) starts.push(+t.toFixed(2));
  let ctaSeq = null;
  if (starts.length) {
    try {
      log(run, `Rendu du bouton d'abonnement (Remotion) — ${starts.length} apparition(s)…`);
      ctaSeq = await renderCtaClip(run, CTA_TEXT[run.params.language] || CTA_TEXT.English);
    } catch (e) {
      log(run, "CTA indisponible (" + String(e.message).slice(0, 90) + ") — montage sans bouton");
    }
  }

  // 4) sous-titres + incrustation, en une passe
  const subsOn = run.params.subtitles !== false;
  if (subsOn) log(run, `Sous-titres : ${buildSrt(run, dir)} lignes`);

  const inputs = ["-i", "video-mute.mp4", "-i", "vo.mp3"];
  let filter = "";
  let curLabel = "[0:v]";
  if (subsOn) {
    // cwd = dossier du run : évite l'échappement Windows du « : » dans les chemins
    filter += `[0:v]subtitles=subs.srt:force_style='FontName=Arial,FontSize=13,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00101010,BorderStyle=1,Outline=1,Shadow=0,Alignment=2,MarginV=12'[sub]`;
    curLabel = "[sub]";
  }
  if (ctaSeq) {
    inputs.push("-framerate", String(FPS), "-start_number", "0", "-i", path.join(ctaSeq, "element-%03d.png"));
    filter += `${filter ? ";" : ""}[2:v]format=rgba,split=${starts.length}${starts.map((_, k) => `[k${k}]`).join("")}`;
    starts.forEach((S, k) => (filter += `;[k${k}]setpts=PTS+${S}/TB[c${k}]`));
    starts.forEach((S, k) => {
      const nl = k === starts.length - 1 ? "[vout]" : `[o${k}]`;
      filter += `;${curLabel}[c${k}]overlay=0:0:eof_action=pass:enable='between(t,${S},${S + 5})'${nl}`;
      curLabel = nl;
    });
  }

  await runFfmpeg([
    "-hide_banner", "-loglevel", "error", "-y", ...inputs,
    ...(filter ? ["-filter_complex", filter] : []),
    "-map", curLabel === "[0:v]" ? "0:v" : curLabel, "-map", "1:a",
    "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", "final.mp4",
  ], dir);

  try {
    if (ctaSeq) fs.rmSync(ctaSeq, { recursive: true, force: true });
    fs.unlinkSync(path.join(REMOTION_DIR, `cta-${run.id}.json`));
    fs.rmSync(clips, { recursive: true, force: true });
    fs.unlinkSync(mute);
  } catch {}
  return path.join(dir, "final.mp4");
}

// ---------------------------------------------------------------- étape 7 : packaging

function capTags(tags, max = 500) {
  const out = [];
  let len = 0;
  for (const t of tags) {
    const s = String(t).trim();
    if (!s) continue;
    const add = s.length + (s.includes(" ") ? 2 : 0) + (out.length ? 1 : 0);
    if (len + add > max) break;
    out.push(s);
    len += add;
  }
  return out;
}

async function generatePackaging(run) {
  const c = config();
  const inspiration = c.nicheId ? (() => { try { return bank.inspiration(c.nicheId, { maxTitles: 15, maxVisions: 0 }); } catch { return ""; } })() : "";
  const j = await genJson(
    [
      "Tu prépares la PUBLICATION YouTube d'un documentaire animé en stickman.",
      `LANGUE DE LA CHAÎNE (titre, description, tags) : ${c.settings.chainLanguage}.`,
      "",
      `TITRE DE TRAVAIL : ${run.title}`,
      `ANGLE : ${run.angle}`,
      "SCRIPT (extrait) :", run.script.slice(0, 3500),
      "",
      inspiration ? "CE QUI PERFORME DANS LA NICHE :\n" + inspiration : "",
      "",
      "CONTRAINTES :",
      "- `title` : formule de la niche — [mot interrogatif] + sujet + chose intime du quotidien + « ? ». 50-85 caractères.",
      "- `description` : 5 à 7 paragraphes. §1 reformule la question. §2-5 racontent les preuves concrètes (sites, études, chiffres).",
      "  Avant-dernier § : « Watch until the end to… ». Dernier § : une question aux spectateurs. Puis une ligne de 6-8 hashtags.",
      "- `tags` : 18 à 24 mots-clés, du plus précis au plus large.",
      "- `thumbPrompt` : en ANGLAIS, la MINIATURE. Codes relevés sur les 7 chaînes : dessin PLUS détaillé et PLUS saturé",
      "  que la vidéo, UN personnage au premier plan avec un visage très expressif (grands yeux, sourcils marqués),",
      "  décalé sur la DROITE, la moitié gauche restant simple pour accueillir le titre. Scène continue, sans panneau ni séparation.",
      "  Termine par : « Absolutely no text, no letters, no words, no numbers anywhere in the image. »",
      "- `thumbText1` et `thumbText2` : le titre de la miniature en 2 lignes TRÈS courtes (1-3 mots chacune), en capitales,",
      "  la 2e se terminant par « ? ». Il doit COMPLÉTER le titre, pas le répéter : le titre pose la question, la miniature",
      "  assène la réponse contre-intuitive.",
      "",
      'RÉPONDS UNIQUEMENT EN JSON : {"title":"","description":"","tags":[],"thumbPrompt":"","thumbText1":"","thumbText2":""}',
    ].filter(Boolean).join("\n"),
    { ms: 8 * 60 * 1000, label: "Packaging" }
  );
  run.pack = {
    title: String(j.title || run.title).slice(0, 100),
    description: String(j.description || ""),
    tags: capTags(j.tags || []),
    thumbText1: String(j.thumbText1 || "").toUpperCase(),
    thumbText2: String(j.thumbText2 || "").toUpperCase(),
  };
  saveRun(run);
  await generateThumbnail(run, j.thumbPrompt);
  log(run, `Packaging prêt : « ${run.pack.title} »`);
  saveRun(run);
}

async function generateThumbnail(run, thumbPrompt) {
  const dir = path.join(OUT_ROOT, run.id);
  const art = path.join(dir, "thumb-art.png");
  const url = await kiePoll(await kieCreate("nano-banana-2-lite", { prompt: thumbPrompt, aspect_ratio: "16:9" }), run.id);
  await download(url, art);
  run.cost.images = (run.cost.images || 0) + PRICES.image;
  spend.record("Kie.ai", MACHINE_NAME, PRICES.image, "USD", "Miniature");

  // La typo est composée au pixel près : les modèles image écrivent mal.
  const esc = (s) => String(s).replace(/'/g, "").replace(/:/g, "\\:").slice(0, 22);
  const draw = (t, y, size) =>
    `drawtext=fontfile='C\\:/Windows/Fonts/impact.ttf':text='${esc(t)}':fontcolor=0xFFE100:fontsize=${size}:borderw=14:bordercolor=black:x=70:y=${y}`;
  const parts = [`scale=1280:720`];
  if (run.pack.thumbText1) parts.push(draw(run.pack.thumbText1, 90, 132));
  if (run.pack.thumbText2) parts.push(draw(run.pack.thumbText2, 235, 172));
  await runFfmpeg(["-hide_banner", "-loglevel", "error", "-y", "-i", art, "-vf", parts.join(","), path.join(dir, "thumbnail.png")]);
  run.pack.thumbRel = `agent-os/output/machines/${run.id}/thumbnail.png`;
  run.pack.thumbTs = Date.now();
  saveRun(run);
}

async function regenThumbnail(runId, instructions) {
  const run = getRun(runId);
  const j = await genJson(
    [
      "Réécris le PROMPT de miniature YouTube d'un documentaire animé en stickman.",
      `Vidéo : ${run.pack?.title || run.title}`,
      instructions ? `Consigne de l'utilisateur : ${instructions}` : "",
      "Codes de la niche : dessin plus détaillé et plus saturé que la vidéo, UN personnage très expressif décalé à droite,",
      "moitié gauche simple pour le titre, scène continue sans panneau. Termine par l'interdiction de tout texte dans l'image.",
      'RÉPONDS UNIQUEMENT EN JSON : {"thumbPrompt":"","thumbText1":"","thumbText2":""}',
    ].filter(Boolean).join("\n"),
    { ms: 5 * 60 * 1000, label: "Miniature" }
  );
  if (j.thumbText1) run.pack.thumbText1 = String(j.thumbText1).toUpperCase();
  if (j.thumbText2) run.pack.thumbText2 = String(j.thumbText2).toUpperCase();
  saveRun(run);
  await generateThumbnail(run, j.thumbPrompt);
  return getRun(runId);
}

async function regenTexts(runId, instructions, field) {
  const run = getRun(runId);
  const c = config();
  const want = field === "all" ? ["title", "description", "tags"] : [field];
  const j = await genJson(
    [
      `Réécris ${want.join(", ")} pour une vidéo YouTube de documentaire animé en stickman.`,
      `Langue : ${c.settings.chainLanguage}.`,
      `Titre actuel : ${run.pack?.title}`,
      `Sujet : ${run.angle || run.title}`,
      instructions ? `Consigne : ${instructions}` : "",
      "Formule de titre de la niche : [mot interrogatif] + sujet + chose intime du quotidien + « ? », 50-85 caractères.",
      `RÉPONDS UNIQUEMENT EN JSON avec seulement ces clés : ${want.map((f) => `"${f}"`).join(", ")}`,
    ].filter(Boolean).join("\n"),
    { ms: 5 * 60 * 1000, label: "Textes" }
  );
  if (j.title) run.pack.title = String(j.title).slice(0, 100);
  if (j.description) run.pack.description = String(j.description);
  if (j.tags) run.pack.tags = capTags(j.tags);
  saveRun(run);
  return getRun(runId);
}

// ---------------------------------------------------------------- stock + publication

function stock() {
  return readJSON(`machines/${MACHINE_ID}-stock.json`, []);
}
function patchStock(entryId, patch = {}) {
  const s = stock();
  const e = s.find((x) => x.id === entryId);
  if (!e) throw new Error("Entrée de stock introuvable");
  for (const k of ["archived", "posted"]) if (patch[k] !== undefined) e[k] = !!patch[k];
  writeJSON(`machines/${MACHINE_ID}-stock.json`, s);
  return e;
}
function addToStock(run) {
  const s = stock();
  if (s.some((x) => x.id === run.id)) return;
  s.unshift({
    id: run.id,
    title: run.pack?.title || run.title,
    description: run.pack?.description || "",
    tags: run.pack?.tags || [],
    finalRel: run.finalRel,
    thumbRel: run.pack?.thumbRel || null,
    durationSec: run.voDuration,
    shots: (run.scenes || []).length,
    cost: run.cost,
    createdAt: new Date().toISOString(),
    posted: false,
    archived: false,
  });
  writeJSON(`machines/${MACHINE_ID}-stock.json`, s);
}

async function publishRun(runId, { channelId, title, description, tags, privacyStatus } = {}) {
  const run = getRun(runId);
  if (!run.finalRel) throw new Error("Pas de vidéo à publier");
  const file = path.join(ROOT, run.finalRel);
  const thumb = run.pack?.thumbRel ? path.join(ROOT, run.pack.thumbRel) : null;
  const res = await google.youtubeUpload({
    channelId: channelId || run.params.publishChannelId,
    file,
    title: title || run.pack?.title || run.title,
    description: description || run.pack?.description || "",
    tags: tags || run.pack?.tags || [],
    privacyStatus: privacyStatus || config().settings.publishPrivacy || "private",
    thumbnail: thumb && fs.existsSync(thumb) ? thumb : null,
  });
  run.published = { videoId: res.id, url: `https://youtu.be/${res.id}`, at: new Date().toISOString(), privacyStatus: privacyStatus || config().settings.publishPrivacy };
  saveRun(run);
  try { patchStock(run.id, { posted: true }); } catch {}
  return run.published;
}

// ---------------------------------------------------------------- concurrence

async function pool(items, worker, concurrency = 6) {
  const q = items.slice();
  let err = null;
  const run1 = async () => {
    while (q.length) {
      const it = q.shift();
      try { await worker(it); } catch (e) { err = err || e; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run1));
  if (err) throw err;
}

const cancelledRuns = new Set();

async function genWithRetry(run, scene, kind) {
  scene.rendering = true;
  saveRun(run);
  try {
    for (let a = 1; a <= MAX_TRIES; a++) {
      if (cancelledRuns.has(run.id)) throw new Error("Annulée par l'utilisateur");
      try {
        if (kind === "image") await generateImage(run, scene);
        return;
      } catch (e) {
        scene.error = e.message;
        saveRun(run);
        if (a === MAX_TRIES) return;
        await new Promise((r) => setTimeout(r, 4000 * a));
      }
    }
  } finally {
    delete scene.rendering;
    saveRun(run);
  }
}

async function stepImages(run) {
  const total = run.scenes.length;
  const tick = () => {
    const done = run.scenes.filter((s) => s.image).length;
    const live = run.scenes.filter((s) => s.rendering).length;
    tasks.updateTask(run.taskId, { step: `Images : ${done}/${total} · ${live} en cours…`, progress: 46 + Math.round((32 * done) / total), status: "running" }).catch(() => {});
  };
  const pend = run.scenes.filter((s) => !s.image);
  if (pend.length) {
    tick();
    log(run, `Génération des images : ${pend.length} plan(s), ${IMG_CONCURRENCY} en parallèle…`);
    await pool(pend, (s) => genWithRetry(run, s, "image").then(tick), IMG_CONCURRENCY);
  }
  // Deuxième vague : un échec en masse est presque toujours transitoire.
  let missing = run.scenes.filter((s) => !s.image);
  if (missing.length) {
    log(run, `⚠ ${missing.length} image(s) manquante(s) — pause de 20 s puis deuxième vague…`);
    await new Promise((r) => setTimeout(r, 20000));
    if (cancelledRuns.has(run.id)) throw new Error("Annulée par l'utilisateur");
    await pool(missing, (s) => genWithRetry(run, s, "image").then(tick), IMG_CONCURRENCY);
    missing = run.scenes.filter((s) => !s.image);
  }
  if (missing.length) {
    const why = (missing.find((s) => s.error) || {}).error || "cause inconnue";
    const msg = `${missing.length}/${total} image(s) manquante(s) (plans ${missing.slice(0, 8).map((s) => s.i).join(", ")}) — ${why}`;
    if (run.mode === "auto") throw new Error(`${msg}. Étape non franchie.`);
    log(run, `⚠ ${msg} — régénère-les (↻) avant de valider.`);
  }
}

// ---------------------------------------------------------------- machine à états

const activeAdvance = new Set();

function promptsComplete(run) {
  return !!run.script && !!run.scenes?.length && run.scenes.every((s) => s.scene);
}
function deriveStatus(run) {
  if (!run.script) return "script_running";
  if (!run.scenes?.length || !run.words?.length) return "voice_running";
  if (!run.cast?.length) return "casting_running";
  if (!promptsComplete(run)) return "prompts_running";
  if (run.scenes.some((s) => !s.image)) return "images_running";
  if (!run.finalRel) return "montage_running";
  if (!run.pack) return "packaging_running";
  return "done";
}
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

const STEPS = [
  ["script", "Écriture du script (Claude)…", 8, stepScript],
  ["voice", "Voix off + transcript + découpage…", 16, stepVoice],
  ["casting", "Casting : distribution des personnages…", 30, stepCasting],
  ["prompts", "Écriture des prompts d'images…", 36, stepPrompts],
  ["images", "Génération des images…", 46, stepImages],
];

async function advance(runId) {
  cancelledRuns.delete(runId);
  activeAdvance.add(runId);
  const run = getRun(runId);
  const auto = run.mode === "auto";
  const t = (patch) => tasks.updateTask(run.taskId, Object.assign({ status: "running" }, patch)).catch(() => {});
  try {
    await ff.ensureTools(); // préflight : ne jamais dépenser si les outils locaux manquent
    while (true) {
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
          } catch (e) {
            log(run, "⚠ Publication échouée : " + e.message);
          }
        }
      } else break; // *_ready ou done : on rend la main
      saveRun(run);
      if (run.status === "done") {
        await tasks.updateTask(run.taskId, { step: `Terminée — ${(run.scenes || []).length} plans, ${(run.voDuration / 60).toFixed(1)} min`, progress: 100, status: "done" }).catch(() => {});
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

function createRun(params = {}) {
  const c = config();
  const id = "s" + Date.now().toString(36);
  const durationMin = Math.max(1, Math.min(30, Number(params.durationMin) || 5));
  const language = params.language || "English";
  const run = {
    id,
    machineId: MACHINE_ID,
    title: params.subject || "Sans titre",
    status: "script_running",
    mode: params.mode === "auto" ? "auto" : "semi",
    createdAt: new Date().toISOString(),
    params: {
      subject: String(params.subject || "").trim(),
      characters: String(params.characters || "").trim(),
      durationMin,
      language,
      voice: params.voice || (VOICES[language] || VOICES.English)[0],
      subtitles: params.subtitles !== false,
      publishChannelId: params.publishChannelId || null,
      channelName: params.channelName || "Stickman Explains",
    },
    cost: { voice: 0, images: 0, sheets: 0 },
    scenes: [],
    logs: [],
  };
  const est = estimate(run.params);
  run.estimate = est;
  const task = tasks.createTask({
    title: `Stickman — ${run.params.subject.slice(0, 60) || "vidéo"}`,
    desc: `${durationMin} min · ~${est.shots} visuels · ~${est.total.toFixed(2)} $`,
    machine: MACHINE_NAME,
    machineId: MACHINE_ID,
    runId: id,
    kind: "video",
    step: "Démarrage…",
    progress: 2,
    status: "running",
  });
  run.taskId = task.id;
  saveRun(run);
  advance(id);
  return run;
}

/** Devis affiché avant de lancer (le prix seul, en gros, à côté de Générer). */
function estimate(p) {
  const words = Math.round((p.durationMin || 5) * WPM);
  const chars = Math.round(words * 5.7);
  const shots = Math.round(((p.durationMin || 5) * 60) / SHOT_TARGET);
  const images = (shots + 1) * PRICES.image; // +1 miniature
  const voice = (chars / 1000) * PRICES.voicePer1kChars + p.durationMin * 60 * PRICES.whisperPerSec;
  const sheets = 3 * PRICES.sheet; // estimation prudente de nouveaux personnages
  return { words, shots, images: +images.toFixed(2), voice: +voice.toFixed(3), sheets: +sheets.toFixed(2), total: +(images + voice + sheets).toFixed(2) };
}

function validate(runId) {
  const run = getRun(runId);
  if (!run.status.endsWith("_ready")) throw new Error("Rien à valider à cette étape.");
  const stuck = (run.scenes || []).filter((s) => s.pending || s.rendering);
  if (stuck.length) throw new Error(`${stuck.length} plan(s) en cours de régénération — attends la fin.`);
  if (run.status === "images_ready") {
    const miss = run.scenes.filter((s) => !s.image);
    if (miss.length) throw new Error(`${miss.length} image(s) manquante(s) — régénère-les avant de valider.`);
  }
  const order = ["script", "voice", "casting", "prompts", "images"];
  const cur = run.status.replace("_ready", "");
  const idx = order.indexOf(cur);
  run.status = idx + 1 < order.length ? order[idx + 1] + "_running" : "montage_running";
  saveRun(run);
  advance(runId);
  return getRun(runId);
}

// ---------------------------------------------------------------- régénération d'un plan

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
  const run = getLiveRun(runId);
  try {
    const scene = run.scenes.find((s) => s.i === Number(sceneI));
    if (!scene) throw new Error("Plan introuvable");
    if (scene.pending) throw new Error("Ce plan est déjà en cours de régénération");
    scene.pending = true;
    saveRun(run);
    try {
      if (instructions) {
        const j = await genJson(
          [
            "Réécris la DESCRIPTION D'IMAGE d'un plan de documentaire animé en stickman.",
            `Ce qui est dit pendant le plan : « ${scene.say} »`,
            `Description actuelle : ${scene.scene}`,
            `Consigne de l'utilisateur : ${instructions}`,
            "Description en ANGLAIS, 40-90 mots. Ne décris jamais le corps ni la tenue des personnages (leur fiche s'en charge) :",
            "tu les appelles par leur nom en majuscules et tu décris pose, émotion, action. Aucun texte dans l'image.",
            'RÉPONDS UNIQUEMENT EN JSON : {"scene":""}',
          ].join("\n"),
          { ms: 4 * 60 * 1000, label: "Réécriture du plan" }
        );
        if (j.scene) scene.scene = String(j.scene);
      }
      const old = scene.image;
      scene.image = null;
      try {
        await generateImage(run, scene);
      } catch (e) {
        scene.image = old; // non destructif : on ne perd l'ancienne image qu'en cas de succès
        throw e;
      }
    } finally {
      delete scene.pending;
      saveRun(run);
    }
    return getRun(runId);
  } finally {
    releaseLiveRun(runId);
  }
}

// ---------------------------------------------------------------- idées

function producedThemes() {
  const out = listRuns().map((r) => r.title);
  for (const s of stock()) out.push(s.title);
  return [...new Set(out)].slice(0, 60);
}

async function suggestTheme() {
  const c = config();
  const inspiration = c.nicheId ? (() => { try { return bank.inspiration(c.nicheId, { maxTitles: 25, maxVisions: 0 }); } catch { return ""; } })() : "";
  const done = producedThemes();
  const j = await genJson(
    [
      "Propose UN sujet de vidéo pour une chaîne de documentaires animés en stickman.",
      "",
      "CE QUI FAIT DÉCOLLER UN SUJET DANS CETTE NICHE (mesuré sur 66 vidéos concurrentes) :",
      "- universalité corporelle : tout le monde dort, mange, transpire — le spectateur est concerné avant la 1re phrase",
      "- tabou léger ou dégoût maîtrisé : hygiène, sexualité, mort",
      "- une vraie réponse scientifique existe : archéologie, chasseurs-cueilleurs actuels, paléo-anthropologie",
      "- un mythe à casser : la vidéo doit contredire une intuition",
      "",
      inspiration ? "CE QUE FONT LES CONCURRENTS :\n" + inspiration : "",
      "",
      done.length ? "DÉJÀ PRODUIT — n'en propose NI un doublon NI une variante proche :\n" + done.map((t) => "- " + t).join("\n") : "",
      "",
      'RÉPONDS UNIQUEMENT EN JSON : {"subject":"le sujet en une phrase française","title":"le titre YouTube en anglais","myth":"le mythe démonté, en français"}',
    ].filter(Boolean).join("\n"),
    { ms: 5 * 60 * 1000, label: "Idée" }
  );
  return j;
}

// ---------------------------------------------------------------- maintenance

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
  for (const r of listRuns()) {
    if (!r.status?.endsWith("_running")) continue;
    try {
      const run = getRun(r.id);
      run.status = "failed";
      run.error = "Interrompue par un redémarrage du serveur";
      (run.scenes || []).forEach((s) => { delete s.rendering; delete s.pending; });
      saveRun(run);
    } catch {}
  }
  backfillStock();
}

/** Runs marqués en cours mais sans advance() en mémoire — le cron Telegram propose de les reprendre. */
function strandedRuns() {
  return listRuns().filter((r) => r.status?.endsWith("_running") && !activeAdvance.has(r.id));
}

module.exports = {
  MACHINE_ID, MACHINE_NAME, VOICES, WPM, PRICES,
  config, patchConfig,
  listRuns, getRun, createRun, validate, cancelRun, resumeRun, advance, estimate,
  regenScene, suggestTheme, producedThemes,
  regenThumbnail, regenTexts,
  stock, patchStock, publishRun,
  sweepRuns, strandedRuns,
  cast,
};
