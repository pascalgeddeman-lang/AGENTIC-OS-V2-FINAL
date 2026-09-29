/**
 * Indexeur du second cerveau : coffre Obsidian -> <coffre>/graphify-out/
 *
 *   node agent-os/scripts/build-graph.js [chemin du coffre]
 *
 * Sans argument, le coffre vient de SECOND_BRAIN_DIR (.env racine).
 * Produit graph.json (noeuds = notes, aretes = wikilinks) + rings.html (viewer),
 * servis par le serveur sur /brain/graph/. Zero dependance.
 */
const fs = require("fs");
const path = require("path");

// .env racine, meme logique que server.js (l'environnement garde la priorite).
try {
  for (const line of fs.readFileSync(path.join(__dirname, "..", "..", ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const VAULT = process.argv[2] || process.env.SECOND_BRAIN_DIR;
if (!VAULT) {
  console.error("Aucun coffre : définis SECOND_BRAIN_DIR dans le .env racine, ou passe le chemin en argument.");
  process.exit(1);
}
if (!fs.existsSync(VAULT)) {
  console.error("Coffre introuvable : " + VAULT);
  process.exit(1);
}

const OUT = path.join(VAULT, "graphify-out");
const SKIP_DIRS = new Set(["graphify-out", ".obsidian", ".git", ".trash", "Templates", "node_modules"]);
const SKIP_FILES = new Set(["CLAUDE.md", "AGENTS.md", "README.md"]);

/** Liste récursive des notes .md du coffre (chemins relatifs, séparateur /). */
function walk(dir, rel = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      out.push(...walk(path.join(dir, e.name), r));
    } else if (e.name.endsWith(".md") && !SKIP_FILES.has(e.name)) {
      out.push(r);
    }
  }
  return out;
}

/** Frontmatter YAML simple (title, tags) + corps. */
function parseFront(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { front: {}, body: raw };
  const front = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith("[") && v.endsWith("]")) {
      v = v.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else {
      v = v.replace(/^["']|["']$/g, "");
    }
    front[kv[1]] = v;
  }
  return { front, body: raw.slice(m[0].length) };
}

/** Corps -> extrait lisible (sans titres, listes de liens, code). */
function excerptOf(body) {
  const lines = body.split(/\r?\n/)
    .filter((l) => !/^\s*(#|>|\||```|---)/.test(l))
    .filter((l) => !/^\s*[-*]\s*\[\[/.test(l))
    .map((l) => l.trim())
    .filter(Boolean);
  const txt = lines.join(" ").replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1").replace(/\s+/g, " ");
  return txt.length > 340 ? txt.slice(0, 337) + "…" : txt;
}

const files = walk(VAULT);
if (!files.length) {
  console.error("Aucune note .md trouvée dans " + VAULT);
  process.exit(1);
}

// ---------- Noeuds ----------
const nodes = [];
const byBase = new Map();   // "Le polling bat le callback" -> id (résolution Obsidian)
const byId = new Map();

for (const file of files) {
  const raw = fs.readFileSync(path.join(VAULT, file), "utf8");
  const { front, body } = parseFront(raw);
  const id = file.replace(/\.md$/, "");
  const base = path.posix.basename(id);
  const folder = id.includes("/") ? id.slice(0, id.indexOf("/")) : "";
  const heading = (/^#\s+(.+)$/m.exec(body) || [])[1];
  const tags = Array.isArray(front.tags) ? front.tags : front.tags ? [String(front.tags)] : [];

  const node = {
    id, file, folder,
    label: front.title || heading || base,
    tags,
    excerpt: excerptOf(body),
    raw: body,   // retiré avant écriture, sert au parsing des liens
  };
  nodes.push(node);
  byId.set(id, node);
  if (!byBase.has(base)) byBase.set(base, id);
}

// ---------- Aretes (wikilinks) ----------
const links = [];
const seen = new Set();
const missing = new Map();

for (const n of nodes) {
  // Un [[lien]] cité dans du code (bloc ou inline) est un exemple, pas une arête.
  const prose = n.raw.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
  const re = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
  let m;
  while ((m = re.exec(prose))) {
    const target = m[1].trim();
    // Résolution : chemin complet, puis nom de fichier seul (comportement Obsidian).
    let tid = byId.has(target) ? target : byBase.get(path.posix.basename(target));
    if (!tid) {
      tid = "?" + target;
      if (!missing.has(tid)) missing.set(tid, target);
    }
    if (tid === n.id) continue;
    const key = n.id < tid ? n.id + " " + tid : tid + " " + n.id;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source: n.id, target: tid });
  }
}

for (const [id, label] of missing) {
  nodes.push({ id, file: "", folder: "", label, tags: [], excerpt: "", missing: true });
}
for (const n of nodes) delete n.raw;

// ---------- Ecriture ----------
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(
  path.join(OUT, "graph.json"),
  JSON.stringify({
    vault: path.basename(VAULT),
    generatedAt: new Date().toISOString(),
    nodes, links,
  }, null, 1)
);
fs.copyFileSync(path.join(__dirname, "rings-viewer.html"), path.join(OUT, "rings.html"));

const orphans = nodes.filter((n) => !n.missing && !links.some((l) => l.source === n.id || l.target === n.id));
console.log("Graphe généré : " + OUT);
console.log("  " + (nodes.length - missing.size) + " notes, " + links.length + " liens");
if (missing.size) console.log("  ! " + missing.size + " lien(s) cassé(s) : " + [...missing.values()].join(", "));
if (orphans.length) console.log("  ! " + orphans.length + " note(s) isolée(s) : " + orphans.map((o) => o.label).join(", "));
