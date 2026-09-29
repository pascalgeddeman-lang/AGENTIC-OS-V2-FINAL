/**
 * Registre des dépenses API.
 * Chaque entrée : {ts, api, machine, amount, unit ("USD"|"units"), note}.
 * Le quota YouTube est enregistré ici aussi (unit "units") + agrégé côté quota.
 */
const { readJSON, writeJSON } = require("./store");

function load() {
  return readJSON("spend.json", []);
}

function record(api, machine, amount, unit, note) {
  const list = load();
  list.push({
    ts: new Date().toISOString(),
    api,
    machine: machine || "Plateforme",
    amount: Number(amount) || 0,
    unit: unit || "USD",
    note: note ? String(note).slice(0, 120) : "",
  });
  // Garde 5000 entrées max
  writeJSON("spend.json", list.slice(-5000));
}

// APIs sans coût réel (abonnement Claude, quota YouTube gratuit) — exclues de la vue Dépenses
const FREE_APIS = ["Claude CLI", "YouTube Data API"];

/** Agrégation par api ou par machine, sur une fenêtre en jours (0 = tout). */
function summary(groupBy, days, realOnly) {
  const list = load();
  const since = days ? Date.now() - days * 86400e3 : 0;
  const groups = {};
  for (const e of list) {
    if (new Date(e.ts).getTime() < since) continue;
    if (realOnly && FREE_APIS.includes(e.api)) continue;
    const key = groupBy === "machine" ? e.machine : groupBy === "tool" ? e.note || e.api : e.api;
    if (!groups[key]) groups[key] = { key, usd: 0, units: 0, count: 0 };
    if (e.unit === "USD") groups[key].usd += e.amount;
    else groups[key].units += e.amount;
    groups[key].count++;
  }
  return Object.values(groups).sort((a, b) => b.usd + b.units / 1e6 - (a.usd + a.units / 1e6));
}

function recent(limit, realOnly) {
  let list = load();
  if (realOnly) list = list.filter((e) => !FREE_APIS.includes(e.api));
  return list.slice(-(limit || 50)).reverse();
}

module.exports = { record, summary, recent, FREE_APIS };
