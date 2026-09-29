/**
 * MACHINE « DRAMA » — mélodrame de revanche africain francophone.
 * Pipeline : Script → Casting → Prompts → Images → Voix → Clips → Montage → Packaging
 *
 * Recette DÉRIVÉE de la banque « Africa Drama » (27 vidéos, 2 chaînes), pas inventée :
 * humiliation → karma, trahison familiale, riche déguisé en pauvre, majuscules sur les mots-chocs,
 * points de suspension avant le retournement, suffixe « | Histoire Africaine ».
 *
 * Contraintes ÉTABLIES PAR LE PROTOTYPE (docs/niche-drama.md) — ne pas les relâcher :
 *  - Une réplique EXIGE un plan rapproché quasi frontal : hors de ce cadrage, veed/lipsync ne
 *    produit RIEN (phase 6, vérifié en lecture).
 *  - 13-14 MOTS MAXIMUM par plan animé : au-delà, la phrase dépasse les 6 s de Grok et le clip
 *    doit être ralenti — la vidéo entière paraît molle (phase 3, 4 clips sur 5 ralentis).
 *  - 2 RÉFÉRENCES i2i maximum par plan (au-delà, les identités se mélangent).
 *  - Le débit d'une voix varie de 12-16 % d'une synthèse à l'autre : on ne calcule JAMAIS un
 *    montage depuis un débit attendu. On synthétise, on sonde, on cale la VIDÉO dessus.
 *  - Relancer un job Kie perdu plutôt qu'allonger le délai ; ne PAS relancer une erreur de requête.
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
const cast = require("./drama-cast");

const MACHINE_ID = "drama";
const MACHINE_NAME = "Drama";
const ROOT = path.join(__dirname, "..", "..", "..");
const OUT_ROOT = path.join(__dirname, "..", "..", "output", "machines");
const intro = require("../intro");
const REMOTION_DIR = path.join(ROOT, "remotion");
const RUNS_DIR = path.join(DATA_DIR, "machines", "runs", MACHINE_ID); // sous-dossier : listRuns ne voit que nos runs
ensureDir(RUNS_DIR);

// ---------------------------------------------------------------- constantes

const PRICES = {
  image: 0.03,              // gpt-image-2 (1K)
  videoPerSec: 0.015,       // grok-imagine-video-1-5-preview
  voicePer1kChars: 0.10,    // ElevenLabs v3
  lipsyncPerMin: 0.40,      // veed/lipsync
  whisperPerSec: 0.0008,
};

/** Français en tête : c'est le marché mesuré (docs/niche-drama.md, Q1). */
const LANGS = ["Français", "English", "Português", "Español", "Kiswahili"];

const RYTHMES = {
  anime:  { label: "Tout animé",    ratio: 1.00, desc: "chaque plan est un clip vidéo — le plus cher, le plus vivant" },
  mixte:  { label: "Mixte",         ratio: 0.35, desc: "les plans d'action et de bascule sont animés, le reste en image animée" },
  fixe:   { label: "Images fixes",  ratio: 0.00, desc: "aucun clip vidéo, mouvement de caméra simulé (Ken Burns)" },
};

const CLIP_SEC = 6;          // fenêtre utilisable de Grok : 6-7 s (8-10 s bascule en multishot)
const WORDS_MAX = 13;        // MESURÉ : au-delà, le clip doit être ralenti
const CTA_FIRST = 20;        // premier appel à 20 s
const CTA_EVERY = 120;       // puis toutes les 2 minutes
const CTA_LOGO = "africa-drama-logo.png";  // remotion/public/
/** Logo permanent en haut à gauche — même taille que Crime (sortie 1280 de large). */
const CORNER_LOGO_PX = 95;

/** Règle produit imposée par l'utilisateur : toute voiture est la MÊME. */
const CAR_RULE =
  "Any car that appears in any shot MUST be the exact same vehicle: a black luxury Mercedes sedan " +
  "with glossy black paint, chrome trim and fully tinted dark windows. Never any other car, never " +
  "another colour, never another brand. Do not show any brand logo or badge on it.";

const NEG =
  "no text, no letters, no subtitles, no watermark, no logo, no brand name, no trademark, " +
  "no distorted hands or faces, no collage, no split frame, no border";

const runPath = (id) => path.join(RUNS_DIR, `${id}.json`);
const getRun = (id) => readJSON(`machines/runs/${MACHINE_ID}/${id}.json`, null);
const saveRun = (r) => writeJSON(`machines/runs/${MACHINE_ID}/${r.id}.json`, r);
function listRuns() {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json"))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), "utf8")); } catch { return null; } })
    .filter(Boolean)
    .map((r) => ({ id: r.id, title: r.title, status: r.status, mode: r.mode, createdAt: r.createdAt,
                   sceneCount: r.sceneCount, cost: r.cost, params: r.params, published: r.published }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
function log(run, msg) {
  run.logs = (run.logs || []).slice(-200);
  run.logs.push({ t: new Date().toISOString(), msg: String(msg) });
  saveRun(run);
}

const DEFAULTS = {
  nicheId: null,
  channelName: "Africa Drama TV",
  settings: {
    style: "3d",
    rythme: "mixte",
    imageModel: "gpt",
    lipsync: true,
    subtitles: false,
    ctaFirst: CTA_FIRST,
    ctaEvery: CTA_EVERY,
    narratorVoiceId: null,
    promptModel: "",
    autoPublish: false,
    publishPrivacy: "private",
    sting: true,                 // générique de chaîne de 5 s en tête
    stingSubtitle: "Histoires d'Afrique",
    stingAccent: "#e09a55",      // orangé chaud — teinte relevée sur le logo
    cornerLogo: true,            // logo de chaîne en haut à gauche, toute la vidéo
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

// ---------------------------------------------------------------- Claude

const genModel = () => config().settings.promptModel || undefined;
const askGen = (prompt, ms = 6 * 60 * 1000) => claude.ask(prompt, { timeoutMs: ms, model: genModel() });
async function genJson(prompt, { ms = 6 * 60 * 1000, tries = 3, label = "" } = {}) {
  let last;
  for (let a = 1; a <= tries; a++) {
    try {
      const out = await askGen(prompt, ms);
      const m = String(out).match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (!m) throw new Error("aucun JSON dans la réponse");
      return JSON.parse(m[0]);
    } catch (e) { last = e; }
  }
  throw new Error(`${label || "Génération"} : ${last?.message || "échec"}`);
}

/** Pool ROULANT : dès qu'une tâche finit, la suivante démarre (pas de blocs). */
async function pool(items, worker, concurrency = 8) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await worker(items[k], k); }
      catch (e) { out[k] = { error: e.message }; }
    }
  }));
  return out;
}

// ---------------------------------------------------------------- transport Kie

const kieKey = () => { const k = vault.get("kie"); if (!k) throw new Error("Clé Kie absente du coffre"); return k; };
const FATAL = /must be|invalid|unauthorized|not found|bad request|required/i;

async function kieCreate(model, input) {
  const r = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
    method: "POST",
    headers: { Authorization: `Bearer ${kieKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  }).then((x) => x.json());
  if (!r.data?.taskId) throw new Error(`Kie ${model} : ${r.msg || JSON.stringify(r).slice(0, 160)}`);
  return r.data.taskId;
}
const cancelledRuns = new Set();
async function kiePoll(taskId, { timeoutMs = 15 * 60 * 1000, intervalMs = 12000, runId } = {}) {
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, intervalMs));
    if (runId && cancelledRuns.has(runId)) throw new Error("Annulée par l'utilisateur");
    if (Date.now() - t0 > timeoutMs) throw new Error("Kie : délai dépassé");
    const r = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`,
      { headers: { Authorization: `Bearer ${kieKey()}` } }).then((x) => x.json());
    if (r.data?.state === "success") return JSON.parse(r.data.resultJson).resultUrls[0];
    if (r.data?.state === "fail") throw new Error(`Kie : ${r.data?.failMsg || "génération échouée"}`);
  }
}
/** Relance un job PERDU ; ne rejoue JAMAIS une requête malformée (phases 4 et 6 du prototype). */
async function kieRetry(model, input, { tries = 2, runId } = {}) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try { return await kiePoll(await kieCreate(model, input), { runId }); }
    catch (e) { last = e; if (FATAL.test(e.message) || /Annulée/.test(e.message)) throw e; }
  }
  throw last;
}
/** Nommer d'après les OCTETS pour les IMAGES seulement — sur une vidéo ça crée « x.mp4.png ». */
async function download(url, file) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Téléchargement ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (/\.(mp4|mov|webm|mp3|m4a|wav)$/i.test(file)) { fs.writeFileSync(file, buf); return file; }
  const out = file.replace(/\.(png|jpe?g)$/i, "") + (buf[0] === 0xff && buf[1] === 0xd8 ? ".jpg" : ".png");
  fs.writeFileSync(out, buf);
  return out;
}
/** Upload public RÉSILIENT : Drive renvoie du HTML quand il throttle → `.json()` explose. */
async function uploadPublic(name, file, mime) {
  let last;
  for (let i = 1; i <= 3; i++) {
    try {
      const up = await google.driveUpload(name, mime, fs.readFileSync(file));
      await google.ensurePublic(up.id).catch(() => {});
      return `https://drive.google.com/uc?export=download&id=${up.id}`;
    } catch (e) { last = e; if (i < 3) await new Promise((r) => setTimeout(r, 4000 * i)); }
  }
  throw new Error(`Upload Drive impossible : ${String(last?.message).slice(0, 120)}`);
}

/** spawn : TOUJOURS consommer stdout, sinon le pipe de 64 Ko fige le process. */
function run(cmd, args, { cwd } = {}) {
  return new Promise((res, rej) => {
    const c = spawn(cmd, args, { cwd, windowsHide: true });
    let err = "";
    c.stdout.on("data", () => {});
    c.stderr.on("data", (d) => { err += d.toString().slice(-4000); });
    c.on("error", rej);
    c.on("close", (code) => (code === 0 ? res() : rej(new Error(`${cmd} ${code} : ${err.slice(-500)}`))));
  });
}
const ffmpeg = (args, opts) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], opts);

// ---------------------------------------------------------------- LA RECETTE (dérivée de la banque)

/**
 * Invariants relevés sur les 27 vidéos de la banque « Africa Drama » :
 *  - une humiliation subie publiquement, puis un RETOURNEMENT total (le karma est nommé) ;
 *  - la trahison vient de la FAMILLE ou du VOISINAGE (belle-mère, sœur, cousine, voisine) ;
 *  - le riche se cache sous les habits du pauvre, ou l'inverse ;
 *  - le personnage humilié ne se venge pas : il réussit, et les autres viennent à lui.
 */
const STORY_BEATS = [
  "ouverture — on montre l'humiliation en cours, sans explication",
  "présentation de l'humilié·e : sa dignité quotidienne, son travail, son silence",
  "la trahison se met en place, invisible pour la victime",
  "premier coup dur : une perte concrète (emploi, logement, respect)",
  "le talent ou la vertu cachée apparaît, connue du seul spectateur",
  "aggravation : celui qui trahit croit avoir gagné",
  "bascule — un tiers découvre la vérité, ou le hasard la révèle",
  "le renversement s'installe : la situation s'inverse concrètement",
  "confrontation : le traître doit demander quelque chose à sa victime",
  "épilogue moral, court, adressé au spectateur",
];

function coreRules(params, entries) {
  const persos = entries.filter((e) => e.kind === "personnage")
    .map((e) => `- ${e.name}${e.role ? ` — ${e.role}` : ""}`).join("\n") || "- (à créer)";
  const lieux = entries.filter((e) => e.kind !== "personnage")
    .map((e) => `- ${e.name} [${e.kind}]${e.role ? ` — ${e.role}` : ""}`).join("\n");
  return [
    `LANGUE DU CONTENU : ${params.language}. Toute réplique et toute narration sont dans cette langue.`,
    "",
    "GENRE : mélodrame moral africain francophone. Humiliation → karma → renversement total.",
    "Le personnage humilié ne se venge JAMAIS activement : il réussit, et ceux qui l'ont méprisé",
    "finissent par avoir besoin de lui. C'est cette inversion qui fait la niche.",
    "",
    "PERSONNAGES DU RÉCIT — respecte le rôle indiqué, c'est le choix de l'utilisateur :",
    persos,
    lieux ? "\nDÉCORS ET VÉHICULES DISPONIBLES :\n" + lieux : "",
    "",
    "RÈGLES DE PLAN — non négociables, elles viennent de mesures :",
    `- Toute réplique fait AU PLUS ${WORDS_MAX} MOTS. Au-delà, le plan doit être ralenti et la vidéo`,
    "  paraît molle. Compter les mots, pas les caractères.",
    "- Un plan qui porte une réplique est FORCÉMENT un plan rapproché quasi frontal sur celui qui",
    "  parle (visage entier, bien éclairé, très légèrement tourné). Hors de ce cadrage la",
    "  synchronisation labiale ne rend rien du tout.",
    "- Un plan large ou à deux personnages ne porte JAMAIS de réplique : il est muet, sous narration.",
    "- Un seul personnage parle par plan.",
    "",
    "CONTRAINTE DE PRODUCTION :",
    CAR_RULE,
  ].join("\n");
}

/** L'INTRO — le point que l'utilisateur a demandé explicitement. */
const INTRO_RULES = [
  "L'INTRO EST LA PARTIE LA PLUS IMPORTANTE. Elle décide si le spectateur reste.",
  "Structure imposée, dans cet ordre :",
  "  1. FROID : on ouvre EN PLEIN sur le pic d'humiliation, sans contexte, sans présentation.",
  "     Une phrase de dialogue cinglante ou un geste violent. Le spectateur ne comprend pas encore.",
  "  2. REMBOBINAGE annoncé à voix haute par le conteur : « pour comprendre comment elle en est",
  "     arrivée là, il faut revenir en arrière ». C'est ce que fait la chaîne la plus performante",
  "     de la banque, mot pour mot.",
  "  3. PROMESSE : le conteur annonce qu'à la fin, la situation sera exactement inversée —",
  "     sans dire comment. C'est la raison de rester.",
  "L'intro fait 3 à 5 plans, pas plus. Elle ne raconte rien : elle promet.",
].join("\n");

/** L'appel à l'action, parlé DANS l'histoire — relevé au transcript d'INSPIRADOR Afrique. */
function ctaLine(language, channelName) {
  if (language !== "Français") {
    return `A short spoken line by the narrator asking to LIKE the video and SUBSCRIBE to ${channelName}, ` +
           `and to say IN THE COMMENTS which country they are watching from. One sentence, warm, natural.`;
  }
  return `Une phrase courte du conteur : demander un like, l'abonnement à ${channelName}, et « dis-nous ` +
         `en commentaire depuis quel pays tu regardes ». Chaleureux, naturel, jamais insistant.`;
}

// ---------------------------------------------------------------- étape 1 : script

function expectedShots(durationMin, rythme) {
  // ~13 mots/plan à ~150 mots/min → ~5,2 s de parole + respiration ≈ 6 s par plan.
  return Math.round((durationMin * 60) / 6.2);
}

async function stepScript(run) {
  const p = run.params;
  const insp = p.nicheId ? (() => { try { return bank.inspiration(p.nicheId, { maxTitles: 20, maxVisions: 1 }); } catch { return ""; } })() : "";
  const shots = expectedShots(p.durationMin, p.rythme);
  // ⚠ ORDRE : le script s'écrit AVANT le casting. Si des personnages sont ÉPINGLÉS, le script
  // doit être écrit POUR EUX dès la première ligne — sinon il invente une héroïne et le casting
  // ne fait que rattraper, ce qui donne une protagoniste différente à chaque vidéo.
  const fixes = cast.pinned();
  if (fixes.length) log(run, `Personnages fixes imposés au script : ${fixes.map((e) => e.name).join(", ")}`);
  const blocFixes = fixes.length
    ? [
        "PERSONNAGES FIXES DE LA CHAÎNE — l'histoire s'écrit AUTOUR D'EUX, ils ne changent jamais :",
        ...fixes.map((e) => `- ${e.name}${e.role ? ` — ${e.role}` : ""}${e.desc ? ` (${String(e.desc).slice(0, 90)})` : ""}`),
        "Ne les renomme pas, ne change pas leur rôle, ne les remplace pas par des équivalents.",
        "Tu peux ajouter d'autres personnages secondaires autour d'eux.",
        "",
      ].join("\n")
    : "";
  log(run, `Script : ${p.durationMin} min ≈ ${shots} plans`);
  const out = await genJson([
    blocFixes,
    insp,
    "",
    `Écris le SQUELETTE d'une histoire de ${p.durationMin} minutes pour cette niche.`,
    p.subject ? `Sujet imposé : « ${p.subject} »` : "Choisis un sujet neuf, dans les codes de la niche.",
    "",
    INTRO_RULES,
    "",
    "Déroulé attendu (adapte, ne récite pas) :",
    STORY_BEATS.map((b, i) => `  ${i + 1}. ${b}`).join("\n"),
    "",
    `LANGUE : ${p.language}.`,
    "",
    'JSON UNIQUEMENT : {"title":"...","logline":"...","characters":[{"name":"...","role":"...",',
    '"desc":"(EN, physique seul, 40-70 mots, un accessoire distinctif permanent)"}],',
    '"synopsis":"(8 à 14 phrases, le déroulé complet, fin comprise)"}',
    "",
    "Le titre suit les codes RELEVÉS dans la niche : majuscules sur les mots-chocs, points de",
    "suspension avant le retournement, et le suffixe « | Histoire Africaine ».",
  ].join("\n"), { label: "Script", ms: 8 * 60 * 1000 });

  run.title = String(out.title || "Sans titre").slice(0, 160);
  run.story = { logline: out.logline || "", synopsis: out.synopsis || "", characters: out.characters || [] };
  run.sceneCount = shots;
  saveRun(run);
  log(run, `Script prêt : « ${run.title} »`);
}

// ---------------------------------------------------------------- étape 2 : casting

async function stepCast(run) {
  const p = run.params;
  log(run, "Casting : distribution des rôles…");
  const plan = await cast.planLibrary({
    title: run.title,
    script: run.story.synopsis,
    style: p.style,
    storyCharacters: run.story.characters || [],
  });
  for (const r of plan.refused || []) log(run, `Casting refusé : ${r.name} (${r.reason}) → rabattu sur ${r.closest || "existant"}`);

  const used = await cast.applyPlan(plan, { onLog: (m) => log(run, m) });

  // --- table de distribution lisible ET modifiable par l'utilisateur ---
  const entries = cast.list().entries;
  run.casting = (run.story.characters || []).map((c) => {
    const map = (plan.mapping || []).find((x) => String(x.story).toLowerCase() === String(c.name).toLowerCase());
    let e = map?.entryId ? entries.find((x) => x.id === map.entryId) : null;
    if (!e && map?.newName) e = entries.find((x) => x.name === map.newName);
    return { story: c.name, storyRole: c.role || "", entryId: e?.id || null, entryName: e?.name || null, why: map?.why || "" };
  });
  const orphelins = run.casting.filter((c) => !c.entryId);
  if (orphelins.length) log(run, `⚠ Sans fiche : ${orphelins.map((o) => o.story).join(", ")} — à distribuer à la main`);

  applyCastingNames(run);

  // Une VOIX par personnage : la même d'un épisode à l'autre.
  const lib = voices.list();
  const libre = lib.filter((v) => !used.some((u) => u.voiceId === v.id));
  for (const u of used) {
    if (u.kind !== "personnage" || u.voiceId) continue;
    const v = libre.shift() || lib[0];
    if (v) { cast.patch(u.id, { voiceId: v.id }); u.voiceId = v.id; log(run, `Voix attribuée à ${u.name} : ${v.name}`); }
  }
  run.cast = used.map((u) => ({ id: u.id, name: u.name, kind: u.kind, role: u.role || "", voiceId: u.voiceId || null }));
  saveRun(run);
  log(run, `Casting : ${run.casting.filter((c) => c.entryId).length}/${run.casting.length} rôle(s) distribué(s)`);
}

/**
 * Le script nomme ses personnages librement ; les fiches ont leurs propres noms.
 * Sans réconciliation, `assignRefs` cherche « Fatoumata » dans une bibliothèque qui ne connaît
 * qu'« Aminata » et n'attache AUCUNE référence — les plans partent sans ancrage i2i.
 * On réécrit donc le synopsis avec les noms des FICHES : ils font foi pour tout l'aval.
 */
function applyCastingNames(run) {
  for (const c of run.casting || []) {
    if (!c.entryName || c.entryName === c.story) continue;
    const re = new RegExp(String(c.story).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    run.story.synopsis = String(run.story.synopsis).replace(re, c.entryName);
    for (const ch of run.story.characters || []) if (ch.name === c.story) ch.name = c.entryName;
    log(run, `Renommé dans l'histoire : « ${c.story} » → « ${c.entryName} »`);
  }
}

/** Distribution manuelle : l'utilisateur réattribue les rôles avant de continuer. */
function setCasting(runId, mapping = []) {
  const run = getRun(runId);
  if (!run) throw new Error("Run introuvable");
  if (!run.casting) throw new Error("Le casting n'a pas encore été calculé");
  if (/_running$/.test(String(run.status))) throw new Error("Un traitement est en cours sur ce run");
  const entries = cast.list().entries;
  for (const m of mapping) {
    const c = run.casting.find((x) => x.story === m.story);
    if (!c) continue;
    const e = m.entryId ? entries.find((x) => x.id === m.entryId) : null;
    // Le renommage aval s'appuie sur le nom d'ORIGINE : on le conserve tel quel.
    c.entryId = e?.id || null;
    c.entryName = e?.name || null;
    c.why = e ? "choisi à la main" : "";
  }
  applyCastingNames(run);
  run.cast = run.casting.filter((c) => c.entryId).map((c) => {
    const e = entries.find((x) => x.id === c.entryId);
    return { id: e.id, name: e.name, kind: e.kind, role: c.storyRole || e.role || "", voiceId: e.voiceId || null };
  });
  saveRun(run);
  return run;
}

// ---------------------------------------------------------------- étape 3 : prompts (storyboard + lots)

const SCENE_SCHEMA =
  '{"i":1,"role":"intro|recit|cta|final","beat":"...","speaker":"(nom du personnage qui parle, ou null)",' +
  '"line":"(sa réplique, ≤ 13 mots — ou null si personne ne parle)",' +
  '"narration":"(phrase du conteur, ≤ 13 mots — ou null)",' +
  '"decor":"(lieu court)","animate":true,' +
  '"image_prompt":"(EN, ≥ 500 caractères, cadrage + action + lumière + ambiance ; JAMAIS le physique d\'un personnage ancré)",' +
  '"video_prompt":"(EN, ≥ 400 caractères, UN mouvement de caméra lent et continu ; interdiction de parole)"}';

async function stepPrompts(run) {
  const p = run.params;
  const entries = cast.list().entries.filter((e) => run.cast.some((c) => c.id === e.id));
  const rules = coreRules(p, run.cast.map((c) => ({ ...c, ...(entries.find((e) => e.id === c.id) || {}) })));
  const n = run.sceneCount;
  const ctaAt = [];
  { let t = p.ctaFirst; while (t < p.durationMin * 60) { ctaAt.push(Math.max(1, Math.round(t / 6.2))); t += p.ctaEvery; } }

  // STORYBOARD en UN appel : un beat unique par plan. Sans lui, les lots parallèles refont tous
  // la même scène (leçon Time Travel : 17 répétitions au premier test).
  log(run, `Storyboard : ${n} plans, CTA aux plans ${ctaAt.join(", ")}`);
  const sb = await genJson([
    rules, "", INTRO_RULES, "",
    `HISTOIRE : ${run.title}`, run.story.synopsis, "",
    `Découpe cette histoire en EXACTEMENT ${n} plans numérotés de 1 à ${n}.`,
    `Les plans ${ctaAt.join(", ")} sont des plans « cta » : le conteur y glisse l'appel à l'action`,
    "sans casser le récit (aucun personnage ne parle sur ces plans).",
    "Les 3 à 5 premiers plans forment l'INTRO selon la structure imposée ci-dessus.",
    "",
    'JSON UNIQUEMENT : {"shots":[{"i":1,"role":"intro|recit|cta|final","beat":"(ce qui se passe, une ligne)",',
    '"speaker":"(nom ou null)","decor":"(lieu court)"}]}',
    "",
    "Chaque beat est DIFFÉRENT des autres. Aucune répétition de situation.",
  ].join("\n"), { label: "Storyboard", ms: 10 * 60 * 1000 });

  const shots = (sb.shots || []).slice(0, n);
  if (shots.length < n) throw new Error(`Storyboard incomplet : ${shots.length}/${n} plans`);

  // Quels plans sont animés — le levier de coût, réglé par le rythme choisi.
  const ratio = RYTHMES[p.rythme].ratio;
  const prio = shots.map((s, k) => ({ k, score: (s.role === "intro" ? 3 : 0) + (s.speaker ? 2 : 0) + (s.role === "final" ? 2 : 0) }))
    .sort((a, b) => b.score - a.score);
  const nAnim = Math.round(shots.length * ratio);
  const animSet = new Set(prio.slice(0, nAnim).map((x) => x.k));
  shots.forEach((s, k) => (s.animate = animSet.has(k)));

  // ÉTOFFAGE par lots parallèles : les lots ne font qu'habiller un beat déjà attribué.
  const BATCH = 6;
  const lots = [];
  for (let i = 0; i < shots.length; i += BATCH) lots.push(shots.slice(i, i + BATCH));
  log(run, `Étoffage : ${lots.length} lot(s) de ${BATCH} plans en parallèle`);

  const done = await pool(lots, async (lot) => {
    const j = await genJson([
      rules, "",
      `HISTOIRE : ${run.title}`, run.story.synopsis, "",
      "Étoffe CES plans, sans en ajouter ni en retirer, sans changer leur beat :",
      JSON.stringify(lot),
      "",
      `Pour chaque plan, rends l'objet complet au format : ${SCENE_SCHEMA}`,
      "",
      "RAPPELS CRITIQUES :",
      `- réplique et narration : ${WORDS_MAX} MOTS MAXIMUM, comptés.`,
      "- si le plan a un `speaker`, son image_prompt DOIT décrire un plan rapproché quasi frontal",
      "  sur ce personnage, visage entier et bien éclairé.",
      "- ne décris JAMAIS le physique d'un personnage de la troupe : dis « the exact same person as",
      "  in the reference image » et ne décris que sa TENUE, son émotion, son action.",
      `- ${CAR_RULE}`,
      "- video_prompt : UN seul mouvement de caméra lent et continu, et l'interdiction de parole",
      "  répétée au début ET à la fin.",
      "",
      'JSON UNIQUEMENT : {"shots":[ ... ]}',
    ].join("\n"), { label: "Lot de plans", ms: 10 * 60 * 1000 });
    return j.shots || [];
  }, 5);

  const scenes = [];
  for (const d of done) if (Array.isArray(d)) scenes.push(...d);
  scenes.sort((a, b) => (a.i || 0) - (b.i || 0));

  // Reprise des manquants UN PAR UN plutôt que d'échouer (leçon Bouddhisme : un lot revenait
  // systématiquement incomplet et l'étape mourait au lieu de rattraper).
  const missing = shots.filter((s) => !scenes.some((x) => x.i === s.i));
  if (missing.length) {
    log(run, `Rattrapage de ${missing.length} plan(s) manquant(s)`);
    const rec = await pool(missing, async (s) => {
      const j = await genJson([rules, "", `HISTOIRE : ${run.title}`, run.story.synopsis, "",
        "Étoffe CE seul plan :", JSON.stringify(s), "",
        `Format : ${SCENE_SCHEMA}`, `Réplique et narration : ${WORDS_MAX} mots maximum.`,
        'JSON UNIQUEMENT : {"shots":[ ... ]}'].join("\n"), { label: `Plan ${s.i}`, ms: 6 * 60 * 1000 });
      return (j.shots || [])[0];
    }, 4);
    for (const r of rec) if (r && r.i) scenes.push(r);
    scenes.sort((a, b) => (a.i || 0) - (b.i || 0));
  }

  // Garde-fou en CODE sur la longueur : le prompt ne suffit jamais.
  for (const sc of scenes) {
    for (const k of ["line", "narration"]) {
      if (!sc[k]) continue;
      const w = String(sc[k]).trim().split(/\s+/);
      if (w.length > WORDS_MAX) { sc[k] = w.slice(0, WORDS_MAX).join(" "); sc.trimmed = true; }
    }
    const src = shots.find((s) => s.i === sc.i);
    if (src) sc.animate = src.animate;
  }
  const trimmed = scenes.filter((s) => s.trimmed).length;
  if (trimmed) log(run, `⚠ ${trimmed} réplique(s) tronquée(s) à ${WORDS_MAX} mots par le garde-fou`);

  // CTA parlé : on écrit la phrase une fois et on la pose sur les plans « cta ».
  const cta = await askGen(ctaLine(p.language, p.channelName) + "\nRends UNIQUEMENT la phrase, sans guillemets.", 3 * 60 * 1000);
  for (const sc of scenes) if (sc.role === "cta") { sc.narration = String(cta).trim().split(/\s+/).slice(0, 22).join(" "); sc.speaker = null; sc.line = null; }

  cast.assignRefs({ scenes, entries });
  run.scenes = scenes;
  saveRun(run);
  log(run, `Prompts : ${scenes.length} plans — ${scenes.filter((s) => s.animate).length} animés, ${scenes.filter((s) => s.speaker).length} dialogués`);
}

// ---------------------------------------------------------------- étape 4 : images

const IMG_MODEL = { gpt: "gpt-image-2-image-to-image", nano: "nano-banana-2-lite", seedream: "seedream/5-lite-image-to-image" };
const IMG_FIELD = { gpt: "input_urls", nano: "image_urls", seedream: "image_urls" };
const IMG_T2I = { gpt: "gpt-image-2-text-to-image", nano: "nano-banana-2-lite", seedream: "seedream/5-lite-text-to-image" };

async function generateImage(run, sc) {
  const p = run.params;
  const dir = path.join(OUT_ROOT, run.id);
  ensureDir(dir);
  const tool = p.imageModel || "gpt";
  const st = cast.STYLES[p.style] || cast.STYLES["3d"];
  const entries = cast.list().entries;
  const refs = (sc.refs || []).map((r) => entries.find((e) => e.id === r.id)).filter(Boolean);
  await cast.ensureRefUrls(refs);
  const urls = refs.map((r) => r.refUrl).filter(Boolean).slice(0, 2); // 2 MAX : au-delà l'i2i mélange

  const ancre = urls.length
    ? `The character(s) are EXACTLY the people in the reference image(s): same face, same hair, same skin, ` +
      `same build, same signature outfit. Do not alter their features in any way, and do not blend them together. `
    : "";
  const prompt = `${ancre}${sc.image_prompt}. ${st.ref}. ${CAR_RULE} ${NEG}.`;

  sc.rendering = true; saveRun(run);
  try {
    const input = { prompt, aspect_ratio: "16:9", resolution: "1K" };
    if (urls.length) input[IMG_FIELD[tool]] = urls;
    const url = await kieRetry(urls.length ? IMG_MODEL[tool] : IMG_T2I[tool], input, { runId: run.id });
    const file = await download(url, path.join(dir, `img-${sc.i}.png`));
    sc.image = { file, rel: `agent-os/output/machines/${run.id}/${path.basename(file)}`, ts: Date.now() };
    run.cost.images = (run.cost.images || 0) + PRICES.image;
    spend.record("Kie.ai", MACHINE_NAME, PRICES.image, "USD", `Image plan ${sc.i}`);
    delete sc.error;
  } finally { delete sc.rendering; saveRun(run); }
}

async function stepImages(run) {
  const todo = run.scenes.filter((s) => !s.image);
  log(run, `Images : ${todo.length} à générer (pool 8)`);
  await pool(todo, async (sc) => {
    try { await generateImage(run, sc); }
    catch (e) { sc.error = e.message; saveRun(run); log(run, `Image plan ${sc.i} : ${e.message}`); }
  }, 8);
  const ko = run.scenes.filter((s) => !s.image).length;
  if (ko) throw new Error(`${ko} image(s) manquante(s) — reprenable`);
}

// ---------------------------------------------------------------- étape 5 : voix

/**
 * Voix d'un plan : celle du personnage qui parle, sinon celle du conteur.
 * ⚠ Le repli sur `lib[0]` est SILENCIEUX par nature — il choisissait la première voix de la
 * bibliothèque sans rien dire, ce qui donne un conteur arbitraire qu'on ne découvre qu'à
 * l'écoute. Il est désormais tracé dans le journal du run.
 */
function voiceForScene(run, sc) {
  const p = run.params;
  const lib = voices.list();
  if (sc.speaker) {
    const c = (run.cast || []).find((x) => String(x.name).toLowerCase() === String(sc.speaker).toLowerCase());
    const v = c?.voiceId ? lib.find((x) => x.id === c.voiceId) : null;
    if (v) return v;
    if (!run.__warnedSpeaker) { run.__warnedSpeaker = true; log(run, `⚠ ${sc.speaker} n'a pas de voix attribuée — voix du conteur utilisée`); }
  }
  const nar = lib.find((x) => x.id === p.narratorVoiceId);
  if (nar) return nar;
  if (!run.__warnedNarrator) {
    run.__warnedNarrator = true;
    log(run, `⚠ Aucune voix de conteur définie — repli sur « ${lib[0]?.name || "aucune"} ». Choisis-en une dans l'input.`);
  }
  return lib[0] || null;
}

async function generateVoice(run, sc) {
  const dir = path.join(OUT_ROOT, run.id);
  ensureDir(dir);
  const texte = (sc.line || sc.narration || "").trim();
  if (!texte) { sc.audio = { silent: true, seconds: 2.2 }; return; }
  const v = voiceForScene(run, sc);
  if (!v) throw new Error("Aucune voix dans la bibliothèque — ajoute-en une page 🎙 Voix");
  const r = await fal.run("fal-ai/elevenlabs/tts/eleven-v3", { text: texte, voice: v.ref },
    { cancelled: () => cancelledRuns.has(run.id) });
  if (!r.audio?.url) throw new Error("ElevenLabs : aucun audio renvoyé");
  const file = path.join(dir, `voix-${sc.i}.mp3`);
  await fal.download(r.audio.url, file);
  // L'atempo est une propriété de LA VOIX (mesurée à son enregistrement), jamais un réglage global.
  const tempo = v.wpm ? Math.max(0.85, Math.min(1.15, 155 / v.wpm)) : 1;
  let final = file;
  if (Math.abs(tempo - 1) > 0.04) {
    final = path.join(dir, `voix-${sc.i}-t.mp3`);
    await ffmpeg(["-i", file, "-filter:a", `atempo=${tempo.toFixed(3)}`, "-ar", "48000", "-ac", "2", final]);
  }
  const seconds = await ff.probeDuration(final, { label: `voix plan ${sc.i}` });
  const cost = +((texte.length / 1000) * PRICES.voicePer1kChars).toFixed(4);
  run.cost.voices = (run.cost.voices || 0) + cost;
  spend.record("FAL.ai", MACHINE_NAME, cost, "USD", `Voix plan ${sc.i} (${v.name})`);
  sc.audio = { file: final, rel: `agent-os/output/machines/${run.id}/${path.basename(final)}`,
               seconds: +seconds.toFixed(2), voiceId: v.id, voiceName: v.name, ts: Date.now() };
}

async function stepVoices(run) {
  const todo = run.scenes.filter((s) => !s.audio);
  log(run, `Voix : ${todo.length} segment(s) (pool 6)`);
  await pool(todo, async (sc) => {
    try { await generateVoice(run, sc); saveRun(run); }
    catch (e) { sc.error = e.message; saveRun(run); log(run, `Voix plan ${sc.i} : ${e.message}`); }
  }, 6);
  const ko = run.scenes.filter((s) => !s.audio).length;
  if (ko) throw new Error(`${ko} voix manquante(s) — reprenable`);
}

// ---------------------------------------------------------------- étape 6 : clips

/**
 * Un plan devient un segment vidéo de la durée EXACTE de sa voix.
 *  - plan animé  : clip Grok, puis lipsync si quelqu'un parle ;
 *  - plan fixe   : image + Ken Burns lent, généré directement à la bonne durée.
 * RÈGLE D'OR : la vidéo se cale sur la voix, jamais l'inverse — on ne coupe JAMAIS l'audio.
 */
async function generateClip(run, sc) {
  const dir = path.join(OUT_ROOT, run.id);
  const D = Math.max(1.6, (sc.audio?.seconds || 2.2) + 0.45); // + respiration
  const out = path.join(dir, `seg-${sc.i}.mp4`);
  sc.rendering = true; saveRun(run);
  try {
    let base;
    if (sc.animate) {
      const imgUrl = await uploadPublic(`drama-${run.id}-${sc.i}.png`, sc.image.file,
        sc.image.file.endsWith(".jpg") ? "image/jpeg" : "image/png");
      const NOSPEAK = "ABSOLUTELY NO SPEECH, no talking, no lip movement, no dialogue, no voice. ";
      const url = await kieRetry("grok-imagine-video-1-5-preview", {
        prompt: `${NOSPEAK}${sc.video_prompt} Keep the character exactly identical to the source image at all times. ${NOSPEAK}`,
        image_urls: [imgUrl + "&r=" + Date.now().toString(36)],
        duration: CLIP_SEC, resolution: "720p", aspect_ratio: "16:9",
      }, { runId: run.id });
      const raw = await download(url, path.join(dir, `clip-${sc.i}.mp4`));
      run.cost.videos = (run.cost.videos || 0) + PRICES.videoPerSec * CLIP_SEC;
      spend.record("Kie.ai", MACHINE_NAME, PRICES.videoPerSec * CLIP_SEC, "USD", `Clip plan ${sc.i}`);
      const dv = await ff.probeDuration(raw, { label: `clip ${sc.i}` });
      base = path.join(dir, `base-${sc.i}.mp4`);
      if (D <= dv) await ffmpeg(["-i", raw, "-t", D.toFixed(3), "-an", "-c:v", "libx264", "-crf", "20", base]);
      else if (D / dv <= 1.35) await ffmpeg(["-i", raw, "-vf", `setpts=${(D / dv).toFixed(4)}*PTS`, "-an", "-c:v", "libx264", "-crf", "20", base]);
      else await ffmpeg(["-i", raw, "-vf", `tpad=stop_mode=clone:stop_duration=${(D - dv).toFixed(2)}`, "-an", "-c:v", "libx264", "-crf", "20", base]);
    } else {
      // Ken Burns lent : zoom 1 → 1,08 sur la durée exacte de la voix.
      base = path.join(dir, `base-${sc.i}.mp4`);
      const frames = Math.max(2, Math.round(D * 30));
      await ffmpeg(["-loop", "1", "-i", sc.image.file, "-t", D.toFixed(3), "-r", "30",
        "-vf", `scale=2560:-2,zoompan=z='min(zoom+0.0008,1.08)':d=${frames}:s=1280x720:fps=30,setsar=1`,
        "-an", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", base]);
    }

    // Lipsync : seulement si quelqu'un parle ET que le plan est animé (sur une image fixe il n'y a
    // rien à synchroniser). Le cadrage frontal est imposé en amont par la recette.
    if (sc.speaker && sc.line && sc.animate && run.params.lipsync && sc.audio?.file) {
      const vUrl = await uploadPublic(`drama-${run.id}-b${sc.i}.mp4`, base, "video/mp4");
      const aUrl = await uploadPublic(`drama-${run.id}-a${sc.i}.mp3`, sc.audio.file, "audio/mpeg");
      const res = await fal.run("veed/lipsync", { video_url: vUrl, audio_url: aUrl },
        { timeoutMs: 12 * 60 * 1000, cancelled: () => cancelledRuns.has(run.id) });
      const lip = res?.video?.url || res?.video_url;
      if (lip) {
        const tmp = path.join(dir, `lip-${sc.i}.mp4`);
        await fal.download(lip, tmp);
        // veed réencode et écourte parfois la piste : on remet l'audio ORIGINAL intégral.
        await ffmpeg(["-i", tmp, "-i", sc.audio.file, "-map", "0:v:0", "-map", "1:a:0",
          "-c:v", "libx264", "-crf", "20", "-r", "30",
          "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:-1:-1,setsar=1",
          "-c:a", "aac", "-b:a", "192k", out]);
        try { fs.unlinkSync(tmp); } catch {}
        const c = +((D / 60) * PRICES.lipsyncPerMin).toFixed(4);
        run.cost.videos = (run.cost.videos || 0) + c;
        spend.record("FAL.ai", MACHINE_NAME, c, "USD", `Lipsync plan ${sc.i}`);
        sc.video = { file: out, rel: `agent-os/output/machines/${run.id}/seg-${sc.i}.mp4`, seconds: D, lipsync: true, ts: Date.now() };
        delete sc.error;
        return;
      }
      log(run, `Lipsync plan ${sc.i} indisponible — segment monté sans`);
    }

    const args = ["-i", base];
    if (sc.audio?.file) args.push("-i", sc.audio.file, "-map", "0:v:0", "-map", "1:a:0");
    else args.push("-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo`, "-map", "0:v:0", "-map", "1:a:0", "-t", D.toFixed(3));
    args.push("-c:v", "libx264", "-crf", "20", "-r", "30",
      "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:-1:-1,setsar=1",
      "-c:a", "aac", "-b:a", "192k", out);
    await ffmpeg(args);
    sc.video = { file: out, rel: `agent-os/output/machines/${run.id}/seg-${sc.i}.mp4`, seconds: D, lipsync: false, ts: Date.now() };
    delete sc.error;
  } finally { delete sc.rendering; saveRun(run); }
}

async function stepClips(run) {
  const todo = run.scenes.filter((s) => !s.video);
  log(run, `Clips : ${todo.length} segment(s) — ${todo.filter((s) => s.animate).length} animés`);
  await pool(todo, async (sc) => {
    try { await generateClip(run, sc); }
    catch (e) { sc.error = e.message; saveRun(run); log(run, `Clip plan ${sc.i} : ${e.message}`); }
  }, 4);
  const ko = run.scenes.filter((s) => !s.video).length;
  if (ko) throw new Error(`${ko} clip(s) manquant(s) — reprenable`);
}

// ---------------------------------------------------------------- étape 7 : montage

/** Séquence PNG transparente du bouton CTA (Remotion ne rend QUE ça — jamais la vidéo longue). */
async function renderCtaFrames(run) {
  const dir = path.join(OUT_ROOT, run.id, "cta");
  if (fs.existsSync(path.join(dir, "element-0000.png"))) return dir;
  ensureDir(dir);
  const props = JSON.stringify({
    channel: run.params.channelName,
    label: run.params.language === "Français" ? "ABONNE-TOI" : "SUBSCRIBE",
    tagline: run.params.language === "Français" ? "Like + Abonnement" : "Like + Subscribe",
    logo: CTA_LOGO,
  });
  await run_remotion(["remotion", "render", "DramaCta", `${dir}/element.png`,
    "--sequence", "--image-format=png", `--props=${props}`, "--log=error"]);
  return dir;
}
function run_remotion(args) {
  return run("npx", args, { cwd: REMOTION_DIR });
}

async function stepMontage(run) {
  const p = run.params;
  const dir = path.join(OUT_ROOT, run.id);
  const segs = run.scenes.slice().sort((a, b) => a.i - b.i).map((s) => s.video.file);
  if (!segs.length) throw new Error("Aucun segment à monter");

  log(run, "Montage : concaténation des segments…");
  const norm = [];
  for (const [k, f] of segs.entries()) {
    const o = path.join(dir, `n-${k}.mp4`);
    if (!fs.existsSync(o)) {
      await ffmpeg(["-i", f, "-r", "30", "-vf",
        "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:-1:-1,setsar=1",
        "-c:v", "libx264", "-crf", "20", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", o]);
    }
    norm.push(o);
  }
  const list = path.join(dir, "concat.txt");
  fs.writeFileSync(list, norm.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
  let cur = path.join(dir, "assemble.mp4");
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", cur]);
  const total = await ff.probeDuration(cur, { label: "assemblage" });
  log(run, `Assemblage : ${(total / 60).toFixed(1)} min`);

  // --- musique d'intro, prise dans la BANQUE (jamais générée) ---
  if (p.musicId || p.musicAuto) {
    const m = p.musicId ? music.get(p.musicId) : music.pick("intro");
    const mf = m ? music.filePath(m.id) : null;
    if (mf && fs.existsSync(mf)) {
      const dureeIntro = Math.min(38, Math.max(12, total * 0.12));
      const out = path.join(dir, "with-music.mp4");
      // Lit musical NORMALISÉ (chaque MP3 arrive à un niveau différent) puis fondu, sous la voix.
      await ffmpeg(["-i", cur, "-i", mf, "-filter_complex",
        `[1:a]atrim=0:${dureeIntro.toFixed(2)},loudnorm=I=-32,afade=t=in:st=0:d=1.5,` +
        `afade=t=out:st=${(dureeIntro - 3).toFixed(2)}:d=3,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[m];` +
        `[0:a][m]amix=inputs=2:duration=first:dropout_transition=3,aresample=48000[a]`,
        "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", out]);
      cur = out;
      run.musicUsed = m ? { id: m.id, name: m.name } : null;
      log(run, `Musique d'intro : « ${m.name} » sur ${dureeIntro.toFixed(0)} s`);
    } else log(run, "Musique d'intro : aucune piste « intro » dans la banque — étape sautée");
  }

  // --- LOGO permanent (haut GAUCHE) + CTA (haut DROITE) : une seule passe ---
  // Le logo doit être là même si le CTA est désactivé : les deux partagent donc le même appel.
  // ⚠ `-loop 1 -framerate 30` INDISPENSABLE pour le logo : en image UNIQUE il s'évapore dès
  //   que la chaîne compte plusieurs incrustations. Vécu sur Crime.
  {
    try {
      const st = config().settings || {};
      const logoFile = st.cornerLogo === false ? null
        : (() => { const f = path.join(REMOTION_DIR, "public", CTA_LOGO);
                   return fs.existsSync(f) ? f : null; })();
      let ctaDir = null, at = [], dureeCta = 0;
      if (p.cta) {
        ctaDir = await renderCtaFrames(run);
        const frames = fs.readdirSync(ctaDir).filter((f) => f.endsWith(".png")).length;
        if (frames) {
          dureeCta = frames / 30;
          for (let t = p.ctaFirst; t + dureeCta < total; t += p.ctaEvery) at.push(t);
          log(run, `CTA : ${at.length} apparition(s) (${at.map((x) => Math.round(x) + "s").join(", ")})`);
        } else ctaDir = null;
      }
      if (logoFile || at.length) {
        const inputs = ["-i", cur];
        const filters = [];
        let lastLabel = "0:v";
        let idx = 1;
        if (logoFile) {
          inputs.push("-loop", "1", "-framerate", "30", "-i", logoFile);
          filters.push(`[${idx}:v]format=rgba,scale=${CORNER_LOGO_PX}:-1,colorchannelmixer=aa=0.85[lg]`);
          filters.push(`[${lastLabel}][lg]overlay=26:22[wlg]`);
          lastLabel = "wlg"; idx++;
          log(run, "Logo de chaîne en haut à gauche, toute la durée");
        }
        at.forEach((t, k) => {
          inputs.push("-framerate", "30", "-start_number", "0", "-i", path.join(ctaDir, "element-%04d.png"));
          const lbl = `v${k}`;
          filters.push(`[${lastLabel}][${idx}:v]overlay=x=W-w-40:y=40:enable='between(t,${t},${(t + dureeCta).toFixed(2)})':shortest=0[${lbl}]`);
          lastLabel = lbl; idx++;
        });
        const out = path.join(dir, "with-cta.mp4");
        // ⚠ `-shortest` OBLIGATOIRE : le logo entre en `-loop 1`, donc en flux INFINI. Sans
        //   borne, l'encodage ne s'arrête jamais (vécu sur Linguistique : 727 Mo en 57 min).
        await ffmpeg([...inputs, "-filter_complex", filters.join(";"), "-map", `[${lastLabel}]`, "-map", "0:a",
          "-shortest", "-c:v", "libx264", "-crf", "20", "-c:a", "copy", out]);
        cur = out;
      }
    } catch (e) { log(run, `CTA ignoré (best-effort) : ${e.message}`); }
  }

  // --- sous-titres OPTIONNELS : une seule passe Whisper sur la vidéo ASSEMBLÉE ---
  if (p.subtitles) {
    try {
      log(run, "Sous-titres : transcription de la vidéo assemblée…");
      const a = path.join(dir, "full-audio.mp3");
      await ffmpeg(["-i", cur, "-vn", "-c:a", "libmp3lame", "-b:a", "128k", a]);
      const url = await uploadPublic(`drama-${run.id}-full.mp3`, a, "audio/mpeg");
      const wl = { "Français": "fr", English: "en", "Português": "pt", "Español": "es", Kiswahili: "sw" }[p.language] || "fr";
      const r = await fal.run("fal-ai/whisper", { audio_url: url, language: wl },
        { cancelled: () => cancelledRuns.has(run.id) });
      const chunks = r.chunks || r.segments || [];
      if (chunks.length) {
        const srt = path.join(dir, "subs.srt");
        fs.writeFileSync(srt, chunks.map((c, k) => {
          const [a0, b0] = c.timestamp || [c.start, c.end];
          return `${k + 1}\n${srtTime(a0)} --> ${srtTime(b0)}\n${String(c.text).trim()}\n`;
        }).join("\n"));
        const out = path.join(dir, "with-subs.mp4");
        // cwd = dossier du run + chemin RELATIF : le « : » d'un chemin absolu casse le filtergraph.
        await ffmpeg(["-i", path.basename(cur), "-vf",
          "subtitles=subs.srt:force_style='FontSize=17,MarginV=26,Outline=2,Shadow=0'",
          "-c:a", "copy", "-c:v", "libx264", "-crf", "20", path.basename(out)], { cwd: dir });
        cur = out;
        const wc = +((total) * PRICES.whisperPerSec).toFixed(4);
        run.cost.montage = (run.cost.montage || 0) + wc;
        spend.record("FAL.ai", MACHINE_NAME, wc, "USD", "Whisper (sous-titres)");
        log(run, `Sous-titres gravés (${chunks.length} segments)`);
      }
    } catch (e) { log(run, `Sous-titres ignorés : ${e.message}`); }
  }

  const final = path.join(dir, "final.mp4");
  if (cur !== final) { try { fs.copyFileSync(cur, final); } catch { await ffmpeg(["-i", cur, "-c", "copy", final]); } }

  // GÉNÉRIQUE DE CHAÎNE — collé APRÈS coup, sans ré-encoder.
  // ⚠ Volontairement HORS du filter_complex du montage : y mêler vidéo et audio a
  //   désynchronisé la voix sur la machine Crime. Best-effort, la vidéo reste intacte en cas
  //   d'échec. Si un jour cette machine produit un .srt SÉPARÉ, il faudra le décaler d'autant.
  {
    const cs = config(); const st = cs.settings || {};
    if (st.sting !== false) {
      const lp = path.join(REMOTION_DIR, "public", CTA_LOGO);
      const added = await intro.prepend(final, {
        logoPath: lp, title: cs.channelName || "", subtitle: st.stingSubtitle || "",
        accent: st.stingAccent || "#e09a55", seconds: 5,
      }).catch(() => 0);
      if (added) log(run, `Générique de chaîne : ${added} s en tête`);
      else log(run, "Générique non ajouté (vidéo inchangée)");
    }
  }

  run.video = { file: final, rel: `agent-os/output/machines/${run.id}/final.mp4`,
                seconds: await ff.probeDuration(final, { label: "vidéo finale" }), ts: Date.now() };
  saveRun(run);
  log(run, `Montage terminé : ${(run.video.seconds / 60).toFixed(1)} min`);
}

function srtTime(sec) {
  const ms = Math.max(0, Math.round((Number(sec) || 0) * 1000));
  const p2 = (n) => String(n).padStart(2, "0");
  return `${p2(Math.floor(ms / 3600000))}:${p2(Math.floor((ms % 3600000) / 60000))}:${p2(Math.floor((ms % 60000) / 1000))},${String(ms % 1000).padStart(3, "0")}`;
}

// ---------------------------------------------------------------- étape 8 : packaging

const PACK_RULES = [
  "TITRE : les codes RELEVÉS dans la niche — majuscules sur les mots-chocs, points de suspension",
  "avant le retournement, suffixe « | Histoire Africaine ». 70 à 100 caractères.",
  "DESCRIPTION : 230-320 mots. Accroche qui rejoue la tension, puces à émoji, invitation à",
  "s'abonner, apaisement, 8-12 hashtags sans accents.",
  "TAGS : 480-500 caractères au total, séparés par des virgules, dans les codes de la niche.",
].join("\n");

async function stepPackaging(run) {
  const p = run.params;
  const insp = p.nicheId ? (() => { try { return bank.inspiration(p.nicheId, { maxTitles: 20 }); } catch { return ""; } })() : "";
  const out = await genJson([
    insp, "",
    `HISTOIRE : ${run.title}`, run.story.synopsis, "",
    `Langue du PUBLIC : ${p.language}. Chaîne : ${p.channelName}.`,
    PACK_RULES, "",
    'JSON UNIQUEMENT : {"title":"...","description":"...","tags":"...","thumb":{"prompt":"(EN, ≥ 400 car.)","lines":["LIGNE 1","LIGNE 2"]}}',
    "Les 2 lignes de miniature forment UNE phrase complète, 14 caractères maximum par ligne.",
  ].join("\n"), { label: "Packaging", ms: 8 * 60 * 1000 });

  run.pack = {
    title: String(out.title || run.title).slice(0, 100),
    description: String(out.description || ""),
    tags: capTags(String(out.tags || "").split(",").map((t) => t.trim()).filter(Boolean), 480),
    thumbPrompt: out.thumb?.prompt || "",
    thumbLines: out.thumb?.lines || [],
  };
  saveRun(run);
  await generateThumbnail(run).catch((e) => log(run, `Miniature : ${e.message}`));
  log(run, "Packaging prêt");
}

function capTags(tags, max) {
  const out = []; let len = 0;
  for (const t of tags) { const c = t.length + (out.length ? 1 : 0); if (len + c > max) break; out.push(t); len += c; }
  return out;
}

async function generateThumbnail(run) {
  const dir = path.join(OUT_ROOT, run.id);
  const st = cast.STYLES[run.params.style] || cast.STYLES["3d"];
  const entries = cast.list().entries.filter((e) => (run.cast || []).some((c) => c.id === e.id && e.kind === "personnage"));
  await cast.ensureRefUrls(entries);
  const urls = entries.map((e) => e.refUrl).filter(Boolean).slice(0, 1);
  const prompt = `${urls.length ? "The person is EXACTLY the one in the reference image. " : ""}` +
    `${run.pack.thumbPrompt} Extreme close-up on the face, very strong emotion, saturated colours, ` +
    `subject placed on the RIGHT third of the frame leaving the left third empty for text. ${st.ref} ${NEG}.`;
  const input = { prompt, aspect_ratio: "16:9", resolution: "1K" };
  if (urls.length) input.input_urls = urls;
  const url = await kieRetry(urls.length ? "gpt-image-2-image-to-image" : "gpt-image-2-text-to-image", input, { runId: run.id });
  const file = await download(url, path.join(dir, "thumb.png"));
  spend.record("Kie.ai", MACHINE_NAME, PRICES.image, "USD", "Miniature");
  run.cost.images = (run.cost.images || 0) + PRICES.image;
  run.thumb = { file, rel: `agent-os/output/machines/${run.id}/${path.basename(file)}`, ts: Date.now() };
  run.thumbTs = Date.now(); // cache-buster : même chemin réécrit → sinon le navigateur ressert l'ancienne
  saveRun(run);
}

// ---------------------------------------------------------------- machine à états

const STEPS = [
  { key: "script",    fn: stepScript,    label: "Script" },
  { key: "cast",      fn: stepCast,      label: "Casting" },
  { key: "prompts",   fn: stepPrompts,   label: "Prompts" },
  { key: "images",    fn: stepImages,    label: "Images" },
  { key: "voices",    fn: stepVoices,    label: "Voix" },
  { key: "clips",     fn: stepClips,     label: "Clips" },
  { key: "montage",   fn: stepMontage,   label: "Montage" },
  { key: "packaging", fn: stepPackaging, label: "Packaging" },
];

/** L'étape atteinte se DÉDUIT des données, jamais d'un compteur — un run repris retombe juste. */
function deriveStatus(run) {
  if (run.pack && run.video) return "done";
  if (run.video) return "packaging_ready";
  const sc = run.scenes || [];
  const complete = sc.length === run.sceneCount && sc.length > 0;
  if (complete && sc.every((s) => s.video)) return "clips_ready";
  if (complete && sc.every((s) => s.audio)) return "voices_ready";
  if (complete && sc.every((s) => s.image)) return "images_ready";
  if (complete) return "prompts_ready";
  if (run.cast?.length) return "cast_ready";
  if (run.story) return "script_ready";
  return "created";
}
const nextStep = (run) => {
  const st = deriveStatus(run);
  if (st === "done") return null;
  const order = ["created", "script_ready", "cast_ready", "prompts_ready", "images_ready", "voices_ready", "clips_ready", "packaging_ready"];
  return STEPS[order.indexOf(st)] || null;
};

const active = new Map();   // runId → true pendant un advance()

async function advance(runId) {
  if (active.get(runId)) return { already: true };
  active.set(runId, true);
  try {
    for (;;) {
      const run = getRun(runId);
      if (!run) throw new Error("Run introuvable");
      if (cancelledRuns.has(runId)) { run.status = "cancelled"; saveRun(run); break; }
      const step = nextStep(run);
      if (!step) { run.status = "done"; saveRun(run); await onDone(run); break; }
      run.status = `${step.key}_running`;
      saveRun(run);
      await tasks.updateTask(run.taskId, { step: step.label, status: "running" }).catch(() => {});
      try {
        await step.fn(run);
        const fresh = getRun(runId);
        fresh.status = deriveStatus(fresh);
        saveRun(fresh);
      } catch (e) {
        const fresh = getRun(runId) || run;
        fresh.status = `${step.key}_failed`;
        fresh.error = e.message;
        saveRun(fresh);
        log(fresh, `❌ ${step.label} : ${e.message}`);
        await tasks.updateTask(fresh.taskId, { step: `${step.label} — ${e.message}`, status: "failed" }).catch(() => {});
        return { ok: false, error: e.message };
      }
      if (run.mode !== "auto") break;   // semi : on rend la main à chaque palier
    }
    return { ok: true, status: getRun(runId)?.status };
  } finally { active.delete(runId); }
}

/** Garde-fou du mode semi : refuse d'avancer si un média manque ou si une régé est en vol. */
function validate(run) {
  const sc = run.scenes || [];
  if (sc.some((s) => s.rendering || s.pending)) return "Une régénération est en cours — attends qu'elle finisse.";
  const st = deriveStatus(run);
  if (st === "prompts_ready" && sc.length !== run.sceneCount) return `Prompts incomplets (${sc.length}/${run.sceneCount}).`;
  if (st === "images_ready" && sc.some((s) => !s.image)) return "Des images manquent.";
  if (st === "voices_ready" && sc.some((s) => !s.audio)) return "Des voix manquent.";
  if (st === "clips_ready" && sc.some((s) => !s.video)) return "Des clips manquent.";
  return null;
}

function createRun(params = {}) {
  const c = config();
  const s = c.settings;
  const durationMin = Math.max(8, Math.min(20, Number(params.durationMin) || 12));
  const language = LANGS.includes(params.language) ? params.language : "Français";
  const rythme = RYTHMES[params.rythme] ? params.rythme : s.rythme;
  const style = cast.STYLES[params.style] ? params.style : s.style;
  const id = "d" + Date.now().toString(36);
  const run = {
    id, machineId: MACHINE_ID,
    title: params.subject || "Sans titre",
    status: "created",
    mode: params.mode === "auto" ? "auto" : "semi",
    createdAt: new Date().toISOString(),
    sceneCount: expectedShots(durationMin, rythme),
    cost: { images: 0, videos: 0, voices: 0, montage: 0 },
    params: {
      subject: String(params.subject || "").trim(),
      durationMin, language, rythme, style,
      imageModel: params.imageModel || s.imageModel,
      lipsync: params.lipsync !== false && s.lipsync !== false,
      subtitles: params.subtitles === true,
      cta: params.cta !== false,
      ctaFirst: Number(params.ctaFirst) || s.ctaFirst,
      ctaEvery: Number(params.ctaEvery) || s.ctaEvery,
      musicId: params.musicId || null,
      musicAuto: params.musicAuto !== false,
      narratorVoiceId: params.narratorVoiceId || s.narratorVoiceId,
      channelName: params.channelName || c.channelName,
      nicheId: params.nicheId || c.nicheId,
      publishChannelId: params.publishChannelId || null,
      publishPrivacy: params.publishPrivacy || s.publishPrivacy,
    },
    logs: [],
  };
  const t = tasks.createTask({
    title: `Drama — ${run.title.slice(0, 60)}`,
    desc: `${durationMin} min · ${RYTHMES[rythme].label} · ${language}`,
    machine: MACHINE_NAME, machineId: MACHINE_ID, runId: id,
    kind: "machine", step: "Script", progress: 2, status: "running",
  });
  run.taskId = t.id;
  saveRun(run);
  return run;
}

function cancelRun(id) { cancelledRuns.add(id); const r = getRun(id); if (r) { r.status = "cancelled"; saveRun(r); } return { ok: true }; }
function resumeRun(id) {
  if (active.get(id)) throw new Error("Un traitement est déjà en cours sur ce run");
  cancelledRuns.delete(id);
  advance(id).catch(() => {});
  return { ok: true };
}
/** Runs marqués « _running » sans advance() en mémoire → cron de sauvetage. */
function strandedRuns() {
  return listRuns().filter((r) => /_running$/.test(String(r.status)) && !active.get(r.id));
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
    if (!/_running$/.test(String(r.status))) continue;
    const full = getRun(r.id);
    if (!full) continue;
    (full.scenes || []).forEach((s) => { delete s.rendering; delete s.pending; });
    full.status = deriveStatus(full);
    saveRun(full); n++;
  }
  backfillStock();
  return n;
}

// ---------------------------------------------------------------- stock & publication

const stock = () => readJSON(`machines/${MACHINE_ID}-stock.json`, []);
const saveStock = (l) => writeJSON(`machines/${MACHINE_ID}-stock.json`, l);
function addToStock(run) {
  const l = stock();
  if (l.some((x) => x.runId === run.id)) return;
  l.unshift({ id: "s" + Date.now().toString(36), runId: run.id, title: run.pack?.title || run.title,
    videoRel: run.video?.rel, thumbRel: run.thumb?.rel, seconds: run.video?.seconds,
    createdAt: new Date().toISOString(), archived: false, posted: false });
  saveStock(l);
}
function patchStock(id, p = {}) {
  const l = stock(); const e = l.find((x) => x.id === id);
  if (!e) throw new Error("Entrée de stock introuvable");
  for (const k of ["archived", "posted", "title"]) if (k in p) e[k] = p[k];
  saveStock(l); return e;
}
async function onDone(run) {
  addToStock(run);
  await tasks.updateTask(run.taskId, { step: "Terminé", progress: 100, status: "done" }).catch(() => {});
  if (run.params.publishChannelId && config().settings.autoPublish) {
    await publishRun(run.id).catch((e) => log(run, `Publication auto : ${e.message}`));
  }
}
async function publishRun(id, { channelId, privacy } = {}) {
  const run = getRun(id);
  if (!run?.video?.file) throw new Error("Aucune vidéo à publier");
  const ch = channelId || run.params.publishChannelId;
  if (!ch) throw new Error("Aucune chaîne sélectionnée");
  const meta = {
    title: run.pack?.title || run.title,
    description: run.pack?.description || "",
    tags: run.pack?.tags || [],
    categoryId: "24",                                   // Entertainment
    privacyStatus: privacy || run.params.publishPrivacy || "private",
  };
  // ⚠ signature à TROIS arguments — piège vécu sur Bouddhisme (statSync sur un objet).
  const r = await google.youtubeUpload(ch, run.video.file, meta);
  if (run.thumb?.file) await google.youtubeSetThumbnail(r.id, run.thumb.file).catch(() => {});
  run.published = { id: r.id, url: `https://youtu.be/${r.id}`, at: new Date().toISOString(), privacy: meta.privacyStatus };
  saveRun(run);
  return run.published;
}

// ---------------------------------------------------------------- idées

function producedThemes() {
  return [...listRuns().map((r) => r.title), ...stock().map((s) => s.title)].filter(Boolean).slice(0, 60);
}
async function suggestTheme(nicheId) {
  const insp = (nicheId || config().nicheId)
    ? (() => { try { return bank.inspiration(nicheId || config().nicheId, { maxTitles: 20 }); } catch { return ""; } })() : "";
  const deja = producedThemes();
  const j = await genJson([
    insp, "",
    "Propose UNE idée d'histoire neuve pour cette niche.",
    deja.length ? `DÉJÀ PRODUITES — n'en propose ni une reprise ni une variante proche :\n- ${deja.join("\n- ")}` : "",
    'JSON UNIQUEMENT : {"subject":"(1 à 2 phrases, la situation et le retournement)","pitch":"(le titre pressenti)"}',
  ].join("\n"), { label: "Idée", ms: 5 * 60 * 1000 });
  return j;
}

// ---------------------------------------------------------------- export

module.exports = {
  MACHINE_ID, MACHINE_NAME, LANGS, RYTHMES, PRICES, CLIP_SEC, WORDS_MAX, STORY_BEATS,
  config, patchConfig,
  listRuns, getRun, createRun, advance, validate, cancelRun, resumeRun, strandedRuns, sweepRuns,
  deriveStatus, expectedShots, setCasting,
  stock, addToStock, patchStock, publishRun,
  suggestTheme, producedThemes, generateThumbnail,
  cast, music, voices,
};
