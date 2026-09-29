/**
 * YouTube Data API v3 (pool de clés + quota) et YouTube Analytics (OAuth chaîne).
 * Quota : 10 000 unités/jour PAR clé, remise à zéro à minuit heure du Pacifique.
 * Ledger : data/quota.json -> { "<jour PT>": { "<label clé>": unités } }
 */
const { readJSON, writeJSON } = require("./store");
const vault = require("./vault");
const google = require("./google");
const spend = require("./spend");

const DAILY_QUOTA = 10000;

function ptDay() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

function ledger() {
  return readJSON("quota.json", {});
}

function chargeQuota(label, units, machine, note) {
  const l = ledger();
  const day = ptDay();
  l[day] = l[day] || {};
  l[day][label] = (l[day][label] || 0) + units;
  // Ne garde que 30 jours
  const days = Object.keys(l).sort().slice(-30);
  const trimmed = {};
  for (const d of days) trimmed[d] = l[d];
  writeJSON("quota.json", trimmed);
  spend.record("YouTube Data API", machine || "Plateforme", units, "units", note);
}

function quotaStatus() {
  const keys = vault.youtubeKeys();
  const today = ledger()[ptDay()] || {};
  const perKey = keys.map((k) => ({
    label: k.label,
    used: today[k.label] || 0,
    limit: DAILY_QUOTA,
    remaining: Math.max(0, DAILY_QUOTA - (today[k.label] || 0)),
  }));
  const used = perKey.reduce((s, k) => s + k.used, 0);
  const limit = keys.length * DAILY_QUOTA;
  return { day: ptDay(), keys: perKey, used, limit, remaining: Math.max(0, limit - used) };
}

/** Choisit la clé ayant le plus de quota restant. */
function pickKey(neededUnits) {
  const keys = vault.youtubeKeys();
  if (!keys.length) throw new Error("Aucune clé API YouTube dans le coffre (page Paramètres)");
  const today = ledger()[ptDay()] || {};
  const sorted = keys
    .map((k) => ({ ...k, remaining: DAILY_QUOTA - (today[k.label] || 0) }))
    .sort((a, b) => b.remaining - a.remaining);
  if (sorted[0].remaining < (neededUnits || 1)) {
    throw new Error(`Quota YouTube épuisé pour aujourd'hui (${quotaStatus().used}/${quotaStatus().limit} unités)`);
  }
  return sorted[0];
}

/** Appel Data API avec clé (coût en unités facturé au ledger). */
async function dataApi(endpoint, params, unitCost, machine, note) {
  const key = pickKey(unitCost);
  const p = new URLSearchParams({ ...params, key: key.key });
  const resp = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}?${p}`);
  const data = await resp.json();
  if (data.error) {
    if (data.error.errors?.some((e) => e.reason === "quotaExceeded")) {
      chargeQuota(key.label, DAILY_QUOTA, machine, "quotaExceeded");
    }
    throw new Error(`YouTube API : ${data.error.message}`);
  }
  chargeQuota(key.label, unitCost, machine, note || endpoint);
  return data;
}

// ---------- Statistiques des chaînes connectées (OAuth) ----------

function periodRange(period, publishedAt) {
  const end = new Date();
  const day = (d) => d.toISOString().slice(0, 10);
  // Périodes façon YouTube Studio : 7 / 28 / 90 jours / All time (anciens alias conservés)
  const DAYS = { "7d": 7, week: 7, "28d": 28, month: 30, "90d": 91, "3months": 91 };
  let start;
  if (DAYS[period]) start = new Date(end.getTime() - DAYS[period] * 86400e3);
  else start = publishedAt ? new Date(publishedAt) : new Date("2010-01-01");
  // Dimension : jour si <= 92 jours, mois sinon (courbes cohérentes avec la période)
  const spanDays = (end - start) / 86400e3;
  const dimension = spanDays > 190 ? "month" : "day";
  return { startDate: day(start), endDate: day(end), dimension };
}

/** Série temporelle vues + abonnés d'une chaîne via YouTube Analytics. */
async function channelSeries(channelId, period) {
  const ch = google.channels().find((c) => c.channelId === channelId);
  const token = await google.channelToken(channelId);
  const { startDate, endDate, dimension } = periodRange(period, ch && ch.publishedAt);
  const p = new URLSearchParams({
    ids: `channel==${channelId}`,
    startDate,
    endDate,
    metrics: "views,subscribersGained,subscribersLost",
    dimensions: dimension,
    sort: dimension,
  });
  const data = await fetch("https://youtubeanalytics.googleapis.com/v2/reports?" + p, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  if (data.error) throw new Error(`YouTube Analytics : ${data.error.message}`);
  const rows = (data.rows || []).map((r) => ({
    date: String(r[0]),
    views: r[1] || 0,
    subs: (r[2] || 0) - (r[3] || 0),
  }));
  return { channelId, period, dimension, startDate, endDate, rows };
}

/**
 * Vues all-time PAR VIDÉO côté Analytics. Sert à isoler les vues que l'Analytics n'a pas
 * encore attribuées (~48 h de retard) : on compare compteur actuel et total Analytics
 * VIDÉO PAR VIDÉO — jamais en agrégé, car le total agrégé d'Analytics conserve les vues
 * des vidéos SUPPRIMÉES et masquerait les vues fraîches des vidéos en ligne.
 */
async function analyticsVideoTotals(channelId) {
  const token = await google.channelToken(channelId);
  const p = new URLSearchParams({
    ids: `channel==${channelId}`,
    startDate: "2010-01-01",
    endDate: new Date().toISOString().slice(0, 10),
    metrics: "views",
    dimensions: "video",
    sort: "-views",
    maxResults: "200",
  });
  const data = await fetch("https://youtubeanalytics.googleapis.com/v2/reports?" + p, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  if (data.error) throw new Error(`YouTube Analytics : ${data.error.message}`);
  const out = {};
  for (const r of data.rows || []) out[String(r[0])] = Number(r[1]) || 0;
  return out;
}

/** Vues du snapshot que l'Analytics n'a encore attribuées à AUCUN jour (comparaison par vidéo). */
async function unattributedViews(channelId, snap, base) {
  if (snap.videos) {
    const av = await analyticsVideoTotals(channelId).catch(() => null);
    if (av) return Object.entries(snap.videos).reduce((s, [id, v]) => s + Math.max(0, v - (av[id] || 0)), 0);
  }
  // Repli agrégé (snapshots pris via le compteur public, sans détail par vidéo)
  const allBase = base || (await channelSeries(channelId, "all").catch(() => null));
  const known = allBase ? allBase.rows.reduce((s, r) => s + r.views, 0) : 0;
  return Math.max(0, snap.views - known);
}

/**
 * SNAPSHOTS quotidiens des compteurs PUBLICS (Data API, 1 unité/chaîne) : la seule façon d'avoir
 * des « vrais analytics » sans le retard ~48 h de l'API Analytics. Un point par jour et par chaîne
 * dans data/stats-snapshots.json ; la série du dashboard = deltas entre snapshots (jours récents)
 * fusionnés avec l'historique Analytics (jours anciens, fiables).
 */
function loadSnaps() {
  return readJSON("stats-snapshots.json", {});
}
/**
 * Compteurs d'une chaîne côté PROPRIÉTAIRE (OAuth) : somme des vues de CHAQUE vidéo,
 * y compris privées/non répertoriées. Indispensable : le compteur public de la chaîne
 * IGNORE les vues des vidéos privées — or on publie en privé par défaut, donc sans ça
 * leurs vues resteraient invisibles jusqu'à ce qu'Analytics les rattrape (~48 h).
 * Coût : ~3 unités/chaîne (channels + playlistItems + videos), quota du projet OAuth.
 */
async function ownerCounters(channelId) {
  const token = await google.channelToken(channelId);
  const call = async (endpoint, params, units, note) => {
    const p = new URLSearchParams(params);
    const resp = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}?${p}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await resp.json();
    if (data.error) throw new Error(`YouTube API (OAuth) : ${data.error.message}`);
    chargeQuota("OAuth chaînes", units, "Dashboard", note);
    return data;
  };
  const chData = await call("channels", { part: "statistics,contentDetails", id: channelId }, 1, "Snapshot stats (chaîne)");
  const it = chData.items && chData.items[0];
  if (!it) throw new Error("Chaîne introuvable : " + channelId);
  const subs = Number(it.statistics?.subscriberCount || 0);
  const uploads = it.contentDetails?.relatedPlaylists?.uploads;
  let views = 0;
  const videos = {}; // compteur PAR vidéo — permet la comparaison vidéo par vidéo avec Analytics
  if (uploads) {
    const ids = [];
    let pageToken = "";
    for (let page = 0; page < 8; page++) { // cap 400 vidéos
      const pl = await call(
        "playlistItems",
        { part: "contentDetails", playlistId: uploads, maxResults: 50, ...(pageToken ? { pageToken } : {}) },
        1,
        "Snapshot stats (vidéos)"
      );
      ids.push(...(pl.items || []).map((x) => x.contentDetails.videoId));
      pageToken = pl.nextPageToken;
      if (!pageToken) break;
    }
    for (let i = 0; i < ids.length; i += 50) {
      const vs = await call("videos", { part: "statistics", id: ids.slice(i, i + 50).join(",") }, 1, "Snapshot stats (compteurs)");
      for (const v of vs.items || []) {
        const n = Number(v.statistics?.viewCount || 0);
        videos[v.id] = n;
        views += n;
      }
    }
  }
  return { views, subs, videos };
}

let lastSnapAt = 0;
async function recordSnapshots() {
  // Appelé au chargement de page, à chaque « Actualiser » ET toutes les 15 min : on écrase le
  // point du jour à chaque passage (compteur le plus frais). Garde anti-rafale : deux appels
  // à moins de 60 s (ex. série « all » qui itère sur chaque chaîne) = un seul relevé payé.
  if (Date.now() - lastSnapAt < 60e3) return loadSnaps();
  lastSnapAt = Date.now();
  const snaps = loadSnaps();
  const today = new Date().toISOString().slice(0, 10);
  for (const ch of google.channels()) {
    try {
      let entry;
      try {
        // Source primaire : somme par vidéo côté propriétaire (voit les vidéos privées)
        const c = await ownerCounters(ch.channelId);
        entry = { date: today, views: c.views, subs: c.subs, at: new Date().toISOString(), src: "owner", videos: c.videos };
      } catch {
        // Repli : compteur public de la chaîne (aveugle aux vidéos privées)
        const data = await dataApi("channels", { part: "statistics" , id: ch.channelId }, 1, "Dashboard", "Snapshot stats (public)");
        const it = data.items && data.items[0];
        if (!it) continue;
        entry = { date: today, views: Number(it.statistics?.viewCount || 0), subs: Number(it.statistics?.subscriberCount || 0), at: new Date().toISOString(), src: "public" };
      }
      const arr = (snaps[ch.channelId] = snaps[ch.channelId] || []);
      const i = arr.findIndex((x) => x.date === today);
      if (i >= 0) arr[i] = entry;
      else arr.push(entry);
      snaps[ch.channelId] = arr.sort((a, b) => a.date.localeCompare(b.date)).slice(-400);
    } catch {}
  }
  writeJSON("stats-snapshots.json", snaps);
  return snaps;
}
function snapshotDeltas(channelId) {
  const arr = (loadSnaps()[channelId] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const out = {};
  for (let i = 1; i < arr.length; i++) {
    // Deux méthodes de relevé coexistent (owner = somme par vidéo, public = compteur chaîne) :
    // un delta entre sources différentes serait faux (fausse pointe ou vues avalées) → on saute.
    if ((arr[i].src || "public") !== (arr[i - 1].src || "public")) continue;
    out[arr[i].date] = { views: Math.max(0, arr[i].views - arr[i - 1].views), subs: arr[i].subs - arr[i - 1].subs };
  }
  return out;
}
/**
 * Remplit CHAQUE jour (ou mois) de la plage avec un 0 si l'API n'a rien renvoyé : l'axe X
 * va toujours jusqu'à aujourd'hui et chaque date est survolable, quel que soit le mode.
 */
function fillRange(rows, startDate, endDate, dimension) {
  const map = new Map(rows.map((r) => [String(r.date), r]));
  const out = [];
  if (dimension === "day") {
    let d = new Date(startDate + "T00:00:00Z");
    const end = new Date(endDate + "T00:00:00Z");
    if ((end - d) / 86400e3 > 400) d = new Date(end.getTime() - 400 * 86400e3); // garde-fou
    for (; d <= end; d = new Date(d.getTime() + 86400e3)) {
      const k = d.toISOString().slice(0, 10);
      out.push(map.get(k) || { date: k, views: 0, subs: 0 });
    }
  } else {
    let [y, m] = startDate.slice(0, 7).split("-").map(Number);
    const endK = endDate.slice(0, 7);
    for (let guard = 0; guard < 240; guard++) {
      const k = `${y}-${String(m).padStart(2, "0")}`;
      out.push(map.get(k) || { date: k, views: 0, subs: 0 });
      if (k >= endK) break;
      m++;
      if (m > 12) { m = 1; y++; }
    }
  }
  return out;
}

/**
 * Série pour le dashboard : historique Analytics (fiable au-delà de ~48 h) + les ~4 derniers jours
 * corrigés/complétés par les deltas de snapshots publics (à jour à la minute).
 */
async function channelSeriesHybrid(channelId, period) {
  const base = await channelSeries(channelId, period).catch(() => null);
  const range = base || periodRange(period, (google.channels().find((c) => c.channelId === channelId) || {}).publishedAt);
  const rows = base ? base.rows.slice() : [];
  if ((base ? base.dimension : range.dimension) === "day") {
    const map = new Map(rows.map((r) => [r.date, r]));
    const deltas = snapshotDeltas(channelId);
    const cutoff = new Date(Date.now() - 4 * 86400e3).toISOString().slice(0, 10);
    for (const [d, v] of Object.entries(deltas)) {
      if (d < range.startDate || d > range.endDate || d < cutoff) continue;
      const r = map.get(d);
      if (!r) map.set(d, { date: d, views: v.views, subs: v.subs });
      else {
        r.views = Math.max(r.views, v.views); // la Data API fait foi sur les jours que l'Analytics n'a pas encore
        if (!r.subs) r.subs = v.subs;
      }
    }
    // Vues que l'Analytics n'a pas encore attribuées (retard ~48 h) : posées sur le jour du
    // PREMIER snapshot (l'ancre — les vues suivantes sont couvertes par les deltas). Comparées
    // VIDÉO PAR VIDÉO : additionnées (jamais max) car disjointes des lignes Analytics par
    // construction. Quand Analytics rattrape, l'extra fond vers 0 et les vues glissent sur
    // leur vrai jour — la courbe converge sans double compte.
    const snapsArr = loadSnaps()[channelId] || [];
    const anchor = snapsArr[0];
    if (anchor && anchor.date >= range.startDate && anchor.date <= range.endDate && !deltas[anchor.date]) {
      const extra = await unattributedViews(channelId, anchor, period === "all" ? base : null).catch(() => 0);
      if (extra > 0) {
        const r = map.get(anchor.date);
        if (!r) map.set(anchor.date, { date: anchor.date, views: extra, subs: 0 });
        else r.views += extra;
      }
    }
    let merged = [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
    // All time : on démarre l'axe à la première donnée réelle (pas au fallback 2010)
    let start = range.startDate;
    if (period === "all") {
      const firsts = [merged[0] && merged[0].date, (loadSnaps()[channelId] || [])[0]?.date].filter(Boolean).sort();
      if (firsts[0] && firsts[0] > start) start = firsts[0];
    }
    merged = fillRange(merged, start, range.endDate, "day");
    return { channelId, period, dimension: "day", startDate: start, endDate: range.endDate, rows: merged };
  }
  // Dimension MOIS (All time sur longue période) : le mois en cours reçoit les vues que
  // l'Analytics n'a pas encore comptées (compteur public − total Analytics connu), puis on
  // remplit tous les mois jusqu'à aujourd'hui pour que l'axe aille bien jusqu'aux dernières dates.
  const snapsArr = loadSnaps()[channelId] || [];
  const last = snapsArr[snapsArr.length - 1];
  if (last) {
    const extra = await unattributedViews(channelId, last, null).catch(() => 0);
    if (extra > 0) {
      const mk = new Date().toISOString().slice(0, 7);
      const r = rows.find((x) => String(x.date) === mk);
      if (r) r.views += extra;
      else rows.push({ date: mk, views: extra, subs: 0 });
    }
  }
  let start = range.startDate;
  const firsts = [rows[0] && String(rows[0].date), snapsArr[0] && snapsArr[0].date].filter(Boolean).sort();
  if (firsts[0] && firsts[0].slice(0, 7) > start.slice(0, 7)) start = firsts[0].slice(0, 7) + "-01";
  const filled = fillRange(rows.sort((a, b) => String(a.date).localeCompare(String(b.date))), start, range.endDate, "month");
  return { channelId, period, dimension: range.dimension, startDate: start, endDate: range.endDate, rows: filled };
}

/**
 * Stats TEMPS RÉEL d'une chaîne via l'API Data publique (clé, pas OAuth) : contrairement à
 * l'API Analytics (~48 h de retard), les compteurs de vues/abonnés sont à jour à la minute.
 * 3 unités par chaîne (channels + playlistItems + videos). Rafraîchissement manuel (cache).
 */
async function channelLive(channelId) {
  const data = await dataApi("channels", { part: "statistics,snippet,contentDetails", id: channelId }, 1, "Dashboard", "Stats chaîne (live)");
  const it = data.items && data.items[0];
  if (!it) throw new Error("Chaîne introuvable : " + channelId);
  const uploads = it.contentDetails?.relatedPlaylists?.uploads;
  let videos = [];
  if (uploads) {
    const pl = await dataApi("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: 10 }, 1, "Dashboard", "Dernières vidéos (live)").catch(() => null);
    const ids = ((pl && pl.items) || []).map((i) => i.contentDetails.videoId).join(",");
    if (ids) {
      const vs = await dataApi("videos", { part: "statistics,snippet", id: ids }, 1, "Dashboard", "Stats vidéos (live)");
      videos = (vs.items || []).map((v) => ({
        videoId: v.id,
        title: v.snippet?.title || "",
        publishedAt: v.snippet?.publishedAt || null,
        views: Number(v.statistics?.viewCount || 0),
        likes: Number(v.statistics?.likeCount || 0),
      }));
    }
  }
  return {
    channelId,
    title: it.snippet?.title || "",
    subscribers: Number(it.statistics?.subscriberCount || 0),
    totalViews: Number(it.statistics?.viewCount || 0),
    videos,
  };
}

/** Vue d'ensemble d'une chaîne connectée : stats totales + stock privé/non répertorié. */
async function channelOverview(channelId) {
  const token = await google.channelToken(channelId);
  const headers = { Authorization: `Bearer ${token}` };

  const info = await fetch(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&id=" + channelId,
    { headers }
  ).then((r) => r.json());
  if (info.error) throw new Error(info.error.message);
  const item = info.items && info.items[0];
  if (!item) throw new Error("Chaîne introuvable");

  const uploads = item.contentDetails?.relatedPlaylists?.uploads;
  let videos = [];
  if (uploads) {
    const pl = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${uploads}&maxResults=50`,
      { headers }
    ).then((r) => r.json());
    const ids = (pl.items || []).map((i) => i.contentDetails.videoId);
    if (ids.length) {
      const vd = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,status,statistics&id=${ids.join(",")}`,
        { headers }
      ).then((r) => r.json());
      videos = vd.items || [];
    }
  }
  const publicVideos = videos.filter((v) => v.status?.privacyStatus === "public");
  const stock = videos.filter((v) => ["private", "unlisted"].includes(v.status?.privacyStatus));
  const lastPublic = publicVideos
    .map((v) => v.snippet.publishedAt)
    .sort()
    .pop();
  // Dernière vidéo postée (toutes confidentialités) avec ses données détaillées — mise en avant
  // sur la page Chaînes (moment exact du post, vues, likes, commentaires, confidentialité).
  const newest = videos
    .slice()
    .sort((a, b) => String(a.snippet.publishedAt).localeCompare(String(b.snippet.publishedAt)))
    .pop();
  const lastVideo = newest
    ? {
        videoId: newest.id,
        title: newest.snippet.title,
        publishedAt: newest.snippet.publishedAt,
        privacy: newest.status?.privacyStatus || "public",
        views: Number(newest.statistics?.viewCount || 0),
        likes: Number(newest.statistics?.likeCount || 0),
        comments: Number(newest.statistics?.commentCount || 0),
        thumbnail: newest.snippet.thumbnails?.medium?.url || newest.snippet.thumbnails?.default?.url || "",
        url: "https://youtube.com/watch?v=" + newest.id,
      }
    : null;

  return {
    lastVideo,
    channelId,
    title: item.snippet.title,
    thumbnail: item.snippet.thumbnails?.default?.url || "",
    publishedAt: item.snippet.publishedAt,
    subscribers: Number(item.statistics.subscriberCount || 0),
    views: Number(item.statistics.viewCount || 0),
    videoCount: Number(item.statistics.videoCount || 0),
    stockPrivate: stock.filter((v) => v.status.privacyStatus === "private").length,
    stockUnlisted: stock.filter((v) => v.status.privacyStatus === "unlisted").length,
    lastVideoAt: lastPublic || null,
    daysSinceLastVideo: lastPublic ? Math.floor((Date.now() - new Date(lastPublic)) / 86400e3) : null,
  };
}

/** Évolution 24 h (vues + abonnés nets de la veille) via Analytics. */
async function channel24h(channelId) {
  const token = await google.channelToken(channelId);
  const day = (d) => d.toISOString().slice(0, 10);
  const end = new Date(Date.now() - 86400e3); // les données Analytics ont ~48h de latence
  const start = new Date(end.getTime() - 2 * 86400e3);
  const p = new URLSearchParams({
    ids: `channel==${channelId}`,
    startDate: day(start),
    endDate: day(end),
    metrics: "views,subscribersGained,subscribersLost",
    dimensions: "day",
    sort: "day",
  });
  const data = await fetch("https://youtubeanalytics.googleapis.com/v2/reports?" + p, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const last = (data.rows || []).slice(-1)[0];
  return last ? { views: last[1] || 0, subs: (last[2] || 0) - (last[3] || 0) } : { views: 0, subs: 0 };
}

module.exports = { dataApi, quotaStatus, chargeQuota, channelSeries, channelSeriesHybrid, recordSnapshots, channelLive, channelOverview, channel24h, periodRange };
