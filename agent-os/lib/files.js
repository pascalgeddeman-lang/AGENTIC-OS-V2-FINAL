/**
 * Fichiers locaux (galerie du studio Kie, vidéos du projet, exports) + Drive.
 */
const fs = require("fs");
const path = require("path");
const { DATA_DIR, ensureDir } = require("./store");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
// Uniquement les fichiers issus des GÉNÉRATEURS et des MACHINES (pas les assets du projet)
const OUTPUT_DIR = path.join(__dirname, "..", "output");
const LOCAL_DIRS = [
  { dir: OUTPUT_DIR, label: "Résultats Agentic Os", sublabels: true },
  { dir: path.join(PROJECT_ROOT, "kie-image-studio", "storage"), label: "Studio Kie" },
];
ensureDir(path.join(OUTPUT_DIR, "miniatures"));

const IMG = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".bmp"]);
const VID = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"]);

// Libellé de dossier : pour output/, on descend au premier sous-dossier.
// Tout le scraping est regroupé sous « Scraping » (les sous-dossiers par chaîne
// restent sur disque mais ne polluent pas le filtre de dossiers).
function subLabel(base, full) {
  const rel = path.relative(base, path.dirname(full)).replace(/\\/g, "/");
  if (!rel || rel === ".") return "Résultats";
  const parts = rel.split("/");
  if (parts[0] === "scraping") return "Scraping";
  return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
}

function walk(dir, label, depth, out, opts) {
  if (depth < 0) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, label, depth - 1, out, opts);
    else {
      const ext = path.extname(e.name).toLowerCase();
      const type = IMG.has(ext) ? "image" : VID.has(ext) ? "video" : null;
      if (!type) continue;
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      out.push({
        name: e.name,
        path: full,
        rel: path.relative(PROJECT_ROOT, full).replace(/\\/g, "/"),
        folder: opts && opts.sublabels ? subLabel(opts.base, full) : label,
        size: st.size,
        modified: st.mtime.toISOString(),
        type,
        source: "local",
      });
    }
  }
}

function localFiles(type) {
  const out = [];
  for (const { dir, label, sublabels } of LOCAL_DIRS) {
    walk(dir, label, 3, out, sublabels ? { sublabels: true, base: dir } : null);
  }
  out.sort((a, b) => b.modified.localeCompare(a.modified));
  return type ? out.filter((f) => f.type === type) : out;
}

/** Résout un chemin relatif projet en chemin absolu sûr (pour servir le média). */
function resolveLocal(rel) {
  const full = path.normalize(path.join(PROJECT_ROOT, rel));
  const allowed = LOCAL_DIRS.some(({ dir }) => full.startsWith(path.normalize(dir)));
  return allowed && fs.existsSync(full) ? full : null;
}

module.exports = { localFiles, resolveLocal, OUTPUT_DIR };
