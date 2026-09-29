/**
 * Apify — pool de clés avec budget mensuel (5 $/clé/mois, crédits gratuits).
 * Chaque action de scraping coûte ~0,005 $ ; quand une clé approche du budget,
 * on bascule automatiquement sur la suivante (rotation).
 * Ledger : data/apify-ledger.json -> { "2026-07": { "<label>": usd } }
 */
const vault = require("./vault");
const spend = require("./spend");
const { readJSON, writeJSON } = require("./store");

const MONTHLY_BUDGET = 5.0;
const ACTION_COST = 0.005;
const SAFETY_MARGIN = 0.25; // on bascule quand il reste moins de 25 cts

function month() {
  return new Date().toISOString().slice(0, 7);
}

function ledger() {
  return readJSON("apify-ledger.json", {});
}

function charge(label, usd) {
  const l = ledger();
  const m = month();
  l[m] = l[m] || {};
  l[m][label] = (l[m][label] || 0) + usd;
  const months = Object.keys(l).sort().slice(-6);
  const trimmed = {};
  for (const k of months) trimmed[k] = l[k];
  writeJSON("apify-ledger.json", trimmed);
}

function status() {
  const keys = vault.apifyKeys();
  const cur = ledger()[month()] || {};
  const perKey = keys.map((k) => ({
    label: k.label,
    used: Math.round((cur[k.label] || 0) * 1000) / 1000,
    limit: MONTHLY_BUDGET,
    remaining: Math.max(0, MONTHLY_BUDGET - (cur[k.label] || 0)),
  }));
  return {
    month: month(),
    actionCost: ACTION_COST,
    keys: perKey,
    used: perKey.reduce((s, k) => s + k.used, 0),
    limit: keys.length * MONTHLY_BUDGET,
  };
}

function pickKey() {
  const keys = vault.apifyKeys();
  if (!keys.length) throw new Error("Aucune clé Apify dans le coffre (page Paramètres)");
  const cur = ledger()[month()] || {};
  const sorted = keys
    .map((k) => ({ ...k, remaining: MONTHLY_BUDGET - (cur[k.label] || 0) }))
    .sort((a, b) => b.remaining - a.remaining);
  if (sorted[0].remaining < SAFETY_MARGIN) {
    throw new Error(
      `Budget Apify du mois épuisé sur toutes les clés (${status().used.toFixed(2)}$/${status().limit}$) — ajoute une clé dans Paramètres`
    );
  }
  return sorted[0];
}

/**
 * Lance un acteur et attend son dataset (run asynchrone + polling 5 s).
 * Facturation : flatCost (fixe) OU costPerItem × nb de résultats (multiplicatif,
 * ex. scraping de chaîne = 0,005 $ PAR VIDÉO récupérée). Défaut : 0,005 $.
 */
async function runActor(actorId, input, { machine, note, costPerItem, flatCost, timeoutMs = 8 * 60 * 1000 } = {}) {
  const key = pickKey();
  const start = await fetch(`https://api.apify.com/v2/acts/${actorId}/runs?token=${key.key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }).then((r) => r.json());
  if (start.error) throw new Error(`Apify : ${start.error.message}`);
  const runId = start.data.id;

  const t0 = Date.now();
  let run;
  while (true) {
    await new Promise((r) => setTimeout(r, 5000));
    if (Date.now() - t0 > timeoutMs) throw new Error("Apify : délai dépassé");
    run = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${key.key}`).then((r) => r.json());
    const st = run.data?.status;
    if (st === "SUCCEEDED") break;
    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(st)) {
      throw new Error(`Apify : run ${st}${run.data.statusMessage ? " — " + run.data.statusMessage : ""}`);
    }
  }
  const items = await fetch(
    `https://api.apify.com/v2/datasets/${run.data.defaultDatasetId}/items?token=${key.key}&clean=1`
  ).then((r) => r.json());

  const list = Array.isArray(items) ? items : [];
  const cost =
    flatCost != null ? flatCost : costPerItem != null ? Math.max(costPerItem * list.length, ACTION_COST) : ACTION_COST;
  charge(key.label, cost);
  spend.record("Apify", machine || "Scrap-o-matic", cost, "USD", note || actorId);
  return { items: list, keyLabel: key.label, cost };
}

module.exports = { runActor, status, ACTION_COST, MONTHLY_BUDGET };
