/**
 * DRAMA — bibliothèque de personnages, lieux et véhicules (références i2i persistantes).
 *
 * Modèle repris de `bouddhisme-library.js` (#5), avec trois différences imposées par la niche :
 *   1. Chaque PERSONNAGE porte une VOIX de la bibliothèque partagée (`lib/voices.js`).
 *      Un personnage récurrent doit avoir la même voix d'un épisode à l'autre — c'est ce qui
 *      fait revenir un spectateur (prototype phase 6).
 *   2. La fiche est générée dans le STYLE du run (3D stylisée ou photoréaliste) : une référence
 *      Pixar utilisée dans un film photoréaliste casse l'ancrage.
 *   3. Les fiches sont en **16:9**. Grok reproduit la taille de sa référence : une fiche 3:4
 *      contaminerait tous les plans (leçon Linguistique).
 *
 * data/machines/drama-cast.json : { entries: [{id, name, kind, desc, style, voiceId, refRel, refUrl, uses}] }
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { readJSON, writeJSON, ensureDir } = require("../store");
const claude = require("../claude");
const vault = require("../vault");
const google = require("../google");
const spend = require("../spend");
const voices = require("../voices");

const MACHINE_NAME = "Drama";
const STORE = "machines/drama-cast.json";
const LIB_DIR = path.join(__dirname, "..", "..", "output", "machines", "drama-cast");
ensureDir(LIB_DIR);

const PRICE_REF = 0.03;
const MAX_NEW = 3;      // créations maximum par vidéo (plafond en CODE, pas seulement dans le prompt)
const SATURATED = 8;    // au-delà, une catégorie est bien pourvue
const KINDS = ["personnage", "lieu", "vehicule"];

/**
 * Styles de fiche. Ils doivent être IDENTIQUES à ceux des plans du run, sinon l'ancrage dérive.
 * Le négatif inclut les marques : un logo Chanel était apparu seul sur un sac (prototype phase 1).
 */
const STYLES = {
  "3d": {
    label: "3D stylisée",
    ref:
      "Modern 3D animated feature film style, Pixar and DreamWorks quality rendering, expressive " +
      "character animation with large detailed eyes, soft cinematic subsurface skin shading, rich warm " +
      "color grading, volumetric lighting, detailed textures, high production value, 16:9 cinematic framing",
  },
  reel: {
    label: "Photoréaliste",
    ref:
      "Photorealistic cinematic film still, shot on ARRI Alexa with a 50mm anamorphic lens, natural " +
      "realistic human skin with visible pores and fine texture, realistic subsurface scattering, subtle " +
      "film grain, professional cinematic color grading, volumetric lighting, 16:9 widescreen. Absolutely " +
      "photorealistic live-action photography — NOT animation, NOT 3D render, NOT CGI, NOT illustration",
  },
};
const REF_NEG =
  "no text, no letters, no watermark, no logo, no brand name, no trademark, no visible commercial branding, " +
  "no distorted hands or faces, no collage, no split frame, no border";

/** Cadrage de la fiche selon la nature — un personnage se reconnaît au visage, un lieu au décor. */
const REF_FRAMING = {
  personnage:
    "Full body character reference, single character centred, neutral standing pose, facing camera, " +
    "plain light grey seamless studio background, soft even lighting, face sharp and clearly visible",
  lieu:
    "Establishing reference view of the location, no people, wide angle, natural light, " +
    "the whole space readable and clearly lit",
  vehicule:
    "Three-quarter front reference view of the vehicle, parked, no people, plain neutral background, " +
    "even studio lighting, the whole vehicle visible",
};

const slug = (s) =>
  String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "ref";

const load = () => readJSON(STORE, { entries: [] });
const save = (c) => writeJSON(STORE, c);

function list() {
  const lib = voices.list();
  return {
    entries: (load().entries || [])
      .slice()
      .sort((a, b) => (b.uses || 0) - (a.uses || 0) || String(a.name).localeCompare(String(b.name)))
      .map((e) => ({ ...e, voice: e.voiceId ? lib.find((v) => v.id === e.voiceId) || null : null })),
  };
}
const get = (id) => (load().entries || []).find((x) => x.id === id) || null;
/** Fiches ÉPINGLÉES : présentes dans TOUTES les vidéos, jamais réinventées. */
const pinned = () => (load().entries || []).filter((e) => e.pinned);

function patch(id, p = {}) {
  const c = load();
  const e = (c.entries || []).find((x) => x.id === id);
  if (!e) throw new Error("Entrée introuvable");
  for (const k of ["name", "desc", "kind", "voiceId", "role", "traits"]) if (p[k] !== undefined) e[k] = p[k] === null ? null : String(p[k]);
  if (p.pinned !== undefined) e.pinned = !!p.pinned;   // personnage FIXE de la chaîne
  if (e.kind && !KINDS.includes(e.kind)) throw new Error(`Nature inconnue : ${e.kind}`);
  save(c);
  return e;
}

function remove(id) {
  const c = load();
  const e = (c.entries || []).find((x) => x.id === id);
  c.entries = (c.entries || []).filter((x) => x.id !== id);
  save(c);
  if (e?.refRel) { try { fs.unlinkSync(path.join(__dirname, "..", "..", "..", e.refRel)); } catch {} }
  return { ok: true };
}

function sheetPath(id) {
  const e = get(id);
  if (!e?.refRel) return null;
  const abs = path.join(__dirname, "..", "..", "..", e.refRel);
  return fs.existsSync(abs) ? abs : null;
}

// ---------------------------------------------------------------- transport Kie

const kieKey = () => { const k = vault.get("kie"); if (!k) throw new Error("Clé Kie absente du coffre"); return k; };
async function kieCreate(model, input) {
  const r = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
    method: "POST",
    headers: { Authorization: `Bearer ${kieKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  }).then((x) => x.json());
  if (!r.data?.taskId) throw new Error(`Kie : ${r.msg || JSON.stringify(r).slice(0, 160)}`);
  return r.data.taskId;
}
async function kiePoll(taskId, timeoutMs = 10 * 60 * 1000) {
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 8000));
    if (Date.now() - t0 > timeoutMs) throw new Error("Kie : délai dépassé");
    const r = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`,
      { headers: { Authorization: `Bearer ${kieKey()}` } }).then((x) => x.json());
    if (r.data?.state === "success") return JSON.parse(r.data.resultJson).resultUrls[0];
    if (r.data?.state === "fail") throw new Error(`Kie : ${r.data?.failMsg || "génération échouée"}`);
  }
}
/** Kie renvoie du JPEG même quand l'URL dit .png : nommer d'après les OCTETS. */
async function grab(url, fileNoExt) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Téléchargement ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const file = fileNoExt + (buf[0] === 0xff && buf[1] === 0xd8 ? ".jpg" : ".png");
  fs.writeFileSync(file, buf);
  return file;
}
/** Upload public RÉSILIENT : Drive renvoie du HTML quand il throttle, et `.json()` explose. */
async function uploadPublic(absFile, name, tries = 3) {
  const mime = absFile.endsWith(".png") ? "image/png" : "image/jpeg";
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      const up = await google.driveUpload(name, mime, fs.readFileSync(absFile));
      await google.ensurePublic(up.id).catch(() => {});
      return `https://drive.google.com/uc?export=download&id=${up.id}`;
    } catch (e) { last = e; if (i < tries) await new Promise((r) => setTimeout(r, 4000 * i)); }
  }
  throw new Error(`Upload Drive impossible : ${String(last?.message).slice(0, 120)}`);
}

const T2I = "gpt-image-2-text-to-image";

// ---------------------------------------------------------------- création / régénération

async function createEntry({ name, kind = "personnage", desc, style = "3d", role = "", traits = "", voiceId = null, tags = [] }, { tries = 2 } = {}) {
  if (!desc) throw new Error("Description visuelle manquante");
  if (!KINDS.includes(kind)) throw new Error(`Nature inconnue : ${kind}`);
  const st = STYLES[style] || STYLES["3d"];
  const prompt = `${REF_FRAMING[kind]}. ${desc}. ${st.ref}. ${REF_NEG}.`;
  let url, last;
  for (let i = 1; i <= tries; i++) {
    try { url = await kiePoll(await kieCreate(T2I, { prompt, aspect_ratio: "16:9", resolution: "1K" })); break; }
    catch (e) { last = e; if (/must be|invalid|required/i.test(e.message)) throw e; } // déterministe : ne pas rejouer
  }
  if (!url) throw last;
  const id = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
  const file = await grab(url, path.join(LIB_DIR, `${id}-${slug(name)}`));
  spend.record("Kie.ai", MACHINE_NAME, PRICE_REF, "USD", `Référence « ${name} »`);
  const rel = `agent-os/output/machines/drama-cast/${path.basename(file)}`;
  let refUrl = null;
  try { refUrl = await uploadPublic(file, `drama-ref-${id}${path.extname(file)}`); } catch {}
  const entry = {
    id, name: String(name), kind, desc: String(desc), style, role: String(role || ""), traits: String(traits || ""),
    voiceId: voiceId || null, tags,
    refRel: rel, refSrc: rel, refUrl, uses: 0, createdAt: new Date().toISOString(),
  };
  const c = load(); c.entries = c.entries || []; c.entries.push(entry); save(c);
  return entry;
}


/**
 * importEntry — enregistre une fiche à partir d'une image DÉJÀ EXISTANTE.
 *
 * Sert à récupérer les références produites hors machine (prototypes, essais, visuels
 * fournis par l'utilisateur) : elles sont déjà payées et déjà validées à l'œil, les
 * regénérer serait doublement absurde.
 *
 * ⚠ NORMALISATION 16:9 : Grok reproduit la TAILLE de sa référence. Une fiche 3:4 ou carrée
 * contaminerait tous les plans du film. Une image hors ratio est donc posée, sans déformation,
 * sur un fond gris neutre 16:9 — le même fond que celui des fiches générées.
 */
async function importEntry({ name, kind = "personnage", desc = "", role = "", traits = "", style = "3d", voiceId = null, dataUrl = null, srcPath = null } = {}) {
  name = String(name || "").trim();
  if (!name) throw new Error("Nom requis");
  if (!KINDS.includes(kind)) throw new Error(`Nature inconnue : ${kind}`);
  if (!dataUrl && !srcPath) throw new Error("Image requise");

  const id = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
  const tmp = path.join(LIB_DIR, `${id}-src`);
  if (dataUrl) {
    const b64 = String(dataUrl).split(",")[1] || "";
    if (!b64) throw new Error("Image illisible");
    fs.writeFileSync(tmp, Buffer.from(b64, "base64"));
  } else {
    if (!fs.existsSync(srcPath)) throw new Error(`Fichier introuvable : ${srcPath}`);
    fs.copyFileSync(srcPath, tmp);
  }

  // dimensions réelles
  let W = 0, H = 0;
  try {
    const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v",
      "-show_entries", "stream=width,height", "-of", "csv=p=0", tmp]).toString().trim();
    [W, H] = out.split(",").map(Number);
  } catch { try { fs.unlinkSync(tmp); } catch {} throw new Error("Image illisible (PNG ou JPEG attendu)"); }
  if (!W || !H) { try { fs.unlinkSync(tmp); } catch {} throw new Error("Dimensions introuvables"); }

  const file = path.join(LIB_DIR, `${id}-${slug(name)}.png`);
  const ratio = W / H;
  const need = Math.abs(ratio - 16 / 9) > 0.04;
  if (need) {
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", tmp,
      "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0xBFBFBF,setsar=1",
      file], { stdio: ["ignore", "pipe", "pipe"] });
  } else {
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", tmp,
      "-vf", "scale=1280:720,setsar=1", file], { stdio: ["ignore", "pipe", "pipe"] });
  }
  try { fs.unlinkSync(tmp); } catch {}

  const rel = `agent-os/output/machines/drama-cast/${path.basename(file)}`;
  let refUrl = null;
  try { refUrl = await uploadPublic(file, `drama-ref-${id}.png`); } catch {}
  const entry = {
    id, name, kind, desc: String(desc), style, role: String(role || ""), traits: String(traits || ""),
    voiceId: voiceId || null, tags: [],
    refRel: rel, refSrc: rel, refUrl, uses: 0,
    imported: true, srcRatio: `${W}x${H}`, padded: need,
    createdAt: new Date().toISOString(),
  };
  const c = load(); c.entries = c.entries || []; c.entries.push(entry); save(c);
  return entry;
}

/** Redessine SANS changer l'identité (même nom, même description sauf override explicite). */
async function regenerate(id, { desc, style } = {}) {
  const c = load();
  const e = (c.entries || []).find((x) => x.id === id);
  if (!e) throw new Error("Entrée introuvable");
  if (desc) e.desc = String(desc);
  if (style && STYLES[style]) e.style = style;
  const st = STYLES[e.style] || STYLES["3d"];
  const prompt = `${REF_FRAMING[e.kind]}. ${e.desc}. ${st.ref}. ${REF_NEG}.`;
  const url = await kiePoll(await kieCreate(T2I, { prompt, aspect_ratio: "16:9", resolution: "1K" }));
  const file = await grab(url, path.join(LIB_DIR, `${e.id}-${slug(e.name)}`));
  spend.record("Kie.ai", MACHINE_NAME, PRICE_REF, "USD", `Référence « ${e.name} » (régénérée)`);
  e.refRel = `agent-os/output/machines/drama-cast/${path.basename(file)}`;
  e.refSrc = e.refRel;
  try { e.refUrl = await uploadPublic(file, `drama-ref-${e.id}${path.extname(file)}`); } catch { e.refUrl = null; }
  save(c);
  return e;
}

/**
 * ensureRefUrls — ANTI-PÉRIMÉ (leçon Linguistique). On mémorise le fichier uploadé (`refSrc`) :
 * si la fiche a été régénérée depuis, on ré-uploade, sinon le run garde l'ancienne image.
 */
async function ensureRefUrls(entries) {
  const c = load();
  for (const e of entries) {
    const live = (c.entries || []).find((x) => x.id === e.id);
    if (!live) continue;
    if (live.refUrl && live.refSrc === live.refRel) { e.refUrl = live.refUrl; continue; }
    const abs = sheetPath(live.id);
    if (!abs) continue;
    live.refUrl = await uploadPublic(abs, `drama-ref-${live.id}${path.extname(abs)}`);
    live.refSrc = live.refRel;
    e.refUrl = live.refUrl;
  }
  save(c);
  return entries;
}

/** L'utilisateur décrit en français ; Claude rédige la fiche exploitable (nom, nature, desc EN). */
async function draftEntry(description, { style = "3d" } = {}) {
  const existing = (load().entries || []).map((e) => `${e.name} (${e.kind})`).join(", ") || "aucune";
  const out = await claude.ask(
    [
      "Tu prépares une fiche de référence visuelle pour une machine de vidéos « histoire africaine ».",
      `Demande de l'utilisateur : « ${description} »`,
      `Entrées DÉJÀ existantes (le nouveau doit s'en distinguer nettement) : ${existing}`,
      "",
      'Rends UNIQUEMENT un JSON : {"name":"...","kind":"personnage|lieu|vehicule","desc":"..."}',
      "- name : court, en français, mémorable.",
      "- desc : EN ANGLAIS, 40-70 mots, PHYSIQUE UNIQUEMENT (morphologie, visage, peau, cheveux, âge,",
      "  tenue signature FIXE). Pas de décor, pas d'action, pas d'émotion — une fiche est une identité,",
      "  pas une scène.",
      "- Donne au personnage UN accessoire distinctif et permanent (foulard, bijou, monture de lunettes…) :",
      "  c'est lui qui ancre l'identité d'un plan à l'autre, mieux que n'importe quelle consigne de prompt.",
      "- Variété FORCÉE par rapport aux entrées existantes : âge, morphologie, teint, tenue.",
    ].join("\n"),
    { timeoutMs: 3 * 60 * 1000 }
  );
  const m = String(out).match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Brouillon illisible");
  const d = JSON.parse(m[0]);
  if (!KINDS.includes(d.kind)) d.kind = "personnage";
  d.style = style;
  return d;
}

/**
 * planLibrary — décide quoi RÉUTILISER et quoi CRÉER pour un script donné.
 * Le plafond est réappliqué en CODE : « un plafond énoncé dans un prompt ne suffit pas,
 * un modèle qui hésite crée » (leçon Stickman #4).
 */
async function planLibrary({ title, script, style = "3d", storyCharacters = [] }) {
  const entries = load().entries || [];
  const fiche = (e) =>
    `- [${e.id}] ${e.name} [${e.kind}]${e.pinned ? " 📌 FIXE" : ""}` +
    `${e.role ? ` — rôle habituel : ${e.role}` : ""}` +
    `${e.traits ? ` — caractère : ${e.traits}` : ""}` +
    `${e.desc ? ` — physique : ${String(e.desc).slice(0, 90)}` : ""}`;
  const inventaire = entries.length ? entries.map(fiche).join("\n") : "(bibliothèque vide)";
  const perso = storyCharacters.length
    ? storyCharacters.map((c) => `- ${c.name} — ${c.role || "rôle non précisé"}${c.desc ? ` (${String(c.desc).slice(0, 90)})` : ""}`).join("\n")
    : "(non fournis)";

  const out = await claude.ask(
    [
      `Histoire : « ${title} »`,
      "",
      String(script).slice(0, 6000),
      "",
      "PERSONNAGES DE CETTE HISTOIRE (issus du script) :",
      perso,
      "",
      "BIBLIOTHÈQUE DE FICHES DISPONIBLES :",
      inventaire,
      "",
      entries.filter((e) => e.pinned).length
        ? "Les fiches marquées 📌 FIXE sont dans TOUTES les vidéos : tu DOIS les employer.\n"
        : "",
      "DISTRIBUE les rôles : pour CHAQUE personnage de l'histoire, choisis la fiche qui lui",
      "correspond le mieux. Le critère principal est le **caractère**, puis le rôle habituel ;",
      "le physique ne départage qu'à égalité. Une fiche importée peut n'avoir aucune description :",
      "fie-toi alors à son nom, son rôle et son caractère.",
      "",
      "N'invente une fiche que si AUCUNE existante ne peut tenir le rôle sans incohérence.",
      `Tu peux créer AU PLUS ${MAX_NEW} nouvelles entrées ; justifie chaque création ("closest", "why").`,
      "Une même fiche ne joue qu'UN SEUL rôle dans une histoire.",
      "",
      'JSON UNIQUEMENT : {"mapping":[{"story":"(nom dans le script)","entryId":"(id de la fiche, ou null si création)",',
      '"newName":"(si création, le nom de la nouvelle fiche)","why":"(pourquoi ce choix, une ligne)"}],',
      '"create":[{"name":"...","kind":"personnage|lieu|vehicule","desc":"(EN, physique seul, 40-70 mots)",',
      '"traits":"(caractère, en français)","role":"...","closest":"...","why":"..."}]}',
    ].join("\n"),
    { timeoutMs: 5 * 60 * 1000 }
  );
  const m = String(out).match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Plan de casting illisible");
  const plan = JSON.parse(m[0]);
  plan.mapping = (plan.mapping || []).filter((x) => x && x.story);
  plan.create = plan.create || [];

  // GARDE-FOU EN CODE : un plafond énoncé dans un prompt ne suffit pas (leçon Stickman #4).
  const saturated = KINDS.filter((k) => entries.filter((e) => e.kind === k).length >= SATURATED);
  plan.refused = [];
  plan.create = plan.create
    .filter((c) => {
      if (saturated.includes(c.kind)) { plan.refused.push({ ...c, reason: `catégorie ${c.kind} saturée` }); return false; }
      return true;
    })
    .slice(0, MAX_NEW);
  plan.create.forEach((c) => (c.style = style));

  // Les fiches ÉPINGLÉES entrent toujours, même si le modèle les a oubliées.
  plan.reuse = plan.mapping.filter((x) => x.entryId && entries.some((e) => e.id === x.entryId))
    .map((x) => ({ id: x.entryId, role: x.story, why: x.why || "" }));
  for (const e of entries.filter((x) => x.pinned)) {
    if (!plan.reuse.some((r) => r.id === e.id)) plan.reuse.push({ id: e.id, role: e.role || "", why: "personnage fixe de la chaîne" });
  }
  return plan;
}

/** Exécute le plan : crée ce qui manque, incrémente les compteurs d'usage. */
async function applyPlan(plan, { onLog } = {}) {
  const used = [];
  for (const r of plan.reuse || []) {
    const e = get(r.id);
    if (e) used.push({ ...e, role: r.role || e.role || "" });
  }
  for (const c of plan.create || []) {
    onLog?.(`Casting : création de « ${c.name} » (${c.kind})`);
    const e = await createEntry(c);
    used.push({ ...e, role: c.role || e.role || "" });
  }
  const db = load();
  for (const u of used) {
    const e = (db.entries || []).find((x) => x.id === u.id);
    if (e) e.uses = (e.uses || 0) + 1;
  }
  save(db);
  return used;
}

/**
 * assignRefs — attribue 0 à 2 références par plan.
 * DEUX MAXIMUM : au-delà l'i2i mélange les identités (mesuré sur Bouddhisme, confirmé
 * en phase 6 du prototype drama où deux références tiennent parfaitement).
 */
function assignRefs({ scenes, entries }) {
  const byName = new Map(entries.map((e) => [String(e.name).toLowerCase(), e]));
  for (const sc of scenes) {
    const hits = [];
    const hay = `${sc.speaker || ""} ${sc.characters || ""} ${sc.decor || ""} ${sc.image_prompt || ""}`.toLowerCase();
    for (const [name, e] of byName) if (name.length > 2 && hay.includes(name)) hits.push(e);
    // le locuteur passe en premier : c'est son visage qui porte le plan
    hits.sort((a, b) => (String(sc.speaker || "").toLowerCase() === String(b.name).toLowerCase() ? 1 : 0)
                      - (String(sc.speaker || "").toLowerCase() === String(a.name).toLowerCase() ? 1 : 0));
    sc.refs = hits.slice(0, 2).map((e) => ({ id: e.id, name: e.name }));
  }
  return scenes;
}

module.exports = {
  KINDS, STYLES, MAX_NEW, SATURATED, PRICE_REF,
  list, get, pinned, patch, remove, sheetPath,
  createEntry, importEntry, regenerate, draftEntry, ensureRefUrls,
  planLibrary, applyPlan, assignRefs,
};
