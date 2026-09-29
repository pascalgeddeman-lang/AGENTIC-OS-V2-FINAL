/**
 * Tâches (en cours / file d'attente / planifiées) + Cron Jobs + événements.
 *
 * Les futures machines créeront/mettront à jour leurs tâches via l'API :
 *   POST /api/tasks            {title, machine, channel, step, progress, status, desc, scheduledAt}
 *   PATCH /api/tasks/:id       {step, progress, status}
 * Transitions notifiées : status -> done | published | failed (événements Telegram).
 */
const { readJSON, writeJSON } = require("./store");
const telegram = require("./telegram");

// run_stranded n'est PAS ici : le cron Sauvetage envoie lui-même un message Telegram
// INTERACTIF (boutons Reprendre/Ignorer) — emit() ne fait que journaliser cet événement.
const EVENTS = {
  video_done: { label: "Vidéo terminée", emoji: "✅" },
  video_published: { label: "Vidéo publiée", emoji: "📤" },
  render_failed: { label: "Rendu échoué", emoji: "❌" },
};

// Libellés adaptés au type de tâche (une image générée n'est pas une « vidéo »)
const KIND_LABELS = {
  image: { video_done: "Image générée", video_published: "Image publiée", render_failed: "Génération d'image échouée" },
  scrap: { video_done: "Scraping terminé", video_published: "Scraping publié", render_failed: "Scraping échoué" },
};

// Les crons ne concernent pas que des vidéos : libellés génériques (vidéo, image, scrap, musique…).
const DEFAULT_CRONS = [
  {
    id: "tg-video-done",
    label: "Telegram : tâche terminée",
    desc: "Alerte quand une machine termine son travail (vidéo montée, image générée, scraping fini…). Le message précise la machine et le contenu.",
    event: "video_done",
    enabled: true,
  },
  {
    id: "tg-video-published",
    label: "Telegram : contenu publié",
    desc: "Alerte quand un contenu est publié sur une chaîne YouTube (avec le lien direct).",
    event: "video_published",
    enabled: true,
  },
  {
    id: "tg-render-failed",
    label: "Telegram : échec d'une tâche",
    desc: "Alerte quand une étape échoue (génération, montage, scraping, publication…), avec l'étape exacte et la raison. Les échecs notifient toujours, même cron désactivé.",
    event: "render_failed",
    enabled: true,
  },
  {
    id: "stats-snapshot",
    label: "Snapshot stats (15 min + dashboard)",
    desc: "Relève les compteurs publics des chaînes (1 unité/chaîne) toutes les 15 minutes et à chaque affichage/actualisation du dashboard : la courbe du jour est à jour à la minute, sans le retard de 48 h de l'API Analytics.",
    event: "stats_snapshot",
    enabled: true,
  },
  {
    id: "publication-schedule",
    label: "Calendrier de publication (vérif. chaque minute)",
    desc: "Exécute les plannings de publication des chaînes (page Calendrier) : à l'heure prévue, la machine associée crée la vidéo et la publie (ou la met en stock). Un créneau manqué (ordinateur éteint) déclenche une alerte Telegram avec bouton de rattrapage.",
    event: "schedule_tick",
    enabled: true,
  },
  {
    id: "rescue-runs",
    label: "Sauvetage des runs plantés (toutes les 5 min)",
    desc: "Scanne les machines toutes les 5 minutes : un run resté « en cours » sans moteur actif (serveur redémarré, crash) déclenche une alerte Telegram qui propose de le reprendre depuis l'UI.",
    event: "run_stranded",
    enabled: true,
  },
];

function loadTasks() {
  return readJSON("tasks.json", []);
}

function saveTasks(t) {
  writeJSON("tasks.json", t);
}

function loadCrons() {
  const saved = readJSON("cron.json", null);
  if (!saved) {
    writeJSON("cron.json", DEFAULT_CRONS);
    return DEFAULT_CRONS;
  }
  // Réinjecte les crons par défaut manquants ET rafraîchit libellés/descriptions
  // (l'état enabled choisi par l'utilisateur est conservé).
  let changed = false;
  for (const d of DEFAULT_CRONS) {
    const cur = saved.find((c) => c.id === d.id);
    if (!cur) {
      saved.push(d);
      changed = true;
    } else if (cur.label !== d.label || cur.desc !== d.desc) {
      cur.label = d.label;
      cur.desc = d.desc;
      changed = true;
    }
  }
  if (changed) writeJSON("cron.json", saved);
  return saved;
}

function saveCrons(c) {
  writeJSON("cron.json", c);
}

// --- Événements -> notifications ---
async function emit(event, payload) {
  // Journal : intitulé adapté au type (image_done pour une image, video_done pour une vidéo…)
  const LOG_NAMES = {
    image: { video_done: "image_done", video_published: "image_published", render_failed: "image_failed" },
    scrap: { video_done: "scrap_done", video_published: "scrap_published", render_failed: "scrap_failed" },
  };
  const logEvent = (payload?.kind && LOG_NAMES[payload.kind]?.[event]) || event;
  const log = readJSON("events.json", []);
  log.push({ ts: new Date().toISOString(), event: logEvent, payload });
  writeJSON("events.json", log.slice(-500));

  const def = EVENTS[event];
  const cron = loadCrons().find((c) => c.event === event);
  const negative = event === "render_failed";
  // Tout événement négatif notifie ; les autres seulement si le cron est activé
  if (def && ((cron && cron.enabled) || negative)) {
    const label = (payload?.kind && KIND_LABELS[payload.kind]?.[event]) || def.label;
    const lines = [`${def.emoji} <b>${payload?.title || label}</b>`];
    if (payload?.title) lines.push(label);
    if (payload?.machine) lines.push(`Machine : ${payload.machine}`);
    if (payload?.channel) lines.push(`Chaîne : ${payload.channel}`);
    if (payload?.detail) lines.push(payload.detail);
    return telegram.send(lines.join("\n"));
  }
  return { ok: true, skipped: true };
}

// --- CRUD tâches ---
function listTasks() {
  const all = loadTasks();
  return {
    running: all.filter((t) => t.status === "running"),
    queued: all.filter((t) => t.status === "queued"),
    scheduled: all.filter((t) => t.status === "scheduled"),
    recent: all
      .filter((t) => ["done", "published", "failed"].includes(t.status))
      .slice(-20)
      .reverse(),
  };
}

function createTask(data) {
  const all = loadTasks();
  const task = {
    id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    title: data.title || "Tâche sans titre",
    desc: data.desc || "",
    kind: data.kind || "video",
    machine: data.machine || null,
    machineId: data.machineId || null, // route frontend (#/<machineId>) — cliquer la tâche ouvre le run
    runId: data.runId || null,
    channel: data.channel || null,
    step: data.step || "",
    progress: Number(data.progress) || 0,
    status: data.status || "queued", // queued | scheduled | running | done | published | failed
    scheduledAt: data.scheduledAt || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  all.push(task);
  saveTasks(all.slice(-300));
  return task;
}

async function updateTask(id, patch) {
  const all = loadTasks();
  const task = all.find((t) => t.id === id);
  if (!task) throw new Error("Tâche introuvable");
  const before = task.status;
  Object.assign(task, patch, { updatedAt: new Date().toISOString() });
  saveTasks(all);
  if (patch.status && patch.status !== before) {
    // machineId + runId voyagent dans l'événement → le journal peut ouvrir le run d'un clic
    const ctx = { title: task.title, kind: task.kind, machine: task.machine, machineId: task.machineId || null, runId: task.runId || null, channel: task.channel, detail: task.step };
    if (patch.status === "done") await emit("video_done", ctx);
    if (patch.status === "published") await emit("video_published", ctx);
    if (patch.status === "failed") await emit("render_failed", ctx);
  }
  return task;
}

function deleteTask(id) {
  saveTasks(loadTasks().filter((t) => t.id !== id));
}

// --- Cron ---
function listCrons() {
  return loadCrons();
}

function toggleCron(id, enabled) {
  const crons = loadCrons();
  const c = crons.find((x) => x.id === id);
  if (!c) throw new Error("Cron introuvable");
  c.enabled = !!enabled;
  saveCrons(crons);
  return c;
}

/** Boucle légère : passe les tâches planifiées arrivées à échéance en file d'attente. */
function tickScheduler() {
  const all = loadTasks();
  let changed = false;
  for (const t of all) {
    if (t.status === "scheduled" && t.scheduledAt && new Date(t.scheduledAt) <= new Date()) {
      t.status = "queued";
      t.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) saveTasks(all);
}

function events(limit) {
  return readJSON("events.json", []).slice(-(limit || 30)).reverse();
}

/**
 * Au démarrage du serveur : toute tâche encore « running » est forcément orpheline
 * (les jobs vivent dans le processus). On la marque échouée SANS notification Telegram.
 */
function sweepOrphans() {
  const { readJSON, writeJSON } = require("./store");
  const list = readJSON("tasks.json", []);
  let n = 0;
  for (const t of list) {
    if (t.status === "running" || t.status === "queued") {
      t.status = "failed";
      t.step = "Interrompue par un redémarrage du serveur";
      t.endedAt = new Date().toISOString();
      n++;
    }
  }
  if (n) writeJSON("tasks.json", list);
  return n;
}

module.exports = { listTasks, createTask, updateTask, deleteTask, listCrons, toggleCron, emit, tickScheduler, events, EVENTS, sweepOrphans };
