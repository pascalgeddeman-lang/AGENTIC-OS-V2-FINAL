/**
 * Routeur unique — toutes les routes /api/* passent par cette seule fonction
 * (limite de 12 fonctions sur le plan Vercel Hobby).
 */
const {
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
} = require("./_lib");

// ---------- Handlers ----------

async function login(req, res) {
  if (req.method !== "POST") return res.status(405).json({ msg: "POST attendu" });
  const { user, pass } = req.body || {};
  if (user === process.env.STUDIO_USER && pass === process.env.STUDIO_PASS) {
    res.setHeader("Set-Cookie", cookie("sid", makeSession(user), 604800));
    return res.status(200).json({ ok: true });
  }
  res.status(401).json({ msg: "Identifiants incorrects" });
}

async function logout(req, res) {
  res.setHeader("Set-Cookie", cookie("sid", "", 0));
  res.status(200).json({ ok: true });
}

async function me(req, res) {
  const ok = checkSession(req);
  res.status(ok ? 200 : 401).json({ ok });
}

async function create(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ msg: "POST attendu" });
  const out = await kie("POST", "/api/v1/jobs/createTask", req.body);
  res.status(out.status).json(out.data);
}

async function status(req, res) {
  if (!requireAuth(req, res)) return;
  const { taskId } = req.query;
  if (!taskId) return res.status(400).json({ msg: "taskId manquant" });
  const out = await kie("GET", `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
  res.status(out.status).json(out.data);
}

async function download(req, res) {
  if (!requireAuth(req, res)) return;
  const target = req.query.url;
  if (!target || !/^https:\/\//.test(target)) return res.status(400).json({ msg: "url invalide" });
  const upstream = await fetch(target);
  if (!upstream.ok) return res.status(502).json({ msg: `Téléchargement impossible (${upstream.status})` });
  const name = ((new URL(target).pathname.split("/").pop() || "image.png").split("?")[0]) || "image.png";
  res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.status(200).send(Buffer.from(await upstream.arrayBuffer()));
}

async function driveConnect(req, res) {
  if (!checkSession(req)) return res.status(401).send("Connecte-toi d'abord au studio.");
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(500).send("GOOGLE_CLIENT_ID manquant dans les variables d'environnement Vercel.");
  }
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${baseUrl(req)}/api/drive-callback`,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.file",
    access_type: "offline",
    prompt: "consent",
  });
  res.redirect(302, `https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

async function driveCallback(req, res) {
  if (!checkSession(req)) return res.status(401).send("Session expirée — reconnecte-toi au studio.");
  const { code, error } = req.query;
  if (error) return res.redirect(302, "/?drive=refused");
  if (!code) return res.status(400).send("Code OAuth manquant.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${baseUrl(req)}/api/drive-callback`,
    }),
  });
  const j = await r.json();
  if (!j.refresh_token) {
    return res.status(500).send("Google n'a pas renvoyé de refresh token : " + JSON.stringify(j).slice(0, 300));
  }
  res.setHeader("Set-Cookie", cookie("gdrive_rt", encodeURIComponent(j.refresh_token), 15552000));
  res.redirect(302, "/?drive=ok");
}

async function driveStatus(req, res) {
  if (!requireAuth(req, res)) return;
  res.status(200).json({
    connected: !!refreshTokenFrom(req),
    client_upload: true,
    configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  });
}

async function driveToken(req, res) {
  if (!requireAuth(req, res)) return;
  const tok = await driveAccessToken(req);
  if (!tok) return res.status(409).json({ msg: "Google Drive non connecté" });
  const { sourcesId } = await ensureStudioFolders(tok);
  res.status(200).json({ access_token: tok, sourcesFolderId: sourcesId });
}

async function save(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ msg: "POST attendu" });
  const { taskId, url, tool, mode, prompt, format } = req.body || {};
  if (!taskId || !url) return res.status(400).json({ msg: "taskId/url manquants" });

  const tok = await driveAccessToken(req);
  if (!tok) return res.status(409).json({ msg: "Google Drive non connecté" });
  const { galerieId } = await ensureStudioFolders(tok);

  const q = encodeURIComponent(
    `appProperties has { key = 'taskId' and value = '${String(taskId).replace(/'/g, "")}' } and trashed = false`
  );
  const dup = await driveApi(tok, "GET", `/files?q=${q}&fields=files(id)`);
  if (dup.files && dup.files.length) return res.status(200).json({ ok: true, dup: true });

  const img = await fetch(url);
  if (!img.ok) return res.status(502).json({ msg: `Image inaccessible (${img.status})` });
  const ct = img.headers.get("content-type") || "image/jpeg";
  const ext = ct.includes("png") ? ".png" : ct.includes("webp") ? ".webp" : ".jpeg";
  const buf = Buffer.from(await img.arrayBuffer());

  const up = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=media&fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": ct },
    body: buf,
  });
  const created = await up.json();
  if (!created.id) return res.status(502).json({ msg: "Upload Drive échoué : " + JSON.stringify(created).slice(0, 200) });

  await fetch(`https://www.googleapis.com/drive/v3/files/${created.id}?addParents=${galerieId}&fields=id`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `${Date.now()}-${(tool || "img").replace(/[^\w\-]/g, "")}${ext}`,
      description: (prompt || "").slice(0, 600),
      appProperties: {
        taskId: String(taskId).slice(0, 120),
        tool: String(tool || "?").slice(0, 60),
        mode: String(mode || "?").slice(0, 30),
        format: String(format || "").slice(0, 10),
      },
    }),
  });

  res.status(200).json({ ok: true, id: created.id });
}

async function gallery(req, res) {
  if (!requireAuth(req, res)) return;
  const tok = await driveAccessToken(req);
  if (!tok) return res.status(200).json({ items: [], driveDisconnected: true });

  const { galerieId } = await ensureStudioFolders(tok);
  const q = encodeURIComponent(`'${galerieId}' in parents and trashed = false`);
  const out = await driveApi(
    tok,
    "GET",
    `/files?q=${q}&orderBy=createdTime desc&pageSize=200&fields=files(id,createdTime,description,appProperties)`
  );

  const items = (out.files || []).map((f) => ({
    id: f.id,
    date: f.createdTime,
    prompt: f.description || "",
    tool: (f.appProperties && f.appProperties.tool) || "?",
    mode: (f.appProperties && f.appProperties.mode) || "",
    format: (f.appProperties && f.appProperties.format) || "",
    src: `/api/file?id=${f.id}`,
    dl: `/api/file?id=${f.id}&dl=1`,
  }));
  res.status(200).json({ items });
}

async function file(req, res) {
  if (!requireAuth(req, res)) return;
  const { id, dl } = req.query;
  if (!id || !/^[\w\-]+$/.test(id)) return res.status(400).json({ msg: "id invalide" });
  const tok = await driveAccessToken(req);
  if (!tok) return res.status(409).json({ msg: "Google Drive non connecté" });
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${tok}` },
  });
  if (!r.ok) return res.status(502).json({ msg: `Drive a répondu ${r.status}` });
  res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
  res.setHeader("Cache-Control", "private, max-age=86400");
  if (dl) res.setHeader("Content-Disposition", `attachment; filename="kie-studio-${id}.jpg"`);
  res.status(200).send(Buffer.from(await r.arrayBuffer()));
}

// ---------- Dispatch ----------
const ROUTES = {
  login,
  logout,
  me,
  create,
  status,
  download,
  "drive-connect": driveConnect,
  "drive-callback": driveCallback,
  "drive-status": driveStatus,
  "drive-token": driveToken,
  save,
  gallery,
  file,
};

module.exports = async (req, res) => {
  const handler = ROUTES[req.query.route];
  if (!handler) return res.status(404).json({ msg: "Route inconnue" });
  try {
    await handler(req, res);
  } catch (e) {
    res.status(500).json({ msg: e.message });
  }
};
