/**
 * Persistance JSON simple sur disque (agent-os/data/).
 * Chaque module lit/écrit son fichier via readJSON/writeJSON.
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureDir(DATA_DIR);

function file(name) {
  return path.join(DATA_DIR, name);
}

function readJSON(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(name, obj) {
  ensureDir(path.dirname(file(name)));
  const tmp = file(name) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file(name));
}

module.exports = { DATA_DIR, ensureDir, file, readJSON, writeJSON };
