/**
 * Cache disque à rafraîchissement MANUEL uniquement.
 * Aucune expiration automatique : une entrée reste servie telle quelle
 * jusqu'à ce que le client demande ?refresh=1 (bouton Actualiser / rechargement).
 */
const fs = require("fs");
const path = require("path");
const { DATA_DIR, ensureDir } = require("./store");

const CACHE_DIR = path.join(DATA_DIR, "cache");
ensureDir(CACHE_DIR);

function fileFor(key) {
  return path.join(CACHE_DIR, key.replace(/[^\w.\-]+/g, "_") + ".json");
}

function read(key) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(key), "utf8"));
  } catch {
    return null;
  }
}

function write(key, value) {
  const entry = { key, fetchedAt: new Date().toISOString(), value };
  fs.writeFileSync(fileFor(key), JSON.stringify(entry));
  return entry;
}

/**
 * getOrFetch(key, refresh, fetcher) :
 * - refresh=false et entrée présente -> renvoie le cache (avec fetchedAt)
 * - sinon exécute fetcher(), stocke et renvoie la nouvelle valeur.
 * En cas d'échec du fetcher avec un cache existant, on ressert le cache (stale=true).
 */
async function getOrFetch(key, refresh, fetcher) {
  const existing = read(key);
  if (existing && !refresh) return { ...existing, cached: true };
  try {
    const value = await fetcher();
    return { ...write(key, value), cached: false };
  } catch (e) {
    if (existing) return { ...existing, cached: true, stale: true, error: e.message };
    throw e;
  }
}

function invalidate(prefix) {
  for (const f of fs.readdirSync(CACHE_DIR)) {
    if (!prefix || f.startsWith(prefix.replace(/[^\w.\-]+/g, "_"))) {
      try {
        fs.unlinkSync(path.join(CACHE_DIR, f));
      } catch {}
    }
  }
}

module.exports = { getOrFetch, read, write, invalidate };
