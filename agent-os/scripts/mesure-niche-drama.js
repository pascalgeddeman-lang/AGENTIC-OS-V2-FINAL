#!/usr/bin/env node
/**
 * Mesure de la niche micro-drama — 1er septembre 2026.
 *
 * Trois questions posées par l'utilisateur :
 *   Q1. FR, EN, ou les deux (deux chaînes) ?
 *   Q2. Des unitaires de ~15 min, ou des épisodes qui retiennent sur plusieurs semaines ?
 *   Q3. Une durée cible de ~15 min est-elle viable dans cette niche ?
 *
 * Méthode :
 *   - Q1 : paires FR/EN à filtres IDENTIQUES. Ce qui compte est le RENDEMENT comparé
 *     (nb de résultats + niveau de vues), pas le taux de percée (non comparable entre
 *     marchés de tailles différentes). Une recherche FR à seuil abaissé teste ensuite
 *     l'existence d'un marché francophone plus petit.
 *   - Q2 : classement des titres en ÉPISODIQUE vs UNITAIRE par motif (EP1, Part 2,
 *     Épisode 3, #4, Chapter 5…), puis mesure de la DÉCROISSANCE de série : pour une
 *     chaîne présente avec plusieurs épisodes, les vues tiennent-elles d'un épisode au
 *     suivant ? C'est la seule vraie preuve qu'un format « retient ».
 *   - Q3 : histogramme des durées et vues médianes PAR BANDE. `minDurationMin` est un
 *     plancher, pas une bande — la réponse est dans la distribution, pas dans le filtre.
 *
 * Réutilise gratuitement les recherches déjà en cache dans data/niche-history.json.
 *
 * Lancer après la remise à zéro du quota (minuit Pacifique = 9 h Paris) :
 *     cd agent-os && node scripts/mesure-niche-drama.js
 */
const niche = require("../lib/niche.js");
const { readJSON } = require("../lib/store");

// Filtres IDENTIQUES pour la comparaison de langue — seule la requête change.
const SAME = { publishedAfter: "2026-01-01", minViews: 20000, maxSubs: 25000, minDurationMin: 8, sampleSize: 300, budget: 1100 };
// Seuil abaissé : teste l'existence d'un marché FR plus petit.
const LOW  = { publishedAfter: "2026-01-01", minViews: 5000,  maxSubs: 50000, minDurationMin: 8, sampleSize: 300, budget: 1100 };

const RUNS = [
  { key: "EN-SERIE",    lang: "EN", f: { ...SAME, keywords: ["animated drama series episode 1 original"] } },
  { key: "FR-SERIE",    lang: "FR", f: { ...SAME, keywords: ["série animée histoire épisode 1 français"] } },
  { key: "EN-UNITAIRE", lang: "EN", f: { ...SAME, keywords: ["animated short story full drama standalone"] } },
  { key: "FR-UNITAIRE", lang: "FR", f: { ...SAME, keywords: ["histoire animée complète drame français"] } },
  { key: "FR-BAS",      lang: "FR", f: { ...LOW,  keywords: ["histoire animée série française drame"] } },
  { key: "EN-IA",       lang: "EN", f: { ...SAME, keywords: ["AI animated story series episode"] } },
  { key: "FR-IA",       lang: "FR", f: { ...LOW,  keywords: ["histoire générée IA animation française"] } },
];

// ---------- classement épisodique / unitaire ----------
const EPISODIC = [
  /\bEP\s?0?(\d{1,3})\b/i, /\bEPISODE\s+0?(\d{1,3})\b/i, /\bÉPISODE\s+0?(\d{1,3})\b/i,
  /\bPART\s+0?(\d{1,3})\b/i, /\bPARTIE\s+0?(\d{1,3})\b/i, /\bCHAPTER\s+0?(\d{1,3})\b/i,
  /\bCHAPITRE\s+0?(\d{1,3})\b/i, /\bS\d+\s?E(\d{1,3})\b/i, /#(\d{1,3})\b/,
];
function episodeNo(title) {
  for (const re of EPISODIC) { const m = (title || "").match(re); if (m) return Number(m[1]); }
  return null;
}
const med = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const h = s.length >> 1;
  return s.length % 2 ? s[h] : Math.round((s[h - 1] + s[h]) / 2); };
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

const BANDS = [[8,12],[12,18],[18,25],[25,45],[45,80],[80,999]];
function band(mins) { for (const [a,b] of BANDS) if (mins >= a && mins < b) return `${a}-${b === 999 ? "∞" : b} min`; return "?"; }

(async () => {
  const all = [];   // { ...video, src, lang }
  let total = 0;

  // 1) Recherches neuves
  for (const r of RUNS) {
    console.log("\n" + "=".repeat(80));
    console.log(`${r.key}  —  « ${r.f.keywords[0] } »`);
    try {
      const e = await niche.search(r.f, () => {});
      total += e.unitsSpent;
      const st = e.stages;
      console.log(`  entonnoir ${JSON.stringify(st)} | ${e.unitsSpent} unites | ${e.resultCount} resultats`);
      for (const v of e.results) all.push({ ...v, src: r.key, lang: r.lang });
    } catch (err) { console.log("  ECHEC:", err.message); }
  }

  // 2) Recherches déjà en cache (gratuit) — la sonde drama d'hier
  const hist = readJSON("niche-history.json", []);
  for (const e of hist) {
    if (!/short drama full episode CEO revenge/i.test(e.query || "")) continue;
    for (const v of e.results || []) all.push({ ...v, src: "CACHE-drama", lang: "EN" });
    console.log(`\n[cache] « ${e.query} » : ${(e.results || []).length} resultats reinjectes (0 unite)`);
  }

  // dédup
  const seen = new Set();
  const vids = all.filter((v) => !seen.has(v.videoId) && seen.add(v.videoId));
  console.log("\n" + "#".repeat(80));
  console.log(`CORPUS : ${vids.length} videos uniques | ${total} unites depensees`);

  // ---------- Q1 : rendement par langue, filtres identiques ----------
  console.log("\n=== Q1 — LANGUE (filtres identiques : >=20k vues, <=25k subs, >=8 min) ===");
  console.log("source | resultats | vues medianes | vues max | subs medians");
  for (const k of ["EN-SERIE","FR-SERIE","EN-UNITAIRE","FR-UNITAIRE","EN-IA"]) {
    const g = vids.filter((v) => v.src === k);
    if (!g.length) { console.log(`${k.padEnd(12)} |         0 | — (aucun resultat a ces seuils)`); continue; }
    console.log(`${k.padEnd(12)} | ${String(g.length).padStart(9)} | ${fmt(med(g.map(v=>v.views))).padStart(13)} | ${fmt(Math.max(...g.map(v=>v.views))).padStart(9)} | ${fmt(med(g.map(v=>v.subscribers))).padStart(12)}`);
  }
  console.log("\n-- seuils abaisses (marche FR plus petit) --");
  for (const k of ["FR-BAS","FR-IA"]) {
    const g = vids.filter((v) => v.src === k);
    console.log(`${k.padEnd(12)} | ${String(g.length).padStart(9)} | ${fmt(med(g.map(v=>v.views))).padStart(13)} | ${g.length?fmt(Math.max(...g.map(v=>v.views))):"—"}`);
  }

  // ---------- Q3 : durées ----------
  console.log("\n=== Q3 — DUREE : ou se situe la performance ? ===");
  console.log("bande | nb | vues medianes | outlier median");
  for (const [a,b] of BANDS) {
    const g = vids.filter((v) => { const m = v.duration/60; return m >= a && m < b; });
    if (!g.length) continue;
    const lbl = `${a}-${b === 999 ? "∞" : b} min`;
    console.log(`${lbl.padEnd(10)} | ${String(g.length).padStart(2)} | ${fmt(med(g.map(v=>v.views))).padStart(13)} | ${med(g.map(v=>v.outlierScore*10))/10}`);
  }
  const cible = vids.filter((v) => { const m = v.duration/60; return m >= 10 && m <= 20; });
  console.log(`\n>>> BANDE CIBLE 10-20 min : ${cible.length} videos sur ${vids.length} (${(100*cible.length/vids.length).toFixed(0)} %), vues medianes ${fmt(med(cible.map(v=>v.views)))}`);
  if (cible.length) {
    console.log("    meilleures de la bande :");
    cible.sort((a,b)=>b.views-a.views).slice(0,10).forEach(v=>
      console.log(`      ${fmt(v.views).padStart(9)} vues | ${fmt(v.subscribers).padStart(7)} subs | ${Math.round(v.duration/60)}min | ${(v.channelTitle||'').slice(0,22).padEnd(22)} | ${(v.title||'').slice(0,52)}`));
  }

  // ---------- Q2 : episodique vs unitaire ----------
  console.log("\n=== Q2 — EPISODIQUE vs UNITAIRE ===");
  const ep = vids.filter((v) => episodeNo(v.title) !== null);
  const un = vids.filter((v) => episodeNo(v.title) === null);
  console.log(`episodique : ${ep.length} videos | vues medianes ${fmt(med(ep.map(v=>v.views)))} | duree mediane ${med(ep.map(v=>Math.round(v.duration/60)))} min`);
  console.log(`unitaire   : ${un.length} videos | vues medianes ${fmt(med(un.map(v=>v.views)))} | duree mediane ${med(un.map(v=>Math.round(v.duration/60)))} min`);

  console.log("\n-- DECROISSANCE DE SERIE (les vues tiennent-elles d'un episode au suivant ?) --");
  const byCh = {};
  for (const v of ep) { (byCh[v.channelTitle] = byCh[v.channelTitle] || []).push(v); }
  const multi = Object.entries(byCh).filter(([, a]) => a.length >= 2);
  if (!multi.length) console.log("  (aucune chaine avec 2+ episodes dans le corpus — signal en soi)");
  for (const [ch, a] of multi.sort((x,y)=>y[1].length-x[1].length).slice(0,12)) {
    a.sort((x, y) => (episodeNo(x.title) || 0) - (episodeNo(y.title) || 0));
    const suite = a.map((v) => `EP${episodeNo(v.title)}:${fmt(v.views)}`).join("  ->  ");
    const prem = a[0].views, dern = a[a.length-1].views;
    const tend = prem ? ((dern/prem)*100).toFixed(0) + " %" : "?";
    console.log(`  ${ch.slice(0,24).padEnd(24)} (${fmt(a[0].subscribers)} subs) ${suite}   [dernier/premier = ${tend}]`);
  }

  console.log("\n" + "#".repeat(80));
  console.log("TOTAL UNITES:", total, "| toutes les recherches sont aussi dans data/niche-history.json");
})();
