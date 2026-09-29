/**
 * Helpers partagés par les fonctions serverless (Vercel).
 * Secrets attendus en variables d'environnement Vercel :
 *   KIE, STUDIO_USER, STUDIO_PASS, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   (optionnel : SESSION_SECRET, GOOGLE_REFRESH_TOKEN)
 */
const crypto = require("crypto");

const SECRET =
  process.env.SESSION_SECRET ||
  crypto
    .createHash("sha256")
    .update(`${process.env.STUDIO_USER}|${process.env.STUDIO_PASS}|kie-studio`)
    .digest("hex");

const sign = (v) => crypto.createHmac("sha256", SECRET).update(v).digest("hex");

function makeSession(user) {
  const p = Buffer.from(user).toString("base64url");
  return `${p}.${sign(p)}`;
}

function checkSession(req) {
  const sid = req.cookies && req.cookies.sid;
  if (!sid) return false;
  const i = sid.lastIndexOf(".");
  if (i < 1) return false;
  const p = sid.slice(0, i);
  return sid.slice(i + 1) === sign(p);
}

function requireAuth(req, res) {
  if (checkSession(req)) return true;
  res.status(401).json({ msg: "Non connecté" });
  return false;
}

function cookie(name, val, maxAge) {
  return `${name}=${val}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure`;
}

function baseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${req.headers.host}`;
}

// ---- Kie ----
async function kie(method, path, body) {
  const r = await fetch("https://api.kie.ai" + path, {
    method,
    headers: { Authorization: `Bearer ${process.env.KIE}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  try {
    return { status: r.status, data: JSON.parse(text) };
  } catch {
    return { status: r.status, data: { code: r.status, msg: text.slice(0, 500) } };
  }
}

// ---- Google Drive (OAuth web, scope drive.file) ----
function refreshTokenFrom(req) {
  return (req.cookies && req.cookies.gdrive_rt && decodeURIComponent(req.cookies.gdrive_rt)) ||
    process.env.GOOGLE_REFRESH_TOKEN || null;
}

async function driveAccessToken(req) {
  const rt = refreshTokenFrom(req);
  if (!rt || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: rt,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json();
  return j.access_token || null;
}

async function driveApi(tok, method, path, body) {
  const r = await fetch("https://www.googleapis.com/drive/v3" + path, {
    method,
    headers: { Authorization: `Bearer ${tok}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

async function ensureFolder(tok, name, parentId, makePublic) {
  const q = encodeURIComponent(
    `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false` +
      (parentId ? ` and '${parentId}' in parents` : "")
  );
  const found = await driveApi(tok, "GET", `/files?q=${q}&fields=files(id)`);
  if (found.files && found.files.length) return found.files[0].id;

  const created = await driveApi(tok, "POST", "/files?fields=id", {
    name,
    mimeType: "application/vnd.google-apps.folder",
    ...(parentId ? { parents: [parentId] } : {}),
  });
  if (makePublic) {
    await driveApi(tok, "POST", `/files/${created.id}/permissions`, { role: "reader", type: "anyone" });
  }
  return created.id;
}

/** Dossiers de travail : Kie Studio Web / { Sources (public), Galerie } */
async function ensureStudioFolders(tok) {
  const rootId = await ensureFolder(tok, "Kie Studio Web", null, false);
  const sourcesId = await ensureFolder(tok, "Sources", rootId, true);
  const galerieId = await ensureFolder(tok, "Galerie", rootId, false);
  return { rootId, sourcesId, galerieId };
}

module.exports = {
  makeSession,
  checkSession,
  requireAuth,
  cookie,
  baseUrl,
  kie,
  refreshTokenFrom,
  driveAccessToken,
  driveApi,
  ensureStudioFolders,
};
