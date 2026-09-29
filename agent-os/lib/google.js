/**
 * OAuth Google (Drive + chaînes YouTube) sans dépendance.
 * - Client id/secret lus dans le coffre (google_client_id / google_client_secret).
 * - Tokens stockés dans data/google.json :
 *   { drive: {tokens, account}, channels: [{channelId, title, thumbnail, tokens, machine}] }
 * - Redirect URI : http://localhost:<PORT>/api/google/callback
 */
const { readJSON, writeJSON } = require("./store");
const vault = require("./vault");

const SCOPES = {
  drive: ["https://www.googleapis.com/auth/drive"],
  youtube: [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
    // Indispensable pour publier depuis les machines (publishRun) — sans lui, upload = 403.
    // Les chaînes connectées AVANT cet ajout doivent être reconnectées pour obtenir le scope.
    "https://www.googleapis.com/auth/youtube.upload",
    // Scope complet : nécessaire pour MODIFIER une vidéo existante (repasser en privé/public,
    // planifier une mise en ligne…). Reconnexion des chaînes requise après cet ajout.
    "https://www.googleapis.com/auth/youtube",
    // Envoi de PISTES DE SOUS-TITRES (captions.insert). Le scope `youtube` complet ne suffit
    // PAS — Google exige force-ssl pour l'API captions. Même piège que youtube.upload en son
    // temps : les chaînes connectées avant cet ajout doivent être RECONNECTÉES.
    "https://www.googleapis.com/auth/youtube.force-ssl",
  ],
};

function load() {
  return readJSON("google.json", { drive: null, channels: [] });
}

function save(g) {
  writeJSON("google.json", g);
}

function redirectUri(port) {
  return `http://localhost:${port}/api/google/callback`;
}

function authUrl(service, port) {
  const clientId = vault.get("google_client_id");
  if (!clientId) throw new Error("Google OAuth Client ID manquant dans le coffre (page Paramètres)");
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(port),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES[service].join(" "),
    state: service,
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + p.toString();
}

async function tokenRequest(params) {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const data = await resp.json();
  if (data.error) throw new Error(`OAuth Google : ${data.error} ${data.error_description || ""}`);
  return data;
}

async function exchangeCode(code, service, port) {
  const tokens = await tokenRequest({
    code,
    client_id: vault.get("google_client_id"),
    client_secret: vault.get("google_client_secret"),
    redirect_uri: redirectUri(port),
    grant_type: "authorization_code",
  });
  tokens.expires_at = Date.now() + (tokens.expires_in || 3600) * 1000;

  const g = load();
  if (service === "drive") {
    let account = null;
    try {
      const about = await fetch("https://www.googleapis.com/drive/v3/about?fields=user", {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      }).then((r) => r.json());
      account = about.user && about.user.emailAddress;
    } catch {}
    g.drive = { tokens, account, connectedAt: new Date().toISOString() };
    save(g);
    return { service, account };
  }

  // YouTube : identifier la chaîne et l'ajouter/reconnecter
  const resp = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true",
    { headers: { Authorization: `Bearer ${tokens.access_token}` } }
  ).then((r) => r.json());
  const item = resp.items && resp.items[0];
  if (!item) throw new Error("Aucune chaîne YouTube sur ce compte Google");
  const entry = {
    channelId: item.id,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.default?.url || "",
    publishedAt: item.snippet.publishedAt,
    uploadsPlaylist: item.contentDetails?.relatedPlaylists?.uploads || "",
    tokens,
    connectedAt: new Date().toISOString(),
  };
  const idx = g.channels.findIndex((c) => c.channelId === entry.channelId);
  // Reconnexion : on rafraîchit tokens/infos SANS toucher à la machine associée
  // (avant : machine: null dans entry écrasait l'association à chaque reconnexion).
  if (idx >= 0) g.channels[idx] = { ...g.channels[idx], ...entry, machine: g.channels[idx].machine || null };
  else g.channels.push({ ...entry, machine: null });
  save(g);
  return { service, channel: { channelId: entry.channelId, title: entry.title } };
}

/** Access token valide pour un porteur donné ({tokens}) avec refresh auto. */
async function freshToken(holder, persist) {
  if (!holder || !holder.tokens) throw new Error("Compte Google non connecté");
  const t = holder.tokens;
  if (t.expires_at && t.expires_at - Date.now() > 60000) return t.access_token;
  if (!t.refresh_token) throw new Error("Token expiré sans refresh_token : reconnecter le compte");
  const renewed = await tokenRequest({
    refresh_token: t.refresh_token,
    client_id: vault.get("google_client_id"),
    client_secret: vault.get("google_client_secret"),
    grant_type: "refresh_token",
  });
  holder.tokens = {
    ...t,
    access_token: renewed.access_token,
    expires_in: renewed.expires_in,
    expires_at: Date.now() + (renewed.expires_in || 3600) * 1000,
  };
  if (persist) persist();
  return holder.tokens.access_token;
}

async function driveToken() {
  const g = load();
  if (!g.drive) throw new Error("Google Drive non connecté (page Paramètres)");
  return freshToken(g.drive, () => save(g));
}

async function channelToken(channelId) {
  const g = load();
  const ch = g.channels.find((c) => c.channelId === channelId);
  if (!ch) throw new Error("Chaîne non connectée : " + channelId);
  return freshToken(ch, () => save(g));
}

function channels() {
  return load().channels.map(({ tokens, ...rest }) => ({
    ...rest,
    tokenOk: !!(tokens && tokens.refresh_token),
  }));
}

function driveStatus() {
  const g = load();
  return g.drive
    ? { connected: true, account: g.drive.account, connectedAt: g.drive.connectedAt }
    : { connected: false };
}

function setChannelMachine(channelId, machine) {
  const g = load();
  const ch = g.channels.find((c) => c.channelId === channelId);
  if (ch) {
    ch.machine = machine || null;
    save(g);
  }
}

function removeChannel(channelId) {
  const g = load();
  g.channels = g.channels.filter((c) => c.channelId !== channelId);
  save(g);
}

function disconnectDrive() {
  const g = load();
  g.drive = null;
  save(g);
}

// --- Fichiers Drive ---
async function driveFiles(type) {
  const token = await driveToken();
  const mime =
    type === "image" ? "mimeType contains 'image/'" : type === "video" ? "mimeType contains 'video/'" : "(mimeType contains 'image/' or mimeType contains 'video/')";
  const p = new URLSearchParams({
    q: `${mime} and trashed=false`,
    fields: "files(id,name,mimeType,size,modifiedTime,thumbnailLink,webViewLink)",
    pageSize: "100",
    orderBy: "modifiedTime desc",
  });
  const data = await fetch("https://www.googleapis.com/drive/v3/files?" + p, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  if (data.error) throw new Error(data.error.message);
  return (data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    mime: f.mimeType,
    size: Number(f.size || 0),
    modified: f.modifiedTime,
    thumbnail: f.thumbnailLink || null,
    view: f.webViewLink,
    directUrl: `https://drive.google.com/uc?export=download&id=${f.id}`,
    source: "drive",
    type: f.mimeType.startsWith("image/") ? "image" : "video",
  }));
}

/** Miniature (ou contenu) d'un fichier Drive, servie côté serveur (évite les 403 navigateur). */
async function driveFileThumb(fileId) {
  const token = await driveToken();
  const meta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=thumbnailLink,mimeType`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then((r) => r.json());
  if (meta.error) throw new Error(meta.error.message);
  if (meta.thumbnailLink) {
    const up = await fetch(meta.thumbnailLink.replace(/=s\d+$/, "=s440"), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (up.ok) return { mime: up.headers.get("content-type") || "image/jpeg", buffer: Buffer.from(await up.arrayBuffer()) };
  }
  // Repli : contenu complet (images uniquement)
  if ((meta.mimeType || "").startsWith("image/")) {
    const up = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (up.ok) return { mime: meta.mimeType, buffer: Buffer.from(await up.arrayBuffer()) };
  }
  throw new Error("Miniature indisponible");
}

/** Rend un fichier Drive lisible par lien (indispensable pour que Kie/FAL puissent le télécharger). */
async function ensurePublic(fileId) {
  const token = await driveToken();
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  }).catch(() => {});
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

/** Upload simple (multipart) d'un buffer vers Drive ; renvoie l'URL directe (publique). */
async function driveUpload(name, mime, buffer) {
  const token = await driveToken();
  const boundary = "agentos" + Date.now();
  const meta = JSON.stringify({ name });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const data = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    }
  ).then((r) => r.json());
  if (data.error) throw new Error(data.error.message);
  await ensurePublic(data.id);
  return { id: data.id, name: data.name, directUrl: `https://drive.google.com/uc?export=download&id=${data.id}` };
}

/**
 * Upload YouTube RÉSUMABLE par chunks (8 Mo) — partagé par toutes les machines.
 * - Chunks avec Content-Range + reprise sur 308 (l'ancien PUT unique chargeait tout en RAM
 *   et mourait sans message clair à la moindre coupure).
 * - Erreurs LISIBLES : scope manquant (reconnecter la chaîne), quota, chaîne non vérifiée.
 * meta = { title, description, tags, categoryId, privacyStatus }
 */
/**
 * Tags conformes YouTube (sinon 400 « invalid video keywords ») :
 * - caractères < et > interdits ; tag individuel <= 100 caractères ;
 * - LIMITE TOTALE ~500 en comptant +2 (guillemets) pour CHAQUE tag contenant un espace
 *   — c'est ce +2 invisible qui faisait rejeter des listes pourtant <= 500 « bruts ».
 */
function sanitizeYtTags(tags) {
  const out = [];
  let len = 0;
  for (let t of (tags || []).map((x) => String(x).replace(/[<>]/g, "").trim()).filter(Boolean)) {
    if (t.length > 100) continue;
    const cost = t.length + (/\s/.test(t) ? 2 : 0) + (out.length ? 1 : 0); // +1 séparateur
    if (len + cost > 470) break; // marge sous la limite (~500)
    out.push(t);
    len += cost;
    if (out.length >= 60) break;
  }
  return out;
}

async function youtubeUpload(channelId, filePath, meta = {}) {
  const fs = require("fs");
  const token = await channelToken(channelId);
  const size = fs.statSync(filePath).size;
  const snippet = {
    title: String(meta.title || "Vidéo").slice(0, 100),
    description: String(meta.description || "").slice(0, 4900),
    tags: sanitizeYtTags(meta.tags),
    categoryId: meta.categoryId || "27",
  };
  const init = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(size) },
      // PRIVÉ par défaut : une vidéo ne devient publique que si on l'a explicitement décidé
      // (choix au clic sur Publier, ou publication auto assumée).
      body: JSON.stringify({ snippet, status: { privacyStatus: meta.privacyStatus || "private", selfDeclaredMadeForKids: false } }),
    }
  );
  if (!init.ok) {
    const txt = await init.text().catch(() => "");
    if (init.status === 403 && /insufficient|forbidden|scope/i.test(txt))
      throw new Error("YouTube : la chaîne n'a pas le droit d'upload — RECONNECTE la chaîne (Connexions) pour obtenir le scope youtube.upload ajouté récemment.");
    if (/uploadLimitExceeded/.test(txt)) throw new Error("YouTube : quota d'upload de la chaîne dépassé (réessaie demain).");
    throw new Error(`YouTube init ${init.status} : ${txt.slice(0, 200)}`);
  }
  const uploadUrl = init.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube : pas d'URL d'upload résumable renvoyée");
  const CHUNK = 8 * 1024 * 1024;
  const fd = fs.openSync(filePath, "r");
  try {
    let offset = 0;
    while (offset < size) {
      const len = Math.min(CHUNK, size - offset);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, offset);
      let up;
      for (let attempt = 1; ; attempt++) {
        up = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "video/mp4", "Content-Length": String(len), "Content-Range": `bytes ${offset}-${offset + len - 1}/${size}` },
          body: buf,
        }).catch((e) => ({ status: 0, _err: e.message }));
        if (up.status === 308 || up.ok) break;
        if (attempt >= 3) throw new Error(`YouTube upload (${Math.round((offset / size) * 100)}%) : ${up.status ? "HTTP " + up.status : up._err}`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
      if (up.ok) {
        const vid = await up.json().catch(() => null);
        if (!vid || !vid.id) throw new Error("YouTube : réponse finale sans id vidéo");
        return vid;
      }
      // 308 : le serveur dit jusqu'où il a reçu
      const range = up.headers.get("range");
      offset = range ? Number(range.split("-")[1]) + 1 : offset + len;
    }
    throw new Error("YouTube : upload terminé sans réponse finale");
  } finally {
    fs.closeSync(fd);
  }
}

/** Pose la miniature d'une vidéo — remonte l'erreur en clair (plus d'échec silencieux). */
async function youtubeSetThumbnail(channelId, videoId, pngPath) {
  const fs = require("fs");
  const token = await channelToken(channelId);
  const r = await fetch(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/png" },
    body: fs.readFileSync(pngPath),
  });
  if (!r.ok) throw new Error(`Miniature YouTube ${r.status} : ${(await r.text().catch(() => "")).slice(0, 150)}`);
}

/**
 * Envoie une piste de sous-titres sur une vidéo YouTube (captions.insert).
 * ⚠ Exige le scope `youtube.force-ssl`. S'il manque, l'API renvoie un 403 illisible : on le
 * traduit en consigne actionnable plutôt que de laisser l'utilisateur deviner.
 */
async function youtubeUploadCaption(channelId, videoId, srtPath, { language = "fr", name = "Français" } = {}) {
  const token = await channelToken(channelId);
  const meta = JSON.stringify({ snippet: { videoId, language, name, isDraft: false } });
  const boundary = "agentoscap" + Date.now();
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
    fs.readFileSync(srtPath),
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const r = await fetch("https://www.googleapis.com/upload/youtube/v3/captions?uploadType=multipart&part=snippet", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  }).then((x) => x.json());
  if (r.error) {
    const msg = String(r.error.message || "");
    if (r.error.code === 403 || /insufficient|scope|permission/i.test(msg)) {
      throw new Error(
        "Sous-titres refusés : la chaîne n'a pas le scope « youtube.force-ssl ». " +
        "Reconnecte-la depuis la page Connexions pour l'obtenir, puis réessaie."
      );
    }
    throw new Error(`Sous-titres YouTube : ${msg || JSON.stringify(r.error).slice(0, 160)}`);
  }
  return { id: r.id, language, name };
}

module.exports = {
  authUrl,
  exchangeCode,
  channels,
  channelToken,
  driveStatus,
  driveToken,
  driveFiles,
  driveFileThumb,
  driveUpload,
  ensurePublic,
  setChannelMachine,
  removeChannel,
  disconnectDrive,
  youtubeUpload,
  youtubeUploadCaption,
  youtubeSetThumbnail,
};
