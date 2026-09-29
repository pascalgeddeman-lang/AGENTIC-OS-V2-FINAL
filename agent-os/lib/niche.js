/**
 * Niche Finder — recherche de vidéos qui surperforment leur chaîne.
 * outlierScore = vues de la vidéo / moyenne des vues des vidéos PRÉCÉDENTES de la chaîne.
 * Échantillons de 500 vidéos max (10 pages search.list de 50).
 *
 * Coûts (unités) : search.list = 100/page ; videos.list, channels.list,
 * playlistItems.list = 1 par page de 50.
 */
const yt = require("./youtube");
const { readJSON, writeJSON } = require("./store");

const MAX_SCORE = 999;

function parseDurationSec(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
  if (!m) return 0;
  return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * Lance une recherche. filters :
 * { keywords: [..], publishedAfter, publishedBefore, minViews, maxSubs,
 *   excludeShorts, minOutlier, sampleSize (<=500), budget (unités max pour cette recherche) }
 */
async function search(filters, onProgress) {
  const progress = onProgress || (() => {});
  const sample = Math.min(Number(filters.sampleSize) || 500, 500);
  const budget = Number(filters.budget) || Infinity;
  let spent = 0;
  const charge = (u) => {
    spent += u;
    if (spent > budget) throw new Error(`Budget de recherche atteint (${spent} unités)`);
  };

  const q = (filters.keywords || []).filter(Boolean).join(" ");
  if (!q) throw new Error("Au moins un mot-clé requis");

  // 1) search.list paginé -> ids de vidéos (dédupliqués).
  // On ne propose QUE des vidéos longues : filtre API medium+long (>= 4 min),
  // long seul si durée min >= 20 min — jamais de Shorts.
  progress("Recherche des vidéos…");
  const minDur = Number(filters.minDurationMin) || 0;
  const durations = minDur >= 20 ? ["long"] : ["medium", "long"];
  const seenIds = new Set();
  const videoIds = [];
  for (let d = 0; d < durations.length; d++) {
    const duration = durations[d];
    // Dernière tranche : complète jusqu'à l'échantillon ; sinon part égale
    const target = d === durations.length - 1 ? sample - videoIds.length : Math.ceil(sample / durations.length);
    let collected = 0;
    let pageToken = "";
    while (videoIds.length < sample && collected < Math.max(target, 50)) {
      charge(100);
      const params = {
        part: "id",
        q,
        type: "video",
        maxResults: "50",
        order: filters.order || "relevance",
      };
      if (duration) params.videoDuration = duration;
      if (filters.publishedAfter) params.publishedAfter = new Date(filters.publishedAfter).toISOString();
      if (filters.publishedBefore) params.publishedBefore = new Date(filters.publishedBefore).toISOString();
      if (pageToken) params.pageToken = pageToken;
      const data = await yt.dataApi("search", params, 100, "Niche Finder", q);
      for (const it of data.items || []) {
        const id = it.id?.videoId;
        if (id && !seenIds.has(id)) {
          seenIds.add(id);
          videoIds.push(id);
          collected++;
        }
      }
      pageToken = data.nextPageToken;
      progress(`${videoIds.length} vidéos échantillonnées…`);
      if (!pageToken) break;
    }
  }

  // 2) videos.list -> stats + durée
  progress("Statistiques des vidéos…");
  const videos = [];
  for (const ids of chunk(videoIds.slice(0, sample), 50)) {
    charge(1);
    const data = await yt.dataApi(
      "videos",
      { part: "snippet,statistics,contentDetails", id: ids.join(","), maxResults: "50" },
      1,
      "Niche Finder"
    );
    videos.push(...(data.items || []));
  }

  // 3) Pré-filtres vidéo (vues min, shorts)
  let candidates = videos.map((v) => ({
    videoId: v.id,
    title: v.snippet.title,
    channelId: v.snippet.channelId,
    channelTitle: v.snippet.channelTitle,
    publishedAt: v.snippet.publishedAt,
    thumbnail: v.snippet.thumbnails?.medium?.url || "",
    views: Number(v.statistics?.viewCount || 0),
    duration: parseDurationSec(v.contentDetails?.duration),
  }));
  const stages = { sampled: videoIds.length, fetched: candidates.length };
  if (filters.minViews) candidates = candidates.filter((v) => v.views >= Number(filters.minViews));
  stages.afterMinViews = candidates.length;
  // Ceinture-bretelles anti-Shorts (l'API a déjà filtré medium+long)
  candidates = candidates.filter((v) => v.duration > 62 && !/#shorts/i.test(v.title));
  // Durée minimum (minutes côté UI)
  if (filters.minDurationMin) candidates = candidates.filter((v) => v.duration >= Number(filters.minDurationMin) * 60);
  stages.afterDuration = candidates.length;

  // 4) channels.list -> abonnés + playlist uploads
  progress("Analyse des chaînes…");
  const channelIds = [...new Set(candidates.map((v) => v.channelId))];
  const channels = {};
  for (const ids of chunk(channelIds, 50)) {
    charge(1);
    const data = await yt.dataApi(
      "channels",
      { part: "statistics,contentDetails,snippet", id: ids.join(","), maxResults: "50" },
      1,
      "Niche Finder"
    );
    for (const c of data.items || []) {
      channels[c.id] = {
        subscribers: Number(c.statistics?.subscriberCount || 0),
        uploads: c.contentDetails?.relatedPlaylists?.uploads,
        title: c.snippet?.title,
      };
    }
  }
  if (filters.maxSubs) {
    candidates = candidates.filter((v) => (channels[v.channelId]?.subscribers ?? Infinity) <= Number(filters.maxSubs));
  }
  stages.afterMaxSubs = candidates.length;

  // 5) Score outlier : moyenne des vues des vidéos précédentes de la chaîne
  progress(`Calcul du score outlier (${candidates.length} candidates)…`);
  const prevCache = {};
  const results = [];
  for (const v of candidates) {
    const ch = channels[v.channelId];
    if (!ch || !ch.uploads) continue;
    if (!prevCache[v.channelId]) {
      try {
        charge(2);
        const pl = await yt.dataApi(
          "playlistItems",
          { part: "contentDetails", playlistId: ch.uploads, maxResults: "50" },
          1,
          "Niche Finder"
        );
        const ids = (pl.items || []).map((i) => i.contentDetails.videoId);
        const stats = [];
        for (const part of chunk(ids, 50)) {
          const vd = await yt.dataApi(
            "videos",
            { part: "statistics,snippet", id: part.join(","), maxResults: "50" },
            1,
            "Niche Finder"
          );
          for (const x of vd.items || []) {
            stats.push({ id: x.id, views: Number(x.statistics?.viewCount || 0), publishedAt: x.snippet.publishedAt });
          }
        }
        prevCache[v.channelId] = stats;
      } catch (e) {
        prevCache[v.channelId] = [];
        if (/Budget|Quota/i.test(e.message)) throw e;
      }
    }
    // Moyenne des vidéos PRÉCÉDENTES ; si la vidéo est plus ancienne que les 50
    // derniers uploads (grosses chaînes très actives), repli sur la moyenne des
    // uploads récents hors vidéo — jamais de 999 artificiel par division par zéro.
    let base = prevCache[v.channelId].filter(
      (x) => x.id !== v.videoId && new Date(x.publishedAt) < new Date(v.publishedAt)
    );
    if (!base.length) base = prevCache[v.channelId].filter((x) => x.id !== v.videoId);
    const avg = base.length ? base.reduce((s, x) => s + x.views, 0) / base.length : 0;
    const score = avg > 0 ? Math.min(v.views / avg, MAX_SCORE) : 0;
    results.push({
      ...v,
      subscribers: ch.subscribers,
      avgPreviousViews: Math.round(avg),
      outlierScore: Math.round(score * 10) / 10,
    });
  }

  let final = results.sort((a, b) => b.outlierScore - a.outlierScore);
  if (filters.minOutlier) final = final.filter((r) => r.outlierScore >= Number(filters.minOutlier));
  stages.scored = final.length;

  const entry = {
    id: "s" + Date.now().toString(36),
    ts: new Date().toISOString(),
    query: q,
    filters,
    sampled: videoIds.length,
    stages,
    unitsSpent: spent,
    resultCount: final.length,
    results: final.slice(0, 200),
  };
  const history = readJSON("niche-history.json", []);
  history.push({ ...entry, results: entry.results.slice(0, 100) });
  writeJSON("niche-history.json", history.slice(-40));
  return entry;
}

function history() {
  return readJSON("niche-history.json", [])
    .slice()
    .reverse()
    .map(({ results, ...meta }) => ({ ...meta, top: results.slice(0, 3) }));
}

function historyEntry(id) {
  return readJSON("niche-history.json", []).find((h) => h.id === id) || null;
}

function deleteHistory(id) {
  writeJSON("niche-history.json", readJSON("niche-history.json", []).filter((h) => h.id !== id));
}

module.exports = { search, history, historyEntry, deleteHistory, MAX_SCORE };
