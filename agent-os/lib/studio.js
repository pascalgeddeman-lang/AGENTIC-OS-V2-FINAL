/**
 * Miniature Creator natif — génération d'images Kie.ai intégrée à la plateforme.
 * - Clé Kie : coffre (kie) ou ../.env (KIE).
 * - Chaque job = une tâche suivie dans Tâches & Cron (étapes + %), Telegram à la fin.
 * - Résultats sauvegardés dans agent-os/output/miniatures/ (visibles dans Mes fichiers).
 * - Sources i2i : fichiers locaux (Mes fichiers), data URLs, ou URLs Drive directes ;
 *   upload vers Drive (OAuth plateforme, repli drive_upload.py du studio).
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const vault = require("./vault");
const google = require("./google");
const tasks = require("./tasks");
const spend = require("./spend");
const filesLib = require("./files");

const KIE_BASE = "https://api.kie.ai";
const OUTPUT_DIR = path.join(__dirname, "..", "output", "miniatures");
const INDEX_FILE = path.join(OUTPUT_DIR, "index.json");
const STUDIO_DIR = path.join(__dirname, "..", "..", "kie-image-studio");
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const TOOLS = {
  seedream: {
    name: "Seedream 5 Lite", sub: "ByteDance",
    t2i: { model: "seedream/5-lite-text-to-image", promptMax: 3000 },
    i2i: { model: "seedream/5-lite-image-to-image", promptMax: 3000, imgField: "image_urls", maxImages: 14 },
  },
  nano: {
    name: "Nano Banana 2 Lite", sub: "Google",
    t2i: { model: "nano-banana-2-lite", promptMax: 20000 },
    i2i: { model: "nano-banana-2-lite", promptMax: 20000, imgField: "image_urls", maxImages: 10 },
  },
  gpt: {
    name: "GPT Image 2", sub: "OpenAI",
    t2i: { model: "gpt-image-2-text-to-image", promptMax: 20000 },
    i2i: { model: "gpt-image-2-image-to-image", promptMax: 20000, imgField: "input_urls", maxImages: 16 },
  },
  grok: {
    name: "Grok Imagine", sub: "xAI",
    t2i: { model: "grok-imagine/text-to-image", promptMax: 5000 },
    i2i: { model: "grok-imagine/image-to-image", promptMax: 5000, imgField: "image_urls", maxImages: 1, promptOptional: true, noRatio: true },
  },
};

// Coût par image (USD). Surcharges dans data/prices.json : { "nano": 0.02, ... }
const DEFAULT_PRICES = { seedream: 0.014, nano: 0.02, gpt: 0.06, grok: 0.04 };
function prices() {
  return { ...DEFAULT_PRICES, ...require("./store").readJSON("prices.json", {}) };
}

function kieKey() {
  const fromVault = vault.get("kie");
  if (fromVault) return fromVault;
  try {
    const txt = fs.readFileSync(path.join(__dirname, "..", "..", ".env"), "utf8");
    const m = /^KIE=(.+)$/m.exec(txt);
    if (m) return m[1].trim();
  } catch {}
  return null;
}

function configured() {
  return !!kieKey();
}

async function kie(method, kiePath, body) {
  const key = kieKey();
  if (!key) throw new Error("Clé Kie absente (coffre ou .env)");
  const resp = await fetch(KIE_BASE + kiePath, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok && !data.data) throw new Error(`Kie ${resp.status} : ${(data.msg || "").slice(0, 200)}`);
  return data;
}

// --- Sources i2i -> URLs publiques ---
async function uploadBuffer(name, mime, buffer) {
  try {
    const out = await google.driveUpload(name, mime, buffer);
    return out.directUrl;
  } catch (e) {
    // Repli : OAuth Python local du studio (drive_upload.py)
    const tmp = path.join(os.tmpdir(), `agentos-${Date.now()}-${name.replace(/[^\w.\-]/g, "_")}`);
    fs.writeFileSync(tmp, buffer);
    try {
      return await new Promise((resolve, reject) => {
        execFile("py", [path.join(STUDIO_DIR, "drive_upload.py"), tmp, name], { timeout: 90000 }, (err, stdout, stderr) => {
          if (err) return reject(new Error("Upload Drive impossible : " + (stderr || err.message).slice(0, 200)));
          const line = String(stdout).split(/\r?\n/).find((l) => l.startsWith("RESULT:"));
          if (!line) return reject(new Error("Réponse Drive illisible"));
          resolve(JSON.parse(line.slice(7)).url);
        });
      });
    } finally {
      fs.unlink(tmp, () => {});
    }
  }
}

async function resolveSources(sources, onStep) {
  const urls = [];
  let i = 0;
  for (const s of sources || []) {
    i++;
    if (s.driveId) { urls.push(await google.ensurePublic(s.driveId)); continue; }
    if (s.url) { urls.push(s.url); continue; }
    onStep(`Upload de l'image source ${i}/${sources.length}…`);
    if (s.rel) {
      const full = filesLib.resolveLocal(s.rel);
      if (!full) throw new Error("Fichier source introuvable : " + s.rel);
      const ext = path.extname(full).toLowerCase();
      const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      urls.push(await uploadBuffer(path.basename(full), mime, fs.readFileSync(full)));
    } else if (s.dataUrl) {
      const m = /^data:([^;]+);base64,(.+)$/.exec(s.dataUrl);
      if (!m) throw new Error("dataUrl invalide");
      urls.push(await uploadBuffer(s.name || `source-${Date.now()}.png`, m[1], Buffer.from(m[2], "base64")));
    }
  }
  return urls;
}

// --- Galerie persistante ---
function readIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")); } catch { return []; }
}
function writeIndex(list) {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(list.slice(-500), null, 2));
}

// --- Jobs ---
const jobs = []; // {id, tool, toolName, mode, prompt, aspect, status, step, progress, resultRel, error, taskId, startedAt}
let seq = 0;

function publicJobs() {
  return jobs.slice(-60).reverse().map(({ timer, ...j }) => j);
}

function setJob(job, patch) {
  Object.assign(job, patch);
  if (job.taskId) {
    tasks
      .updateTask(job.taskId, {
        step: job.step,
        progress: job.progress,
        ...(patch.status === "done" ? { status: "done" } : {}),
        ...(patch.status === "failed" ? { status: "failed" } : {}),
      })
      .catch(() => {});
  }
}

/**
 * Lance des générations. Deux formes :
 * - { tool, count, mode, prompt, aspect, sources }               (un seul outil)
 * - { allocations: {nano:2, gpt:1, ...}, mode, prompt, aspect, sources }  (répartition façon Kie Studio)
 * Renvoie la liste des jobs créés (suivi via /api/studio/jobs).
 */
async function generate(body) {
  const { mode: rawMode, prompt, aspect, sources } = body;
  const mode = rawMode === "i2i" ? "i2i" : "t2i";
  if (!configured()) throw new Error("Clé Kie absente : renseigne-la dans Paramètres (coffre) ou .env");

  // Répartition demandée : {tool: count}
  let alloc = body.allocations;
  if (!alloc) alloc = { [body.tool]: Math.min(Math.max(Number(body.count) || 1, 1), 8) };
  const entries = Object.entries(alloc).filter(([id, n]) => TOOLS[id] && Number(n) > 0);
  if (!entries.length) throw new Error("Répartis au moins une image sur un outil");
  const totalCount = entries.reduce((s, [, n]) => s + Number(n), 0);
  if (totalCount > 20) throw new Error("Maximum 20 images par lancement");

  if (mode === "i2i" && (!sources || !sources.length)) throw new Error("Ajoute au moins une image source");
  const promptRequired = mode === "t2i" || entries.some(([id]) => !TOOLS[id][mode].promptOptional);
  if (promptRequired && (!prompt || prompt.trim().length < 3))
    throw new Error("Écris un prompt (3 caractères minimum)");

  // Résolution des sources UNE fois pour tout le lot
  let urls = [];
  if (mode === "i2i") urls = await resolveSources(sources, () => {});

  const created = [];
  let idx = 0;
  for (const [toolId, n] of entries) {
    const t = TOOLS[toolId];
    const conf = t[mode];
    for (let i = 0; i < Number(n); i++) {
      idx++;
      const job = {
        id: "g" + Date.now().toString(36) + ++seq,
        tool: toolId, toolName: t.name, mode,
        prompt: (prompt || "").slice(0, conf.promptMax),
        aspect: conf.noRatio ? null : aspect || "16:9",
        status: "running", step: "Préparation…", progress: 5,
        resultRel: null, error: null, taskId: null,
        startedAt: new Date().toISOString(),
      };
      const task = tasks.createTask({
        title: `Image ${t.name} · ${mode}${totalCount > 1 ? ` (${idx}/${totalCount})` : ""}`,
        desc: (prompt || "(sans prompt)").slice(0, 140),
        machine: "Miniature Creator",
        kind: "image",
        channel: null,
        step: job.step,
        progress: job.progress,
        status: "running",
      });
      job.taskId = task.id;
      jobs.push(job);
      created.push(job);
      runJob(job, conf, urls.slice(0, conf.maxImages)).catch((e) =>
        setJob(job, { status: "failed", error: e.message, step: "Échec : " + e.message, progress: 100 })
      );
    }
  }
  return publicJobs().filter((j) => created.some((c) => c.id === j.id));
}

async function runJob(job, conf, urls) {
  const input = {};
  if (job.prompt) input.prompt = job.prompt;
  if (job.aspect) input.aspect_ratio = job.aspect;
  if (job.tool === "seedream") input.quality = "basic";
  if (job.mode === "i2i") input[conf.imgField] = urls;

  setJob(job, { step: `Envoi à Kie (${conf.model})…`, progress: 15 });
  const createResp = await kie("POST", "/api/v1/jobs/createTask", { model: conf.model, input });
  const taskId = createResp?.data?.taskId;
  if (!taskId) throw new Error(createResp.msg || "Kie n'a pas renvoyé de taskId");
  job.kieTaskId = taskId;
  setJob(job, { step: "Génération en cours…", progress: 25 });

  const t0 = Date.now();
  await new Promise((resolve, reject) => {
    job.timer = setInterval(async () => {
      try {
        if (Date.now() - t0 > 12 * 60 * 1000) {
          clearInterval(job.timer);
          return reject(new Error("Délai dépassé (12 min)"));
        }
        const r = await kie("GET", `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
        const d = r?.data || {};
        const state = String(d.state || "").toLowerCase();
        // Progression estimée (courbe asymptotique 25 -> 88 %)
        const s = (Date.now() - t0) / 1000;
        const pct = Math.min(88, Math.round(25 + 63 * (1 - Math.exp(-s / 50))));
        if (state === "success") {
          clearInterval(job.timer);
          let resultUrls = [];
          try { resultUrls = JSON.parse(d.resultJson || "{}").resultUrls || []; } catch {}
          if (!resultUrls.length) return reject(new Error("Tâche Kie terminée sans image"));
          setJob(job, { step: "Sauvegarde locale…", progress: 92 });
          const resp = await fetch(resultUrls[0]);
          if (!resp.ok) return reject(new Error(`Image inaccessible (${resp.status})`));
          const ct = resp.headers.get("content-type") || "";
          const ext = ct.includes("png") ? ".png" : ct.includes("webp") ? ".webp" : ".jpeg";
          const fname = `${Date.now()}-${job.tool}${ext}`;
          fs.writeFileSync(path.join(OUTPUT_DIR, fname), Buffer.from(await resp.arrayBuffer()));
          const index = readIndex();
          index.push({
            file: fname, tool: job.toolName, mode: job.mode,
            prompt: job.prompt.slice(0, 600), aspect: job.aspect, date: new Date().toISOString(),
          });
          writeIndex(index);
          job.resultRel = "agent-os/output/miniatures/" + fname;
          spend.record("Kie.ai", "Miniature Creator", prices()[job.tool] || 0.03, "USD", job.toolName);
          setJob(job, { status: "done", step: "Terminé", progress: 100 });
          resolve();
        } else if (state === "fail" || state === "failed") {
          clearInterval(job.timer);
          reject(new Error(d.failMsg || d.failCode || "Génération échouée"));
        } else {
          setJob(job, {
            step: state === "waiting" || state === "queuing" ? "Dans la file Kie…" : "Génération en cours…",
            progress: pct,
          });
        }
      } catch (e) {
        // Erreur réseau ponctuelle : on retentera au prochain tick
      }
    }, 5000);
  });
}

module.exports = { TOOLS, configured, generate, publicJobs, readIndex, OUTPUT_DIR };
