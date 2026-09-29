/**
 * Agentic Os — serveur de la plateforme centralisée.
 * Zéro dépendance : Node http + libs locales (lib/).
 *
 * - Sert l'interface (public/) sur http://localhost:4100
 * - API JSON (/api/...) : stats YouTube (cache manuel), coffre, Claude CLI,
 *   tâches/cron, niche finder, fichiers, OAuth Google
 * - Monte le viewer Graphify du coffre (SECOND_BRAIN_DIR, optionnel) sur /brain/graph/
 * - Lance le Kie Image Studio (miniature creator) en processus enfant (port 3210)
 * - Lance Claude CLI (warmup) en même temps que le serveur
 */
const http = require("http");
const fs = require("fs");
/**
 * Détection de serveur PÉRIMÉ. Piège vécu : recharger la page sert les nouveaux fichiers
 * frontend (lus sur disque à chaque requête), mais `server.js` n'est chargé qu'au démarrage.
 * L'interface est alors neuve et les routes anciennes → un 404 incompréhensible sur une
 * fonction qui « existe pourtant ». On compare la date du fichier chargé à celle sur disque.
 */
const BOOT_AT = Date.now();
/**
 * Date de modification la PLUS RÉCENTE de tout le code serveur.
 * ⚠ Ne surveillait que `server.js` : éditer une machine (`lib/machines/*.js`) ou une page
 *   laissait le drapeau à `false` alors que le serveur tournait bel et bien avec l'ancien
 *   code. Faux négatif vécu — on a failli lancer une génération payante sur du code périmé.
 */
function newestMtime() {
  const fsx = require("fs"), px = require("path");
  let max = 0;
  const walk = (dir) => {
    let ents; try { ents = fsx.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const f = px.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith(".js")) { try { const m = fsx.statSync(f).mtimeMs; if (m > max) max = m; } catch {} }
    }
  };
  try { max = fsx.statSync(__filename).mtimeMs; } catch {}
  walk(px.join(__dirname, "lib"));
  walk(px.join(__dirname, "public", "js"));
  return max;
}
const BOOT_MTIME = newestMtime();
let staleCache = { at: 0, v: false };
function serverStale() {
  const now = Date.now();
  if (now - staleCache.at < 5000) return staleCache.v;
  staleCache = { at: now, v: newestMtime() > BOOT_MTIME + 1000 };
  return staleCache.v;
}

const path = require("path");
const { execFile } = require("child_process");

// Charge le .env racine dans process.env (zéro dépendance) AVANT les libs qui le lisent.
// Les variables déjà présentes dans l'environnement gardent la priorité.
try {
  for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const cache = require("./lib/cache");
const vault = require("./lib/vault");
const claude = require("./lib/claude");
const hermes = require("./lib/hermes");
const hermesCrons = require("./lib/hermes-crons");
const google = require("./lib/google");
const yt = require("./lib/youtube");
const niche = require("./lib/niche");
const tasks = require("./lib/tasks");
const spend = require("./lib/spend");
const files = require("./lib/files");
const telegram = require("./lib/telegram");

const studio = require("./lib/studio");
const scrap = require("./lib/scrap");
const bankLib = require("./lib/bank");
const tt = require("./lib/machines/timetravel");
const ling = require("./lib/machines/linguistique");
const mus = require("./lib/machines/musique");
const stick = require("./lib/machines/stickman");
const boud = require("./lib/machines/bouddhisme");
const voices = require("./lib/voices");
const musicLib = require("./lib/music");
const drama = require("./lib/machines/drama");
const crime = require("./lib/machines/crime");
const heygenLib = require("./lib/heygen");
const apify = require("./lib/apify");
const sched = require("./lib/schedule");

const MACHINES = { timetravel: tt, linguistique: ling, musique: mus, stickman: stick, bouddhisme: boud };

/** Exécute un événement du calendrier : la machine crée la vidéo (mode auto) et la publie/stocke. */
async function execScheduledEvent(ev) {
  const mac = MACHINES[ev.machineId];
  if (!mac) throw new Error("Machine inconnue : " + ev.machineId);
  const run = await mac.orderRun({
    publishChannelId: ev.destination === "publish" ? ev.channelId : null,
    publishPrivacy: ev.privacy || "private",
    publish: ev.destination === "publish",
    overrides: ev.params || null,
  });
  sched.patchEvent(ev.id, { status: "running", runId: run.id });
  return run;
}

const PORT = 4100;
const PUBLIC_DIR = path.join(__dirname, "public");
// Second cerveau (optionnel) : coffre Obsidian + son graphe.
// GRAPHIFY_DIR explicite, sinon déduit de SECOND_BRAIN_DIR (généré par scripts/build-graph.js).
const VAULT_DIR = process.env.SECOND_BRAIN_DIR || null;
const GRAPHIFY_DIR = process.env.GRAPHIFY_DIR ||
  (VAULT_DIR ? path.join(VAULT_DIR, "graphify-out") : null);

// ---------- Helpers HTTP ----------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".woff2": "font/woff2",
};

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
        reject(new Error("Body trop volumineux"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const txt = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(txt ? JSON.parse(txt) : {});
      } catch {
        reject(new Error("JSON invalide"));
      }
    });
    req.on("error", reject);
  });
}

function serveFile(res, filePath, rangeHeader) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    // Support des requêtes Range (lecture vidéo)
    if (rangeHeader) {
      const m = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
      if (m) {
        const start = Number(m[1]);
        const end = m[2] ? Number(m[2]) : st.size - 1;
        res.writeHead(206, {
          "Content-Type": type,
          "Content-Range": `bytes ${start}-${end}/${st.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": end - start + 1,
        });
        return fs.createReadStream(filePath, { start, end }).pipe(res);
      }
    }
    // HTML/JS/CSS : jamais de cache navigateur (sinon le menu et les pages restent figés après une mise à jour)
    const appFile = /\.(html|js|css)$/i.test(filePath);
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": st.size,
      "Accept-Ranges": "bytes",
      ...(appFile ? { "Cache-Control": "no-cache" } : {}),
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function serveFromDir(res, baseDir, rel, rangeHeader) {
  const full = path.normalize(path.join(baseDir, rel));
  if (!full.startsWith(path.normalize(baseDir))) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  serveFile(res, full, rangeHeader);
}

// ---------- Machines (v1 : liste vide, aucune machine inventée) ----------
function listMachines() {
  const { readJSON } = require("./lib/store");
  return readJSON("machines.json", []);
}

// ---------- Jobs asynchrones du Niche Finder ----------
const nicheJobs = {};

function startNicheJob(filters) {
  const id = "j" + Date.now().toString(36);
  nicheJobs[id] = { id, status: "running", progress: "Démarrage…", result: null, error: null, startedAt: Date.now() };
  niche
    .search(filters, (msg) => (nicheJobs[id].progress = msg))
    .then((result) => Object.assign(nicheJobs[id], { status: "done", result }))
    .catch((e) => Object.assign(nicheJobs[id], { status: "error", error: e.message }));
  // Purge des vieux jobs
  for (const k of Object.keys(nicheJobs)) {
    if (Date.now() - nicheJobs[k].startedAt > 3600e3) delete nicheJobs[k];
  }
  return nicheJobs[id];
}

// ---------- Stats agrégées ----------
async function seriesFor(channelId, period, refresh) {
  // Un refresh manuel prend AUSSI un snapshot des compteurs publics → les jours récents de la
  // courbe (que l'API Analytics n'a pas encore, ~48 h de retard) sont alimentés en vrai.
  if (refresh) await yt.recordSnapshots().catch(() => {});
  return cache.getOrFetch(`yt-series-${channelId}-${period}`, refresh, () => yt.channelSeriesHybrid(channelId, period));
}

async function aggregatedSeries(period, refresh) {
  const chans = google.channels();
  const all = [];
  for (const ch of chans) {
    try {
      const s = await seriesFor(ch.channelId, period, refresh);
      all.push(s.value);
    } catch {}
  }
  // Fusion par date
  const byDate = {};
  for (const s of all) {
    for (const r of s.rows) {
      if (!byDate[r.date]) byDate[r.date] = { date: r.date, views: 0, subs: 0 };
      byDate[r.date].views += r.views;
      byDate[r.date].subs += r.subs;
    }
  }
  const rows = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  return { channelId: "all", period, rows, channels: all.length };
}

// ---------- Routeur ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  const refresh = url.searchParams.get("refresh") === "1";

  try {
    // ===== Santé globale =====
    if (p === "/api/health") {
      return json(res, 200, {
        ok: true,
        now: new Date().toISOString(),
        // `stale` : le code sur disque est plus récent que celui qui tourne → les routes
        // ajoutées depuis renverront 404 alors que l'interface les affiche déjà.
        stale: serverStale(),
        bootedAt: new Date(BOOT_AT).toISOString(),
        uptimeMin: Math.round((Date.now() - BOOT_AT) / 60000),
        claude: claude.status(),
        hermes: hermes.status(),
        kie: { configured: studio.configured() },
        apify: apify.status(),
        telegram: { configured: !!(vault.get("telegram_token") && vault.get("telegram_chat_id")) },
        drive: google.driveStatus(),
        channels: google.channels().length,
        quota: yt.quotaStatus(),
      });
    }

    // ===== Manifest agents (Hermès & co) =====
    // Un agent local (Hermès, Claude CLI, script) découvre ici TOUT ce qu'il peut piloter — mêmes
    // accès que l'UI (le serveur est local, sans auth). Doc humaine : agent-os/docs/agents-locaux.md
    if (p === "/api/agent/manifest") {
      return json(res, 200, {
        name: "Agentic Os",
        base: `http://localhost:${PORT}`,
        doc: "agent-os/docs/agents-locaux.md",
        machines: [
          { id: "timetravel", name: "Time Travel", api: "/api/machines/timetravel" },
          { id: "linguistique", name: "Linguistique", api: "/api/machines/linguistique" },
          { id: "musique", name: "Musique", api: "/api/machines/musique" },
          { id: "stickman", name: "Stickman", api: "/api/machines/stickman" },
          { id: "bouddhisme", name: "Bouddhisme", api: "/api/machines/bouddhisme" },
        ],
        conventions: {
          runs: "GET|POST <machine>/runs · GET <machine>/runs/:id · POST :id/(validate|cancel|resume|regen|publish)",
          stock: "GET <machine>/stock · PATCH <machine>/stock/:id {archived|posted}",
          idea: "POST <machine>/idea",
          tasks: "GET|POST /api/tasks · PATCH|DELETE /api/tasks/:id",
          hermesCrons: "GET|POST /api/hermes/crons · POST /api/hermes/crons/:id/(toggle|run) · DELETE /api/hermes/crons/:id",
          scrap: "GET /api/scrap/list · POST /api/scrap/add-video {url} · POST /api/scrap/(channel|video)/:id/scrape",
          bank: "GET /api/bank/niches · GET /api/bank/niches/:id",
          media: "GET /media/<rel> (fichiers générés)",
          notify: "POST /api/notify {text} (Telegram)",
        },
      });
    }

    // ===== Claude CLI =====
    if (p === "/api/claude/status") return json(res, 200, claude.status());
    if (p === "/api/claude/reconnect" && req.method === "POST") return json(res, 200, await claude.checkStatus());

    if (p === "/api/chats" && req.method === "GET") {
      return json(res, 200, claude.listChats(url.searchParams.get("kind") || "chat"));
    }
    if (p === "/api/chats" && req.method === "POST") {
      const b = await readBody(req);
      return json(res, 200, claude.createChat(b.kind || "chat", b.title));
    }
    let m = /^\/api\/chats\/([\w]+)$/.exec(p);
    if (m && req.method === "GET") {
      const chat = claude.getChat(m[1]);
      return chat ? json(res, 200, chat) : json(res, 404, { error: "Conversation introuvable" });
    }
    if (m && req.method === "DELETE") {
      claude.deleteChat(m[1]);
      return json(res, 200, { ok: true });
    }
    m = /^\/api\/chats\/([\w]+)\/send$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req);
      try {
        return json(res, 200, await claude.sendMessage(m[1], String(b.text || "")));
      } catch (e) {
        return json(res, 500, { error: e.message });
      }
    }

    // ===== Hermes Agent =====
    if (p === "/api/hermes/status") return json(res, 200, hermes.status());
    if (p === "/api/hermes/reconnect" && req.method === "POST") return json(res, 200, await hermes.checkStatus());
    if (p === "/api/hermes/chats" && req.method === "GET") return json(res, 200, hermes.listChats());
    if (p === "/api/hermes/chats" && req.method === "POST") {
      const b = await readBody(req);
      return json(res, 200, hermes.createChat(b.title));
    }
    m = /^\/api\/hermes\/chats\/([\w]+)$/.exec(p);
    if (m && req.method === "GET") {
      const chat = hermes.getChat(m[1]);
      return chat ? json(res, 200, chat) : json(res, 404, { error: "Conversation Hermes introuvable" });
    }
    if (m && req.method === "DELETE") {
      hermes.deleteChat(m[1]);
      return json(res, 200, { ok: true });
    }
    m = /^\/api\/hermes\/chats\/([\w]+)\/send$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req);
      if (!String(b.text || "").trim()) return json(res, 400, { error: "Message vide" });
      try {
        return json(res, 200, await hermes.sendMessage(m[1], String(b.text)));
      } catch (e) {
        return json(res, 500, { error: e.message });
      }
    }

    // ===== OAuth Google =====
    if (p === "/api/google/auth") {
      const service = url.searchParams.get("service") === "drive" ? "drive" : "youtube";
      return json(res, 200, { url: google.authUrl(service, PORT) });
    }
    if (p === "/api/google/callback") {
      const code = url.searchParams.get("code");
      const service = url.searchParams.get("state") || "youtube";
      if (!code) {
        res.writeHead(302, { Location: "/#/settings?oauth=denied" });
        return res.end();
      }
      try {
        await google.exchangeCode(code, service, PORT);
        cache.invalidate("yt-");
        res.writeHead(302, { Location: "/#/settings?oauth=ok" });
      } catch (e) {
        res.writeHead(302, { Location: "/#/settings?oauth=error&msg=" + encodeURIComponent(e.message) });
      }
      return res.end();
    }
    if (p === "/api/google/drive/disconnect" && req.method === "POST") {
      google.disconnectDrive();
      return json(res, 200, { ok: true });
    }

    // ===== Chaînes =====
    if (p === "/api/channels" && req.method === "GET") return json(res, 200, google.channels());
    if (p === "/api/channels/overview") {
      const out = [];
      for (const ch of google.channels()) {
        try {
          const ov = await cache.getOrFetch(`yt-overview-${ch.channelId}`, refresh, () =>
            yt.channelOverview(ch.channelId)
          );
          const day = await cache.getOrFetch(`yt-24h-${ch.channelId}`, refresh, () => yt.channel24h(ch.channelId));
          out.push({ ...ov.value, machine: ch.machine, fetchedAt: ov.fetchedAt, last24h: day.value });
        } catch (e) {
          out.push({ channelId: ch.channelId, title: ch.title, thumbnail: ch.thumbnail, machine: ch.machine, error: e.message });
        }
      }
      return json(res, 200, out);
    }
    m = /^\/api\/channels\/([\w-]+)\/machine$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req);
      google.setChannelMachine(m[1], b.machine);
      return json(res, 200, { ok: true });
    }
    m = /^\/api\/channels\/([\w-]+)$/.exec(p);
    if (m && req.method === "DELETE") {
      google.removeChannel(m[1]);
      return json(res, 200, { ok: true });
    }

    // ===== Stats (cache manuel) =====
    if (p === "/api/stats/series") {
      const channel = url.searchParams.get("channel") || "all";
      const period = url.searchParams.get("period") || "month";
      if (channel === "all") {
        const entry = await cache.getOrFetch(`yt-series-all-${period}`, refresh, () =>
          aggregatedSeries(period, refresh)
        );
        return json(res, 200, entry);
      }
      try {
        return json(res, 200, await seriesFor(channel, period, refresh));
      } catch (e) {
        return json(res, 500, { error: e.message });
      }
    }

    // Stats TEMPS RÉEL (API Data publique — pas le retard ~48 h d'Analytics). 3 unités/chaîne, cache manuel.
    if (p === "/api/stats/live") {
      const entry = await cache.getOrFetch("yt-live-all", refresh, async () => {
        const out = [];
        for (const ch of google.channels()) {
          try { out.push(await yt.channelLive(ch.channelId)); } catch (e) { out.push({ channelId: ch.channelId, title: ch.title, error: e.message }); }
        }
        return out;
      });
      return json(res, 200, entry);
    }

    // ===== Dépenses (real=1 : uniquement les APIs à coût réel) =====
    if (p === "/api/spend") {
      const real = url.searchParams.get("real") === "1";
      const days = Number(url.searchParams.get("days")) || 30;
      return json(res, 200, {
        byApi: spend.summary("api", days, real),
        byMachine: spend.summary("machine", days, real),
        byTool: spend.summary("tool", days, real),
        recent: spend.recent(30, real),
      });
    }

    // ===== Tâches & cron =====
    if (p === "/api/tasks" && req.method === "GET") return json(res, 200, tasks.listTasks());
    if (p === "/api/tasks" && req.method === "POST") return json(res, 200, tasks.createTask(await readBody(req)));
    m = /^\/api\/tasks\/([\w]+)$/.exec(p);
    if (m && req.method === "PATCH") return json(res, 200, await tasks.updateTask(m[1], await readBody(req)));
    if (m && req.method === "DELETE") {
      tasks.deleteTask(m[1]);
      return json(res, 200, { ok: true });
    }
    if (p === "/api/crons" && req.method === "GET") return json(res, 200, tasks.listCrons());
    m = /^\/api\/crons\/([\w-]+)\/toggle$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req);
      return json(res, 200, tasks.toggleCron(m[1], b.enabled));
    }

    // Véritable planificateur Hermes : mêmes jobs depuis le site, Chat Hermes,
    // Telegram, le Desktop et la CLI.
    if (p === "/api/hermes/crons" && req.method === "GET") {
      try { return json(res, 200, await hermesCrons.list()); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (p === "/api/hermes/crons" && req.method === "POST") {
      try {
        const b = await readBody(req);
        if (!["local", "telegram"].includes(b.deliver)) b.deliver = "local";
        return json(res, 200, await hermesCrons.create(b));
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    m = /^\/api\/hermes\/crons\/([\w-]+)\/toggle$/.exec(p);
    if (m && req.method === "POST") {
      try {
        const b = await readBody(req);
        return json(res, 200, await hermesCrons.setEnabled(m[1], !!b.enabled));
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/hermes\/crons\/([\w-]+)\/run$/.exec(p);
    if (m && req.method === "POST") {
      try { return json(res, 200, await hermesCrons.runNow(m[1])); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/hermes\/crons\/([\w-]+)$/.exec(p);
    if (m && req.method === "DELETE") {
      try { return json(res, 200, await hermesCrons.remove(m[1])); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (p === "/api/events") return json(res, 200, tasks.events(30));
    if (p === "/api/test/telegram" && req.method === "POST") {
      return json(res, 200, await telegram.send("🔧 Test Agentic Os : la connexion Telegram fonctionne."));
    }
    if (p === "/api/notify" && req.method === "POST") {
      const b = await readBody(req);
      if (!b.text) return json(res, 400, { error: "text manquant" });
      return json(res, 200, await telegram.send(String(b.text).slice(0, 3800)));
    }

    // ===== Niche Finder =====
    if (p === "/api/niche/search" && req.method === "POST") {
      const filters = await readBody(req);
      return json(res, 200, startNicheJob(filters));
    }
    m = /^\/api\/niche\/job\/([\w]+)$/.exec(p);
    if (m) return json(res, 200, nicheJobs[m[1]] || { status: "unknown" });
    if (p === "/api/niche/history") return json(res, 200, niche.history());
    m = /^\/api\/niche\/history\/([\w]+)$/.exec(p);
    if (m && req.method === "DELETE") {
      niche.deleteHistory(m[1]);
      return json(res, 200, { ok: true });
    }
    if (m) return json(res, 200, niche.historyEntry(m[1]));
    if (p === "/api/niche/quota") return json(res, 200, yt.quotaStatus());

    // ===== SCRAP-O-MATIC =====
    if (p === "/api/scrap/list") {
      return json(res, 200, { ...scrap.watchlist(), budget: apify.status() });
    }
    if (p === "/api/scrap/add" && req.method === "POST") {
      const b = await readBody(req);
      return json(res, 200, scrap.add(b.type, b.item || {}));
    }
    if (p === "/api/scrap/add-video" && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, await scrap.addVideoByUrl(b.url || "")); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (p === "/api/scrap/search-channels" && req.method === "GET") {
      try {
        return json(res, 200, await scrap.searchChannels(url.searchParams.get("q")));
      } catch (e) {
        return json(res, 500, { error: e.message });
      }
    }
    m = /^\/api\/scrap\/(channel|video)\/([\w-]+)$/.exec(p);
    if (m && req.method === "DELETE") {
      scrap.remove(m[1], m[2]);
      return json(res, 200, { ok: true });
    }
    if (m && req.method === "GET") {
      const r = m[1] === "channel" ? scrap.channelResult(m[2]) : scrap.videoResult(m[2]);
      return r ? json(res, 200, r) : json(res, 404, { error: "Pas encore scrappé" });
    }
    m = /^\/api\/scrap\/video\/([\w-]+)\/details$/.exec(p);
    if (m) {
      try {
        return json(res, 200, await scrap.videoDetails(m[1]));
      } catch (e) {
        return json(res, 500, { error: e.message });
      }
    }
    m = /^\/api\/scrap\/channel\/([\w-]+)\/thumbs$/.exec(p);
    if (m) return json(res, 200, scrap.channelThumbs(m[1]));
    m = /^\/api\/scrap\/channel\/([\w-]+)\/avatar$/.exec(p);
    if (m) {
      try {
        const f = await scrap.avatarPath(m[1]);
        if (!f) return json(res, 404, { error: "Logo introuvable" });
        res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" });
        return res.end(require("fs").readFileSync(f));
      } catch (e) {
        return json(res, 404, { error: e.message });
      }
    }
    m = /^\/api\/scrap\/channel\/([\w-]+)\/info$/.exec(p);
    if (m) {
      try {
        return json(res, 200, await scrap.channelInfo(m[1]));
      } catch (e) {
        return json(res, 500, { error: e.message });
      }
    }
    m = /^\/api\/scrap\/(channel|video)\/([\w-]+)\/scrape$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      const id = m[2];
      // Lancement asynchrone : le suivi passe par la liste (statuts) + Tâches & Cron
      const job = m[1] === "channel" ? scrap.scrapeChannel(id, b) : scrap.scrapeVideo(id);
      job.catch((e) => console.log("[scrap]", e.message));
      return json(res, 200, { ok: true, started: true });
    }
    m = /^\/api\/scrap\/channel\/([\w-]+)\/analyze-all$/.exec(p);
    if (m && req.method === "POST") {
      // Batch transcript + vision de TOUTES les vidéos scrappées de la chaîne (1 seule tâche)
      const job = scrap.analyzeChannelVideos(m[1]);
      job.catch((e) => console.log("[scrap batch]", e.message));
      return json(res, 200, { ok: true, started: true });
    }
    // ===== BANQUE DE NICHES =====
    if (p === "/api/bank/niches" && req.method === "GET") return json(res, 200, bankLib.niches());
    if (p === "/api/bank/niches" && req.method === "POST") {
      const b = await readBody(req);
      return json(res, 200, bankLib.create(b.name));
    }
    m = /^\/api\/bank\/niches\/([\w-]+)\/channels\/([\w-]+)$/.exec(p);
    if (m && req.method === "DELETE") {
      bankLib.removeChannel(m[1], m[2]);
      return json(res, 200, { ok: true });
    }
    m = /^\/api\/bank\/niches\/([\w-]+)\/videos\/([\w-]+)$/.exec(p);
    if (m && req.method === "DELETE") {
      bankLib.removeVideo(m[1], m[2]);
      return json(res, 200, { ok: true });
    }
    m = /^\/api\/bank\/niches\/([\w-]+)\/videos$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, bankLib.addVideo(m[1], b.videoId)); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/bank\/niches\/([\w-]+)\/channels$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req);
      try {
        return json(res, 200, bankLib.addChannel(m[1], b.channelId));
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    m = /^\/api\/bank\/niches\/([\w-]+)$/.exec(p);
    if (m && req.method === "DELETE") {
      bankLib.remove(m[1]);
      return json(res, 200, { ok: true });
    }
    if (m && req.method === "GET") {
      try {
        return json(res, 200, bankLib.summary(m[1]));
      } catch (e) {
        return json(res, 404, { error: e.message });
      }
    }
    // ===== MACHINES =====
    if (p === "/api/machines" && req.method === "GET") {
      const card = (mac) => {
        const c = mac.config();
        const st = mac.stock();
        // Les vidéos ARCHIVÉES ne comptent jamais dans le stock
        // La troupe vit dans un module séparé sur certaines machines, et sa clé diffère
        // (`characters` chez Stickman, `entries` chez Drama) → repli en cascade.
        const lib = mac.cast ? mac.cast.list() : null;
        const chars = lib ? (lib.characters || lib.entries || []).length : (c.characters || c.styles || []).length;
        return {
          id: c.id || mac.MACHINE_ID,
          name: c.name || mac.MACHINE_NAME,
          characters: chars,
          stock: { total: st.filter((v) => !v.archived).length, unposted: st.filter((v) => !v.posted && !v.archived).length },
        };
      };
      return json(res, 200, [card(tt), card(ling), card(mus), card(stick), card(boud), card(drama), card(crime)]);
    }
    // ================= MACHINE CRIME =================
    if (p === "/api/machines/crime" && req.method === "GET")
      return json(res, 200, { ...crime.config(), voices: voices.list(), stock: crime.stock().length });
    if (p === "/api/machines/crime" && req.method === "PATCH") {
      const b = await readBody(req);
      return json(res, 200, { ...crime.patchConfig(b), voices: voices.list() });
    }
    if (p === "/api/machines/crime/estimate" && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      return json(res, 200, crime.estimate(b));
    }
    if (p === "/api/machines/crime/idea" && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try { return json(res, 200, await crime.suggestTheme(b.nicheId)); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (p === "/api/machines/crime/runs" && req.method === "GET") return json(res, 200, crime.listRuns());
    if (p === "/api/machines/crime/runs" && req.method === "POST") {
      const b = await readBody(req);
      try { const r = crime.createRun(b); crime.advance(r.id).catch(() => {}); return json(res, 200, r); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/crime\/runs\/([\w-]+)\/(advance|resume|cancel|publish|thumbnail)$/.exec(p);
    if (m && req.method === "POST") {
      const id = m[1], act = m[2];
      const b = await readBody(req).catch(() => ({}));
      try {
        if (act === "cancel") return json(res, 200, crime.cancelRun(id));
        if (act === "resume") return json(res, 200, crime.resumeRun(id));
        if (act === "publish") return json(res, 200, await crime.publishRun(id, b));
        if (act === "thumbnail") {
          const run = crime.getRun(id);
          if (!run) return json(res, 404, { error: "Run introuvable" });
          for (const f of ["th-portrait.png", "th-portrait.jpg", "th-medaillon.png", "th-medaillon.jpg"]) {
            try { require("fs").unlinkSync(require("path").join(__dirname, "output", "machines", id, f)); } catch {}
          }
          if (b.instructions) { run.pack.portrait += ` ${b.instructions}`; run.pack.medaillon += ` ${b.instructions}`; }
          await crime.generateThumbnail(run);
          return json(res, 200, crime.getRun(id));
        }
        const run = crime.getRun(id);
        if (!run) return json(res, 404, { error: "Run introuvable" });
        const bad = crime.validate(run);
        if (bad) return json(res, 400, { error: bad });
        crime.advance(id).catch(() => {});
        return json(res, 200, { ok: true });
      } catch (e) { return json(res, 500, { error: e.message }); }
    }
    m = /^\/api\/machines\/crime\/runs\/([\w-]+)$/.exec(p);
    if (m && req.method === "GET") {
      const r = crime.getRun(m[1]);
      return r ? json(res, 200, r) : json(res, 404, { error: "Run introuvable" });
    }
    if (p === "/api/machines/crime/stock" && req.method === "GET") return json(res, 200, crime.stock());
    m = /^\/api\/machines\/crime\/stock\/([\w-]+)$/.exec(p);
    if (m && req.method === "PATCH") {
      const b = await readBody(req);
      try { return json(res, 200, crime.patchStock(m[1], b)); } catch (e) { return json(res, 400, { error: e.message }); }
    }

    // ---- HeyGen (avatar parlant, brique partagée) ----
    if (p === "/api/heygen/quota" && req.method === "GET") {
      try { return json(res, 200, await heygenLib.quota()); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (p === "/api/heygen/avatars" && req.method === "GET") {
      try {
        const groups = await heygenLib.avatarGroups();
        const out = [];
        for (const g of groups) out.push({ ...g, looks: await heygenLib.looks(g.id).catch(() => []) });
        return json(res, 200, out);
      } catch (e) { return json(res, 500, { error: e.message }); }
    }

    // ================= MACHINE DRAMA =================
    if (p === "/api/machines/drama" && req.method === "GET")
      return json(res, 200, { ...drama.config(), langs: drama.LANGS, rythmes: drama.RYTHMES,
        styles: drama.cast.STYLES, cast: drama.cast.list().entries, voices: voices.list(), music: musicLib.list() });
    if (p === "/api/machines/drama" && req.method === "PATCH") {
      const b = await readBody(req);
      return json(res, 200, { ...drama.patchConfig(b), langs: drama.LANGS, rythmes: drama.RYTHMES,
        styles: drama.cast.STYLES, cast: drama.cast.list().entries, voices: voices.list(), music: musicLib.list() });
    }
    // -- troupe --
    if (p === "/api/machines/drama/cast" && req.method === "GET") return json(res, 200, drama.cast.list());
    if (p === "/api/machines/drama/cast" && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, await drama.cast.createEntry(b)); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (p === "/api/machines/drama/cast/import" && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, await drama.cast.importEntry(b)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (p === "/api/machines/drama/cast/draft" && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, await drama.cast.draftEntry(b.description || "", { style: b.style })); }
      catch (e) { return json(res, 500, { error: e.message }); }
    }
    m = /^\/api\/machines\/drama\/cast\/([\w-]+)\/regen$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try { return json(res, 200, await drama.cast.regenerate(m[1], b)); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    m = /^\/api\/machines\/drama\/cast\/([\w-]+)\/sheet$/.exec(p);
    if (m && req.method === "GET") {
      const f = drama.cast.sheetPath(m[1]);
      if (!f) return json(res, 404, { error: "Fiche introuvable" });
      return serveFile(res, f, req.headers.range);
    }
    m = /^\/api\/machines\/drama\/cast\/([\w-]+)$/.exec(p);
    if (m && req.method === "PATCH") {
      const b = await readBody(req);
      try { return json(res, 200, drama.cast.patch(m[1], b)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (m && req.method === "DELETE") {
      try { return json(res, 200, drama.cast.remove(m[1])); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    // -- runs --
    if (p === "/api/machines/drama/idea" && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try { return json(res, 200, await drama.suggestTheme(b.nicheId)); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (p === "/api/machines/drama/runs" && req.method === "GET") return json(res, 200, drama.listRuns());
    if (p === "/api/machines/drama/runs" && req.method === "POST") {
      const b = await readBody(req);
      try {
        const r = drama.createRun(b);
        drama.advance(r.id).catch(() => {});
        return json(res, 200, r);
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/drama\/runs\/([\w-]+)\/casting$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, drama.setCasting(m[1], b.mapping || [])); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/drama\/runs\/([\w-]+)\/(advance|resume|cancel|publish|thumbnail)$/.exec(p);
    if (m && req.method === "POST") {
      const id = m[1], act = m[2];
      const b = await readBody(req).catch(() => ({}));
      try {
        if (act === "cancel") return json(res, 200, drama.cancelRun(id));
        if (act === "resume") return json(res, 200, drama.resumeRun(id));
        if (act === "publish") return json(res, 200, await drama.publishRun(id, b));
        if (act === "thumbnail") {
          const run = drama.getRun(id);
          if (!run) return json(res, 404, { error: "Run introuvable" });
          if (b.instructions) run.pack.thumbPrompt = `${run.pack.thumbPrompt} PRIORITÉ ABSOLUE : ${b.instructions}`;
          await drama.generateThumbnail(run);
          return json(res, 200, drama.getRun(id));
        }
        const run = drama.getRun(id);
        if (!run) return json(res, 404, { error: "Run introuvable" });
        const bad = drama.validate(run);
        if (bad) return json(res, 400, { error: bad });
        drama.advance(id).catch(() => {});
        return json(res, 200, { ok: true });
      } catch (e) { return json(res, 500, { error: e.message }); }
    }
    m = /^\/api\/machines\/drama\/runs\/([\w-]+)$/.exec(p);
    if (m && req.method === "GET") {
      const r = drama.getRun(m[1]);
      return r ? json(res, 200, r) : json(res, 404, { error: "Run introuvable" });
    }
    if (p === "/api/machines/drama/stock" && req.method === "GET") return json(res, 200, drama.stock());
    m = /^\/api\/machines\/drama\/stock\/([\w-]+)$/.exec(p);
    if (m && req.method === "PATCH") {
      const b = await readBody(req);
      try { return json(res, 200, drama.patchStock(m[1], b)); } catch (e) { return json(res, 400, { error: e.message }); }
    }

    // ---- Banque de musiques (partagée par toutes les machines) ----
    if (p === "/api/music" && req.method === "GET")
      return json(res, 200, { usages: musicLib.USAGES, tracks: musicLib.list() });
    if (p === "/api/music" && req.method === "POST") {
      const b = await readBody(req);
      try {
        const buf = b.dataUrl ? Buffer.from(String(b.dataUrl).split(",")[1] || "", "base64") : null;
        return json(res, 200, await musicLib.add({ name: b.name, usage: b.usage, tags: b.tags, buffer: buf, srcPath: b.srcPath }));
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/music\/([\w-]+)\/file$/.exec(p);
    if (m && req.method === "GET") {
      const f = musicLib.filePath(m[1]);
      if (!require("fs").existsSync(f)) { res.writeHead(404); return res.end("Not found"); }
      return serveFile(res, f, req.headers.range);
    }
    m = /^\/api\/music\/([\w-]+)$/.exec(p);
    if (m && req.method === "PATCH") {
      const b = await readBody(req);
      try { return json(res, 200, musicLib.patch(m[1], b)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (m && req.method === "DELETE") return json(res, 200, musicLib.remove(m[1]));

    // ---- Bibliothèque de voix (partagée par toutes les machines) ----
    if (p === "/api/voices" && req.method === "GET") {
      return json(res, 200, voices.list({
        engine: url.searchParams.get("engine") || "",
        gender: url.searchParams.get("gender") || "",
        language: url.searchParams.get("language") || "",
      }));
    }
    if (p === "/api/voices" && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, await voices.add(b)); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/voices\/([\w-]+)\/sample$/.exec(p);
    if (m && req.method === "GET") {
      const f = voices.samplePath(m[1]);
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end("Not found"); }
      return serveFile(res, f, req.headers.range);
    }
    m = /^\/api\/voices\/([\w-]+)\/refresh$/.exec(p);
    if (m && req.method === "POST") {
      try { return json(res, 200, await voices.refresh(m[1])); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/voices\/([\w-]+)$/.exec(p);
    if (m && req.method === "PATCH") {
      const b = await readBody(req);
      try { return json(res, 200, voices.patch(m[1], b)); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (m && req.method === "DELETE") return json(res, 200, voices.remove(m[1]));

    // ---- Stock générique (page Chaînes) : lecture, édition, publication depuis le stock ----
    m = /^\/api\/machines\/(timetravel|linguistique|musique|stickman|bouddhisme)\/stock$/.exec(p);
    if (m && req.method === "GET") return json(res, 200, MACHINES[m[1]].stock());
    m = /^\/api\/machines\/(timetravel|linguistique|musique|stickman|bouddhisme)\/stock\/([\w-]+)\/publish$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req);
      const mac = MACHINES[m[1]];
      const entry = mac.stock().find((v) => v.id === m[2] || v.runId === m[2]);
      if (!entry) return json(res, 404, { error: "Vidéo introuvable dans le stock" });
      try {
        return json(res, 200, await mac.publishRun(entry.runId, b));
      } catch (e) {
        return json(res, 500, { error: e.message });
      }
    }
    m = /^\/api\/machines\/(timetravel|linguistique|musique|stickman|bouddhisme)\/stock\/([\w-]+)$/.exec(p);
    if (m && req.method === "PATCH") {
      const b = await readBody(req);
      try { return json(res, 200, MACHINES[m[1]].patchStock(m[2], b)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    // ---- Restock : commander N vidéos à la machine associée à la chaîne ----
    m = /^\/api\/channels\/([\w-]+)\/restock$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req);
      const ch = google.channels().find((c) => c.channelId === m[1]);
      if (!ch) return json(res, 404, { error: "Chaîne inconnue" });
      if (!ch.machine || !MACHINES[ch.machine]) return json(res, 400, { error: "Associe d'abord une machine à cette chaîne" });
      const count = Math.min(Math.max(Number(b.count) || 1, 1), 5);
      const mac = MACHINES[ch.machine];
      const publish = b.destination === "publish";
      // Thèmes explicites optionnels (un par vidéo) — string ou objet idée
      const themes = (Array.isArray(b.themes) ? b.themes : [])
        .map((t) => (typeof t === "string" ? (t.trim() ? { title: t.trim(), text: t.trim() } : null) : t))
        .filter(Boolean);
      // Lancement séquentiel en tâche de fond, avec une tâche VISIBLE pendant la génération du
      // thème (sinon 2-4 min sans aucun feedback → impression de panne).
      (async () => {
        for (let i = 0; i < count; i++) {
          const t = tasks.createTask({
            title: `Restock ${mac.config().name} — vidéo ${i + 1}/${count}`,
            machine: mac.config().name,
            machineId: ch.machine,
            kind: "video",
            step: themes[i] ? "Lancement du run…" : "Génération du thème (2-4 min)…",
            progress: 2,
            status: "running",
          });
          try {
            await mac.orderRun({
              publishChannelId: publish ? ch.channelId : null,
              publishPrivacy: b.privacy || "private",
              publish,
              overrides: b.overrides || null,
              theme: themes[i] || null,
            });
            tasks.deleteTask(t.id); // le run a créé sa propre tâche de suivi
          } catch (e) {
            await tasks.updateTask(t.id, { status: "failed", step: e.message }).catch(() => {});
            telegram.send(`❌ <b>Restock ${ch.title}</b>\n${e.message}`).catch(() => {});
            break;
          }
        }
      })();
      return json(res, 200, { ok: true, ordered: count, machine: ch.machine });
    }
    // ---- Infos de commande (mini-wizard restock/planification) + idées multiples ----
    m = /^\/api\/machines\/(timetravel|linguistique|musique|stickman|bouddhisme)\/order-info$/.exec(p);
    if (m && req.method === "GET") {
      const mac = MACHINES[m[1]];
      const c = mac.config();
      const last = mac.listRuns().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] || null;
      return json(res, 200, {
        machineId: m[1],
        name: c.name,
        params: (last && last.params) || null,
        settings: c.settings || {},
        characters: (c.characters || []).map(({ id, name, presenter, sex }) => ({ id, name, presenter: !!presenter, sex })),
        styles: (c.styles || []).map(({ id, name }) => ({ id, name })),
      });
    }
    m = /^\/api\/machines\/(timetravel|linguistique|musique|stickman|bouddhisme)\/ideas$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try {
        return json(res, 200, { ideas: await MACHINES[m[1]].suggestThemes(b.count || 1, b) });
      } catch (e) {
        return json(res, 500, { error: e.message });
      }
    }
    // ---- Calendrier de publication ----
    if (p === "/api/schedule" && req.method === "GET") return json(res, 200, sched.listAll());
    if (p === "/api/schedule/plans" && req.method === "POST") {
      const b = await readBody(req);
      try {
        const plan = sched.upsertPlan(b);
        sched.materialize();
        return json(res, 200, plan);
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/schedule\/plans\/([\w-]+)$/.exec(p);
    if (m && req.method === "PATCH") {
      const b = await readBody(req);
      try {
        const plan = sched.patchPlan(m[1], b);
        sched.materialize();
        return json(res, 200, plan);
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (m && req.method === "DELETE") {
      sched.deletePlan(m[1]);
      return json(res, 200, { ok: true });
    }
    if (p === "/api/schedule/events" && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, sched.addEvent(b)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/schedule\/events\/([\w-]+)$/.exec(p);
    if (m && req.method === "PATCH") {
      const b = await readBody(req);
      try {
        if (b.action === "run") {
          // Rattrapage manuel : on lance la création tout de suite
          const ev = sched.getEvent(m[1]);
          if (!ev) return json(res, 404, { error: "Événement introuvable" });
          execScheduledEvent(ev).catch((e) => sched.patchEvent(ev.id, { status: "failed", error: e.message }));
          return json(res, 200, { ok: true, launched: true });
        }
        return json(res, 200, sched.patchEvent(m[1], b));
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (m && req.method === "DELETE") {
      sched.deleteEvent(m[1]);
      return json(res, 200, { ok: true });
    }
    if (p === "/api/machines/timetravel/stock" && req.method === "GET") return json(res, 200, tt.stock());
    m = /^\/api\/machines\/(timetravel|linguistique)\/stock\/([\w-]+)$/.exec(p);
    if (m && req.method === "PATCH") {
      const mac = m[1] === "timetravel" ? tt : ling;
      const b = await readBody(req);
      try { return json(res, 200, mac.patchStock(m[2], b)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/timetravel\/runs\/([\w-]+)\/publish$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req);
      try {
        return json(res, 200, await tt.publishRun(m[1], b));
      } catch (e) {
        return json(res, 500, { error: e.message });
      }
    }
    m = /^\/api\/machines\/timetravel\/runs\/([\w-]+)\/thumbnail$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try {
        return json(res, 200, await tt.regenThumbnail(m[1], b.instructions || ""));
      } catch (e) {
        return json(res, 500, { error: e.message });
      }
    }
    m = /^\/api\/machines\/timetravel\/runs\/([\w-]+)\/texts$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try {
        return json(res, 200, await tt.regenTexts(m[1], b.instructions || "", b.field || ""));
      } catch (e) {
        return json(res, 500, { error: e.message });
      }
    }
    if (p === "/api/machines/timetravel" && req.method === "GET") return json(res, 200, tt.config());
    if (p === "/api/machines/timetravel" && req.method === "PATCH") {
      const b = await readBody(req);
      return json(res, 200, tt.patchConfig(b));
    }
    if (p === "/api/machines/timetravel/characters" && req.method === "POST") {
      const b = await readBody(req);
      return json(res, 200, tt.upsertCharacter(b));
    }
    if (p === "/api/machines/timetravel/upload-ref" && req.method === "POST") {
      const b = await readBody(req);
      try {
        return json(res, 200, { rel: tt.saveUploadedReference(b.name, b.dataUrl) });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    if (p === "/api/machines/timetravel/complete-character" && req.method === "POST") {
      const b = await readBody(req);
      try {
        return json(res, 200, await tt.completeCharacter(b));
      } catch (e) {
        return json(res, 500, { error: e.message });
      }
    }
    if (p === "/api/machines/timetravel/generate-ref" && req.method === "POST") {
      const b = await readBody(req);
      try {
        return json(res, 200, { rel: await tt.generateReference(b.name, b.appearance) });
      } catch (e) {
        return json(res, 500, { error: e.message });
      }
    }
    m = /^\/api\/machines\/timetravel\/characters\/([\w-]+)$/.exec(p);
    if (m && req.method === "DELETE") {
      tt.removeCharacter(m[1]);
      return json(res, 200, { ok: true });
    }
    if (p === "/api/machines/timetravel/idea" && req.method === "POST") {
      try {
        return json(res, 200, await tt.suggestTheme());
      } catch (e) {
        return json(res, 500, { error: e.message });
      }
    }
    if (p === "/api/machines/timetravel/runs" && req.method === "GET") return json(res, 200, tt.listRuns());
    if (p === "/api/machines/timetravel/runs" && req.method === "POST") {
      const b = await readBody(req);
      try {
        return json(res, 200, tt.createRun(b));
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    m = /^\/api\/machines\/timetravel\/runs\/([\w-]+)\/validate$/.exec(p);
    if (m && req.method === "POST") {
      try {
        return json(res, 200, tt.validate(m[1]));
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    m = /^\/api\/machines\/timetravel\/runs\/([\w-]+)\/cancel$/.exec(p);
    if (m && req.method === "POST") {
      try {
        return json(res, 200, tt.cancelRun(m[1]));
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    m = /^\/api\/machines\/timetravel\/runs\/([\w-]+)\/resume$/.exec(p);
    if (m && req.method === "POST") {
      // Reprend un run interrompu/annulé à la DERNIÈRE étape atteinte (jamais un saut au montage) :
      // les étapes sont idempotentes (scènes déjà générées gardées). {status} force une étape précise.
      const b = await readBody(req).catch(() => ({}));
      try {
        const run = tt.resumeRun(m[1], b.status);
        return json(res, 200, { ok: true, status: run.status });
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    m = /^\/api\/machines\/timetravel\/runs\/([\w-]+)\/regen$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req);
      try {
        return json(res, 200, await tt.regenScene(m[1], b.scene, b.step, b.instructions));
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    m = /^\/api\/machines\/timetravel\/runs\/([\w-]+)\/regen-modes$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try {
        const modes = Array.isArray(b.modes) && b.modes.length ? b.modes : ["pov_action", "temoin"];
        return json(res, 200, tt.regenScenesByMode(m[1], modes, b.instructions || "", b.imageModes));
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    m = /^\/api\/machines\/timetravel\/runs\/([\w-]+)$/.exec(p);
    if (m && req.method === "GET") {
      try {
        return json(res, 200, tt.getRun(m[1]));
      } catch (e) {
        return json(res, 404, { error: e.message });
      }
    }

    // ===== MACHINE Linguistique =====
    if (p === "/api/machines/linguistique/stock" && req.method === "GET") return json(res, 200, ling.stock());
    m = /^\/api\/machines\/linguistique\/runs\/([\w-]+)\/publish$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, await ling.publishRun(m[1], b)); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    m = /^\/api\/machines\/linguistique\/runs\/([\w-]+)\/thumbnail$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try { return json(res, 200, await ling.regenThumbnail(m[1], b.instructions || "")); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    m = /^\/api\/machines\/linguistique\/runs\/([\w-]+)\/texts$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try { return json(res, 200, await ling.regenTexts(m[1], b.instructions || "", b.field || "")); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (p === "/api/machines/linguistique" && req.method === "GET") return json(res, 200, { ...ling.config(), voices: ling.VOICES });
    if (p === "/api/machines/linguistique" && req.method === "PATCH") {
      const b = await readBody(req);
      return json(res, 200, { ...ling.patchConfig(b), voices: ling.VOICES });
    }
    if (p === "/api/machines/linguistique/characters" && req.method === "POST") {
      const b = await readBody(req);
      return json(res, 200, ling.upsertCharacter(b));
    }
    if (p === "/api/machines/linguistique/upload-ref" && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, { rel: ling.saveUploadedReference(b.name, b.dataUrl) }); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (p === "/api/machines/linguistique/complete-character" && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, await ling.completeCharacter(b)); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (p === "/api/machines/linguistique/generate-ref" && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, { rel: await ling.generateReference(b.name, b.appearance, { presenter: !!b.presenter }) }); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    m = /^\/api\/machines\/linguistique\/characters\/([\w-]+)\/regen-ref$/.exec(p);
    if (m && req.method === "POST") {
      try { return json(res, 200, await ling.regenCharacterImage(m[1])); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    m = /^\/api\/machines\/linguistique\/characters\/([\w-]+)$/.exec(p);
    if (m && req.method === "DELETE") {
      ling.removeCharacter(m[1]);
      return json(res, 200, { ok: true });
    }
    if (p === "/api/machines/linguistique/idea" && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try { return json(res, 200, await ling.suggestTheme(b.sceneCount)); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (p === "/api/machines/linguistique/runs" && req.method === "GET") return json(res, 200, ling.listRuns());
    if (p === "/api/machines/linguistique/runs" && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, ling.createRun(b)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/linguistique\/runs\/([\w-]+)\/validate$/.exec(p);
    if (m && req.method === "POST") {
      try { return json(res, 200, ling.validate(m[1])); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/linguistique\/runs\/([\w-]+)\/cancel$/.exec(p);
    if (m && req.method === "POST") {
      try { return json(res, 200, ling.cancelRun(m[1])); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/linguistique\/runs\/([\w-]+)\/resume$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try { const run = ling.resumeRun(m[1], b.status); return json(res, 200, { ok: true, status: run.status }); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/linguistique\/runs\/([\w-]+)\/regen$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, await ling.regenScene(m[1], b.scene, b.step, b.instructions)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/linguistique\/runs\/([\w-]+)\/regen-images$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try {
        const all = ling.getRun(m[1]).scenes.map((s) => s.i);
        const except = Array.isArray(b.except) ? b.except.map(Number) : [];
        const indices = Array.isArray(b.indices) && b.indices.length ? b.indices.map(Number) : all.filter((i) => !except.includes(i));
        return json(res, 200, ling.regenSceneImages(m[1], indices));
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/linguistique\/runs\/([\w-]+)$/.exec(p);
    if (m && req.method === "GET") {
      try { return json(res, 200, ling.getRun(m[1])); } catch (e) { return json(res, 404, { error: e.message }); }
    }

    // ===== MACHINE Stickman =====
    if (p === "/api/machines/stickman/stock" && req.method === "GET") return json(res, 200, stick.stock());
    if (p === "/api/machines/stickman" && req.method === "GET") {
      return json(res, 200, { ...stick.config(), voices: stick.VOICES, cast: stick.cast.list() });
    }
    if (p === "/api/machines/stickman" && req.method === "PATCH") {
      const b = await readBody(req);
      return json(res, 200, { ...stick.patchConfig(b), voices: stick.VOICES, cast: stick.cast.list() });
    }
    if (p === "/api/machines/stickman/estimate" && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      return json(res, 200, stick.estimate(b));
    }
    // ---- Bibliothèque de personnages (partagée par tous les runs) ----
    if (p === "/api/machines/stickman/cast" && req.method === "GET") return json(res, 200, stick.cast.list());
    if (p === "/api/machines/stickman/cast" && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, await stick.cast.createCharacter(b)); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (p === "/api/machines/stickman/cast/draft" && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, await stick.cast.draftCharacter(b.description || "")); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (p === "/api/machines/stickman/cast/neutral" && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try {
        const n = b.dataUrl ? await stick.cast.setNeutralFromUpload(b.dataUrl) : await stick.cast.ensureNeutral({ force: !!b.force });
        return json(res, 200, n);
      } catch (e) { return json(res, 500, { error: e.message }); }
    }
    m = /^\/api\/machines\/stickman\/cast\/([\w-]+)\/regen$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try { return json(res, 200, await stick.cast.regenerate(m[1], b.look)); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    m = /^\/api\/machines\/stickman\/cast\/([\w-]+)\/sheet$/.exec(p);
    if (m && req.method === "GET") {
      const f = stick.cast.sheetPath(m[1]);
      if (!f) return json(res, 404, { error: "Fiche introuvable" });
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-cache" });
      return res.end(require("fs").readFileSync(f));
    }
    m = /^\/api\/machines\/stickman\/cast\/([\w-]+)$/.exec(p);
    if (m && req.method === "PATCH") {
      const b = await readBody(req);
      try { return json(res, 200, stick.cast.patch(m[1], b)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (m && req.method === "DELETE") {
      try { return json(res, 200, stick.cast.remove(m[1])); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    // ---- Runs ----
    if (p === "/api/machines/stickman/idea" && req.method === "POST") {
      try { return json(res, 200, await stick.suggestTheme()); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (p === "/api/machines/stickman/runs" && req.method === "GET") return json(res, 200, stick.listRuns());
    if (p === "/api/machines/stickman/runs" && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, stick.createRun(b)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/stickman\/runs\/([\w-]+)\/publish$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, await stick.publishRun(m[1], b)); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    m = /^\/api\/machines\/stickman\/runs\/([\w-]+)\/thumbnail$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try { return json(res, 200, await stick.regenThumbnail(m[1], b.instructions || "")); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    m = /^\/api\/machines\/stickman\/runs\/([\w-]+)\/texts$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try { return json(res, 200, await stick.regenTexts(m[1], b.instructions || "", b.field || "")); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    m = /^\/api\/machines\/stickman\/runs\/([\w-]+)\/validate$/.exec(p);
    if (m && req.method === "POST") {
      try { return json(res, 200, stick.validate(m[1])); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/stickman\/runs\/([\w-]+)\/cancel$/.exec(p);
    if (m && req.method === "POST") {
      try { return json(res, 200, stick.cancelRun(m[1])); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/stickman\/runs\/([\w-]+)\/resume$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try { const run = stick.resumeRun(m[1], b.status); return json(res, 200, { ok: true, status: run.status }); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/stickman\/runs\/([\w-]+)\/regen$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, await stick.regenScene(m[1], b.scene, b.instructions)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/stickman\/runs\/([\w-]+)$/.exec(p);
    if (m && req.method === "GET") {
      try { return json(res, 200, stick.getRun(m[1])); } catch (e) { return json(res, 404, { error: e.message }); }
    }

    // ===== MACHINE Bouddhisme =====
    if (p === "/api/machines/bouddhisme/stock" && req.method === "GET") return json(res, 200, boud.stock());
    if (p === "/api/machines/bouddhisme" && req.method === "GET") {
      return json(res, 200, { ...boud.config(), voices: boud.VOICES, ttsEngines: boud.TTS_ENGINES, musicStyles: Object.keys(boud.MUSIC_STYLES), musicLib: boud.musicLib(), library: boud.library.list().entries });
    }
    if (p === "/api/machines/bouddhisme" && req.method === "PATCH") {
      const b = await readBody(req);
      return json(res, 200, { ...boud.patchConfig(b), voices: boud.VOICES, ttsEngines: boud.TTS_ENGINES, musicStyles: Object.keys(boud.MUSIC_STYLES), musicLib: boud.musicLib(), library: boud.library.list().entries });
    }
    if (p === "/api/machines/bouddhisme/estimate" && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      return json(res, 200, boud.estimate(b));
    }
    // Voix filtrées par langue ET par genre (l'API Inworld n'expose pas le genre : déduit du prénom)
    if (p === "/api/machines/bouddhisme/voices" && req.method === "GET") {
      return json(res, 200, boud.voicesFor(url.searchParams.get("language") || "Français", url.searchParams.get("gender") || "", url.searchParams.get("engine") || "inworld"));
    }
    // ---- Bibliothèque visuelle (références i2i partagées par tous les runs) ----
    if (p === "/api/machines/bouddhisme/library" && req.method === "GET") return json(res, 200, boud.library.list());
    if (p === "/api/machines/bouddhisme/library" && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, await boud.library.createEntry(b)); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (p === "/api/machines/bouddhisme/library/draft" && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, await boud.library.draftEntry(b.description || "")); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    m = /^\/api\/machines\/bouddhisme\/library\/([\w-]+)\/regen$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try { return json(res, 200, await boud.library.regenerate(m[1], b.desc || "")); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    m = /^\/api\/machines\/bouddhisme\/library\/([\w-]+)\/sheet$/.exec(p);
    if (m && req.method === "GET") {
      const f = boud.library.sheetPath(m[1]);
      if (!f) { res.writeHead(404); return res.end("Not found"); }
      return serveFile(res, f, req.headers.range);
    }
    m = /^\/api\/machines\/bouddhisme\/library\/([\w-]+)$/.exec(p);
    if (m && req.method === "PATCH") {
      const b = await readBody(req);
      try { return json(res, 200, boud.library.patch(m[1], b)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (m && req.method === "DELETE") {
      try { return json(res, 200, boud.library.remove(m[1])); } catch (e) { return json(res, 400, { error: e.message }); }
    }

    // Stock de pistes musicales réutilisables (économise une génération Suno par vidéo)
    if (p === "/api/machines/bouddhisme/music" && req.method === "GET") return json(res, 200, boud.musicLib());
    m = /^\/api\/machines\/bouddhisme\/music\/([\w-]+)$/.exec(p);
    if (m && req.method === "DELETE") return json(res, 200, boud.removeFromMusicLib(m[1]));

    if (p === "/api/machines/bouddhisme/idea" && req.method === "POST") {
      try { return json(res, 200, await boud.suggestTheme()); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (p === "/api/machines/bouddhisme/runs" && req.method === "GET") return json(res, 200, boud.listRuns());
    if (p === "/api/machines/bouddhisme/runs" && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, boud.createRun(b)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/bouddhisme\/stock\/([\w-]+)$/.exec(p);
    if (m && req.method === "PATCH") {
      const b = await readBody(req);
      try { return json(res, 200, boud.patchStock(m[1], b)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/bouddhisme\/runs\/([\w-]+)\/publish$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, await boud.publishRun(m[1], b)); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    m = /^\/api\/machines\/bouddhisme\/runs\/([\w-]+)\/thumbnail$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try { return json(res, 200, await boud.regenThumbnail(m[1], b.instructions || "")); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    m = /^\/api\/machines\/bouddhisme\/runs\/([\w-]+)\/texts$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try { return json(res, 200, await boud.regenTexts(m[1], b.instructions || "", b.field || "")); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    m = /^\/api\/machines\/bouddhisme\/runs\/([\w-]+)\/music$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, boud.chooseMusic(m[1], b.variant)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/bouddhisme\/runs\/([\w-]+)\/validate$/.exec(p);
    if (m && req.method === "POST") {
      try { return json(res, 200, boud.validate(m[1])); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/bouddhisme\/runs\/([\w-]+)\/cancel$/.exec(p);
    if (m && req.method === "POST") {
      try { return json(res, 200, boud.cancelRun(m[1])); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/bouddhisme\/runs\/([\w-]+)\/resume$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try { const run = boud.resumeRun(m[1], b.status); return json(res, 200, { ok: true, status: run.status }); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/bouddhisme\/runs\/([\w-]+)\/regen$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, await boud.regenScene(m[1], b.scene, b.instructions)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/bouddhisme\/runs\/([\w-]+)$/.exec(p);
    if (m && req.method === "GET") {
      try { return json(res, 200, boud.getRun(m[1])); } catch (e) { return json(res, 404, { error: e.message }); }
    }

    // ===== MACHINE Musique =====
    if (p === "/api/machines/musique/stock" && req.method === "GET") return json(res, 200, mus.stock());
    m = /^\/api\/machines\/musique\/stock\/([\w-]+)$/.exec(p);
    if (m && req.method === "PATCH") {
      const b = await readBody(req);
      try { return json(res, 200, mus.patchStock(m[1], b)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/musique\/runs\/([\w-]+)\/publish$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, await mus.publishRun(m[1], b)); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    m = /^\/api\/machines\/musique\/runs\/([\w-]+)\/thumbnail$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try { return json(res, 200, await mus.regenThumbnail(m[1], b.instructions || "")); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    m = /^\/api\/machines\/musique\/runs\/([\w-]+)\/texts$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try { return json(res, 200, await mus.regenTexts(m[1], b.instructions || "", b.field || "")); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (p === "/api/machines/musique" && req.method === "GET") return json(res, 200, mus.config());
    if (p === "/api/machines/musique" && req.method === "PATCH") {
      const b = await readBody(req);
      return json(res, 200, mus.patchConfig(b));
    }
    if (p === "/api/machines/musique/styles" && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, mus.upsertStyle(b)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (p === "/api/machines/musique/styles/derive" && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try { return json(res, 200, await mus.deriveStyle(b.nicheId || null, b.hint || "", b.name || "")); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    m = /^\/api\/machines\/musique\/styles\/([\w-]+)$/.exec(p);
    if (m && req.method === "DELETE") {
      mus.removeStyle(m[1]);
      return json(res, 200, { ok: true });
    }
    if (p === "/api/machines/musique/idea" && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try { return json(res, 200, await mus.suggestTheme(b.styleId)); } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (p === "/api/machines/musique/runs" && req.method === "GET") return json(res, 200, mus.listRuns());
    if (p === "/api/machines/musique/runs" && req.method === "POST") {
      const b = await readBody(req);
      try { return json(res, 200, mus.createRun(b)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/musique\/runs\/([\w-]+)\/validate$/.exec(p);
    if (m && req.method === "POST") {
      try { return json(res, 200, mus.validate(m[1])); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/musique\/runs\/([\w-]+)\/cancel$/.exec(p);
    if (m && req.method === "POST") {
      try { return json(res, 200, mus.cancelRun(m[1])); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/musique\/runs\/([\w-]+)\/resume$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try { const run = mus.resumeRun(m[1], b.status); return json(res, 200, { ok: true, status: run.status }); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/musique\/runs\/([\w-]+)\/regen-visual$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try { return json(res, 200, await mus.regenVisual(m[1], b.instructions || "")); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/musique\/runs\/([\w-]+)\/regen-pair$/.exec(p);
    if (m && req.method === "POST") {
      const b = await readBody(req).catch(() => ({}));
      try { return json(res, 200, await mus.regenPair(m[1], b.pair, b.instructions || "")); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    m = /^\/api\/machines\/musique\/runs\/([\w-]+)$/.exec(p);
    if (m && req.method === "GET") {
      try { return json(res, 200, mus.getRun(m[1])); } catch (e) { return json(res, 404, { error: e.message }); }
    }

    if (p === "/api/scrap/export") {
      try {
        const csv = scrap.exportCsv(url.searchParams.get("table"));
        res.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="scrap-${url.searchParams.get("table")}.csv"`,
        });
        return res.end("﻿" + csv);
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    if (p === "/api/vault/apify-keys" && req.method === "POST") {
      const b = await readBody(req);
      if (!b.key) return json(res, 400, { error: "Clé manquante" });
      vault.addApifyKey(b.label, b.key);
      return json(res, 200, { ok: true });
    }
    m = /^\/api\/vault\/apify-keys\/(\d+)$/.exec(p);
    if (m && req.method === "DELETE") {
      vault.removeApifyKey(Number(m[1]));
      return json(res, 200, { ok: true });
    }
    if (p === "/api/vault/apify-keys" && req.method === "GET") {
      return json(res, 200, vault.poolSummary("apify_keys"));
    }

    // ===== Coffre-fort =====
    if (p === "/api/vault" && req.method === "GET") return json(res, 200, vault.summary());
    if (p === "/api/vault" && req.method === "POST") {
      const b = await readBody(req);
      vault.set(b.key, b.value);
      return json(res, 200, { ok: true });
    }
    if (p === "/api/vault/youtube-keys" && req.method === "POST") {
      const b = await readBody(req);
      if (!b.key) return json(res, 400, { error: "Clé manquante" });
      vault.addYoutubeKey(b.label, b.key);
      return json(res, 200, { ok: true });
    }
    m = /^\/api\/vault\/youtube-keys\/(\d+)$/.exec(p);
    if (m && req.method === "DELETE") {
      vault.removeYoutubeKey(Number(m[1]));
      return json(res, 200, { ok: true });
    }

    // ===== Fichiers =====
    if (p === "/api/files") {
      const type = url.searchParams.get("type") || null; // image | video | null
      const source = url.searchParams.get("source") || "local";
      if (source === "drive") {
        try {
          return json(res, 200, await google.driveFiles(type));
        } catch (e) {
          return json(res, 500, { error: e.message });
        }
      }
      return json(res, 200, files.localFiles(type));
    }
    if (p.startsWith("/media/")) {
      const rel = decodeURIComponent(p.slice(7));
      const full = files.resolveLocal(rel);
      if (!full) {
        res.writeHead(404);
        return res.end("Not found");
      }
      return serveFile(res, full, req.headers.range);
    }
    // Miniatures Drive proxifiées (le navigateur reçoit un 403 sur thumbnailLink direct)
    if (p === "/api/drive/thumb") {
      try {
        const t = await google.driveFileThumb(url.searchParams.get("id"));
        res.writeHead(200, { "Content-Type": t.mime, "Cache-Control": "private, max-age=3600" });
        return res.end(t.buffer);
      } catch (e) {
        res.writeHead(404);
        return res.end();
      }
    }

    // ===== Machines =====
    if (p === "/api/machines") return json(res, 200, listMachines());

    // ===== Miniature Creator natif =====
    if (p === "/api/studio/status") {
      return json(res, 200, { configured: studio.configured(), tools: studio.TOOLS });
    }
    if (p === "/api/studio/generate" && req.method === "POST") {
      try {
        return json(res, 200, await studio.generate(await readBody(req)));
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
    if (p === "/api/studio/jobs") return json(res, 200, studio.publicJobs());
    if (p === "/api/studio/gallery") {
      return json(res, 200, studio.readIndex().slice().reverse().map((e) => ({
        ...e,
        rel: "agent-os/output/miniatures/" + e.file,
      })));
    }

    // ===== Second cerveau : état du coffre + réindexation =====
    if (p === "/api/brain/info") {
      if (!GRAPHIFY_DIR) return json(res, 200, { configured: false });
      let g = null;
      try {
        g = JSON.parse(fs.readFileSync(path.join(GRAPHIFY_DIR, "graph.json"), "utf8"));
      } catch {}
      return json(res, 200, {
        configured: true,
        vault: g ? g.vault : path.basename(VAULT_DIR || GRAPHIFY_DIR),
        indexed: !!g,
        generatedAt: g ? g.generatedAt : null,
        notes: g ? g.nodes.filter((n) => !n.missing).length : 0,
        links: g ? g.links.length : 0,
      });
    }
    // Relit le coffre et régénère graphify-out/ (bouton « Réindexer » de la page).
    if (p === "/api/brain/reindex" && req.method === "POST") {
      if (!VAULT_DIR) return json(res, 400, { error: "Second cerveau non configuré : définis SECOND_BRAIN_DIR dans le .env." });
      const out = await new Promise((resolve) => {
        execFile(process.execPath, [path.join(__dirname, "scripts", "build-graph.js"), VAULT_DIR],
          { timeout: 60000 }, (err, so, se) => resolve({ err, text: (so || "") + (se || "") }));
      });
      if (out.err) return json(res, 500, { error: out.text.trim() || out.err.message });
      return json(res, 200, { ok: true, log: out.text.trim() });
    }

    // ===== Graphify (second cerveau, optionnel) =====
    if (p.startsWith("/brain/graph/")) {
      if (!GRAPHIFY_DIR) return json(res, 404, { error: "Second cerveau non configuré : définis SECOND_BRAIN_DIR dans le .env (coffre Obsidian avec un dossier graphify-out/)." });
      return serveFromDir(res, GRAPHIFY_DIR, decodeURIComponent(p.slice("/brain/graph/".length)) || "rings.html", req.headers.range);
    }

    // ===== Static (SPA) =====
    let rel = p === "/" ? "index.html" : p.slice(1);
    return serveFromDir(res, PUBLIC_DIR, decodeURIComponent(rel), req.headers.range);
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
});

// Interface d'administration sans authentification : écoute strictement locale.
/**
 * ⚠ Sans ceci, un `npm start` sur un port déjà occupé échouait avec une trace Node illisible
 *   et l'ANCIEN serveur continuait de répondre : on croyait avoir redémarré, le bandeau
 *   « serveur périmé » restait, et on cherchait ailleurs. Vécu.
 */
server.on("error", (e) => {
  if (e && e.code === "EADDRINUSE") {
    const { execSync } = require("child_process");
    let who = "";
    try { who = execSync(`lsof -ti :${PORT}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim().split("\n")[0]; } catch {}
    console.error(`\n⛔ Le port ${PORT} est DÉJÀ utilisé par un autre Agent OS${who ? ` (PID ${who})` : ""}.`);
    console.error("   Ce serveur-ci ne démarre donc PAS, et c'est l'ancien qui continue de répondre.");
    console.error(`   Ferme-le d'abord :  kill ${who || "<PID>"}     puis relance  npm start\n`);
    process.exit(1);
  }
  console.error("Erreur serveur :", e && e.message);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", async () => {
  const orphans = tasks.sweepOrphans();
  if (orphans) console.log(`  ${orphans} tâche(s) orpheline(s) marquée(s) échouée(s) (redémarrage)`);
  try {
    const stale = tt.sweepRuns() + ling.sweepRuns() + mus.sweepRuns() + (stick.sweepRuns() || 0) + (boud.sweepRuns() || 0) + (drama.sweepRuns() || 0) + (crime.sweepRuns() || 0);
    if (stale) console.log(`  ${stale} run(s) : marqueurs de génération périmés nettoyés`);
  } catch {}
  console.log(`\n  Agentic Os  →  http://localhost:${PORT}\n`);
  setInterval(() => tasks.tickScheduler(), 30000);
  // CRON sauvetage : toutes les 5 min, détecte les runs restés « en cours » sans moteur en mémoire
  // (serveur redémarré, crash) et envoie un message Telegram INTERACTIF : ✅ Reprendre / ❌ Ignorer.
  const rescued = new Set();
  setInterval(() => {
    try {
      const cron = tasks.listCrons().find((c) => c.id === "rescue-runs");
      if (!cron || !cron.enabled) return;
      for (const r of [...tt.strandedRuns(), ...ling.strandedRuns(), ...mus.strandedRuns()]) {
        if (rescued.has(r.id)) continue;
        rescued.add(r.id);
        tasks.emit("run_stranded", { title: `${r.machine} — run ${r.id}`, machine: r.machine, kind: "video", detail: r.status }).catch(() => {}); // journal seulement
        telegram.sendWithButtons(
          `🚑 <b>Run planté — ${r.machine}</b>\n« ${r.theme} »\nBloqué à l'étape « ${r.status.replace("_running", "")} » (serveur coupé pendant la génération).\nVeux-tu le reprendre là où il s'est arrêté ?`,
          [
            { text: "✅ Oui, reprendre", data: `resume:${r.machineId}:${r.id}` },
            { text: "❌ Non, ignorer", data: `ignore:${r.machineId}:${r.id}` },
          ]
        ).catch(() => {});
      }
    } catch {}
  }, 5 * 60 * 1000);
  // Snapshot des compteurs publics (cron « stats-snapshot », 1 unité/chaîne) : toutes les 15 min
  // + à chaque affichage/actualisation du dashboard (via seriesFor). recordSnapshots écrase le
  // point du jour à chaque passage → la courbe du jour est à jour à la minute.
  const snapTick = () => {
    try {
      const cron = tasks.listCrons().find((c) => c.id === "stats-snapshot");
      if (cron && cron.enabled) yt.recordSnapshots().catch(() => {});
    } catch {}
  };
  snapTick();
  setInterval(snapTick, 15 * 60 * 1000);

  // CALENDRIER DE PUBLICATION : chaque minute, matérialise les occurrences des plans et lance
  // les événements arrivés à échéance. Un créneau raté de plus de 45 min (ordinateur éteint)
  // devient « manqué » → Telegram interactif ✅ Créer maintenant / ❌ Ignorer. Le suivi des
  // événements « running » se fait ici aussi (le run associé est lu à chaque passage).
  const schedTick = () => {
    try {
      const cron = tasks.listCrons().find((c) => c.id === "publication-schedule");
      if (!cron || !cron.enabled) return;
      sched.materialize();
      const { due, missed } = sched.dueAndMissed();
      for (const ev of due) {
        sched.patchEvent(ev.id, { status: "running" }); // verrou immédiat (le tick suivant ne le relance pas)
        execScheduledEvent(ev).catch((e) => {
          try { sched.patchEvent(ev.id, { status: "failed", error: e.message }); } catch {}
          telegram.send(`❌ <b>Publication planifiée échouée</b>\n${e.message}`).catch(() => {});
        });
      }
      for (const ev of missed) {
        sched.patchEvent(ev.id, { status: "missed" });
        const ch = google.channels().find((c) => c.channelId === ev.channelId);
        telegram.sendWithButtons(
          `📅 <b>Publication manquée — ${ch ? ch.title : ev.channelId}</b>\nLa vidéo prévue le ${ev.date} à ${ev.time} n'a pas pu être créée (l'ordinateur était éteint à ce moment-là).\nVeux-tu la créer maintenant ?`,
          [
            { text: "✅ Créer maintenant", data: `schedrun:${ev.id}` },
            { text: "❌ Ignorer ce créneau", data: `schedskip:${ev.id}` },
          ]
        ).catch(() => {});
      }
      // Suivi des événements en cours : le STATUT du run fait foi (listRuns renvoie des
      // résumés sans le champ published — ne jamais s'appuyer dessus ici).
      for (const ev of sched.listAll().events.filter((e) => e.status === "running" && e.runId)) {
        const mac = MACHINES[ev.machineId];
        const run = mac && mac.listRuns().find((r) => r.id === ev.runId);
        if (!run) continue;
        if (/failed/.test(run.status)) sched.patchEvent(ev.id, { status: "failed", error: run.status });
        else if (/^(done|published)$/.test(run.status))
          sched.patchEvent(ev.id, { status: "done", doneAt: new Date().toISOString() });
      }
    } catch {}
  };
  setTimeout(schedTick, 20 * 1000); // premier passage après le boot (rattrape les créneaux manqués pendant l'extinction)
  setInterval(schedTick, 60 * 1000);

  // Réception des clics sur les boutons Telegram (long-poll, un seul consommateur)
  telegram.startCallbackLoop(async (data) => {
    const [action, machineId, runId] = String(data || "").split(":");
    // Boutons du calendrier de publication (machineId = eventId ici)
    if (action === "schedrun") {
      const ev = sched.getEvent(machineId);
      if (!ev) return "Événement introuvable";
      execScheduledEvent(ev).catch((e) => { try { sched.patchEvent(ev.id, { status: "failed", error: e.message }); } catch {} });
      return "⚡ Création lancée !";
    }
    if (action === "schedskip") {
      try { sched.patchEvent(machineId, { status: "skipped" }); } catch {}
      return "OK, créneau ignoré.";
    }
    const mac = MACHINES[machineId];
    if (!mac || !runId) return "Bouton inconnu";
    if (action === "resume") {
      const run = mac.resumeRun(runId);
      telegram.send(`⚡ Run <b>${runId}</b> relancé (étape « ${String(run.status).replace("_running", "")} »).`).catch(() => {});
      return "⚡ Run relancé !";
    }
    if (action === "ignore") {
      rescued.add(runId);
      return "OK, ignoré (relançable depuis l'UI, bouton ⚡).";
    }
    return "Action inconnue";
  });
  // Claude démarre en même temps que le serveur
  const st = await claude.warmup();
  // MAINTIEN DE SESSION : un appel réel périodique fait exercer au CLI son propre
  // rafraîchissement TANT QUE le jeton de renouvellement est valide. On ne peut pas rafraîchir
  // à sa place — le jeton vit dans son coffre — mais on évite ainsi la plupart des expirations.
  claude.startKeepAlive(45);
  console.log(st.connected ? `  Claude CLI connecté (${st.version})` : `  Claude CLI indisponible : ${st.lastError}`);
  const hs = await hermes.warmup();
  console.log(hs.connected ? `  Hermes Agent connecté (${hs.version})` : `  Hermes Agent indisponible : ${hs.lastError}`);
});
