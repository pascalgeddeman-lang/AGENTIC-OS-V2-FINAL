/**
 * Banque de Niches — collections de chaînes scrappées qui servent d'inspiration
 * aux Machines (titres, tags, descriptions, miniatures, transcripts, visions).
 * data/bank/niches.json : [{id, name, createdAt, channels: [channelId], videos: [videoId]}]
 *
 * Une niche agrège DEUX sources :
 *   - des CHAÎNES entières (toutes leurs vidéos scrappées entrent dans la niche) ;
 *   - des VIDÉOS ISOLÉES, ajoutées à l'unité depuis le Scrap-o-matic — utile quand une seule
 *     vidéo d'une chaîne hors-sujet est pertinente, ou pour un one-shot repéré au Niche Finder.
 * `videos` peut être absent des niches créées avant cette évolution : toujours lire `|| []`.
 */
const { readJSON, writeJSON } = require("./store");
const scrap = require("./scrap");

function niches() {
  return readJSON("bank/niches.json", []);
}
function save(list) {
  writeJSON("bank/niches.json", list);
}

function create(name) {
  const list = niches();
  if (list.some((n) => n.name.toLowerCase() === String(name).toLowerCase())) {
    return list.find((n) => n.name.toLowerCase() === String(name).toLowerCase());
  }
  const niche = { id: "n" + Date.now().toString(36), name: String(name), createdAt: new Date().toISOString(), channels: [], videos: [] };
  list.push(niche);
  save(list);
  return niche;
}

function remove(id) {
  save(niches().filter((n) => n.id !== id));
}

function addChannel(nicheId, channelId) {
  const list = niches();
  const n = list.find((x) => x.id === nicheId);
  if (!n) throw new Error("Niche introuvable");
  if (!n.channels.includes(channelId)) n.channels.push(channelId);
  save(list);
  return n;
}

function removeChannel(nicheId, channelId) {
  const list = niches();
  const n = list.find((x) => x.id === nicheId);
  if (n) n.channels = n.channels.filter((c) => c !== channelId);
  save(list);
}

function addVideo(nicheId, videoId) {
  const list = niches();
  const n = list.find((x) => x.id === nicheId);
  if (!n) throw new Error("Niche introuvable");
  if (!Array.isArray(n.videos)) n.videos = [];
  if (!n.videos.includes(videoId)) n.videos.push(videoId);
  save(list);
  return n;
}

function removeVideo(nicheId, videoId) {
  const list = niches();
  const n = list.find((x) => x.id === nicheId);
  if (n && Array.isArray(n.videos)) n.videos = n.videos.filter((v) => v !== videoId);
  save(list);
}

/** Agrégat complet des données scrappées de la niche (pour l'UI et les Machines). */
function summary(id) {
  const n = niches().find((x) => x.id === id);
  if (!n) throw new Error("Niche introuvable");
  const w = scrap.watchlist();
  const channels = [];
  const videos = [];
  const tagCount = {};
  let transcripts = 0;
  let visions = 0;
  for (const cid of n.channels) {
    const c = w.channels.find((x) => x.channelId === cid);
    const r = scrap.channelResult(cid);
    channels.push({
      channelId: cid,
      title: c?.title || r?.title || cid,
      subscribers: c?.subscribers || 0,
      scraped: !!r,
      videoCount: r ? r.videos.length : 0,
    });
    for (const v of r ? r.videos : []) {
      const vid = v.videoId || v.id;
      const analysis = vid ? scrap.videoResult(vid) : null;
      if (analysis?.transcript) transcripts++;
      if (analysis?.vision) visions++;
      for (const t of [...(v.tags || []), ...(v.hashtags || [])]) tagCount[t] = (tagCount[t] || 0) + 1;
      videos.push({
        videoId: vid,
        channelId: cid,
        title: v.title,
        views: Number(v.viewCount ?? v.views ?? 0),
        duration: v.duration || "",
        thumbnail: v.thumbnailUrl || "",
        description: v.description || "",
        hasTranscript: !!analysis?.transcript,
        hasVision: !!analysis?.vision,
      });
    }
  }
  // Vidéos ISOLÉES : ajoutées à l'unité, sans que leur chaîne soit dans la niche.
  // On saute celles qu'une chaîne de la niche apporte déjà (sinon doublon dans les titres).
  let standalone = 0;
  for (const vid of n.videos || []) {
    if (videos.some((v) => v.videoId === vid)) continue;
    const wv = w.videos.find((x) => x.videoId === vid);
    const analysis = scrap.videoResult(vid);
    if (analysis?.transcript) transcripts++;
    if (analysis?.vision) visions++;
    standalone++;
    videos.push({
      videoId: vid,
      channelId: wv?.channelId || null,
      channelTitle: wv?.channelTitle || "",
      standalone: true,
      title: wv?.title || analysis?.title || vid,
      views: Number(wv?.views || 0),
      duration: wv?.duration || "",
      thumbnail: wv?.thumbnail || `https://i.ytimg.com/vi/${vid}/mqdefault.jpg`,
      description: "",
      hasTranscript: !!analysis?.transcript,
      hasVision: !!analysis?.vision,
    });
  }

  videos.sort((a, b) => b.views - a.views);
  return {
    ...n,
    videos: n.videos || [],
    channels,
    standaloneCount: standalone,
    videoTotal: videos.length,
    transcripts,
    visions,
    topTags: Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([t]) => t),
    topVideos: videos.slice(0, 30),
  };
}

/**
 * Bloc d'inspiration compact injecté dans les prompts des Machines :
 * meilleurs titres, tags dominants, extraits de descriptions et de visions.
 */
function inspiration(id, { maxTitles = 15, maxVisions = 3 } = {}) {
  const s = summary(id);
  const src = [`${s.channels.length} chaîne(s) concurrente(s)`];
  if (s.standaloneCount) src.push(`${s.standaloneCount} vidéo(s) ajoutée(s) à l'unité`);
  const lines = [`[NICHE « ${s.name} » — inspiration issue de ${src.join(" + ")}]`];
  lines.push("Titres qui performent (vues) :");
  for (const v of s.topVideos.slice(0, maxTitles)) lines.push(`- ${v.title} (${v.views} vues)`);
  if (s.topTags.length) lines.push("Tags dominants : " + s.topTags.slice(0, 25).join(", "));
  const descs = s.topVideos.filter((v) => v.description).slice(0, 3);
  if (descs.length) {
    lines.push("Exemples de descriptions :");
    for (const d of descs) lines.push("- " + d.description.replace(/\s+/g, " ").slice(0, 300));
  }
  let visionsAdded = 0;
  for (const v of s.topVideos) {
    if (visionsAdded >= maxVisions) break;
    if (!v.hasVision) continue;
    const a = scrap.videoResult(v.videoId);
    if (a?.vision) {
      lines.push(`Analyse visuelle de « ${v.title} » : ` + a.vision.replace(/\s+/g, " ").slice(0, 500));
      visionsAdded++;
    }
  }
  return lines.join("\n");
}

module.exports = { niches, create, remove, addChannel, removeChannel, addVideo, removeVideo, summary, inspiration };
