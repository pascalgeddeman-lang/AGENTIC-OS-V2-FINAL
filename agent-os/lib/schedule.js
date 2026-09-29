/**
 * Calendrier de publication : plans récurrents par chaîne + événements (occurrences).
 *
 * data/schedule.json = { plans: [], events: [] }
 *  Plan       : {id, channelId, machineId, days:[0-6 (0=dimanche, convention JS)], time:"15:00",
 *                privacy:"private|unlisted|public", destination:"publish|stock", enabled, createdAt}
 *  Événement  : {id, channelId, machineId, date:"YYYY-MM-DD", time:"15:00", privacy, destination,
 *                status:"planned|running|done|failed|missed|skipped", planId?, runId?, error?, createdAt}
 *
 * Le scheduler (server.js) appelle tick logic chaque minute : materialize() crée les occurrences
 * des plans sur l'horizon glissant, dueAndMissed() sépare ce qui doit partir maintenant (grâce
 * 45 min) de ce qui a été manqué (ordinateur éteint à l'heure prévue) → notification Telegram
 * avec boutons ✅ Rattraper / ❌ Ignorer.
 */
const { readJSON, writeJSON } = require("./store");

const GRACE_MIN = 45;
const HORIZON_DAYS = 28;

function load() {
  return readJSON("schedule.json", { plans: [], events: [] });
}
function save(s) {
  writeJSON("schedule.json", s);
}
function newId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}
/** Date locale d'un événement (date + time locales). */
function evDate(ev) {
  return new Date(`${ev.date}T${ev.time || "12:00"}:00`);
}
function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function listAll() {
  const s = load();
  return { plans: s.plans, events: s.events };
}

function upsertPlan(data) {
  const s = load();
  const days = (Array.isArray(data.days) ? data.days : []).map(Number).filter((d) => d >= 0 && d <= 6);
  if (!data.channelId) throw new Error("Choisis une chaîne");
  if (!data.machineId) throw new Error("Associe d'abord une machine à la chaîne");
  if (!days.length) throw new Error("Choisis au moins un jour de la semaine");
  if (!/^\d{2}:\d{2}$/.test(data.time || "")) throw new Error("Heure invalide (format HH:MM)");
  let plan = data.id && s.plans.find((p) => p.id === data.id);
  if (plan) Object.assign(plan, { ...data, days });
  else {
    plan = {
      id: newId("pl"),
      channelId: data.channelId,
      machineId: data.machineId,
      days,
      time: data.time,
      privacy: data.privacy || "private",
      destination: data.destination === "stock" ? "stock" : "publish",
      params: data.params || null, // overrides machine (ex. sceneCount, characterId…)
      enabled: data.enabled !== false,
      createdAt: new Date().toISOString(),
    };
    s.plans.push(plan);
  }
  save(s);
  return plan;
}

function patchPlan(id, patch) {
  const s = load();
  const p = s.plans.find((x) => x.id === id);
  if (!p) throw new Error("Planification introuvable");
  Object.assign(p, patch);
  // Désactivé → on retire les occurrences futures pas encore lancées
  if (patch.enabled === false) s.events = s.events.filter((e) => !(e.planId === id && e.status === "planned"));
  save(s);
  return p;
}

function deletePlan(id) {
  const s = load();
  s.plans = s.plans.filter((p) => p.id !== id);
  s.events = s.events.filter((e) => !(e.planId === id && e.status === "planned"));
  save(s);
}

function addEvent(data) {
  if (!data.channelId) throw new Error("Choisis une chaîne");
  if (!data.machineId) throw new Error("Associe d'abord une machine à la chaîne");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date || "")) throw new Error("Date invalide");
  if (!/^\d{2}:\d{2}$/.test(data.time || "")) throw new Error("Heure invalide (format HH:MM)");
  const s = load();
  const ev = {
    id: newId("ev"),
    channelId: data.channelId,
    machineId: data.machineId,
    date: data.date,
    time: data.time,
    privacy: data.privacy || "private",
    destination: data.destination === "stock" ? "stock" : "publish",
    params: data.params || null,
    status: "planned",
    planId: null,
    runId: null,
    createdAt: new Date().toISOString(),
  };
  s.events.push(ev);
  save(s);
  return ev;
}

function getEvent(id) {
  return load().events.find((e) => e.id === id) || null;
}

function patchEvent(id, patch) {
  const s = load();
  const e = s.events.find((x) => x.id === id);
  if (!e) throw new Error("Événement introuvable");
  Object.assign(e, patch);
  save(s);
  return e;
}

function deleteEvent(id) {
  const s = load();
  s.events = s.events.filter((e) => e.id !== id);
  save(s);
}

/**
 * Crée les occurrences des plans actifs sur l'horizon glissant (28 jours).
 * Une occurrence déjà existante (même plan + même date) n'est jamais dupliquée ;
 * une occurrence dont l'heure est déjà passée de plus de 45 min à la création est ignorée
 * (on ne rétro-déclare pas des « manqués » antérieurs à la création du plan).
 */
function materialize() {
  const s = load();
  const now = new Date();
  let changed = false;
  for (const plan of s.plans.filter((p) => p.enabled)) {
    for (let i = 0; i <= HORIZON_DAYS; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      if (!plan.days.includes(d.getDay())) continue;
      const date = dayKey(d);
      if (s.events.some((e) => e.planId === plan.id && e.date === date)) continue;
      const dt = new Date(`${date}T${plan.time}:00`);
      if (dt < new Date(now.getTime() - GRACE_MIN * 60000)) continue;
      s.events.push({
        id: newId("ev"),
        channelId: plan.channelId,
        machineId: plan.machineId,
        date,
        time: plan.time,
        privacy: plan.privacy,
        destination: plan.destination,
        params: plan.params || null,
        status: "planned",
        planId: plan.id,
        runId: null,
        createdAt: new Date().toISOString(),
      });
      changed = true;
    }
  }
  // Ménage : événements terminés vieux de plus de 90 jours
  const cutoff = new Date(Date.now() - 90 * 86400e3);
  const before = s.events.length;
  s.events = s.events.filter((e) => e.status === "planned" || evDate(e) > cutoff);
  if (changed || s.events.length !== before) save(s);
}

/** Événements planifiés arrivés à échéance : dus (≤ 45 min de retard) vs manqués (au-delà). */
function dueAndMissed() {
  const now = Date.now();
  const due = [];
  const missed = [];
  for (const e of load().events) {
    if (e.status !== "planned") continue;
    const t = evDate(e).getTime();
    if (t > now) continue;
    if (now - t <= GRACE_MIN * 60000) due.push(e);
    else missed.push(e);
  }
  return { due, missed };
}

module.exports = { listAll, upsertPlan, patchPlan, deletePlan, addEvent, getEvent, patchEvent, deleteEvent, materialize, dueAndMissed, GRACE_MIN };
