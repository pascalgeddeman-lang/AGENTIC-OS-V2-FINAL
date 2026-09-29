/**
 * MACHINE « CRIME » — true crime francophone, chaîne « Au creux de la nuit ».
 * Pipeline : Script → Voix → Intro avatar → Plans → Images → Montage → Packaging
 *
 * ⚠ Pipeline SCRIPT-FIRST (modèle Stickman #4), pas scene-first : en narration documentaire
 * le découpage des plans se DÉDUIT de la voix off, il ne la précède pas.
 *
 * Recette dérivée de la banque « Crime » (Axel 5 130 ab. / 116 k vues, Nuits de Crime 1 360 /
 * 49 k) — voir docs/niche-truecrime.md. Mesures qui commandent tout :
 *  - TITRE = AMORCE, jamais le nom de l'affaire. Nommer l'affaire, c'est jouer sur la RECHERCHE
 *    et affronter des chaînes à 1-2 M d'abonnés. Raconter une amorce, c'est jouer sur la
 *    RECOMMANDATION, où la taille ne pénalise pas. Axel fait 116 k avec 5 k abonnés sur une
 *    affaire inconnue.
 *  - AFFAIRES INTERNATIONALES autant que françaises : les géants traitent le terrain français.
 *  - AUCUN VISAGE RÉEL généré. Illustrations stylisées uniquement (les concurrents utilisent des
 *    photos de presse, ce qu'une machine ne peut ni ne doit reproduire).
 *  - Voix KAEL uniquement, 165 mots/min mesurés, écart 3 % — aucun atempo nécessaire.
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { DATA_DIR, ensureDir, readJSON, writeJSON } = require("../store");
const claude = require("../claude");
const vault = require("../vault");
const google = require("../google");
const spend = require("../spend");
const tasks = require("../tasks");
const fal = require("../fal");
const ff = require("../ffmpeg");
const bank = require("../bank");
const voices = require("../voices");
const music = require("../music");
const heygen = require("../heygen");
const intro = require("../intro");

const MACHINE_ID = "crime";
const MACHINE_NAME = "Crime";
const ROOT = path.join(__dirname, "..", "..", "..");
const OUT_ROOT = path.join(__dirname, "..", "..", "output", "machines");
const REMOTION_DIR = path.join(ROOT, "remotion");
const RUNS_DIR = path.join(DATA_DIR, "machines", "runs", MACHINE_ID);
ensureDir(RUNS_DIR);

const PRICES = { image: 0.03, voicePer1kChars: 0.10, whisperPerSec: 0.0008 };

/** Mesuré sur la niche : Axel 197, Nuits de Crime 169. Kael sort à 165 — on ne la force pas. */
const WPM = 165;

/** Amplitude du Ken Burns, étalée sur toute la durée du plan (jamais un pas fixe). */
const KEN_AMP = 0.14;
/**
 * Largeur de travail du Ken Burns. ⚠ `zoompan` calcule l'origine du recadrage en pixels
 * ENTIERS : à 2560 px, l'origine n'avançait que d'un demi-pixel par image, restait figée une
 * image puis sautait — d'où un tremblement saccadé, perçu au visionnage et confirmé par la
 * mesure (PSNR entre images consécutives : écart-type 3,01 dB au lieu d'une valeur stable).
 * Mesuré sur un plan réel : 2560 → 3,01 dB · 3840 → 2,25 · 5120 → 1,36 · 7680 → 1,87 (la
 * source ne fait que ~1670 px, au-delà l'interpolation ajoute plus de bruit qu'elle n'enlève
 * de saccade). 5120 coûte 0,2 s de plus par plan, soit ~20 s sur une vidéo entière.
 */
const KEN_UPSCALE = 5120;
/** Part de la marge consommée par la dérive latérale, en style « gauche ». */
const KEN_DRIFT = 0.7;
/** Taille du logo permanent en haut à gauche (sur 1280 de large). Agrandi sur retour utilisateur. */
const LOGO_PX = 95;
/** Durée de l'animation du CTA et instant de son « clic » (voir la composition Remotion). */
const CTA_SEC = 5;
const CTA_CLICK_SEC = 2;
/** Mots par illustration. Bouddhisme avait mesuré 25 ; la narration documentaire coupe plus
 *  lentement. 30 = ~11 s par image. À MESURER sur les vidéos sources (planches contact). */
const WORDS_PER_IMAGE = 30;
const INTRO_MAX_SEC = 60;          // plafond dur du plan HeyGen
const INTRO_MAX_WORDS = 160;       // 60 s à 165 mots/min, avec marge
const INTRO_MIN_WORDS = 130;       // en dessous, le plan avatar est trop court (vécu : 8 s)

/** Direction artistique des plans — jamais de visage identifiable. */
const ART =
  "Dark cinematic true-crime still, desaturated sepia and cold grey palette, deep blacks, heavy film grain, " +
  "volumetric haze, single hard light source, high contrast, unsettling documentary mood, 16:9 widescreen";
const NEG =
  "No identifiable human face, no recognisable person, no portrait of a real individual, no celebrity, " +
  "no text, no letters, no subtitles, no watermark, no logo, no brand, no distorted hands";

/**
 * ⚠ Le PORTRAIT de miniature ne peut PAS hériter de `ART` ni de `NEG` :
 *   - `NEG` interdit explicitement tout visage (« no identifiable human face, no portrait ») —
 *     c'est juste pour les plans du film, absurde pour un portrait ;
 *   - `ART` impose « deep blacks, single hard light source », ce qui plonge le visage dans
 *     l'ombre alors qu'on le veut lisible.
 * Résultat constaté au premier run : une silhouette de dos, dans le noir. Le modèle obéissait
 * correctement à des consignes contradictoires. D'où ces deux constantes séparées.
 */
const PORTRAIT_ART =
  "Painted portrait illustration with visible brush and palette-knife texture — clearly an " +
  "ILLUSTRATION, never a photograph. Soft directional key light from the front-left so the FACE " +
  "IS FULLY LIT AND CLEARLY READABLE, both eyes open and visible. Desaturated sepia and warm grey " +
  "palette, plain very dark background behind the subject, gentle melancholic and respectful mood, " +
  "16:9 widescreen";
const PORTRAIT_NEG =
  "Not a photograph, not photorealistic. Does not resemble any specific real person, no celebrity, " +
  "no distinctive identifying marks. No text, no letters, no watermark, no logo, no brand, " +
  "no distorted hands, no extra limbs, no back of the head, no face hidden in shadow";

const getRun = (id) => readJSON(`machines/runs/${MACHINE_ID}/${id}.json`, null);
const saveRun = (r) => writeJSON(`machines/runs/${MACHINE_ID}/${r.id}.json`, r);
function listRuns() {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json"))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), "utf8")); } catch { return null; } })
    .filter(Boolean)
    .map((r) => ({ id: r.id, title: r.title, status: r.status, mode: r.mode, createdAt: r.createdAt,
                   shots: (r.shots || []).length, cost: r.cost, params: r.params, published: r.published, introMode: r.introMode }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
function log(run, msg) {
  run.logs = (run.logs || []).slice(-200);
  run.logs.push({ t: new Date().toISOString(), msg: String(msg) });
  saveRun(run);
}

const DEFAULTS = {
  nicheId: null,
  channelName: "Au creux de la nuit",
  settings: {
    voiceId: null,              // Kael — posé au premier démarrage
    avatarLookId: null,         // look HeyGen
    intro: "auto",              // auto | toujours | jamais
    wordsPerImage: WORDS_PER_IMAGE,
    imageModel: "gpt",
    subtitles: "srt",        // "srt" (défaut) | "burn" | "none"
    ctaEveryMin: 3,             // CTA visuel toutes les N minutes (0 = aucun)
    kenStyle: "centre",         // "centre" | "gauche" — mouvement du Ken Burns
    cornerLogo: true,           // petit logo rond en haut à gauche, toute la durée
    musicPrefix: "Machine crime", // les pistes « fond » dont le nom commence ainsi
    musicLufs: -30,             // niveau du lit musical sous la voix
    outroLine: "Merci d'avoir regardé la vidéo jusqu'au bout, on se retrouve très vite pour une prochaine vidéo.",
    fadeOutSec: 2.5,            // fondu au noir en fin de vidéo (0 = aucun)
    sting: true,                // générique de chaîne de 5 s en tête
    stingSeconds: 5,
    stingAccent: "#7fa8d9",     // couleur des particules et du halo
    stingSubtitle: "Affaires non résolues",
    ctaFirstSec: 20,            // premier CTA à 20 s
    channelName: "Au Creux de la Nuit",
    ctaLogo: "au-creux-de-la-nuit-logo.png",
    promptModel: "",
    publishPrivacy: "private",
    publishChannelId: null,
  },
};
function config() {
  const c = readJSON(`machines/${MACHINE_ID}.json`, null);
  if (!c) { writeJSON(`machines/${MACHINE_ID}.json`, DEFAULTS); return JSON.parse(JSON.stringify(DEFAULTS)); }
  c.settings = { ...DEFAULTS.settings, ...(c.settings || {}) };
  return c;
}
function patchConfig(p = {}) {
  const c = config();
  const next = { ...c, ...p, settings: { ...c.settings, ...(p.settings || {}) } };
  writeJSON(`machines/${MACHINE_ID}.json`, next);
  return next;
}

const genModel = () => config().settings.promptModel || undefined;
const askGen = (p, ms = 6 * 60 * 1000) => claude.ask(p, { timeoutMs: ms, model: genModel() });
async function genJson(prompt, { ms = 8 * 60 * 1000, tries = 3, label = "" } = {}) {
  let last;
  for (let a = 1; a <= tries; a++) {
    try {
      const out = await askGen(prompt, ms);
      const m = String(out).match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (!m) throw new Error("aucun JSON");
      return JSON.parse(m[0]);
    } catch (e) { last = e; }
  }
  throw new Error(`${label || "Génération"} : ${last?.message || "échec"}`);
}
async function pool(items, worker, n = 8) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await worker(items[k], k); } catch (e) { out[k] = { error: e.message }; } }
  }));
  return out;
}

// ---------------------------------------------------------------- transport

const kieKey = () => { const k = vault.get("kie"); if (!k) throw new Error("Clé Kie absente du coffre"); return k; };
const FATAL = /must be|invalid|unauthorized|not found|bad request|required/i;
async function kieCreate(model, input) {
  const r = await fetch("https://api.kie.ai/api/v1/jobs/createTask", { method: "POST",
    headers: { Authorization: `Bearer ${kieKey()}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, input }) }).then((x) => x.json());
  if (!r.data?.taskId) throw new Error(`Kie ${model} : ${r.msg || JSON.stringify(r).slice(0, 160)}`);
  return r.data.taskId;
}
const cancelled = new Set();
async function kiePoll(taskId, { timeoutMs = 15 * 60 * 1000, runId } = {}) {
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 12000));
    if (runId && cancelled.has(runId)) throw new Error("Annulée par l'utilisateur");
    if (Date.now() - t0 > timeoutMs) throw new Error("Kie : délai dépassé");
    const r = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, { headers: { Authorization: `Bearer ${kieKey()}` } }).then((x) => x.json());
    if (r.data?.state === "success") return JSON.parse(r.data.resultJson).resultUrls[0];
    if (r.data?.state === "fail") throw new Error(`Kie : ${r.data?.failMsg || "échec"}`);
  }
}
/** Relance un job PERDU ; ne rejoue jamais une requête malformée. */
async function kieRetry(model, input, { tries = 2, runId } = {}) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try { return await kiePoll(await kieCreate(model, input), { runId }); }
    catch (e) { last = e; if (FATAL.test(e.message) || /Annulée/.test(e.message)) throw e; }
  }
  throw last;
}
async function download(url, file) {
  const r = await fetch(url); if (!r.ok) throw new Error(`Téléchargement ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  if (/\.(mp4|mov|webm|mp3|m4a|wav)$/i.test(file)) { fs.writeFileSync(file, b); return file; }
  const o = file.replace(/\.(png|jpe?g)$/i, "") + (b[0] === 0xff && b[1] === 0xd8 ? ".jpg" : ".png");
  fs.writeFileSync(o, b); return o;
}
async function uploadPublic(name, file, mime) {
  let last;
  for (let i = 1; i <= 3; i++) {
    try { const u = await google.driveUpload(name, mime, fs.readFileSync(file));
      await google.ensurePublic(u.id).catch(() => {});
      return `https://drive.google.com/uc?export=download&id=${u.id}`; }
    catch (e) { last = e; if (i < 3) await new Promise((r) => setTimeout(r, 4000 * i)); }
  }
  throw new Error(`Upload Drive impossible : ${String(last?.message).slice(0, 120)}`);
}
function run(cmd, args, opt) {
  return new Promise((res, rej) => {
    const c = spawn(cmd, args, opt || {});
    let err = "";
    c.stdout.on("data", () => {});                 // pipe non lu = process figé
    c.stderr.on("data", (d) => { err += d.toString().slice(-4000); });
    c.on("error", rej);
    c.on("close", (k) => (k === 0 ? res() : rej(new Error(`${cmd} ${k} : ${err.slice(-400)}`))));
  });
}
const ffmpeg = (a, o) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...a], o);

// ---------------------------------------------------------------- LA RECETTE

/** Structure relevée sur les deux gagnants : on ouvre sur une accroche, jamais sur un nom. */
const HOOK_RULES = [
  "L'OUVERTURE DÉCIDE DE TOUT. Elle ne nomme JAMAIS l'affaire.",
  "Deux ouvertures qui fonctionnent, relevées sur la niche :",
  "  • le FAIT BRUT sans contexte — « Un homme de 79 ans vient d'être incarcéré. Ils vont",
  "    recenser 89 mineurs. » (Axel, 116 000 vues avec 5 000 abonnés)",
  "  • la QUESTION UNIVERSELLE — « Parfois, ce qui est le plus terrifiant n'est pas ce qui se",
  "    cache dans l'obscurité, mais ce à quoi nous faisons confiance sans hésitation. »",
  "    (Nuits de Crime, 49 000 vues avec 1 350 abonnés)",
  "Puis on installe la victime comme une personne ordinaire, AVANT que rien n'arrive.",
  "C'est ce contraste qui tient le spectateur, pas le sang.",
].join("\n");

/**
 * L'INTRODUCTION est dite face caméra par le présentateur (avatar HeyGen). Elle a un rôle
 * précis, signalé au visionnage : elle ne doit PAS commencer l'histoire, elle doit donner
 * envie de rester. Sa longueur est aussi une contrainte technique — c'est elle qui fixe la
 * durée du plan avatar.
 */
const INTRO_RULES = [
  `INTRODUCTION — le PREMIER paragraphe, ${INTRO_MIN_WORDS} à ${INTRO_MAX_WORDS} mots, d'un seul tenant.`,
  "Il est dit FACE CAMÉRA par le présentateur de la chaîne. Ce n'est PAS le début du récit.",
  "Sa seule mission : donner envie de rester jusqu'au bout. Il doit contenir, dans cet ordre :",
  "  1. l'ACCROCHE (voir ci-dessus) — un fait brut ou une question universelle ;",
  "  2. l'ÉNIGME posée en une phrase : ce qui, dans ce dossier, n'a pas de réponse évidente ;",
  "  3. une PROMESSE explicite de ce que le spectateur comprendra à la fin — sans le révéler ;",
  "  4. une phrase qui demande de rester jusqu'au bout (« restez jusqu'à la fin », tournée",
  "     naturellement, jamais mécaniquement).",
  "⚠ INTERDIT dans ce paragraphe : la chronologie des faits, le déroulé, le dénouement.",
  "Le récit proprement dit commence au DEUXIÈME paragraphe.",
].join("\n");

/** Demandé : la vidéo se termine par un appel au like et à l'abonnement. */
const OUTRO_RULES = [
  "CONCLUSION — le DERNIER paragraphe se termine par un appel au spectateur : lui demander",
  "de laisser un like et de s'abonner à la chaîne pour ne pas manquer les prochaines affaires.",
  "Deux phrases maximum, dans le ton grave du reste — jamais l'enthousiasme d'un youtubeur.",
  "Il vient APRÈS la clôture du dossier, jamais à la place.",
  "⚠ N'ajoute AUCUNE formule de remerciement ni d'au revoir : la machine ajoute elle-même la",
  "phrase de clôture de la chaîne, à l'identique sur toutes les vidéos.",
].join("\n");

const TONE_RULES = [
  "TON : grave, analytique, respectueux. Jamais de sensationnalisme, jamais de complaisance",
  "dans la violence. Les deux chaînes qui gagnent sont sobres — c'est la rigueur qui captive.",
  "On explique des MÉCANISMES : comment il a pu opérer, pourquoi personne n'a vu.",
  "",
  "⚠ AUCUNE IMAGE ne montrera de visage réel. N'écris donc jamais de description reposant sur",
  "la ressemblance d'une personne identifiable : décris des lieux, des objets, des atmosphères,",
  "des silhouettes de dos, des mains, des documents.",
].join("\n");

/** Le titre est le levier mesuré de la niche. */
const TITLE_RULES = [
  "TITRE — c'est le facteur le plus discriminant de cette niche, mesuré :",
  "  ✗ JAMAIS « Affaire X », « L'affaire Y », le nom du dossier en tête.",
  "  ✓ Une AMORCE narrative qui fonctionne même si on n'a jamais entendu parler du dossier.",
  "Modèles qui performent :",
  "  « Son neveu ouvre 5 clés USB… et découvre 55 ans d'horreur »",
  "  « Il part faire la fête à 19 ans, il revient sans ses organes »",
  "  « Il savait où était le corps. Il a laissé la France entière chercher »",
  "  « CETTE AFFAIRE A CHOQUÉ TOUTE L'ANGLETERRE ! »",
  "70 à 100 caractères. Points de suspension autorisés avant le retournement.",
].join("\n");

// ---------------------------------------------------------------- étape 1 : script

const expectedWords = (min) => Math.round(min * WPM);

async function stepScript(run) {
  const p = run.params;
  const insp = p.nicheId ? (() => { try { return bank.inspiration(p.nicheId, { maxTitles: 20, maxVisions: 2 }); } catch { return ""; } })() : "";
  const mots = expectedWords(p.durationMin);
  log(run, `Script : ${p.durationMin} min ≈ ${mots} mots à ${WPM} mots/min`);

  const out = await genJson([
    insp, "",
    `Écris le script COMPLET d'un documentaire true crime de ${p.durationMin} minutes, en français.`,
    p.subject ? `Sujet imposé : « ${p.subject} »` : "Choisis une affaire, française OU INTERNATIONALE.",
    p.international ? "PRIVILÉGIE une affaire NON française : les chaînes géantes occupent le terrain français." : "",
    "", HOOK_RULES, "", INTRO_RULES, "", TONE_RULES, "", OUTRO_RULES, "", TITLE_RULES, "",
    `LONGUEUR : environ ${mots} mots (${p.durationMin} min à ${WPM} mots/min). Compte-les.`,
    "",
    "Sépare les paragraphes par une ligne vide. Un paragraphe = une unité de sens.",
    "",
    "JSON UNIQUEMENT :",
    '{"title":"(l\'amorce narrative, 70-100 caractères)",',
    '"affaire":"(le nom réel du dossier — pour référence, il n\'apparaît PAS dans le titre)",',
    '"pays":"(pays de l\'affaire)",',
    '"script":"(le texte complet, paragraphes séparés par une ligne vide)"}',
  ].join("\n"), { label: "Script", ms: 12 * 60 * 1000 });

  run.title = String(out.title || "Sans titre").slice(0, 160);
  run.affaire = out.affaire || "";
  run.pays = out.pays || "";
  run.script = String(out.script || "").trim();
  // PHRASE DE CLÔTURE — texte FIXE, ajouté après coup plutôt que demandé au modèle : une
  // formule de remerciement doit être identique d'une vidéo à l'autre (c'est une signature de
  // chaîne), et un modèle la reformule à chaque fois. Elle vient APRÈS l'appel à s'abonner,
  // donc en tout dernier paragraphe.
  const line = String(config().settings.outroLine || "").trim();
  if (line && !run.script.endsWith(line)) run.script += "\n\n" + line;
  const n = run.script.split(/\s+/).filter(Boolean).length;
  run.words = n;
  saveRun(run);
  log(run, `Script : « ${run.title} » — ${n} mots (${(n / WPM).toFixed(1)} min estimées) · ${run.pays || "?"}`);
  if (Math.abs(n - mots) / mots > 0.35) log(run, `⚠ Écart de longueur important (${n} mots pour ${mots} visés)`);
}

// ---------------------------------------------------------------- étape 2 : voix

/** Découpe en paragraphes, en respectant la limite de l'API TTS. */
function paragraphs(txt, max = 1900) {
  const out = [];
  for (const para of String(txt).split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)) {
    if (para.length <= max) { out.push(para); continue; }
    let cur = "";
    for (const ph of para.split(/(?<=[.!?])\s+/)) {
      if ((cur + " " + ph).length > max && cur) { out.push(cur.trim()); cur = ph; } else cur = cur ? cur + " " + ph : ph;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

async function stepVoice(run) {
  const dir = path.join(OUT_ROOT, run.id); ensureDir(dir);
  const lib = voices.list();
  const v = lib.find((x) => x.id === run.params.voiceId) || lib.find((x) => x.name === "Kael");
  if (!v) throw new Error("Voix introuvable — ajoute Kael dans la page 🎙 Voix");
  run.voiceName = v.name;

  const paras = paragraphs(run.script);
  run.paras = paras;
  log(run, `Voix : ${paras.length} paragraphe(s), voix « ${v.name} » (${v.wpm} mots/min)`);

  const segs = run.voiceSegs || [];
  await pool(paras.map((t, i) => ({ t, i })), async ({ t, i }) => {
    const f = path.join(dir, `vo-${String(i).padStart(3, "0")}.mp3`);
    if (segs[i] && fs.existsSync(f)) return;
    const r = await fal.run("fal-ai/elevenlabs/tts/eleven-v3", { text: t, voice: v.ref },
      { cancelled: () => cancelled.has(run.id) });
    if (!r.audio?.url) throw new Error(`ElevenLabs : aucun audio (paragraphe ${i})`);
    await fal.download(r.audio.url, f);
    const sec = await ff.probeDuration(f, { label: `voix ${i}` });
    segs[i] = { i, file: f, seconds: +sec.toFixed(2), words: t.split(/\s+/).length };
    const c = +((t.length / 1000) * PRICES.voicePer1kChars).toFixed(4);
    run.cost.voice = (run.cost.voice || 0) + c;
    spend.record("FAL.ai", MACHINE_NAME, c, "USD", `Voix paragraphe ${i}`);
    saveRun(run);
  }, 6);

  run.voiceSegs = segs;
  if (segs.filter(Boolean).length !== paras.length) throw new Error("Voix incomplète — reprenable");

  // Assemblage de la voix off complète (l'audio n'est JAMAIS retouché ni tronqué).
  const list = path.join(dir, "vo.txt");
  fs.writeFileSync(list, segs.map((s) => `file '${s.file.replace(/\\/g, "/")}'`).join("\n"));
  const vo = path.join(dir, "voix.mp3");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c:a", "libmp3lame", "-b:a", "192k", vo]);
  run.voice = { file: vo, rel: `agent-os/output/machines/${run.id}/voix.mp3`,
                seconds: await ff.probeDuration(vo, { label: "voix off" }) };
  saveRun(run);
  log(run, `Voix off : ${(run.voice.seconds / 60).toFixed(1)} min (${Math.round(run.words / (run.voice.seconds / 60))} mots/min réels)`);
}

// ---------------------------------------------------------------- étape 3 : intro avatar

/**
 * L'avatar MIME la voix : on lui envoie les 60 premières secondes de l'audio déjà produit.
 * Une seule voix court donc du début à la fin de la vidéo.
 * Bascule AUTOMATIQUE si le quota mensuel est épuisé — jamais d'échec de run pour ça.
 */
async function stepIntro(run) {
  const c = config().settings;
  const dir = path.join(OUT_ROOT, run.id);
  const mode = run.params.intro || c.intro || "auto";
  if (mode === "jamais") { run.introMode = "aucune"; saveRun(run); log(run, "Intro : désactivée"); return; }

  // ⚠ On ne prend PLUS le seul premier paragraphe. Vécu : le modèle en avait écrit un court,
  //   l'avatar ne durait que 8 s et la vidéo basculait aussitôt sur les images. On CUMULE les
  //   paragraphes tant qu'on tient sous le plafond du plan HeyGen, pour occuper vraiment la
  //   minute payée.
  const segs = run.voiceSegs || [];
  if (!segs.length) throw new Error("Voix manquante pour l'intro");
  const take = [segs[0]];
  let acc = segs[0].seconds;
  for (let k = 1; k < segs.length; k++) {
    if (acc + segs[k].seconds > INTRO_MAX_SEC) break;
    take.push(segs[k]); acc += segs[k].seconds;
  }
  const cut = path.join(dir, "intro-audio.mp3");
  let dur = Math.min(acc, INTRO_MAX_SEC);
  if (take.length === 1 && segs[0].seconds > INTRO_MAX_SEC) {
    await ffmpeg(["-i", segs[0].file, "-t", INTRO_MAX_SEC.toFixed(2), "-c:a", "libmp3lame", "-b:a", "192k", cut]);
    dur = INTRO_MAX_SEC;
    log(run, `Intro : paragraphe de ${segs[0].seconds.toFixed(1)} s coupé à ${INTRO_MAX_SEC} s (plafond du plan)`);
  } else if (take.length === 1) {
    fs.copyFileSync(segs[0].file, cut);
  } else {
    const li = path.join(dir, "intro-parts.txt");
    fs.writeFileSync(li, take.map((t) => `file '${t.file.replace(/\\/g, "/")}'`).join("\n"));
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", li, "-c:a", "libmp3lame", "-b:a", "192k", cut]);
    dur = await ff.probeDuration(cut, { label: "intro avatar" });
    log(run, `Intro : ${take.length} paragraphes cumulés → ${dur.toFixed(1)} s`);
  }
  // Repli BRUYANT : une intro très courte gâche la génération HeyGen (3 par mois).
  if (dur < 25) log(run, `⚠ Intro courte (${dur.toFixed(1)} s) — le script n'a pas produit l'introduction de ${INTRO_MIN_WORDS}-${INTRO_MAX_WORDS} mots attendue`);

  const gate = await heygen.canGenerate(dur);
  if (!gate.ok) {
    if (mode === "toujours") throw new Error(`Intro avatar impossible : ${gate.reason}`);
    run.introMode = "illustrée";
    saveRun(run);
    log(run, `Intro : ${gate.reason} → bascule sur une intro illustrée (aucun échec)`);
    return;
  }

  const look = run.params.avatarLookId || c.avatarLookId;
  if (!look) { run.introMode = "illustrée"; saveRun(run); log(run, "Intro : aucun avatar choisi → intro illustrée"); return; }

  log(run, `Intro avatar : ${dur.toFixed(1)} s (${gate.quota.remaining} génération(s) restante(s) ce mois)`);
  const audioUrl = await uploadPublic(`crime-${run.id}-intro.mp3`, cut, "audio/mpeg");
  const res = await heygen.generate({ avatarId: look, audioUrl, seconds: dur, machine: MACHINE_NAME, note: run.title });
  const f = await heygen.download(res.url, path.join(dir, "intro-avatar.mp4"));
  run.intro = { file: f, rel: `agent-os/output/machines/${run.id}/intro-avatar.mp4`, seconds: res.seconds || dur };
  run.introMode = "avatar";
  saveRun(run);
  log(run, `Intro avatar prête (${(res.seconds || dur).toFixed(1)} s)`);
}

// ---------------------------------------------------------------- étape 4 : plans

/**
 * Le découpage se DÉDUIT de la voix : chaque paragraphe a une durée mesurée, on le coupe en
 * plans de ~wordsPerImage mots et on répartit sa durée au prorata des mots. Aucun Whisper
 * nécessaire pour le montage — il ne sert qu'aux sous-titres, s'ils sont demandés.
 */
function buildShots(run) {
  const per = Number(config().settings.wordsPerImage) || WORDS_PER_IMAGE;
  const shots = [];
  let t = 0;
  (run.voiceSegs || []).forEach((seg, pi) => {
    const mots = (run.paras[pi] || "").split(/\s+/).filter(Boolean);
    const n = Math.max(1, Math.round(mots.length / per));
    const taille = Math.ceil(mots.length / n);
    for (let k = 0; k < n; k++) {
      const tranche = mots.slice(k * taille, (k + 1) * taille);
      if (!tranche.length) continue;
      const part = tranche.length / mots.length;
      const d = seg.seconds * part;
      shots.push({ i: shots.length, para: pi, start: +t.toFixed(2), seconds: +d.toFixed(2),
                   texte: tranche.join(" ") });
      t += d;
    }
  });
  return shots;
}

async function stepShots(run) {
  const shots = buildShots(run);
  const introSec = run.introMode === "avatar" ? (run.intro?.seconds || 0) : 0;
  // Les plans entièrement couverts par l'intro avatar n'ont pas besoin d'illustration.
  for (const s of shots) s.covered = introSec > 0 && s.start + s.seconds <= introSec + 0.4;
  run.shots = shots;
  run.introSec = introSec;
  saveRun(run);
  const a = shots.filter((s) => !s.covered).length;
  log(run, `Plans : ${shots.length} au total, ${a} à illustrer (${shots.length - a} couverts par l'intro avatar)`);

  // Les prompts d'image sont écrits par lots, à partir du TEXTE de chaque plan.
  const todo = shots.filter((s) => !s.covered && !s.prompt);
  const lots = [];
  for (let i = 0; i < todo.length; i += 8) lots.push(todo.slice(i, i + 8));
  log(run, `Prompts d'image : ${lots.length} lot(s)`);
  await pool(lots, async (lot) => {
    const j = await genJson([
      `DOCUMENTAIRE : « ${run.title} »`, "",
      "Pour CHAQUE extrait ci-dessous, écris un prompt d'image EN ANGLAIS qui l'illustre.",
      "", TONE_RULES, "",
      "RÈGLES ABSOLUES :",
      "- AUCUN visage humain identifiable. Lieux, objets, documents, silhouettes de dos, mains,",
      "  détails matériels, paysages, intérieurs vides. Jamais un portrait.",
      "- 400 caractères minimum, riches en détails concrets et en lumière.",
      "- Chaque plan doit être VISUELLEMENT DIFFÉRENT des autres du lot.",
      "",
      JSON.stringify(lot.map((s) => ({ i: s.i, texte: s.texte.slice(0, 320) }))),
      "",
      'JSON UNIQUEMENT : {"shots":[{"i":0,"prompt":"(EN, ≥ 400 car.)"}]}',
    ].join("\n"), { label: "Prompts d'image", ms: 8 * 60 * 1000 });
    for (const x of j.shots || []) {
      const s = run.shots.find((y) => y.i === x.i);
      if (s && x.prompt) s.prompt = String(x.prompt);
    }
    saveRun(run);
  }, 4);

  const manquants = run.shots.filter((s) => !s.covered && !s.prompt);
  if (manquants.length) throw new Error(`${manquants.length} prompt(s) d'image manquant(s) — reprenable`);
}

// ---------------------------------------------------------------- étape 5 : images

const T2I = { gpt: "gpt-image-2-text-to-image", nano: "nano-banana-2-lite", seedream: "seedream/5-lite-text-to-image" };

async function stepImages(run) {
  const dir = path.join(OUT_ROOT, run.id); ensureDir(dir);
  const model = T2I[config().settings.imageModel] || T2I.gpt;
  const todo = run.shots.filter((s) => !s.covered && !s.image);
  log(run, `Images : ${todo.length} à générer (${model})`);
  await pool(todo, async (s) => {
    try {
      const url = await kieRetry(model, { prompt: `${s.prompt}. ${ART}. ${NEG}.`, aspect_ratio: "16:9", resolution: "1K" }, { runId: run.id });
      const f = await download(url, path.join(dir, `img-${String(s.i).padStart(3, "0")}.png`));
      s.image = { file: f, rel: `agent-os/output/machines/${run.id}/${path.basename(f)}`, ts: Date.now() };
      run.cost.images = (run.cost.images || 0) + PRICES.image;
      spend.record("Kie.ai", MACHINE_NAME, PRICES.image, "USD", `Image plan ${s.i}`);
      delete s.error;
    } catch (e) { s.error = e.message; log(run, `Image ${s.i} : ${e.message}`); }
    saveRun(run);
  }, 8);
  const ko = run.shots.filter((s) => !s.covered && !s.image).length;
  if (ko) throw new Error(`${ko} image(s) manquante(s) — reprenable`);
}

/**
 * CTA « s'abonner » — rendu SEUL par Remotion en séquence PNG transparente, incrusté ensuite
 * par FFmpeg. On réutilise la composition de Bouddhisme (tout y est une prop) sous l'id
 * `CrimeCta`, avec le logo de la chaîne.
 * ⚠ `child.stdout.on("data")` est OBLIGATOIRE : un pipe non lu (64 Ko) fige le rendu.
 */
function renderCtaClip(run) {
  return new Promise((resolve, reject) => {
    const c = config().settings;
    const rel = `cta-${run.id}`;
    fs.writeFileSync(path.join(REMOTION_DIR, rel + ".json"), JSON.stringify({
      label: "S'ABONNER", labelDone: "ABONNÉ",
      channel: c.channelName || "Au Creux de la Nuit",
      tagline: "Une nouvelle affaire chaque semaine",
      taglineDone: "Merci — à la prochaine affaire",
      logo: c.ctaLogo || "au-creux-de-la-nuit-logo.png",
    }));
    const child = spawn("npx", ["remotion", "render", "CrimeCta", rel, "--sequence", "--image-format=png", `--props=${rel}.json`],
      { cwd: REMOTION_DIR, shell: true, windowsHide: true });
    let err = "";
    child.stdout.on("data", () => {});
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      const folder = path.join(REMOTION_DIR, rel);
      try { fs.unlinkSync(path.join(REMOTION_DIR, rel + ".json")); } catch {}
      if (code === 0 && fs.existsSync(path.join(folder, "element-000.png"))) resolve(folder);
      else reject(new Error(err.slice(-300) || "code " + code));
    });
  });
}

/**
 * MUSIQUE — on ne génère RIEN. On pioche au hasard 1 ou 2 pistes de la bibliothèque
 * (onglet Musique), parmi celles en usage « fond » dont le nom commence par le préfixe
 * réglé — « Machine crime … » par défaut. L'utilisateur alimente lui-même cette banque.
 */
function pickMusic() {
  const c = config().settings;
  const pref = String(c.musicPrefix || "Machine crime").toLowerCase();
  const pool = music.list({ usage: "fond" }).filter((m) => String(m.name || "").toLowerCase().startsWith(pref));
  if (!pool.length) return [];
  const shuffled = pool.slice().sort(() => Math.random() - 0.5);
  const n = pool.length >= 2 && Math.random() < 0.5 ? 2 : 1;
  return shuffled.slice(0, n);
}

/**
 * Construit le lit musical : les pistes choisies s'enchaînent en fondu, puis la chaîne boucle
 * jusqu'à couvrir toute la voix. Recette reprise de Bouddhisme (éprouvée).
 */
async function buildBed(run, dir, totalSec) {
  const bed = path.join(dir, "bed.mp3");
  if (fs.existsSync(bed)) return bed;
  const tracks = (run.music || []).map((m) => music.filePath(m.id)).filter((f) => fs.existsSync(f));
  if (!tracks.length) return null;

  let unit = tracks[0];
  if (tracks.length > 1) {                       // enchaîner les pistes entre elles
    unit = path.join(dir, "bed-unit.mp3");
    const ins = []; tracks.forEach((f) => ins.push("-i", f));
    let f = "", prev = "[0:a]";
    for (let i = 1; i < tracks.length; i++) {
      const lab = i === tracks.length - 1 ? "[u]" : `[x${i}]`;
      f += `${prev}[${i}:a]acrossfade=d=3:c1=tri:c2=tri${lab};`; prev = lab;
    }
    await ffmpeg([...ins, "-filter_complex", f.slice(0, -1), "-map", "[u]", "-c:a", "libmp3lame", "-b:a", "192k", unit]);
  }
  const uDur = await ff.probeDuration(unit, { label: "musique" });
  const loops = Math.max(1, Math.ceil((totalSec + 10) / Math.max(5, uDur - 3)));
  const ins = []; for (let i = 0; i < loops; i++) ins.push("-i", unit);
  let f = "", prev = "[0:a]";
  for (let i = 1; i < loops; i++) {
    const lab = i === loops - 1 ? "[m]" : `[a${i}]`;
    f += `${prev}[${i}:a]acrossfade=d=3:c1=tri:c2=tri${lab};`; prev = lab;
  }
  if (loops === 1) f = "[0:a]anull[m];";
  f += `[m]atrim=0:${totalSec.toFixed(2)},afade=t=in:st=0:d=4,afade=t=out:st=${Math.max(0, totalSec - 6).toFixed(2)}:d=6[bed]`;
  await ffmpeg([...ins, "-filter_complex", f, "-map", "[bed]", "-c:a", "libmp3lame", "-b:a", "192k", bed]);
  log(run, `Lit musical : ${(run.music || []).map((m) => m.name).join(" + ")} — ${loops} boucle(s)`);
  return bed;
}

/**
 * Instant où la voix DIT de s'abonner, lu dans les sous-titres.
 * ⚠ Je plaçais le dernier CTA « à la fin moins 16 s », en annonçant qu'il tomberait sur
 *   l'appel parlé. Ce n'était qu'une approximation, et elle tombait à côté. Le .srt donne
 *   l'instant réel.
 */
function spokenSubscribeAt(run) {
  if (!run.srt?.file || !fs.existsSync(run.srt.file)) return null;
  const txt = fs.readFileSync(run.srt.file, "utf8");
  const blocks = txt.split(/\n\s*\n/);
  for (const b of blocks) {
    const m = /(\d\d):(\d\d):(\d\d),(\d{3})\s*-->/.exec(b);
    if (!m) continue;
    const body = b.split(/\n/).slice(2).join(" ");
    if (!/\babonn|s'abonner|abonnez/i.test(body)) continue;
    return +(m[1] * 3600 + m[2] * 60 + +m[3] + m[4] / 1000).toFixed(2);
  }
  return null;
}

// ---------------------------------------------------------------- étape 6 : montage

/**
 * MONTAGE — la partie illustrée n'est encodée QU'UNE FOIS.
 *
 * ⚠ Avant : quatre encodages complets d'une vidéo de 18 min (les segments, puis `illustre`
 *   pour coller l'audio, puis la normalisation avant concat, puis le CTA). Chronométré :
 *   51 min de montage dont ~2 min seulement pour les segments Ken Burns. Tout le reste était
 *   du ré-encodage redondant.
 *
 * Maintenant : les segments sortent déjà aux paramètres finaux (1280x720, 30 fps, yuv420p,
 * SAR 1:1) — donc `concat -c copy` suffit pour les coller ENTRE EUX et avec l'intro, à
 * condition de normaliser l'intro SANS audio. Une seule passe d'encodage à la fin ajoute la
 * voix, le CTA et, si demandé, les sous-titres gravés. Sans CTA ni gravure, cette passe est
 * même un `-c:v copy`.
 *
 * L'audio final est `voix.mp3` en entier : l'avatar MIME les 49,6 premières secondes de cette
 * même piste, et HeyGen rend une vidéo de la durée exacte de l'audio envoyé (vérifié : 0,6 ms
 * d'écart). Il n'y a donc rien à recoller côté son.
 */
async function stepMontage(run) {
  const dir = path.join(OUT_ROOT, run.id);
  const introSec = run.introSec || 0;
  const c = config().settings;
  const kenStyle = run.params.kenStyle || c.kenStyle || "centre";

  // 1) un segment par plan, Ken Burns, à la durée EXACTE du plan
  const vis = run.shots.filter((s) => !s.covered);
  log(run, `Montage : ${vis.length} segments illustrés`);
  const parts = [];
  for (const s of vis) {
    const o = path.join(dir, `seg-${String(s.i).padStart(3, "0")}.mp4`);
    if (!fs.existsSync(o)) {
      const frames = Math.max(2, Math.round(s.seconds * 30));
      // KEN BURNS — l'amplitude est répartie sur TOUTE la durée du plan.
      // ⚠ Bug corrigé (signalé au visionnage) : un pas FIXE (`zoom+0.0009`) plafonné à 1.10
      //   atteignait sa butée en ~3,7 s, puis l'image restait FIGÉE le reste du plan.
      // ⚠ `x`/`y` sont indispensables : sans eux zoompan zoome vers le coin haut-gauche.
      // ⚠ `KEN_UPSCALE` : zoompan recadre en pixels ENTIERS — trop bas, l'origine avance d'un
      //   demi-pixel par image et l'image tremble. Voir la constante.
      const zoomIn = s.i % 2 === 0;
      const z = zoomIn
        ? `1+${KEN_AMP}*on/${frames}`
        : `${(1 + KEN_AMP).toFixed(3)}-${KEN_AMP}*on/${frames}`;
      // Deux styles au choix (réglage `kenStyle`) :
      //   centre — la fenêtre reste centrée, le zoom seul travaille ;
      //   gauche — la fenêtre DÉRIVE vers la gauche pendant le zoom (le rendu de la 1re vidéo,
      //            que l'utilisateur a trouvé intéressant), verticalement centrée.
      // `x` reste toujours dans [0, iw-iw/zoom] : la dérive n'entame que la marge disponible.
      const xExpr = kenStyle === "gauche"
        ? `(iw/2-(iw/zoom/2))*(1-${KEN_DRIFT}*on/${frames})`
        : `iw/2-(iw/zoom/2)`;
      await ffmpeg(["-loop", "1", "-i", s.image.file, "-t", s.seconds.toFixed(3), "-r", "30",
        "-vf", `scale=${KEN_UPSCALE}:-2,zoompan=z='${z}':d=${frames}:x='${xExpr}':y='ih/2-(ih/zoom/2)':s=1280x720:fps=30,setsar=1`,
        "-an", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", o]);
    }
    parts.push(o);
  }

  // 2) collage SANS ré-encodage — segments, précédés de l'intro si elle existe
  // GÉNÉRIQUE DE CHAÎNE — brique partagée, rendue UNE fois puis mise en cache.
  // Sa vidéo est muette (mêmes paramètres que les segments) : elle se colle par copie.
  // Son jingle est mixé plus bas, et la voix décalée d'autant.
  let sting = null;
  if (c.sting !== false && c.ctaLogo) {
    const lp = path.join(REMOTION_DIR, "public", c.ctaLogo);
    sting = await intro.build({
      logoPath: lp, title: c.channelName || "", subtitle: c.stingSubtitle || "",
      accent: c.stingAccent || "#7fa8d9", width: 1280, height: 720,
      seconds: Number(c.stingSeconds) || 5,
    }).catch(() => null);
    if (sting) log(run, `Générique de chaîne : ${sting.seconds} s${sting.audio ? " (avec jingle)" : ""}`);
    else log(run, "Générique indisponible — vidéo sans générique");
  }
  const stingSec = sting ? sting.seconds : 0;

  const pieces = [];
  if (sting) pieces.push(sting.video);
  if (run.introMode === "avatar" && run.intro?.file) {
    const ni = path.join(dir, "n-intro.mp4");
    if (!fs.existsSync(ni)) {
      // muette : les segments n'ont pas d'audio, le concat par copie exige des flux identiques.
      await ffmpeg(["-i", run.intro.file, "-an", "-r", "30",
        "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:-1:-1,setsar=1",
        "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", ni]);
    }
    pieces.push(ni);
    log(run, `Intro avatar en tête (${introSec.toFixed(1)} s)`);
  }
  pieces.push(...parts);
  const lv = path.join(dir, "muet.txt");
  fs.writeFileSync(lv, pieces.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
  const mute = path.join(dir, "assemble-muet.mp4");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", lv, "-c", "copy", mute]);
  const vidSec = await ff.probeDuration(mute, { label: "vidéo assemblée" });

  // 3) sous-titres — Whisper tourne sur la voix DÉJÀ produite : rien à extraire, et les temps
  //    sont ceux du fichier final puisque la vidéo démarre avec cette piste.
  const subMode = run.params.subtitles === true ? "burn" : (run.params.subtitles || "none");
  let burn = false;
  if (subMode !== "none" && !run.srt) {
    try {
      const url = await uploadPublic(`crime-${run.id}-voix.mp3`, run.voice.file, "audio/mpeg");
      const r = await fal.run("fal-ai/whisper", { audio_url: url, language: "fr" }, { cancelled: () => cancelled.has(run.id) });
      const ch = r.chunks || r.segments || [];
      if (ch.length) {
        // ⚠ Whisper tourne sur `voix.mp3`, qui commence APRÈS le générique. Tous les temps
        //   doivent donc être décalés de `stingSec`, sinon les sous-titres avancent de 5 s
        //   sur toute la vidéo.
        fs.writeFileSync(path.join(dir, "subs.srt"), ch.map((seg, k) => {
          const [a0, b0] = seg.timestamp || [seg.start, seg.end];
          return `${k + 1}\n${srt(a0 + stingSec)} --> ${srt(b0 + stingSec)}\n${String(seg.text).trim()}\n`;
        }).join("\n"));
        run.srt = { file: path.join(dir, "subs.srt"), rel: `agent-os/output/machines/${run.id}/subs.srt`, segments: ch.length };
        const wc = +(run.voice.seconds * PRICES.whisperPerSec).toFixed(4);
        run.cost.montage = (run.cost.montage || 0) + wc;
        spend.record("FAL.ai", MACHINE_NAME, wc, "USD", "Whisper (sous-titres)");
        log(run, `Sous-titres : ${ch.length} segments`);
      }
    } catch (e) { log(run, `Sous-titres ignorés : ${e.message}`); }
  }
  burn = subMode === "burn" && !!run.srt;

  // ────────────────────────────────────────────────────────────────────────────────────────
  // 4) DEUX PASSES : la BANDE-SON d'abord, la VIDÉO ensuite.
  //
  // ⚠ Pourquoi séparées, alors qu'une seule suffisait avant le générique :
  //   dans un `filter_complex` qui traite AUSSI la vidéo, la chaîne audio sortait décalée —
  //   la voix arrivait à 10 s au lieu de 5. Isolé par élimination : le même graphe audio rendu
  //   SEUL est juste ; mêlé au filtrage vidéo il ne l'est plus ; avec la vidéo simplement
  //   COPIÉE il redevient juste. La source vidéo est un `concat -c copy` de morceaux encodés
  //   séparément (générique, avatar, segments), dont les horodatages ne sont pas homogènes —
  //   le premier paquet a même un DTS négatif.
  //   On ne cherche plus à faire cohabiter les deux : le son est construit à part, puis COPIÉ
  //   tel quel dans la passe vidéo. Coût négligeable (une passe audio est rapide) et le son
  //   devient vérifiable indépendamment.
  // ────────────────────────────────────────────────────────────────────────────────────────
  const cta = await ctaPlan(run, vidSec);
  const bed = await buildBed(run, dir, Math.min(vidSec, run.voice.seconds));
  const logoFile = c.cornerLogo === false ? null
    : (() => { const f = path.join(REMOTION_DIR, "public", c.ctaLogo || "au-creux-de-la-nuit-logo.png");
               return fs.existsSync(f) ? f : null; })();
  const final = path.join(dir, "final.mp4");
  const fade = Math.max(0, Number(c.fadeOutSec) || 0);
  const outDur = Math.max(vidSec, run.voice.seconds + stingSec) + fade;
  const DLY = Math.round(stingSec * 1000);

  // ── PASSE 1 : la bande-son
  const son = path.join(dir, "bande-son.m4a");
  {
    const args = ["-i", path.basename(run.voice.file)];
    let k = 1;
    const iBed = bed ? k++ : -1; if (bed) args.push("-i", path.basename(bed));
    const iJgl = sting?.audio ? k++ : -1; if (sting?.audio) args.push("-i", sting.audio);

    const ch = [];
    let src = "[0:a]";
    if (stingSec > 0) { ch.push(`[0:a]adelay=${DLY}|${DLY}[vdly]`); src = "[vdly]"; }
    let out = src;
    if (bed) {
      // la voix mène, la musique se couche dessous par ducking sidechain (recette Bouddhisme)
      ch.push(`${src}aformat=channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=7,aresample=48000,asplit=2[vo1][vosc]`);
      ch.push(`[${iBed}:a]aformat=channel_layouts=stereo,aresample=48000,loudnorm=I=${Number(c.musicLufs) || -30},aresample=48000${stingSec > 0 ? `,adelay=${DLY}|${DLY}` : ""}[bed0]`);
      ch.push(`[bed0][vosc]sidechaincompress=threshold=0.03:ratio=8:attack=25:release=900:makeup=1[duck]`);
      ch.push(`[vo1][duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,aresample=48000[aout]`);
      out = "[aout]";
    }
    if (iJgl >= 0) {   // le jingle du générique, à t=0, la voix ayant été décalée
      ch.push(`[${iJgl}:a]aformat=channel_layouts=stereo,aresample=48000[jgl]`);
      ch.push(`${out}[jgl]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,aresample=48000[amix]`);
      out = "[amix]";
    }
    ch.push(`${out}apad[afin]`);   // silence de queue, pour couvrir le fondu au noir
    await ffmpeg([...args, "-filter_complex", ch.join(";"), "-map", "[afin]",
      "-t", outDur.toFixed(2), "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
      path.basename(son)], { cwd: dir });
    log(run, `Bande-son : ${outDur.toFixed(0)} s${bed ? " (musique sous la voix)" : ""}${sting?.audio ? " + jingle" : ""}`);
  }

  // ── PASSE 2 : la vidéo, le son étant simplement COPIÉ
  const args = ["-i", path.basename(mute), "-i", path.basename(son)];
  let n = 2;
  const iCta = cta ? n++ : -1;      if (cta) args.push("-framerate", "30", "-start_number", "0", "-i", path.join(cta.seq, "element-%03d.png"));
  // ⚠ `-loop 1 -framerate 30` est INDISPENSABLE : en image UNIQUE, le logo disparaissait de
  //   toute la vidéo dès que la chaîne comptait plusieurs incrustations de CTA. Reproduit :
  //   avec 1 CTA le logo tient, avec 7 il s'évapore — les `overlay` en cascade attendent des
  //   flux calés loin dans le futur et l'image isolée du logo n'est jamais resservie.
  //   En flux continu, il y a une image de logo à chaque instant : le problème disparaît.
  const iLogo = logoFile ? n++ : -1;
  if (logoFile) args.push("-loop", "1", "-framerate", "30", "-i", logoFile);

  const chain = [];
  let cur = "[0:v]";
  if (burn) { chain.push(`${cur}subtitles=subs.srt:force_style='FontSize=17,MarginV=26,Outline=2,Shadow=0'[sub]`); cur = "[sub]"; }
  if (iLogo >= 0) {   // petit logo rond en haut à gauche, présent du début à la fin
    chain.push(`[${iLogo}:v]format=rgba,scale=${LOGO_PX}:-1,colorchannelmixer=aa=0.85[lg]`);
    chain.push(`${cur}[lg]overlay=26:22[wlg]`); cur = "[wlg]";
  }
  if (cta) {
    chain.push(`[${iCta}:v]format=rgba,scale=1280:-1,split=${cta.starts.length}${cta.starts.map((_, k) => `[k${k}]`).join("")}`);
    cta.starts.forEach((S, k) => chain.push(`[k${k}]setpts=PTS+${S}/TB[c${k}]`));
    cta.starts.forEach((S, k) => {
      const nl = k === cta.starts.length - 1 ? "[vout]" : `[o${k}]`;
      chain.push(`${cur}[c${k}]overlay=0:0:eof_action=pass:enable='between(t,${S},${(S + CTA_SEC).toFixed(2)})'${nl}`);
      cur = nl;
    });
  }
  // FONDU AU NOIR — en dernier, pour que TOUT s'éteigne avec l'image (logo et CTA compris).
  // La queue est AJOUTÉE après la voix : un fondu pris sur la fin avalerait les derniers mots.
  if (fade > 0) {
    chain.push(`${cur}tpad=stop_mode=clone:stop_duration=${(fade + 0.5).toFixed(2)},fade=t=out:st=${(outDur - fade).toFixed(2)}:d=${fade.toFixed(2)}[vfade]`);
    cur = "[vfade]";
  }

  const reencode = cur !== "[0:v]";
  if (chain.length) args.push("-filter_complex", chain.join(";"));
  args.push("-map", reencode ? cur : "0:v:0", "-map", "1:a:0");
  args.push("-c:v", reencode ? "libx264" : "copy");
  if (reencode) args.push("-crf", "20", "-pix_fmt", "yuv420p");
  args.push("-c:a", "copy", "-t", outDur.toFixed(2), path.basename(final));

  try {
    await ffmpeg(args, { cwd: dir });
    if (bed) log(run, `Musique : ${(run.music || []).map((m) => m.name).join(" + ")} sous la voix`);
    if (iLogo >= 0) log(run, "Logo de chaîne en haut à gauche, toute la durée");
    if (cta) log(run, `CTA : ${cta.starts.length} apparition(s) — ${cta.starts.slice(0, 6).join(", ")}${cta.starts.length > 6 ? "…" : ""} s`);
    if (burn) log(run, "Sous-titres GRAVÉS dans l'image");
    else if (run.srt) log(run, "Sous-titres : .srt envoyé à YouTube à la publication");
  } finally {
    if (cta) { try { fs.rmSync(cta.seq, { recursive: true, force: true }); } catch {} }
  }


  run.video = { file: final, rel: `agent-os/output/machines/${run.id}/final.mp4`,
                seconds: await ff.probeDuration(final, { label: "vidéo finale" }), ts: Date.now() };
  saveRun(run);
  log(run, `Montage terminé : ${(run.video.seconds / 60).toFixed(1)} min`);
}

/** Instants du CTA + rendu de la séquence PNG. `null` si désactivé ou si le rendu échoue. */
async function ctaPlan(run, total) {
  const c = config().settings;
  if (run.params.cta === false || !Number(c.ctaEveryMin)) return null;
  const every = Math.max(1, Number(c.ctaEveryMin)) * 60;
  const first = Math.max(5, Number(c.ctaFirstSec) || 20);
  const starts = [];
  for (let t = first; t < total - 25; t += every) starts.push(+t.toFixed(2));
  // Le script se termine par un appel à s'abonner : le bouton doit tomber DESSUS. On lit
  // l'instant réel dans les sous-titres plutôt que de le deviner à « fin moins 16 s ».
  // `spokenSubscribeAt` lit le .srt, qui est DÉJÀ écrit au temps de la vidéo finale
  // (générique compris) : aucun décalage supplémentaire à appliquer ici.
  const said = spokenSubscribeAt(run);
  // ⚠ Le bouton s'anime pendant 5 s et le CLIC tombe à 2 s. Pour que le clic coïncide avec le
  //   mot prononcé, il faut DÉMARRER 2 s avant — et rester assez tôt pour que l'animation
  //   entière tienne dans la vidéo (l'appel est souvent dans la toute dernière phrase :
  //   mesuré à 1093 s sur une vidéo de 1096 s, l'animation aurait été tronquée).
  // La borne ne protège que le CLIC, pas le fondu de sortie : l'appel est dans la dernière
  // phrase, et exiger les 5 s complètes décalait le clic de ~0,9 s. Perdre une demi-seconde
  // de fondu à la toute fin de la vidéo est invisible ; un clic désynchronisé, non.
  const outro = said !== null
    ? Math.max(first, Math.min(+(said - CTA_CLICK_SEC).toFixed(2), +(total - CTA_CLICK_SEC - 0.5).toFixed(2)))
    : null;
  if (outro !== null) {
    const near = starts.findIndex((x) => Math.abs(x - outro) < 12);
    if (near >= 0) starts[near] = outro; else starts.push(outro);
    starts.sort((a, b) => a - b);
    log(run, `CTA final calé sur l'appel parlé (${outro.toFixed(1)} s)`);
  }
  if (!starts.length) return null;
  try { return { seq: await renderCtaClip(run), starts }; }
  catch (e) { log(run, `CTA indisponible (${String(e.message).slice(0, 90)}) — montage sans bouton`); return null; }
}


function srt(sec) {
  const ms = Math.max(0, Math.round((Number(sec) || 0) * 1000)); const p = (n) => String(n).padStart(2, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))},${String(ms % 1000).padStart(3, "0")}`;
}

// ---------------------------------------------------------------- étape 7 : packaging

const PACK_RULES = [
  TITLE_RULES, "",
  "DESCRIPTION : 230-320 mots. Rejoue la tension en 2 phrases, puis le contexte de l'affaire,",
  "puis une invitation à s'abonner personnelle, puis 8-12 hashtags sans accents.",
  "⚠ Elle DOIT contenir la mention : « Les illustrations de cette vidéo sont des images",
  "d'évocation générées, elles ne représentent aucune personne réelle. »",
  "TAGS : 18 à 24, minuscules, les plus génériques de la niche d'abord.",
].join("\n");

async function stepPackaging(run) {
  const c = config();
  const insp = run.params.nicheId ? (() => { try { return bank.inspiration(run.params.nicheId, { maxTitles: 20 }); } catch { return ""; } })() : "";
  const j = await genJson([
    insp, "",
    `DOCUMENTAIRE : « ${run.title} » (affaire : ${run.affaire || "?"}, ${run.pays || "?"})`,
    run.script.slice(0, 2500), "",
    `Chaîne : ${run.params.channelName}.`, PACK_RULES, "",
    "MINIATURE — deux lignes seulement, EN CAPITALES, 18 caractères MAXIMUM par ligne.",
    "Elles forment UNE phrase, une amorce qui intrigue sans nommer l'affaire.",
    "Exemple valide : [\"ELLE N'EST JAMAIS\", \"RENTRÉE CHEZ ELLE\"].",
    "Plus deux prompts d'image EN ANGLAIS, SANS AUCUN visage identifiable :",
    "  • `portrait` : portrait ILLUSTRÉ et anonyme (peinture, jamais une photo) d'une personne",
    "    ORDINAIRE évoquant la victime — buste, visage de face bien éclairé, fond noir.",
    "    Ne décris ni la lumière ni le cadrage : la machine les impose.",
    "  • `medaillon` : un OBJET ou un LIEU de l'affaire, nocturne, sans personne.",
    "",
    'JSON UNIQUEMENT : {"title":"","description":"","tags":[],"thumbLines":["",""],',
    '"portrait":"(EN)","medaillon":"(EN)"}',
  ].join("\n"), { label: "Packaging", ms: 8 * 60 * 1000 });

  run.pack = {
    title: String(j.title || run.title).slice(0, 100),
    description: String(j.description || ""),
    tags: capTags((j.tags || []).map(String), 470),
    thumbLines: (j.thumbLines || []).slice(0, 2).map((x) => String(x).toUpperCase()),
    portrait: j.portrait || "", medaillon: j.medaillon || "",
  };
  saveRun(run);
  await generateThumbnail(run).catch((e) => log(run, `Miniature : ${e.message}`));
  log(run, "Packaging prêt");
}
function capTags(tags, max) {
  const out = []; let n = 0;
  for (const t of tags) { const c = t.length + (/\s/.test(t) ? 2 : 0) + (out.length ? 1 : 0); if (n + c > max) break; out.push(t); n += c; }
  return out;
}

/**
 * MINIATURE — gabarit validé avec l'utilisateur (« option 4 ») :
 *   médaillon circulaire cerclé de rouge à gauche · flèche · portrait ILLUSTRÉ anonyme à droite
 *   · deux lignes en bas, blanc puis rouge.
 * ⚠ Le portrait est une ÉVOCATION peinte, jamais le visage d'une personne réelle ; la mention
 *   figure dans la description (cf. PACK_RULES).
 */
const FONT = process.platform === "darwin"
  ? "/System/Library/Fonts/Supplemental/Arial Black.ttf" : "C\\:/Windows/Fonts/ariblk.ttf";
const CHAR_W = 0.78;   // MESURÉ au pixel sur Arial Black capitales (0,67 à 0,78 selon le mot)

async function generateThumbnail(run) {
  const dir = path.join(OUT_ROOT, run.id); ensureDir(dir);
  const p = run.pack;
  const model = T2I[config().settings.imageModel] || T2I.gpt;
  // ⚠ Le cadrage doit être IMPOSÉ au modèle, pas espéré : le premier run réel a rendu un portrait
  //   dont le visage tombait hors de la zone découpée — on ne voyait qu'une épaule.
  const PORTRAIT_GUARD =
    "COMPOSITION REQUIRED: head and shoulders CENTRED in the frame, FACING THE CAMERA in a " +
    "three-quarter front view, the face occupying the middle third of the image, both eyes open " +
    "and looking towards the viewer. The face must be the brightest element of the picture. " +
    "A generic everyday face.";

  const RECETTE = [
    ["portrait", PORTRAIT_GUARD, PORTRAIT_ART, PORTRAIT_NEG],
    ["medaillon", "No people at all, no human figure.", ART, NEG],
  ];
  for (const [k, guard, art, neg] of RECETTE) {
    const f = path.join(dir, `th-${k}.png`);
    if (fs.existsSync(f) || fs.existsSync(f.replace(".png", ".jpg"))) continue;
    const url = await kieRetry(model, { prompt: `${p[k]}. ${guard} ${art}. ${neg}.`, aspect_ratio: "16:9", resolution: "1K" }, { runId: run.id });
    await download(url, f);
    run.cost.images = (run.cost.images || 0) + PRICES.image;
    spend.record("Kie.ai", MACHINE_NAME, PRICES.image, "USD", `Miniature — ${k}`);
  }
  const pick = (k) => [path.join(dir, `th-${k}.png`), path.join(dir, `th-${k}.jpg`)].find(fs.existsSync);

  const txt = path.join(dir, "thtxt"); ensureDir(txt);
  const lines = (p.thumbLines || []).filter(Boolean).slice(0, 2);
  lines.forEach((t, i) => fs.writeFileSync(path.join(txt, `t${i}.txt`), t, "utf8"));
  const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), "");
  const size = Math.max(40, Math.min(72, Math.floor(1000 / (CHAR_W * Math.max(1, longest.length)))));
  const step = Math.round(size * 1.18);

  // anneau rouge : un disque sous le médaillon, ce qui évite toute estimation de contour
  const ring = path.join(dir, "th-ring.png");
  if (!fs.existsSync(ring))
    await ffmpeg(["-f", "lavfi", "-i", "color=c=0xE03131:s=420x420", "-vf",
      "format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt((X-210)*(X-210)+(Y-210)*(Y-210),210*210),255,0)'",
      "-frames:v", "1", ring]);

  // Le bloc est ancré au BAS (marge de 46 px) plutôt qu'à une ordonnée fixe : à 572 px, la
  // seconde ligne débordait du cadre dès que la police atteignait sa taille maximale.
  const bottom = 720 - 46;
  const draws = lines.map((t, i) => {
    const y = bottom - (lines.length - i) * step;
    return `drawtext=fontfile='${FONT}':textfile=thtxt/t${i}.txt:x=62:y=${y}:fontsize=${size}:` +
      `fontcolor=${i ? "0xE03131" : "white"}:borderw=7:bordercolor=black@0.95`;
  }).join(",");

  const out = path.join(dir, "thumbnail.jpg");
  await ffmpeg(["-i", path.basename(pick("portrait")), "-i", path.basename(pick("medaillon")), "-i", path.basename(ring),
    "-filter_complex",
    "color=black:s=1280x720[bg];" +
    "[0:v]scale=-1:900,crop=600:720:(iw-600)/2:90,eq=contrast=1.12:saturation=0.85,vignette=PI/4.5[av];" +
    "[av]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*clip(X/120,0,1)'[avf];" +
    "[bg][avf]overlay=680:0[s1];[s1][2:v]overlay=80:110[s2];" +
    "[1:v]scale=400:400:force_original_aspect_ratio=increase,crop=400:400,eq=saturation=0.5:brightness=-0.05,format=rgba," +
    "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt((X-200)*(X-200)+(Y-200)*(Y-200),200*200),255,0)'[med];" +
    "[s2][med]overlay=90:120[s3];" +
    `[s3]drawtext=fontfile='${FONT}':text='►':x=520:y=286:fontsize=64:fontcolor=0xE03131` + (draws ? "," + draws : ""),
    "-frames:v", "1", "-q:v", "2", "thumbnail.jpg"], { cwd: dir });

  run.thumb = { file: out, rel: `agent-os/output/machines/${run.id}/thumbnail.jpg` };
  run.thumbTs = Date.now();   // cache-buster : même chemin réécrit
  saveRun(run);
}

// ---------------------------------------------------------------- machine à états

const STEPS = [
  { k: "script", fn: stepScript, label: "Script" },
  { k: "voice", fn: stepVoice, label: "Voix" },
  { k: "intro", fn: stepIntro, label: "Intro avatar" },
  { k: "shots", fn: stepShots, label: "Plans" },
  { k: "images", fn: stepImages, label: "Images" },
  { k: "montage", fn: stepMontage, label: "Montage" },
  { k: "packaging", fn: stepPackaging, label: "Packaging" },
];
function deriveStatus(run) {
  if (run.pack && run.video) return "done";
  if (run.video) return "packaging_ready";
  const sh = run.shots || [];
  if (sh.length && sh.filter((s) => !s.covered).every((s) => s.image)) return "images_ready";
  if (sh.length && sh.filter((s) => !s.covered).every((s) => s.prompt)) return "shots_ready";
  if (run.introMode) return "intro_ready";
  if (run.voice) return "voice_ready";
  if (run.script) return "script_ready";
  return "created";
}
const ORDER = ["created", "script_ready", "voice_ready", "intro_ready", "shots_ready", "images_ready", "packaging_ready"];
const nextStep = (run) => { const st = deriveStatus(run); return st === "done" ? null : STEPS[ORDER.indexOf(st)] || null; };

const active = new Map();
async function advance(runId) {
  if (active.get(runId)) return { already: true };
  active.set(runId, true);
  try {
    for (;;) {
      const run = getRun(runId);
      if (!run) throw new Error("Run introuvable");
      if (cancelled.has(runId)) { run.status = "cancelled"; saveRun(run); break; }
      const step = nextStep(run);
      if (!step) { run.status = "done"; saveRun(run); await onDone(run); break; }
      run.status = `${step.k}_running`; saveRun(run);
      await tasks.updateTask(run.taskId, { step: step.label, status: "running" }).catch(() => {});
      try {
        await step.fn(run);
        // ⚠ Une étape qui réussit doit EFFACER l'erreur de la tentative précédente : sinon un
        //   run réparé continue d'afficher son ancien échec, et on croit qu'il a re-échoué.
        const fr = getRun(runId); fr.status = deriveStatus(fr); delete fr.error; saveRun(fr);
      } catch (e) {
        const fr = getRun(runId) || run;
        fr.status = `${step.k}_failed`; fr.error = e.message; saveRun(fr);
        log(fr, `❌ ${step.label} : ${e.message}`);
        await tasks.updateTask(fr.taskId, { step: `${step.label} — ${e.message}`, status: "failed" }).catch(() => {});
        return { ok: false, error: e.message };
      }
      if (run.mode !== "auto") break;
    }
    return { ok: true, status: getRun(runId)?.status };
  } finally { active.delete(runId); }
}
function validate(run) {
  const sh = (run.shots || []).filter((s) => !s.covered);
  const st = deriveStatus(run);
  if (st === "shots_ready" && sh.some((s) => !s.prompt)) return "Des prompts d'image manquent.";
  if (st === "images_ready" && sh.some((s) => !s.image)) return "Des images manquent.";
  return null;
}

/** Résumé lisible d'un sujet libre : première phrase, 90 caractères maximum. */
function shortTitle(subject) {
  const t = String(subject || "").trim();
  if (!t) return "Sans titre";
  const phrase = t.split(/(?<=[.!?:])\s/)[0] || t;
  return phrase.length > 90 ? phrase.slice(0, 87).trimEnd() + "…" : phrase;
}

function createRun(params = {}) {
  const c = config(); const s = c.settings;
  const durationMin = Math.max(8, Math.min(40, Number(params.durationMin) || 18));
  const id = "c" + Date.now().toString(36);
  const run = {
    // Titre COURT dès la création : le sujet peut être un paragraphe entier, et il s'affichait
    // en pleine largeur dans la liste des runs jusqu'à ce que le script pose le vrai titre.
    id, machineId: MACHINE_ID, title: shortTitle(params.subject),
    status: "created", mode: params.mode === "auto" ? "auto" : "semi",
    createdAt: new Date().toISOString(), cost: { images: 0, voice: 0, montage: 0 },
    params: {
      subject: String(params.subject || "").trim(),
      durationMin,
      international: params.international !== false,
      voiceId: params.voiceId || s.voiceId,
      avatarLookId: params.avatarLookId || s.avatarLookId,
      intro: ["auto", "toujours", "jamais"].includes(params.intro) ? params.intro : s.intro,
      subtitles: ["srt", "burn", "none"].includes(params.subtitles) ? params.subtitles : s.subtitles,
      channelName: params.channelName || c.channelName,
      nicheId: params.nicheId || c.nicheId,
      publishChannelId: params.publishChannelId || s.publishChannelId,
      publishPrivacy: params.publishPrivacy || s.publishPrivacy,
      kenStyle: ["centre", "gauche"].includes(params.kenStyle) ? params.kenStyle : s.kenStyle,
    },
    // Musiques tirées au sort DÈS la création : figées pour tout le run, donc une reprise de
    // montage ne change pas la bande-son en cours de route.
    music: pickMusic().map((m) => ({ id: m.id, name: m.name, seconds: m.seconds })),
    logs: [],
  };
  const t = tasks.createTask({ title: `Crime — ${run.title.slice(0, 60)}`,
    desc: `${durationMin} min · intro ${run.params.intro}`, machine: MACHINE_NAME, machineId: MACHINE_ID,
    runId: id, kind: "machine", step: "Script", progress: 2, status: "running" });
  run.taskId = t.id; saveRun(run);
  return run;
}
const cancelRun = (id) => { cancelled.add(id); const r = getRun(id); if (r) { r.status = "cancelled"; saveRun(r); } return { ok: true }; };
function resumeRun(id) {
  if (active.get(id)) throw new Error("Un traitement est déjà en cours sur ce run");
  cancelled.delete(id); advance(id).catch(() => {}); return { ok: true };
}
const strandedRuns = () => listRuns().filter((r) => /_running$/.test(String(r.status)) && !active.get(r.id));
/**
 * Balayage au demarrage. Deux roles :
 *   1. reclasser les runs restes en `*_running` (leur advance() est mort avec le process) ;
 *   2. ⚠ RATTRAPER LE STOCK. `addToStock` n'etait appele que par `onDone()`, en sortie normale
 *      de la boucle advance(). Un run interrompu qui atteint quand meme `done` par
 *      `deriveStatus` n'y passait jamais : video, miniature et packaging sur le disque, et
 *      AUCUNE ligne de stock — donc invisible dans l'onglet Stock, et impossible a publier.
 *      Vecu sur le run cmtlpl0vt. `addToStock` est idempotent (il teste l'id), le rattrapage
 *      est donc sur.
 */
function sweepRuns() {
  let n = 0;
  for (const r of listRuns()) {
    const f = getRun(r.id); if (!f) continue;
    if (/_running$/.test(String(f.status))) { f.status = deriveStatus(f); saveRun(f); n++; }
    if (f.status === "done" && f.video?.rel) addToStock(f);
  }
  return n;
}

// ---------------------------------------------------------------- stock & publication

const stock = () => readJSON(`machines/${MACHINE_ID}-stock.json`, []);
const saveStock = (l) => writeJSON(`machines/${MACHINE_ID}-stock.json`, l);
function addToStock(run) {
  const l = stock(); if (l.some((x) => x.id === run.id)) return;
  l.unshift({ id: run.id, runId: run.id, title: run.pack?.title || run.title, affaire: run.affaire || "",
    createdAt: new Date().toISOString(), durationSec: run.video?.seconds, videoRel: run.video?.rel,
    thumbRel: run.thumb?.rel, shots: (run.shots || []).length, cost: run.cost,
    introMode: run.introMode, channelId: null, videoId: null, posted: false, archived: false });
  saveStock(l);
}
function patchStock(id, p = {}) {
  const l = stock(); const e = l.find((x) => x.id === id);
  if (!e) throw new Error("Entrée de stock introuvable");
  for (const k of ["archived", "posted"]) if (p[k] !== undefined) e[k] = !!p[k];
  for (const k of ["videoId", "channelId", "title"]) if (p[k] !== undefined) e[k] = p[k];
  saveStock(l); return e;
}
async function onDone(run) {
  addToStock(run);
  await tasks.updateTask(run.taskId, { step: "Terminé", progress: 100, status: "done" }).catch(() => {});
}
async function publishRun(id, { channelId, privacy } = {}) {
  const run = getRun(id);
  if (!run?.video?.file) throw new Error("Aucune vidéo à publier");
  const ch = channelId || run.params.publishChannelId;
  if (!ch) throw new Error("Aucune chaîne sélectionnée");
  // ⚠ signature à TROIS arguments (piège vécu sur Bouddhisme)
  const r = await google.youtubeUpload(ch, run.video.file, {
    title: run.pack?.title || run.title, description: run.pack?.description || "",
    tags: run.pack?.tags || [], categoryId: "24",
    privacyStatus: privacy || run.params.publishPrivacy || "private",
  });
  if (run.thumb?.file) await google.youtubeSetThumbnail(r.id, run.thumb.file).catch(() => {});
  // Piste de sous-titres : meilleure que la gravure (référencement, traduction auto, désactivable).
  // Best-effort : un scope manquant ne doit jamais annuler une publication réussie.
  let captions = null;
  if (run.srt?.file && fs.existsSync(run.srt.file)) {
    try {
      await google.youtubeUploadCaption(ch, r.id, run.srt.file, { language: "fr", name: "Français" });
      captions = "envoyés";
      log(run, "Sous-titres .srt envoyés à YouTube");
    } catch (e) { captions = `échec : ${e.message}`; log(run, `Sous-titres non envoyés — ${e.message}`); }
  }
  run.published = { id: r.id, url: `https://youtu.be/${r.id}`, at: new Date().toISOString(), captions };
  saveRun(run);
  try { patchStock(id, { posted: true, videoId: r.id, channelId: ch }); } catch {}
  return run.published;
}

const producedThemes = () => [...listRuns().map((r) => r.title), ...stock().map((s) => `${s.title} (${s.affaire})`)].filter(Boolean).slice(0, 60);
async function suggestTheme(nicheId) {
  const insp = (nicheId || config().nicheId) ? (() => { try { return bank.inspiration(nicheId || config().nicheId, { maxTitles: 20 }); } catch { return ""; } })() : "";
  const deja = producedThemes();
  return genJson([
    insp, "", "Propose UNE affaire criminelle réelle à traiter, française ou internationale.",
    "Privilégie une affaire NON française et peu couverte en francophonie : c'est là qu'il y a de la place.",
    deja.length ? `DÉJÀ TRAITÉES — ni reprise ni variante proche :\n- ${deja.join("\n- ")}` : "",
    'JSON UNIQUEMENT : {"subject":"(l\'affaire et son angle, 2 phrases)","pitch":"(le titre-amorce pressenti)"}',
  ].join("\n"), { label: "Idée", ms: 5 * 60 * 1000 });
}
function estimate(p = {}) {
  const min = Number(p.durationMin) || 18;
  const mots = expectedWords(min);
  const per = Number(config().settings.wordsPerImage) || WORDS_PER_IMAGE;
  const introSec = p.intro === "jamais" ? 0 : INTRO_MAX_SEC;
  const shots = Math.max(1, Math.round((mots - introSec / 60 * WPM) / per));
  const images = (shots + 2) * PRICES.image;                       // +2 pour la miniature
  const voice = (mots * 5.7 / 1000) * PRICES.voicePer1kChars;
  const sub = p.subtitles === true ? "burn" : (p.subtitles || "srt");
  const whisper = sub === "none" ? 0 : min * 60 * PRICES.whisperPerSec;
  return { mots, shots, images: +images.toFixed(2), voice: +voice.toFixed(2), whisper: +whisper.toFixed(2),
           total: +(images + voice + whisper).toFixed(2) };
}

module.exports = {
  MACHINE_ID, MACHINE_NAME, PRICES, WPM, WORDS_PER_IMAGE, INTRO_MAX_SEC, INTRO_MAX_WORDS,
  config, patchConfig, listRuns, getRun, createRun, advance, validate, cancelRun, resumeRun,
  strandedRuns, sweepRuns, deriveStatus, estimate, expectedWords,
  stock, addToStock, patchStock, publishRun, suggestTheme, producedThemes, generateThumbnail,
  heygen, voices, music,
};
