/**
 * CASTING STICKMAN — bibliothèque de personnages persistante, partagée par TOUS les runs.
 *
 * Le principe (voir stickman-lab/RECETTE-NICHE-STICKMAN.md §5) : générer une série d'images
 * depuis UNE seule référence fait rhabiller tout le monde avec la tenue de cette référence
 * (des hommes préhistoriques en t-shirt bleu). La parade :
 *
 *   1. UNE base neutre — un stickman nu, chauve, sans accessoire. Généré une fois, jamais modifié.
 *   2. Chaque personnage est HABILLÉ depuis cette base en image-to-image : mêmes proportions,
 *      même trait, seules la tenue / la coiffure / les accessoires changent.
 *   3. À chaque plan on ne joint QUE les fiches des personnages présents, avec leur identité
 *      rappelée dans le prompt.
 *
 * La bibliothèque grandit d'une vidéo à l'autre : la machine réutilise ce qui existe et ne crée
 * que ce qui manque. Effet de bord recherché : la troupe devient reconnaissable sur la chaîne.
 *
 * Données : data/machines/stickman-cast.json   Fiches : output/machines/stickman-cast/<id>.png
 */
const fs = require("fs");
const path = require("path");
const { DATA_DIR, ensureDir, readJSON, writeJSON } = require("../store");
const vault = require("../vault");
const google = require("../google");
const spend = require("../spend");
const claude = require("../claude");

const CAST_DIR = path.join(__dirname, "..", "..", "output", "machines", "stickman-cast");
const ROOT = path.join(__dirname, "..", "..", "..");
ensureDir(CAST_DIR);

const PRICE_SHEET = 0.02; // une fiche = un appel nano-banana-2-lite
const MAX_NEW = 3;        // créations maximum par vidéo (la réutilisation est la norme)
const MODEL = "nano-banana-2-lite";

// ---------------------------------------------------------------- charte graphique

/** Style commun à TOUTES les fiches : c'est lui qui tient l'unité de la troupe. */
const SHEET_STYLE = `Flat 2D minimalist stickman cartoon character sheet, single character standing centred and facing forward on a completely plain flat pale beige background, full body visible head to feet, arms relaxed at the sides. Thick uniform black outlines, flat matte desaturated colour fills, no gradients, no texture, no shading beyond one single darker tone. The head is a large plain round off-white circle with a thick black outline, two small black dot eyes and one short thin line for the mouth — no nose, no ears, no skin tone, no facial shading. Arms and legs are thin solid black lines with small solid black oval hands and feet. Nothing else in the frame: no props on the ground, no scenery, no shadow beyond one small flat ellipse.`;

const SHEET_NEG = `Absolutely no text, no letters, no words, no numbers, no labels, no watermark, no logo, no signature. No photorealism, no 3D render, no anime, no detailed or shaded face, no realistic skin, no multiple characters, no turnaround views, no side or back views.`;

/** Le gabarit : nu, chauve, sans accessoire. Tout le reste en dérive. */
const NEUTRAL_LOOK = `He is completely plain and unclothed: no clothing at all, no hair, no accessories — just the bare round head and the black stick body. He is the neutral template every other character is built from.`;

// ---------------------------------------------------------------- persistance

function load() {
  return readJSON("machines/stickman-cast.json", { neutral: null, characters: [] });
}
function save(c) {
  writeJSON("machines/stickman-cast.json", c);
}

/** Fiches exposées à l'UI (sans les chemins absolus). */
function list() {
  const c = load();
  return {
    neutral: c.neutral,
    characters: (c.characters || []).sort((a, b) => (a.era || "").localeCompare(b.era || "") || a.name.localeCompare(b.name)),
  };
}

function get(id) {
  return (load().characters || []).find((x) => x.id === id) || null;
}

function remove(id) {
  const c = load();
  c.characters = (c.characters || []).filter((x) => x.id !== id);
  save(c);
  try { fs.unlinkSync(path.join(CAST_DIR, id + ".png")); } catch {}
  return list();
}

function patch(id, p = {}) {
  const c = load();
  const ch = (c.characters || []).find((x) => x.id === id);
  if (!ch) throw new Error("Personnage introuvable");
  for (const k of ["name", "era", "role", "tags", "look"]) {
    if (p[k] !== undefined) ch[k] = p[k];
  }
  ch.updatedAt = new Date().toISOString();
  save(c);
  return ch;
}

// ---------------------------------------------------------------- Kie

function kieKey() {
  const k = vault.get("kie");
  if (!k) throw new Error("Clé Kie absente du coffre");
  return k;
}

async function kieCreate(input) {
  const r = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
    method: "POST",
    headers: { Authorization: `Bearer ${kieKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input }),
  }).then((x) => x.json());
  if (!r.data?.taskId) throw new Error(`Kie : ${r.msg || JSON.stringify(r).slice(0, 180)}`);
  return r.data.taskId;
}

async function kiePoll(taskId, timeoutMs = 8 * 60 * 1000) {
  const t0 = Date.now();
  while (true) {
    await new Promise((r) => setTimeout(r, 6000));
    if (Date.now() - t0 > timeoutMs) throw new Error("Kie : délai dépassé");
    const r = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
      headers: { Authorization: `Bearer ${kieKey()}` },
    }).then((x) => x.json());
    if (r.data?.state === "success") return JSON.parse(r.data.resultJson).resultUrls[0];
    if (r.data?.state === "fail") throw new Error(`Kie : ${r.data?.failMsg || "génération échouée"}`);
  }
}

async function grab(url, file) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Téléchargement fiche ${resp.status}`);
  fs.writeFileSync(file, Buffer.from(await resp.arrayBuffer()));
}

/** Kie doit pouvoir aller CHERCHER la référence : on passe par une URL publique Drive. */
async function uploadPublic(absFile, name) {
  const up = await google.driveUpload(name, "image/png", fs.readFileSync(absFile));
  await google.ensurePublic(up.id).catch(() => {});
  return `https://drive.google.com/uc?export=download&id=${up.id}`;
}

// ---------------------------------------------------------------- base neutre

/**
 * La base neutre. Générée une seule fois puis figée : toute la bibliothèque en dérive, donc
 * la remplacer (par le stickman maison de l'utilisateur) change l'identité de la chaîne entière.
 */
async function ensureNeutral({ force = false } = {}) {
  const c = load();
  const file = path.join(CAST_DIR, "neutral.png");
  if (!force && c.neutral && fs.existsSync(file)) return c.neutral;

  const url = await kiePoll(await kieCreate({ prompt: `${SHEET_STYLE}\n\nCHARACTER: ${NEUTRAL_LOOK}\n\n${SHEET_NEG}`, aspect_ratio: "3:4" }));
  await grab(url, file);
  spend.record("Kie.ai", "Stickman", PRICE_SHEET, "USD", "Fiche stickman neutre");
  c.neutral = {
    rel: "agent-os/output/machines/stickman-cast/neutral.png",
    url: await uploadPublic(file, "stickman-neutral.png"),
    ts: Date.now(),
  };
  save(c);
  return c.neutral;
}

/** Remplace la base neutre par une image fournie (le stickman maison). */
async function setNeutralFromUpload(dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!m) throw new Error("Image invalide (attendu : PNG, JPG ou WebP)");
  const file = path.join(CAST_DIR, "neutral.png");
  fs.writeFileSync(file, Buffer.from(m[2], "base64"));
  const c = load();
  c.neutral = {
    rel: "agent-os/output/machines/stickman-cast/neutral.png",
    url: await uploadPublic(file, `stickman-neutral-${Date.now()}.png`),
    ts: Date.now(),
    custom: true,
  };
  save(c);
  return c.neutral;
}

// ---------------------------------------------------------------- fiches

const slug = (s) =>
  String(s || "perso").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "perso";

/**
 * Crée une fiche : on HABILLE la base neutre. Le prompt interdit explicitement de toucher au
 * corps — sans ça le modèle redessine un personnage différent à chaque fiche et la troupe part
 * dans tous les sens.
 */
async function createCharacter({ name, era = "", role = "", tags = [], look }, { tries = 3 } = {}) {
  if (!look) throw new Error("Description de tenue manquante");
  const neutral = await ensureNeutral();
  const c = load();
  let id = slug(name);
  let n = 2;
  while ((c.characters || []).some((x) => x.id === id)) id = `${slug(name)}-${n++}`;

  const prompt =
    `${SHEET_STYLE}\n\n` +
    `Take the neutral stickman in the reference image and DRESS HIM as the following character. ` +
    `Keep his exact body: same round head shape, same dot eyes, same line mouth, same thin black stick limbs, ` +
    `same proportions and same line weight. Change ONLY the clothing, the hair and the accessories.\n\n` +
    `CHARACTER: ${look}\n\n${SHEET_NEG}`;

  const file = path.join(CAST_DIR, id + ".png");
  let lastErr;
  for (let a = 1; a <= tries; a++) {
    try {
      await grab(await kiePoll(await kieCreate({ prompt, aspect_ratio: "3:4", image_urls: [neutral.url] })), file);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (a < tries) await new Promise((r) => setTimeout(r, 4000 * a));
    }
  }
  if (lastErr) throw lastErr;

  spend.record("Kie.ai", "Stickman", PRICE_SHEET, "USD", `Fiche personnage « ${name} »`);
  const ch = {
    id,
    name: String(name),
    era: String(era),
    role: String(role),
    tags: Array.isArray(tags) ? tags : [],
    look: String(look),
    rel: `agent-os/output/machines/stickman-cast/${id}.png`,
    url: await uploadPublic(file, `stickman-${id}.png`),
    locked: false,
    universal: false,
    uses: 0,
    createdAt: new Date().toISOString(),
  };
  const cur = load();
  cur.characters = [...(cur.characters || []), ch];
  save(cur);
  return ch;
}

/** Régénère la fiche d'un personnage existant (même identité, nouveau dessin). */
async function regenerate(id, lookOverride) {
  const c = load();
  const ch = (c.characters || []).find((x) => x.id === id);
  if (!ch) throw new Error("Personnage introuvable");
  const neutral = await ensureNeutral();
  if (lookOverride) ch.look = String(lookOverride);

  const prompt =
    `${SHEET_STYLE}\n\n` +
    `Take the neutral stickman in the reference image and DRESS HIM as the following character. ` +
    `Keep his exact body: same round head shape, same dot eyes, same line mouth, same thin black stick limbs, ` +
    `same proportions and same line weight. Change ONLY the clothing, the hair and the accessories.\n\n` +
    `CHARACTER: ${ch.look}\n\n${SHEET_NEG}`;

  const tmp = path.join(CAST_DIR, id + ".new.png");
  await grab(await kiePoll(await kieCreate({ prompt, aspect_ratio: "3:4", image_urls: [neutral.url] })), tmp);
  // On n'écrase l'ancienne fiche qu'en cas de SUCCÈS (règle non négociable du squelette).
  fs.renameSync(tmp, path.join(CAST_DIR, id + ".png"));
  spend.record("Kie.ai", "Stickman", PRICE_SHEET, "USD", `Fiche régénérée « ${ch.name} »`);
  ch.url = await uploadPublic(path.join(CAST_DIR, id + ".png"), `stickman-${id}-${Date.now()}.png`);
  ch.ts = Date.now();
  save(c);
  return ch;
}

// ---------------------------------------------------------------- résolution du casting

/**
 * Traduit une demande en français (« femme viking, natte blonde, cape de laine ») en fiche
 * structurée prête à générer. Sert au bouton « + Personnage » de l'onglet Personnages.
 */
async function draftCharacter(description) {
  const out = await claude.ask(
    [
      "Tu prépares une FICHE DE PERSONNAGE pour une série de documentaires animés en stickman (bonshommes allumettes).",
      "Le corps ne se décrit JAMAIS (tête ronde blanche, membres en traits noirs — c'est le gabarit commun).",
      "Tu ne décris QUE : la tenue, la coiffure/pilosité et les accessoires.",
      "",
      `DEMANDE DE L'UTILISATEUR : ${description}`,
      "",
      "Contraintes :",
      "- `look` en ANGLAIS, 45-80 mots, commence par « He wears » / « She wears », décrit matières et couleurs concrètes,",
      "  précise la coiffure (ou son absence), 1 à 3 accessoires, et si le personnage est pieds nus ou chaussé.",
      "- Ne mentionne AUCUNE couleur de peau : les personnages restent des pictogrammes.",
      "- `era` parmi : prehistoire, antiquite, moyen-age, moderne, contemporain, intemporel",
      "- `role` court en français (ex. « chasseur », « archéologue », « enfant »)",
      "- `name` : NOM LISIBLE en français, 1 à 3 mots, majuscule initiale, accents normaux, sans article",
      "  (ex. « Guerrière viking »). JAMAIS un identifiant technique : pas de tiret, pas de minuscules collées.",
      "- `tags` : 3 à 6 mots-clés français en minuscules",
      "",
      'RÉPONDS UNIQUEMENT EN JSON : {"name":"","era":"","role":"","tags":[],"look":""}',
    ].join("\n"),
    { timeoutMs: 3 * 60 * 1000 }
  );
  const j = claude.parseJson(out);
  if (!j || !j.look) throw new Error("Le brouillon de fiche n'a pas pu être généré");
  return j;
}

/**
 * LE CŒUR : à partir du script d'une vidéo, décide qui réutiliser et qui créer.
 *
 * On donne à Claude la bibliothèque complète et une consigne de RÉUTILISATION STRICTE :
 * sans ça il recrée « homme préhistorique 2 » à chaque vidéo et la troupe se dilue.
 *
 * @returns { reuse: [{id, why}], create: [{name, era, role, tags, look, why}] }
 */
async function planCast({ title, script, shots = [], forced = "" }) {
  const lib = load().characters || [];
  const inventory = lib.length
    ? lib.map((c) => `- ${c.id} | ${c.name} | époque: ${c.era || "?"} | rôle: ${c.role || "?"} | ${c.look.slice(0, 130)}`).join("\n")
    : "(bibliothèque vide)";

  const out = await claude.ask(
    [
      "Tu es directeur de casting pour une chaîne de documentaires animés en stickman.",
      "Tu dois établir la distribution d'UNE vidéo à partir de son script.",
      "",
      `TITRE : ${title}`,
      "",
      "SCRIPT (voix off) :",
      String(script).slice(0, 9000),
      shots.length ? "\nRÉSUMÉ DES PLANS :\n" + shots.slice(0, 90).map((s) => `${s.i}. ${String(s.scene || s.say || "").slice(0, 110)}`).join("\n") : "",
      "",
      "BIBLIOTHÈQUE EXISTANTE (à réutiliser en priorité) :",
      inventory,
      forced ? `\nPERSONNAGES IMPOSÉS PAR L'UTILISATEUR : ${forced}` : "",
      "",
      "RÈGLES — LA RÉUTILISATION EST LA NORME, LA CRÉATION EST L'EXCEPTION :",
      "1. Un personnage de la bibliothèque joue TOUS les rôles de son époque et de sa fonction, dans",
      "   TOUTES les vidéos. L'« homme préhistorique » est chasseur, tailleur de silex, malade, père,",
      "   guetteur, mangeur, dormeur — c'est la POSE et l'ACTION qui changent d'un plan à l'autre, pas",
      "   le personnage. Un métier ne justifie JAMAIS une fiche à lui seul.",
      "2. Avant toute création, demande-toi : « lequel de la bibliothèque pourrait tenir ce rôle en",
      "   changeant simplement de posture, d'expression ou d'objet tenu en main ? » Si la réponse existe,",
      "   tu RÉUTILISES — même imparfaitement. Une troupe reconnaissable vaut mieux qu'une troupe exacte.",
      "3. Tu ne crées QUE dans ces deux cas :",
      "   (a) AUCUN personnage de cette époque n'existe dans la bibliothèque ;",
      "   (b) le script s'attarde sur une silhouette que rien d'existant ne peut évoquer (une armure,",
      "       un scaphandre, une coiffe rituelle) ET ce personnage revient dans plusieurs plans.",
      "4. **3 créations maximum par vidéo, et zéro si l'époque traitée compte déjà 4 fiches ou plus.**",
      "   Si tu hésites, tu ne crées pas.",
      "5. Une distribution tient en 4 à 8 personnages. Au-delà, tu regroupes.",
      "6. Pour CHAQUE création, `closest` doit nommer l'identifiant de la fiche existante la PLUS proche",
      "   et `why` doit expliquer pourquoi elle ne peut pas tenir le rôle. Si tu n'arrives pas à le",
      "   justifier en une phrase convaincante, c'est que la création n'est pas nécessaire : réutilise.",
      "4. Pour chaque CRÉATION : `look` en ANGLAIS, 45-80 mots, uniquement tenue + coiffure + accessoires,",
      "   jamais le corps, jamais de couleur de peau. `era` parmi : prehistoire, antiquite, moyen-age,",
      "   moderne, contemporain, intemporel.",
      "   `name` est un NOM LISIBLE en français, 1 à 3 mots, première lettre en majuscule, accents normaux",
      "   (ex. « Guérisseuse préhistorique », « Scribe égyptien »). JAMAIS un identifiant technique :",
      "   pas de tiret, pas de minuscules collées, pas d'abréviation.",
      "5. Distingue visuellement les personnages entre eux (coiffure, couleur de tenue, accessoire) :",
      "   un plan dure 3 secondes, on doit lire qui est qui immédiatement.",
      "",
      'RÉPONDS UNIQUEMENT EN JSON : {"reuse":[{"id":"","why":""}],"create":[{"name":"","era":"","role":"","tags":[],"look":"","closest":"","why":""}]}',
    ].join("\n"),
    { timeoutMs: 6 * 60 * 1000 }
  );
  const j = claude.parseJson(out);
  if (!j) throw new Error("Le plan de casting n'a pas pu être lu");

  const known = new Map(lib.map((c) => [c.id, c]));
  const reuse = (j.reuse || []).filter((r) => known.has(r.id));
  const reused = new Set(reuse.map((r) => r.id));

  // GARDE-FOU CODE — le prompt seul ne suffit pas : un modèle qui hésite crée. On applique
  // les mêmes règles côté machine, et toute création refusée est rabattue sur la fiche la plus
  // proche (celle que le modèle a lui-même désignée, sinon n'importe laquelle de son époque).
  const perEra = {};
  for (const c of lib) perEra[c.era] = (perEra[c.era] || 0) + 1;

  const create = [];
  const rejected = [];
  for (const c of j.create || []) {
    if (!c || !c.look || !c.name) continue;
    const era = String(c.era || "");
    const saturated = (perEra[era] || 0) >= 4;   // époque déjà bien pourvue
    const overCap = create.length >= MAX_NEW;    // plafond par vidéo
    if (!saturated && !overCap) { create.push(c); continue; }

    const fallback = known.get(c.closest) || lib.find((x) => x.era === era) || null;
    rejected.push({ name: c.name, reason: overCap ? `plafond de ${MAX_NEW} créations` : `${perEra[era]} fiches existent déjà pour « ${era} »`, fallback: fallback?.name || null });
    if (fallback && !reused.has(fallback.id)) {
      reuse.push({ id: fallback.id, why: `remplace « ${c.name} » (${overCap ? "plafond de créations" : "époque déjà couverte"})` });
      reused.add(fallback.id);
    }
  }
  return { reuse, create, rejected };
}

/**
 * Exécute un plan de casting : les réutilisations coûtent 0, les créations sont générées en
 * parallèle et versées dans la bibliothèque. Renvoie la distribution complète du run.
 */
async function applyPlan(plan, { onLog } = {}) {
  const log = onLog || (() => {});
  const cast = [];
  for (const r of plan.reuse || []) {
    const ch = get(r.id);
    if (ch) cast.push(ch);
  }
  if (cast.length) log(`Casting : ${cast.length} personnage(s) réutilisé(s) — ${cast.map((c) => c.name).join(", ")}`);

  const todo = plan.create || [];
  if (todo.length) {
    log(`Casting : ${todo.length} nouveau(x) personnage(s) à dessiner (${(todo.length * PRICE_SHEET).toFixed(2)} $)…`);
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const spec = todo[next++];
        try {
          const ch = await createCharacter(spec);
          cast.push(ch);
          log(`  + ${ch.name} (${ch.era || "époque ?"})`);
        } catch (e) {
          log(`  ⚠ « ${spec.name} » : ${e.message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));
  }

  // Compteur d'usage : sert au tri de l'onglet Personnages (les piliers de la troupe en tête).
  const c = load();
  for (const ch of cast) {
    const ref = (c.characters || []).find((x) => x.id === ch.id);
    if (ref) ref.uses = (ref.uses || 0) + 1;
  }
  save(c);
  return cast;
}

/**
 * Fiches toujours disponibles pour un run, quel que soit le thème : l'hôte/narrateur.
 * Réglage interne (pas d'UI) — l'utilisateur n'a pas à gérer de « favoris ».
 */
function universals() {
  return (load().characters || []).filter((c) => c.universal);
}

/** Chemin disque d'une fiche (pour /media/ et les aperçus). */
function sheetPath(id) {
  const f = path.join(CAST_DIR, (id === "neutral" ? "neutral" : id) + ".png");
  return fs.existsSync(f) ? f : null;
}

module.exports = {
  SHEET_STYLE, SHEET_NEG, PRICE_SHEET,
  list, get, patch, remove,
  ensureNeutral, setNeutralFromUpload,
  createCharacter, regenerate, draftCharacter,
  planCast, applyPlan, universals, sheetPath,
};
