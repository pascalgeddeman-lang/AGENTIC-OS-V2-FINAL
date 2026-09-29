/**
 * BIBLIOTHÈQUE VISUELLE de la machine Bouddhisme.
 *
 * Le problème qu'elle résout : en text-to-image pur, un personnage récurrent n'est pas le
 * même d'un plan à l'autre — le vieux moine du plan 4 n'est pas celui du plan 7. Sur une
 * parabole, ça se voit. La parade est la même que la troupe de la machine Stickman : une
 * IMAGE DE RÉFÉRENCE persistante par entité récurrente, réinjectée en image-to-image.
 *
 * Deux natures d'entrée :
 *   - « personnage » : un moine, un novice, un villageois… (référence en 3:4)
 *   - « lieu »       : un monastère, un lac sacré, une cour…  (référence en 16:9)
 *
 * La bibliothèque grandit d'une vidéo à l'autre : c'est un atout d'identité pour la chaîne,
 * pas seulement une économie.
 */
const fs = require("fs");
const path = require("path");
const { DATA_DIR, ensureDir, readJSON, writeJSON } = require("../store");
const claude = require("../claude");
const vault = require("../vault");
const google = require("../google");
const spend = require("../spend");

const MACHINE_NAME = "Bouddhisme";
const STORE = "machines/bouddhisme-library.json";
const LIB_DIR = path.join(__dirname, "..", "..", "output", "machines", "bouddhisme-library");
ensureDir(LIB_DIR);

const PRICE_REF = 0.02;
const MAX_NEW = 3;              // créations maximum par vidéo
const SATURATED = 6;            // au-delà, une catégorie est considérée bien pourvue

/** Style de la fiche de référence : le MÊME que celui des plans, sinon l'ancrage i2i dérive. */
const REF_STYLE =
  "Cinematic photorealistic reference portrait, warm golden-hour light with soft volumetric god rays, " +
  "muted palette of saffron orange, deep forest green, earth brown, weathered stone grey and pale gold, " +
  "shallow depth of field, subtle film grain, serene contemplative documentary mood, clean neutral background, " +
  "subject centred and fully visible, sharp and well lit";
const REF_NEG =
  "no text, no letters, no watermark, no logo, no modern clothing, no distorted hands or faces, no collage, no split frame";

function slug(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "ref";
}

function load() { return readJSON(STORE, { entries: [] }); }
function save(c) { writeJSON(STORE, c); }
function list() {
  const c = load();
  return {
    entries: (c.entries || []).slice().sort((a, b) => (b.uses || 0) - (a.uses || 0) || a.name.localeCompare(b.name)),
  };
}
function get(id) { return (load().entries || []).find((x) => x.id === id) || null; }
function patch(id, p = {}) {
  const c = load();
  const e = (c.entries || []).find((x) => x.id === id);
  if (!e) throw new Error("Entrée introuvable");
  for (const k of ["name", "desc", "kind"]) if (p[k] !== undefined) e[k] = String(p[k]);
  if (p.tags !== undefined) e.tags = Array.isArray(p.tags) ? p.tags : [];
  if (p.locked !== undefined) e.locked = !!p.locked;
  save(c);
  return e;
}
function remove(id) {
  const c = load();
  const e = (c.entries || []).find((x) => x.id === id);
  if (e && e.locked) throw new Error("Entrée verrouillée — déverrouille-la d'abord");
  c.entries = (c.entries || []).filter((x) => x.id !== id);
  save(c);
  try { fs.unlinkSync(path.join(LIB_DIR, id + ".jpg")); } catch {}
  try { fs.unlinkSync(path.join(LIB_DIR, id + ".png")); } catch {}
  return list();
}
function sheetPath(id) {
  for (const ext of [".jpg", ".png"]) {
    const f = path.join(LIB_DIR, id + ext);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

// ---------------------------------------------------------------- transport Kie

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
  if (!r.data?.taskId) throw new Error(`Kie : ${r.msg || JSON.stringify(r).slice(0, 160)}`);
  return r.data.taskId;
}
async function kiePoll(taskId, timeoutMs = 8 * 60 * 1000) {
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
/** Kie renvoie du JPEG même quand l'URL dit .png : on nomme d'après les octets réels. */
async function grab(url, fileNoExt) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Téléchargement ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const ext = buf[0] === 0xff && buf[1] === 0xd8 ? ".jpg" : ".png";
  const file = fileNoExt + ext;
  fs.writeFileSync(file, buf);
  return file;
}
/** URL publique Drive : Kie doit pouvoir lire la référence depuis l'extérieur. */
async function uploadPublic(absFile, name) {
  const mime = absFile.endsWith(".png") ? "image/png" : "image/jpeg";
  const up = await google.driveUpload(name, mime, fs.readFileSync(absFile));
  await google.ensurePublic(up.id).catch(() => {});
  return `https://drive.google.com/uc?export=download&id=${up.id}`;
}

// ---------------------------------------------------------------- création / régénération

const MODEL = "nano-banana-2-lite";

/** Fabrique la fiche de référence d'une entité et l'ajoute à la bibliothèque. */
async function createEntry({ name, kind = "personnage", desc, tags = [] }, { tries = 3 } = {}) {
  if (!desc) throw new Error("Description visuelle manquante");
  const c = load();
  let id = slug(name);
  let n = 2;
  while ((c.entries || []).some((x) => x.id === id)) id = `${slug(name)}-${n++}`;

  const isPlace = kind === "lieu";
  const prompt = [
    REF_STYLE,
    "",
    isPlace
      ? "This is a LOCATION reference sheet: one single establishing view of the place, no people in frame."
      : "This is a CHARACTER reference sheet: one single person, head to knees, facing the camera, neutral calm expression, plain uncluttered background.",
    "",
    `SUBJECT: ${desc}`,
    "",
    REF_NEG,
  ].join("\n");

  let file, lastErr;
  for (let a = 1; a <= tries; a++) {
    try {
      file = await grab(await kiePoll(await kieCreate(MODEL, { prompt, aspect_ratio: isPlace ? "16:9" : "3:4" })), path.join(LIB_DIR, id));
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (a < tries) await new Promise((r) => setTimeout(r, 4000 * a));
    }
  }
  if (lastErr) throw lastErr;

  spend.record("Kie.ai", MACHINE_NAME, PRICE_REF, "USD", `Référence « ${name} »`);
  const entry = {
    id,
    name: String(name),
    kind: isPlace ? "lieu" : "personnage",
    desc: String(desc),
    tags: Array.isArray(tags) ? tags : [],
    rel: `agent-os/output/machines/bouddhisme-library/${path.basename(file)}`,
    url: await uploadPublic(file, `bouddhisme-${id}${path.extname(file)}`),
    locked: false,
    uses: 0,
    createdAt: new Date().toISOString(),
    ts: Date.now(),
  };
  const cur = load();
  cur.entries = [...(cur.entries || []), entry];
  save(cur);
  return entry;
}

/** Redessine une entrée SANS changer son identité (même nom, même description sauf override). */
async function regenerate(id, descOverride) {
  const c = load();
  const e = (c.entries || []).find((x) => x.id === id);
  if (!e) throw new Error("Entrée introuvable");
  const desc = descOverride || e.desc;
  const isPlace = e.kind === "lieu";
  const prompt = [
    REF_STYLE, "",
    isPlace
      ? "This is a LOCATION reference sheet: one single establishing view of the place, no people in frame."
      : "This is a CHARACTER reference sheet: one single person, head to knees, facing the camera, neutral calm expression, plain uncluttered background.",
    "", `SUBJECT: ${desc}`, "", REF_NEG,
  ].join("\n");

  const old = sheetPath(id);
  const file = await grab(await kiePoll(await kieCreate(MODEL, { prompt, aspect_ratio: isPlace ? "16:9" : "3:4" })), path.join(LIB_DIR, id));
  if (old && old !== file) { try { fs.unlinkSync(old); } catch {} }   // l'ancienne n'est jetée qu'en cas de SUCCÈS
  spend.record("Kie.ai", MACHINE_NAME, PRICE_REF, "USD", `Référence « ${e.name} » (régénérée)`);

  const cur = load();
  const ref = (cur.entries || []).find((x) => x.id === id);
  ref.desc = desc;
  ref.rel = `agent-os/output/machines/bouddhisme-library/${path.basename(file)}`;
  ref.url = await uploadPublic(file, `bouddhisme-${id}-${Date.now()}${path.extname(file)}`);
  ref.ts = Date.now();
  save(cur);
  return ref;
}

/** L'utilisateur décrit en français ; Claude rédige la fiche (nom, nature, description EN, tags). */
async function draftEntry(description) {
  if (!description || !description.trim()) throw new Error("Décris ce que tu veux ajouter");
  const out = await claude.ask([
    "Tu prépares une fiche de RÉFÉRENCE VISUELLE pour une chaîne de sagesse bouddhiste.",
    "L'utilisateur décrit en français ce qu'il veut ; tu rends une fiche exploitable.",
    "",
    `DEMANDE : ${description}`,
    "",
    "RÈGLES :",
    "- `kind` vaut « personnage » ou « lieu ».",
    "- `name` : nom LISIBLE en français, 1 à 4 mots, première lettre en majuscule.",
    "- `desc` : en ANGLAIS, 40 à 70 mots, UNIQUEMENT ce qui définit l'identité visuelle et",
    "  qui doit rester constant d'une vidéo à l'autre (morphologie, âge, tenue, matières,",
    "  couleurs, architecture, végétation). Jamais d'action, jamais d'émotion, jamais de météo :",
    "  ça change à chaque plan.",
    "- `tags` : 3 à 6 étiquettes courtes en français (tradition, type de lieu, saison, palette…).",
    "",
    'RÉPONDS UNIQUEMENT EN JSON : {"name":"","kind":"","desc":"","tags":[]}',
  ].join("\n"), { timeoutMs: 4 * 60 * 1000 });
  const j = claude.parseJson(out);
  return { name: j.name || "", kind: j.kind === "lieu" ? "lieu" : "personnage", desc: j.desc || "", tags: j.tags || [] };
}

// ---------------------------------------------------------------- plan de la vidéo

/**
 * Décide QUI et QUOI est récurrent dans cette vidéo, en réutilisant d'abord la bibliothèque.
 * Les plafonds sont appliqués EN CODE : un modèle qui hésite crée, le prompt seul ne suffit
 * jamais (leçon de la troupe Stickman).
 */
async function planLibrary({ title, script, shots = [] }) {
  const lib = load().entries || [];
  const inventory = lib.length
    ? lib.map((e) => `- ${e.id} | ${e.name} | ${e.kind} | ${(e.tags || []).join(", ")} | ${e.desc.slice(0, 110)}`).join("\n")
    : "(bibliothèque vide)";

  const out = await claude.ask([
    "Tu prépares la BIBLIOTHÈQUE VISUELLE d'une vidéo de sagesse bouddhiste.",
    "Objectif : les personnages et les lieux qui REVIENNENT dans le récit doivent être",
    "identiques d'un plan à l'autre. Pour cela, chacun a une image de référence persistante.",
    "",
    `TITRE : ${title}`,
    "",
    "SCRIPT :",
    String(script).slice(0, 7000),
    shots.length ? "\nPLANS :\n" + shots.slice(0, 90).map((s) => `${s.i}. ${String(s.say || "").slice(0, 110)}`).join("\n") : "",
    "",
    "BIBLIOTHÈQUE EXISTANTE (à réutiliser en priorité) :",
    inventory,
    "",
    "RÈGLES — LA RÉUTILISATION EST LA NORME, LA CRÉATION EST L'EXCEPTION :",
    "1. Ne retiens QUE ce qui revient dans PLUSIEURS plans. Un décor vu une seule fois n'a",
    "   pas besoin de référence : le prompt du plan suffit.",
    "2. Une entrée existante qui approche convient : on préfère une troupe reconnaissable à",
    "   une troupe exacte. Un moine âgé reste le même moine, qu'il marche, médite ou parle.",
    "3. Tu ne crées QUE si RIEN dans la bibliothèque ne peut tenir le rôle.",
    `4. ${MAX_NEW} créations maximum, et zéro si la bibliothèque compte déjà ${SATURATED} entrées de la même nature.`,
    "5. Une vidéo tient avec 2 à 5 entrées récurrentes. Au-delà, tu regroupes.",
    "6. Pour CHAQUE création : `desc` en ANGLAIS, 40 à 70 mots, UNIQUEMENT l'identité visuelle",
    "   constante (morphologie, âge, tenue, matières, couleurs, architecture). Jamais d'action,",
    "   jamais d'émotion, jamais de météo.",
    "7. Pour chaque création, `closest` nomme l'entrée existante la plus proche et `why` explique",
    "   en une phrase pourquoi elle ne peut pas convenir. Si tu n'y arrives pas, réutilise.",
    "",
    'RÉPONDS UNIQUEMENT EN JSON : {"reuse":[{"id":"","why":""}],"create":[{"name":"","kind":"personnage|lieu","desc":"","tags":[],"closest":"","why":""}]}',
  ].join("\n"), { timeoutMs: 6 * 60 * 1000 });

  const j = claude.parseJson(out);
  const known = new Map(lib.map((e) => [e.id, e]));
  const reuse = (j.reuse || []).filter((r) => known.has(r.id));
  const reused = new Set(reuse.map((r) => r.id));

  // GARDE-FOU EN CODE — le prompt ne suffit pas.
  const perKind = {};
  for (const e of lib) perKind[e.kind] = (perKind[e.kind] || 0) + 1;
  const create = [];
  const rejected = [];
  for (const c of j.create || []) {
    if (!c || !c.name || !c.desc) continue;
    const kind = c.kind === "lieu" ? "lieu" : "personnage";
    const saturated = (perKind[kind] || 0) >= SATURATED;
    const overCap = create.length >= MAX_NEW;
    if (!saturated && !overCap) { create.push({ ...c, kind }); continue; }
    const fallback = known.get(c.closest) || lib.find((x) => x.kind === kind) || null;
    rejected.push({
      name: c.name,
      reason: overCap ? `plafond de ${MAX_NEW} créations` : `${perKind[kind]} entrées « ${kind} » existent déjà`,
      fallback: fallback?.name || null,
    });
    if (fallback && !reused.has(fallback.id)) {
      reuse.push({ id: fallback.id, why: `remplace « ${c.name} »` });
      reused.add(fallback.id);
    }
  }
  return { reuse, create, rejected };
}

/** Exécute le plan : réutilise, crée ce qui manque, met à jour les compteurs d'usage. */
async function applyPlan(plan, { onLog } = {}) {
  const log = onLog || (() => {});
  const used = [];
  for (const r of plan.reuse || []) {
    const e = get(r.id);
    if (e) used.push(e);
  }
  if (used.length) log(`Bibliothèque : ${used.length} référence(s) réutilisée(s) — ${used.map((e) => e.name).join(", ")}`);
  for (const r of plan.rejected || []) {
    log(`  ⤷ création refusée « ${r.name} » (${r.reason})${r.fallback ? ` → jouée par ${r.fallback}` : ""}`);
  }

  const todo = plan.create || [];
  if (todo.length) {
    log(`Bibliothèque : ${todo.length} référence(s) à dessiner (${(todo.length * PRICE_REF).toFixed(2)} $)…`);
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const spec = todo[next++];
        try {
          const e = await createEntry(spec);
          used.push(e);
          log(`  + ${e.name} (${e.kind})`);
        } catch (err) {
          log(`  ⚠ « ${spec.name} » : ${err.message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, todo.length) }, worker));
  }

  const c = load();
  for (const e of used) {
    const ref = (c.entries || []).find((x) => x.id === e.id);
    if (ref) ref.uses = (ref.uses || 0) + 1;
  }
  save(c);
  return used;
}

/**
 * Attribue à chaque plan les références qui y apparaissent (0 à 2).
 * Peu de références par plan : au-delà de deux, l'i2i mélange les identités.
 */
async function assignRefs({ shots, entries }) {
  if (!entries.length) return {};
  const out = await claude.ask([
    "Tu attribues des images de référence aux plans d'une vidéo de sagesse bouddhiste.",
    "",
    "RÉFÉRENCES DISPONIBLES :",
    ...entries.map((e) => `- ${e.id} | ${e.name} | ${e.kind} | ${e.desc.slice(0, 110)}`),
    "",
    "PLANS :",
    ...shots.map((s) => `${s.i}. ${String(s.say || "").slice(0, 150)}`),
    "",
    "RÈGLES :",
    "- Un plan reçoit 0, 1 ou 2 références — JAMAIS plus : au-delà, les identités se mélangent.",
    "- N'attribue une référence que si l'entité est VRAIMENT dans le plan. Un plan de paysage",
    "  sans personnage ne reçoit aucun personnage.",
    "- Si le plan ne montre rien de récurrent, laisse la liste vide : le prompt suffira.",
    "",
    'RÉPONDS UNIQUEMENT EN JSON : {"assign":[{"i":1,"refs":["id1"]}]}',
  ].join("\n"), { timeoutMs: 6 * 60 * 1000 });

  const j = claude.parseJson(out);
  const valid = new Set(entries.map((e) => e.id));
  const map = {};
  for (const a of j.assign || []) {
    const refs = (a.refs || []).filter((r) => valid.has(r)).slice(0, 2);
    if (refs.length) map[Number(a.i)] = refs;
  }
  return map;
}

module.exports = {
  PRICE_REF, MAX_NEW,
  list, get, patch, remove, sheetPath,
  createEntry, regenerate, draftEntry,
  planLibrary, applyPlan, assignRefs,
};
