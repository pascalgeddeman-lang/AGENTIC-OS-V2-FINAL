/**
 * Coffre-fort de credentials.
 * Valeurs chiffrées AES-256-GCM avec une clé machine générée dans data/.vaultkey.
 * L'API ne renvoie jamais les valeurs en clair : uniquement un aperçu masqué.
 */
const crypto = require("crypto");
const fs = require("fs");
const { file, readJSON, writeJSON } = require("./store");

const KEY_FILE = file(".vaultkey");

function machineKey() {
  if (!fs.existsSync(KEY_FILE)) {
    fs.writeFileSync(KEY_FILE, crypto.randomBytes(32).toString("hex"));
  }
  return Buffer.from(fs.readFileSync(KEY_FILE, "utf8").trim(), "hex");
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", machineKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return [iv.toString("hex"), cipher.getAuthTag().toString("hex"), enc.toString("hex")].join(".");
}

function decrypt(blob) {
  const [iv, tag, data] = String(blob).split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", machineKey(), Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(data, "hex")), decipher.final()]).toString("utf8");
}

// Champs simples du coffre (clé -> libellé affiché côté UI)
const FIELDS = {
  kie: "Kie.ai",
  fal: "FAL.ai",
  heygen: "HeyGen",
  openrouter: "OpenRouter",
  pexels: "Pexels",
  apify: "Apify",
  telegram_token: "Telegram Bot API",
  telegram_chat_id: "Telegram Chat ID",
  google_client_id: "Google OAuth Client ID",
  google_client_secret: "Google OAuth Client Secret",
};

function load() {
  return readJSON("vault.json", { secrets: {}, youtube_keys: [] });
}

function save(v) {
  writeJSON("vault.json", v);
}

/** Renvoie la valeur en clair d'un champ, ou null. */
function get(key) {
  const v = load();
  const blob = v.secrets[key];
  if (!blob) return null;
  try {
    return decrypt(blob);
  } catch {
    return null;
  }
}

function set(key, value) {
  const v = load();
  if (value === "" || value == null) delete v.secrets[key];
  else v.secrets[key] = encrypt(value);
  save(v);
}

function mask(plain) {
  if (!plain) return null;
  const s = String(plain);
  return s.length <= 6 ? "•".repeat(s.length) : "•".repeat(6) + s.slice(-4);
}

/** État du coffre pour l'UI : champs + aperçus masqués, jamais de clair. */
function summary() {
  const v = load();
  const fields = Object.entries(FIELDS).map(([key, label]) => {
    let preview = null;
    if (v.secrets[key]) {
      try {
        preview = mask(decrypt(v.secrets[key]));
      } catch {
        preview = "(illisible)";
      }
    }
    return { key, label, set: !!v.secrets[key], preview };
  });
  const youtubeKeys = (v.youtube_keys || []).map((k, i) => {
    let preview = null;
    try {
      preview = mask(decrypt(k.blob));
    } catch {}
    return { index: i, label: k.label || `Clé ${i + 1}`, preview };
  });
  return { fields, youtubeKeys };
}

// --- Pools de clés (YouTube : +10 000 unités/jour ; Apify : 5 $/mois par clé) ---
function poolKeys(listName) {
  const v = load();
  return (v[listName] || [])
    .map((k, i) => {
      try {
        return { index: i, label: k.label || `Clé ${i + 1}`, key: decrypt(k.blob) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function addPoolKey(listName, label, key) {
  const v = load();
  v[listName] = v[listName] || [];
  v[listName].push({ label: label || `Clé ${v[listName].length + 1}`, blob: encrypt(key) });
  save(v);
}

function removePoolKey(listName, index) {
  const v = load();
  v[listName] = (v[listName] || []).filter((_, i) => i !== index);
  save(v);
}

function poolSummary(listName) {
  const v = load();
  return (v[listName] || []).map((k, i) => {
    let preview = null;
    try {
      preview = mask(decrypt(k.blob));
    } catch {}
    return { index: i, label: k.label || `Clé ${i + 1}`, preview };
  });
}

const youtubeKeys = () => poolKeys("youtube_keys");
const addYoutubeKey = (label, key) => addPoolKey("youtube_keys", label, key);
const removeYoutubeKey = (i) => removePoolKey("youtube_keys", i);

/** Clés Apify : le champ simple « apify » du coffre compte comme clé principale. */
function apifyKeys() {
  const main = get("apify");
  const pool = poolKeys("apify_keys");
  return [...(main ? [{ index: -1, label: "Principale (coffre)", key: main }] : []), ...pool];
}
const addApifyKey = (label, key) => addPoolKey("apify_keys", label, key);
const removeApifyKey = (i) => removePoolKey("apify_keys", i);

module.exports = {
  FIELDS,
  get,
  set,
  summary,
  poolSummary,
  youtubeKeys,
  addYoutubeKey,
  removeYoutubeKey,
  apifyKeys,
  addApifyKey,
  removeApifyKey,
};
