/**
 * BANQUE DE MUSIQUES — MP3 déposés par l'utilisateur, réutilisés par toutes les machines.
 *
 * Pourquoi pas de génération : Suno coûte 0,06 $ la requête et 3-5 min d'attente PAR vidéo.
 * Sur une machine qui produit en série, une bibliothèque réutilisable ramène ce coût à ZÉRO
 * et supprime une étape bloquante du pipeline. La machine Bouddhisme avait déjà validé le
 * principe avec sa bibliothèque de pistes Suno retenues ; ici on va au bout : l'utilisateur
 * verse ses propres fichiers, rien n'est généré.
 *
 * data/music/index.json : [{id, name, usage, tags, seconds, sizeKo, rel, addedAt}]
 * fichiers : output/music/<id>.mp3
 */
const fs = require("fs");
const path = require("path");
const { readJSON, writeJSON, ensureDir } = require("./store");
const ff = require("./ffmpeg");

const DIR = path.join(__dirname, "..", "output", "music");
ensureDir(DIR);

/** Usages prévus — sert à filtrer le sélecteur d'une machine. */
const USAGES = ["intro", "fond", "tension", "emotion", "generique"];

const db = () => readJSON("music/index.json", []);
const save = (l) => writeJSON("music/index.json", l);
const filePath = (id) => path.join(DIR, `${id}.mp3`);

function list({ usage } = {}) {
  let l = db();
  if (usage) l = l.filter((m) => m.usage === usage);
  return l.map((m) => ({ ...m, exists: fs.existsSync(filePath(m.id)) }));
}
const get = (id) => db().find((m) => m.id === id) || null;

/**
 * Ajoute un MP3 déjà présent sur le disque (copie) ou un buffer (upload).
 * La DURÉE est sondée à l'ajout : le montage en a besoin pour boucler ou couper
 * la musique sans re-sonder le fichier à chaque run.
 */
async function add({ name, usage = "fond", tags = [], srcPath = null, buffer = null } = {}) {
  name = String(name || "").trim();
  if (!name) throw new Error("Nom requis");
  if (!USAGES.includes(usage)) throw new Error(`Usage inconnu : ${usage}`);
  if (!srcPath && !buffer) throw new Error("Fichier requis (chemin ou contenu)");
  const id = "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const dest = filePath(id);
  if (buffer) fs.writeFileSync(dest, buffer);
  else {
    if (!fs.existsSync(srcPath)) throw new Error(`Fichier introuvable : ${srcPath}`);
    fs.copyFileSync(srcPath, dest);
  }
  let seconds = 0;
  try { seconds = await ff.probeDuration(dest, { label: "musique" }); }
  catch { fs.unlinkSync(dest); throw new Error("Fichier audio illisible (MP3 attendu)"); }
  const entry = {
    id, name, usage,
    tags: Array.isArray(tags) ? tags : String(tags).split(",").map((t) => t.trim()).filter(Boolean),
    seconds: +seconds.toFixed(2),
    sizeKo: Math.round(fs.statSync(dest).size / 1024),
    rel: `agent-os/output/music/${id}.mp3`,
    addedAt: new Date().toISOString(),
  };
  const l = db(); l.push(entry); save(l);
  return entry;
}

function patch(id, fields = {}) {
  const l = db();
  const m = l.find((x) => x.id === id);
  if (!m) throw new Error("Musique inconnue");
  for (const k of ["name", "usage", "tags"]) if (k in fields) m[k] = fields[k];
  if (m.usage && !USAGES.includes(m.usage)) throw new Error(`Usage inconnu : ${m.usage}`);
  save(l);
  return m;
}

function remove(id) {
  save(db().filter((m) => m.id !== id));
  try { fs.unlinkSync(filePath(id)); } catch {}
  return { ok: true };
}

/** Tire une piste au hasard parmi un usage — évite que toutes les vidéos aient la même intro. */
function pick(usage, { exclude = [] } = {}) {
  const l = list({ usage }).filter((m) => m.exists && !exclude.includes(m.id));
  if (!l.length) return null;
  return l[Math.floor(Math.random() * l.length)];
}

module.exports = { USAGES, list, get, add, patch, remove, pick, filePath };
