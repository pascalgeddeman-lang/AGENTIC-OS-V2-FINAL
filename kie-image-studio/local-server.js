/**
 * Kie Image Studio — serveur local.
 * - Login (session cookie) : Alex / 1234
 * - Sert l'interface statique (public/) et la galerie persistante (storage/)
 * - Proxifie l'API Kie.ai avec la clé lue dans ../.env (jamais exposée au navigateur)
 * - Upload des images sources vers Google Drive (dossier public « Kie Studio »)
 * - Sauvegarde chaque image générée dans storage/ + index.json
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const PORT = 3210;
const KIE_BASE = "https://api.kie.ai";
const STORAGE_DIR = path.join(__dirname, "storage");
const INDEX_FILE = path.join(STORAGE_DIR, "index.json");

if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });

// --- Secrets depuis ../.env (jamais commité) ou variables d'environnement ---
function readEnvFile() {
  const map = {};
  try {
    const txt = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8");
    txt.split(/\r?\n/).forEach((l) => {
      const m = /^([A-Z_]+)=(.*)$/.exec(l.trim());
      if (m) map[m[1]] = m[2];
    });
  } catch {}
  return map;
}
const ENV = readEnvFile();
const KIE_KEY = ENV.KIE || process.env.KIE;
const AUTH_USER = ENV.STUDIO_USER || process.env.STUDIO_USER;
const AUTH_PASS = ENV.STUDIO_PASS || process.env.STUDIO_PASS;
if (!KIE_KEY) throw new Error("Clé KIE introuvable (.env ou variable d'environnement KIE)");
if (!AUTH_USER || !AUTH_PASS) throw new Error("STUDIO_USER / STUDIO_PASS manquants (.env)");

// --- Sessions en mémoire ---
const sessions = new Set();

function getSession(req) {
  const cookie = req.headers.cookie || "";
  const m = /(?:^|;\s*)sid=([a-f0-9]{48})/.exec(cookie);
  return m && sessions.has(m[1]) ? m[1] : null;
}

// --- Helpers ---
function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readBody(req, limitMb = 45) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limitMb * 1024 * 1024) {
        reject(new Error(`Body trop volumineux (> ${limitMb} Mo)`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function proxyKie(method, kiePath, bodyObj) {
  const resp = await fetch(KIE_BASE + kiePath, {
    method,
    headers: { Authorization: `Bearer ${KIE_KEY}`, "Content-Type": "application/json" },
    body: bodyObj ? JSON.stringify(bodyObj) : undefined,
  });
  const text = await resp.text();
  try {
    return { status: resp.status, data: JSON.parse(text) };
  } catch {
    return { status: resp.status, data: { code: resp.status, msg: text.slice(0, 500) } };
  }
}

function readIndex() {
  try {
    return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeIndex(list) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(list, null, 2));
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const authed = getSession(req);

  try {
    // ---------- Auth ----------
    if (url.pathname === "/api/login" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      if (body.user === AUTH_USER && body.pass === AUTH_PASS) {
        const sid = crypto.randomBytes(24).toString("hex");
        sessions.add(sid);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Set-Cookie": `sid=${sid}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax`,
        });
        return res.end(JSON.stringify({ ok: true }));
      }
      return json(res, 401, { msg: "Identifiants incorrects" });
    }

    if (url.pathname === "/api/me") {
      return json(res, authed ? 200 : 401, { ok: !!authed });
    }

    if (url.pathname === "/api/logout" && req.method === "POST") {
      if (authed) sessions.delete(authed);
      res.writeHead(200, { "Set-Cookie": "sid=; Path=/; Max-Age=0", "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    }

    // ---------- Tout le reste de l'API + storage : session requise ----------
    const protectedPath = url.pathname.startsWith("/api/") || url.pathname.startsWith("/storage/");
    if (protectedPath && !authed) return json(res, 401, { msg: "Non connecté" });

    // ---------- Compat front web : Drive local toujours "connecté" (via python/token.json) ----------
    if (url.pathname === "/api/drive-status") {
      return json(res, 200, { connected: true, client_upload: false, configured: true });
    }

    // ---------- API Kie ----------
    if (url.pathname === "/api/create" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const out = await proxyKie("POST", "/api/v1/jobs/createTask", body);
      return json(res, out.status, out.data);
    }

    if (url.pathname === "/api/status" && req.method === "GET") {
      const taskId = url.searchParams.get("taskId");
      if (!taskId) return json(res, 400, { msg: "taskId manquant" });
      const out = await proxyKie("GET", `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
      return json(res, out.status, out.data);
    }

    // ---------- Upload source -> Google Drive ----------
    if (url.pathname === "/api/upload" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const m = /^data:([^;]+);base64,(.+)$/.exec(body.base64Data || "");
      if (!m) return json(res, 400, { msg: "base64Data invalide" });
      const safeName = (body.fileName || `upload-${Date.now()}.png`).replace(/[^\w.\-]/g, "_");
      const tmpPath = path.join(os.tmpdir(), `kie-studio-${Date.now()}-${safeName}`);
      fs.writeFileSync(tmpPath, Buffer.from(m[2], "base64"));
      try {
        const out = await new Promise((resolve, reject) => {
          execFile(
            "py",
            [path.join(__dirname, "drive_upload.py"), tmpPath, safeName],
            { timeout: 90000 },
            (err, stdout, stderr) => {
              if (err) return reject(new Error(stderr || err.message));
              const line = String(stdout).split(/\r?\n/).find((l) => l.startsWith("RESULT:"));
              if (!line) return reject(new Error("Réponse Drive illisible : " + String(stdout).slice(0, 200)));
              resolve(JSON.parse(line.slice(7)));
            }
          );
        });
        return json(res, 200, { code: 200, data: { downloadUrl: out.url, fileId: out.id } });
      } finally {
        fs.unlink(tmpPath, () => {});
      }
    }

    // ---------- Téléchargement proxifié ----------
    if (url.pathname === "/api/download" && req.method === "GET") {
      const target = url.searchParams.get("url");
      if (!target || !/^https:\/\//.test(target)) return json(res, 400, { msg: "url invalide" });
      const upstream = await fetch(target);
      if (!upstream.ok) return json(res, 502, { msg: `Téléchargement impossible (${upstream.status})` });
      const name = (new URL(target).pathname.split("/").pop() || "image.png").split("?")[0];
      res.writeHead(200, {
        "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
      });
      return res.end(Buffer.from(await upstream.arrayBuffer()));
    }

    // ---------- Galerie persistante ----------
    if (url.pathname === "/api/save" && req.method === "POST") {
      const body = JSON.parse(await readBody(req));
      const { taskId, url: imgUrl, tool, mode, prompt, format } = body;
      if (!taskId || !imgUrl) return json(res, 400, { msg: "taskId/url manquants" });

      const index = readIndex();
      if (index.some((e) => e.taskId === taskId)) return json(res, 200, { ok: true, dup: true });

      const upstream = await fetch(imgUrl);
      if (!upstream.ok) return json(res, 502, { msg: `Image inaccessible (${upstream.status})` });
      const ct = upstream.headers.get("content-type") || "";
      const ext = ct.includes("png") ? ".png" : ct.includes("webp") ? ".webp" : ".jpeg";
      const file = `${Date.now()}-${(tool || "img").replace(/[^\w\-]/g, "")}${ext}`;
      fs.writeFileSync(path.join(STORAGE_DIR, file), Buffer.from(await upstream.arrayBuffer()));

      index.push({
        taskId,
        file,
        tool: tool || "?",
        mode: mode || "?",
        prompt: (prompt || "").slice(0, 600),
        format: format || "",
        date: new Date().toISOString(),
      });
      writeIndex(index);
      return json(res, 200, { ok: true, file });
    }

    if (url.pathname === "/api/gallery" && req.method === "GET") {
      const items = readIndex()
        .slice()
        .reverse()
        .map((e) => ({ ...e, src: "/storage/" + e.file, dl: "/storage/" + e.file }));
      return json(res, 200, { items });
    }

    if (url.pathname.startsWith("/storage/") && req.method === "GET") {
      const f = path.join(STORAGE_DIR, path.normalize(url.pathname.slice(9)));
      if (!f.startsWith(STORAGE_DIR)) {
        res.writeHead(403);
        return res.end();
      }
      return serveFile(res, f);
    }

    // ---------- Static ----------
    let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
    filePath = path.join(__dirname, "public", path.normalize(filePath));
    if (!filePath.startsWith(path.join(__dirname, "public"))) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    serveFile(res, filePath);
  } catch (e) {
    json(res, 500, { msg: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`Kie Image Studio -> http://localhost:${PORT}`);
});
