/**
 * SCRAP-O-MATIC — scraping YouTube local (zéro Google Sheets).
 * - Liste de suivi (chaînes + vidéos ajoutées depuis le Niche Finder)
 * - Loupe (chaîne)  : acteur Apify grow_media/youtube-channel-video-scraper
 * - Œil (vidéo)     : transcript (starvibe/youtube-video-transcript) + vision Gemini via OpenRouter
 * - Données : data/scrap/*.json (+ export CSV) ; miniatures : output/scraping/<chaîne>/
 */
const fs = require("fs");
const path = require("path");
const { DATA_DIR, ensureDir, readJSON, writeJSON } = require("./store");
const apify = require("./apify");
const vault = require("./vault");
const tasks = require("./tasks");
const spend = require("./spend");

const CHANNEL_ACTOR = "GGRZKQuor7EwBGqVo"; // grow_media/youtube-channel-video-scraper
const TRANSCRIPT_ACTOR = "Uwpce1RSXlrzF6WBA"; // starvibe/youtube-video-transcript
const VISION_MODEL = "google/gemini-3.1-flash-lite";
const VISION_COST = 0.005;

const SCRAP_DIR = path.join(DATA_DIR, "scrap");
const AVATAR_DIR = path.join(SCRAP_DIR, "avatars");
const OUTPUT_SCRAPING = path.join(__dirname, "..", "output", "scraping");
ensureDir(path.join(SCRAP_DIR, "channels"));
ensureDir(path.join(SCRAP_DIR, "videos"));
ensureDir(AVATAR_DIR);
ensureDir(OUTPUT_SCRAPING);

const safe = (s) => String(s || "sans-nom").replace(/[^\wÀ-ſ .-]+/g, "_").slice(0, 60).trim();

// ---------- Liste de suivi ----------
function watchlist() {
  return readJSON("scrap/watchlist.json", { channels: [], videos: [] });
}
function saveWatchlist(w) {
  writeJSON("scrap/watchlist.json", w);
}

/** Ajout depuis le Niche Finder (stats non scrappées, issues de la recherche). */
function add(type, item) {
  const w = watchlist();
  if (type === "channel") {
    if (w.channels.some((c) => c.channelId === item.channelId)) return { ok: true, dup: true };
    w.channels.push({
      channelId: item.channelId,
      title: item.channelTitle || item.title || "Chaîne",
      url: `https://www.youtube.com/channel/${item.channelId}`,
      subscribers: Number(item.subscribers) || 0,
      avgViews: Number(item.avgPreviousViews) || 0,
      avatar: item.avatar || null, // logo direct (ajout manuel/recherche) — sert /avatar
      totalVideos: Number(item.totalVideos) || null,
      fromVideo: item.videoId || null,
      fromSearch: item.query || null, // null = ajout manuel (pas de tag niche)
      addedAt: new Date().toISOString(),
      status: "new", // new | scraping | done | failed
      lastScrapedAt: null,
      videoCount: null,
    });
  } else {
    if (w.videos.some((v) => v.videoId === item.videoId)) return { ok: true, dup: true };
    w.videos.push({
      videoId: item.videoId,
      title: item.title || "Vidéo",
      url: `https://www.youtube.com/watch?v=${item.videoId}`,
      channelId: item.channelId || null,
      channelTitle: item.channelTitle || "",
      views: Number(item.views) || 0,
      subscribers: Number(item.subscribers) || 0,
      duration: Number(item.duration) || 0,
      publishedAt: item.publishedAt || null,
      thumbnail: item.thumbnail || "",
      outlierScore: item.outlierScore || null,
      fromSearch: item.query || null,
      addedAt: new Date().toISOString(),
      status: "new",
      lastScrapedAt: null,
    });
  }
  saveWatchlist(w);
  return { ok: true };
}

function remove(type, id) {
  const w = watchlist();
  if (type === "channel") w.channels = w.channels.filter((c) => c.channelId !== id);
  else w.videos = w.videos.filter((v) => v.videoId !== id);
  saveWatchlist(w);
}

// Sérialise les read-modify-write de la watchlist : quand plusieurs vidéos sont analysées EN
// PARALLÈLE (batch d'une chaîne), deux écritures concurrentes se clobberaient (dernier qui écrit
// gagne → statut « scraping » figé). La chaîne de promesses garantit un accès un-à-la-fois.
let wlChain = Promise.resolve();
function setStatus(type, id, patch) {
  wlChain = wlChain
    .then(() => {
      const w = watchlist();
      const item = type === "channel" ? w.channels.find((c) => c.channelId === id) : w.videos.find((v) => v.videoId === id);
      if (item) Object.assign(item, patch);
      saveWatchlist(w);
    })
    .catch(() => {});
  return wlChain;
}

// ---------- Résultats ----------
function channelResult(channelId) {
  return readJSON(`scrap/channels/${channelId}.json`, null);
}
function videoResult(videoId) {
  return readJSON(`scrap/videos/${videoId}.json`, null);
}

// ---------- Scraping chaîne (Loupe) ----------
// On ne scrape QUE les vidéos longues — jamais les Shorts.
async function scrapeChannel(channelId, { maxResults = 10 } = {}) {
  const ch = watchlist().channels.find((c) => c.channelId === channelId);
  if (!ch) throw new Error("Chaîne absente de la liste");
  setStatus("channel", channelId, { status: "scraping" });
  const task = tasks.createTask({
    title: `Scraping chaîne — ${ch.title}`,
    desc: `${maxResults} vidéos longues max (Apify)`,
    machine: "Scrap-o-matic",
    kind: "scrap",
    step: "Lancement de l'acteur Apify…",
    progress: 10,
    status: "running",
  });
  try {
    await tasks.updateTask(task.id, { step: "Scraping en cours (Apify)…", progress: 30 });
    // Coût multiplicatif : 0,005 $ PAR VIDÉO récupérée sur la chaîne
    const { items, cost } = await apify.runActor(
      CHANNEL_ACTOR,
      { channelUrls: [ch.url], maxResults, sortOrder: "latest", videoType: "long" },
      { machine: "Scrap-o-matic", note: "Scraping chaîne", costPerItem: 0.005 }
    );
    await tasks.updateTask(task.id, { step: "Téléchargement des miniatures…", progress: 70 });

    // Miniatures dans un sous-dossier par chaîne (visible dans Mes fichiers)
    const dir = path.join(OUTPUT_SCRAPING, safe(ch.title));
    ensureDir(dir);
    let thumbs = 0;
    for (const v of items.slice(0, maxResults)) {
      const url = v.thumbnailUrl || v.thumbnail || (v.thumbnails && v.thumbnails[0]?.url);
      const vid = v.videoId || v.id;
      if (!url || !vid) continue;
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          fs.writeFileSync(path.join(dir, `${safe(v.title).slice(0, 40)}-${vid}.jpg`), Buffer.from(await resp.arrayBuffer()));
          thumbs++;
        }
      } catch {}
    }

    writeJSON(`scrap/channels/${channelId}.json`, {
      channelId,
      title: ch.title,
      scrapedAt: new Date().toISOString(),
      maxResults,
      videoType: "long",
      count: items.length,
      thumbsSaved: thumbs,
      thumbsDir: `agent-os/output/scraping/${safe(ch.title)}`,
      videos: items,
    });
    setStatus("channel", channelId, {
      status: "done",
      lastScrapedAt: new Date().toISOString(),
      videoCount: items.length,
      avatar: items[0]?.channelAvatarUrl || ch.avatar || null,
      totalVideos: Number(items[0]?.channelTotalVideos) || ch.totalVideos || null,
    });
    // Logo en local (yt3.ggpht.com bloque le hotlink navigateur) — servi par /avatar
    await downloadAvatar(channelId, items[0]?.channelAvatarUrl || ch.avatar);
    await tasks.updateTask(task.id, {
      step: `${items.length} vidéos, ${thumbs} miniatures (${cost.toFixed(3)}$)`,
      progress: 100,
      status: "done",
    });
    return { count: items.length, thumbs };
  } catch (e) {
    setStatus("channel", channelId, { status: "failed" });
    await tasks.updateTask(task.id, { step: e.message, status: "failed" }).catch(() => {});
    throw e;
  }
}

// ---------- Vision (Gemini via OpenRouter) ----------
function openrouterKey() {
  const k = vault.get("openrouter");
  if (k) return k;
  try {
    const txt = fs.readFileSync(path.join(__dirname, "..", "..", ".env"), "utf8");
    const m = /^OPENROUTER=(.+)$/m.exec(txt);
    if (m) return m[1].trim();
  } catch {}
  return null;
}

async function vision(videoUrl, attempt = 1) {
  // GARDE AVANT PAIEMENT : jamais d'appel sans une URL YouTube valide (cause du gaspillage constaté).
  if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(String(videoUrl || ""))) {
    throw new Error(`Vision : URL vidéo manquante ou invalide (« ${String(videoUrl).slice(0, 60)} ») — appel annulé`);
  }
  const key = openrouterKey();
  if (!key) throw new Error("Clé OpenRouter absente (coffre ou .env)");
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              // L'URL figure AUSSI dans le texte (ceinture + bretelles : le modèle sait toujours
              // quelle vidéo est jointe, même si l'attachement est mal interprété).
              type: "text",
              text: `La vidéo YouTube jointe est : ${videoUrl}\nDécris ce qui se passe dans cette vidéo : sujet, déroulé, style visuel, ton, éléments notables (texte à l'écran, musique, montage). 500 mots minimum, en français. Ne demande JAMAIS de lien : la vidéo est jointe à ce message.`,
            },
            { type: "video_url", video_url: { url: videoUrl } },
          ],
        },
      ],
    }),
  }).then((r) => r.json());
  if (resp.error) throw new Error(`OpenRouter : ${resp.error.message || JSON.stringify(resp.error).slice(0, 200)}`);
  const text = resp.choices?.[0]?.message?.content;
  if (!text) throw new Error("Vision : réponse vide");
  // GARDE ANTI-GASPILLAGE : si le modèle dit qu'il n'a pas reçu/pu lire la vidéo, on RETENTE une
  // fois, puis on marque l'ÉCHEC — ce texte halluciné n'est JAMAIS stocké comme « analyse ».
  if (/n'avez pas fourni|pas de lien|aucun lien|fournir? (un|le) lien|cannot (access|view|watch)|unable to (access|view|watch)|je ne peux pas (analyser|accéder|visionner)|please provide (a|the) (link|video)/i.test(text.slice(0, 600))) {
    if (attempt < 2) return vision(videoUrl, attempt + 1);
    throw new Error("Vision inexploitable : le modèle n'a pas pu lire la vidéo (2 tentatives) — analyse rejetée, non stockée");
  }
  spend.record("OpenRouter", "Scrap-o-matic", VISION_COST, "USD", "Vision Gemini 3.1 Flash Lite");
  return text;
}

// ---------- Scraping vidéo (Œil = transcript + vision) ----------
// quiet : pas de tâche/notification individuelle (utilisé par les batchs)
async function scrapeVideo(videoId, { quiet = false } = {}) {
  const v = watchlist().videos.find((x) => x.videoId === videoId);
  if (!v) throw new Error("Vidéo absente de la liste");
  setStatus("video", videoId, { status: "scraping" });
  const task = quiet
    ? { id: null }
    : tasks.createTask({
        title: `Vision vidéo — ${v.title.slice(0, 60)}`,
        desc: "Transcript (Apify) + description Gemini",
        machine: "Scrap-o-matic",
        kind: "scrap",
        step: "Transcript en cours (Apify)…",
        progress: 15,
        status: "running",
      });
  const upd = (patch) => (quiet ? Promise.resolve() : tasks.updateTask(task.id, patch));
  const result = { videoId, title: v.title, url: v.url, scrapedAt: new Date().toISOString() };
  try {
    // 1) Transcript
    try {
      const { items } = await apify.runActor(
        TRANSCRIPT_ACTOR,
        { youtube_url: v.url, include_transcript_text: true },
        { machine: "Scrap-o-matic", note: "Transcript vidéo", flatCost: 0.005 }
      );
      const item = items[0] || {};
      result.transcript = item.transcript_text || item.transcript || null;
      result.transcriptLang = item.language || null;
      result.transcriptError = result.transcript ? null : "Aucun transcript disponible";
    } catch (e) {
      result.transcript = null;
      result.transcriptError = e.message;
    }
    await upd({ step: "Analyse vision (Gemini)…", progress: 60 });

    // 2) Vision — URL TOUJOURS reconstruite depuis l'id si absente (jamais d'appel sans lien)
    try {
      result.vision = await vision(v.url || `https://www.youtube.com/watch?v=${videoId}`);
      result.visionError = null;
    } catch (e) {
      result.vision = null;
      result.visionError = e.message;
    }

    if (!result.transcript && !result.vision) throw new Error(result.visionError || result.transcriptError || "Échec");
    writeJSON(`scrap/videos/${videoId}.json`, result);
    setStatus("video", videoId, { status: "done", lastScrapedAt: new Date().toISOString() });
    await upd({
      step: `${result.transcript ? "transcript ✓" : "sans transcript"} · ${result.vision ? "vision ✓" : "sans vision"}`,
      progress: 100,
      status: "done",
    });
    return result;
  } catch (e) {
    setStatus("video", videoId, { status: "failed" });
    await upd({ step: e.message, status: "failed" }).catch(() => {});
    throw e;
  }
}

// ---------- Traitement complet d'une chaîne (batch transcript + vision) ----------
// Une SEULE tâche pour tout le lot (pas de spam Telegram) ; reprend là où il en était
// (les vidéos déjà analysées sont sautées) ; continue malgré les échecs individuels.
let batchRunning = false;
async function analyzeChannelVideos(channelId) {
  const r = channelResult(channelId);
  if (!r) throw new Error("Chaîne pas encore scrappée — lance d'abord 🔍 Scraper");
  const ch = watchlist().channels.find((c) => c.channelId === channelId);
  const vids = r.videos.map((v) => ({ id: v.videoId || v.id, v })).filter((x) => x.id);

  // Inscrit les vidéos manquantes dans la liste de suivi
  {
    const w = watchlist();
    for (const { id, v } of vids) {
      if (!w.videos.some((x) => x.videoId === id)) {
        w.videos.push({
          videoId: id,
          title: v.title || "Vidéo",
          url: `https://www.youtube.com/watch?v=${id}`,
          channelId,
          channelTitle: ch?.title || r.title,
          views: Number(v.viewCount ?? v.views ?? 0),
          subscribers: ch?.subscribers || 0,
          duration: 0,
          publishedAt: v.date || null,
          thumbnail: v.thumbnailUrl || "",
          outlierScore: null,
          fromSearch: null,
          addedAt: new Date().toISOString(),
          status: "new",
          lastScrapedAt: null,
        });
      }
    }
    saveWatchlist(w);
  }

  const todo = vids.filter(({ id }) => !videoResult(id));
  const task = tasks.createTask({
    title: `Analyse complète — ${ch?.title || r.title}`,
    desc: `${todo.length} vidéos à analyser (transcript + vision) · ${(todo.length * 0.01).toFixed(2)}$`,
    machine: "Scrap-o-matic",
    kind: "scrap",
    step: "Démarrage du lot…",
    progress: 2,
    status: "running",
  });
  // Analyse EN PARALLÈLE par lots (bien plus rapide qu'une vidéo à la fois). Pool à concurrence
  // fixe : dès qu'une vidéo finit, la suivante démarre. Les échecs individuels n'arrêtent pas le lot.
  const CONCURRENCY = 6;
  let done = 0;
  let failed = 0;
  const q = todo.slice();
  const worker = async () => {
    while (q.length) {
      const { id } = q.shift();
      try {
        await scrapeVideo(id, { quiet: true });
        done++;
      } catch {
        failed++;
      }
      await tasks
        .updateTask(task.id, {
          step: `${done + failed}/${todo.length} vidéos (${failed} échecs)`,
          progress: Math.min(2 + Math.round(((done + failed) / Math.max(todo.length, 1)) * 96), 98),
        })
        .catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  await tasks.updateTask(task.id, {
    step: `${done} analysées, ${failed} échecs, ${vids.length - todo.length} déjà en cache`,
    progress: 100,
    status: "done",
  });
  return { total: vids.length, analyzed: done, failed, cached: vids.length - todo.length };
}

// ---------- Stats complètes d'une vidéo (YouTube Data API, 1 unité, mise en cache) ----------
/**
 * Ajoute UNE vidéo ciblée à la watchlist depuis son URL (ou id 11 car.) YouTube.
 * Hydrate titre/durée/chaîne via l'API Data (1 unité) puis l'ajoute comme les vidéos issues de recherche.
 */
async function addVideoByUrl(input) {
  const m = /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/.exec(String(input)) || /^([\w-]{11})$/.exec(String(input).trim());
  if (!m) throw new Error("URL YouTube invalide — colle un lien de vidéo (watch?v=…, youtu.be/…) ou un id à 11 caractères");
  const videoId = m[1];
  const w = watchlist();
  if (w.videos.some((v) => v.videoId === videoId)) return { ok: true, dup: true, videoId };
  const yt = require("./youtube");
  const data = await yt.dataApi("videos", { part: "statistics,snippet,contentDetails", id: videoId }, 1, "Scrap-o-matic", "Ajout vidéo");
  const it = data.items && data.items[0];
  if (!it) throw new Error("Vidéo introuvable sur YouTube (id " + videoId + ")");
  const dur = (() => {
    const d = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(it.contentDetails?.duration || "");
    return d ? (Number(d[1]) || 0) * 3600 + (Number(d[2]) || 0) * 60 + (Number(d[3]) || 0) : 0;
  })();
  add("video", {
    videoId,
    title: it.snippet?.title,
    channelId: it.snippet?.channelId,
    channelTitle: it.snippet?.channelTitle,
    views: Number(it.statistics?.viewCount || 0),
    duration: dur,
    publishedAt: it.snippet?.publishedAt,
    thumbnail: (it.snippet?.thumbnails?.medium || it.snippet?.thumbnails?.default || {}).url || "",
  });
  return { ok: true, videoId, title: it.snippet?.title };
}

async function videoDetails(videoId) {
  const w = watchlist();
  const v = w.videos.find((x) => x.videoId === videoId);
  if (!v) throw new Error("Vidéo absente de la liste");
  if (v.stats && v.stats.fetchedAt && v.stats.allTags) return v.stats; // allTags : anciens caches tronqués à 15 tags -> refetch une fois
  const yt = require("./youtube");
  const data = await yt.dataApi(
    "videos",
    { part: "statistics,snippet,contentDetails", id: videoId },
    1,
    "Scrap-o-matic",
    "Stats vidéo"
  );
  const it = data.items && data.items[0];
  if (!it) throw new Error("Vidéo introuvable sur YouTube");
  v.stats = {
    fetchedAt: new Date().toISOString(),
    views: Number(it.statistics?.viewCount || 0),
    likes: Number(it.statistics?.likeCount || 0),
    comments: Number(it.statistics?.commentCount || 0),
    publishedAt: it.snippet?.publishedAt || null,
    channelTitle: it.snippet?.channelTitle || v.channelTitle,
    tags: it.snippet?.tags || [],
    allTags: true,
  };
  saveWatchlist(w);
  return v.stats;
}

// ---------- Infos chaîne AVANT scraping (nb de vidéos longues, logo — 2 unités, cache) ----------
async function channelInfo(channelId, force) {
  const w = watchlist();
  const c = w.channels.find((x) => x.channelId === channelId);
  if (!c) throw new Error("Chaîne absente de la liste");
  if (!force && c.totalVideos != null && c.longVideos != null && c.avatar) {
    return { totalVideos: c.totalVideos, longVideos: c.longVideos, avatar: c.avatar, subscribers: c.subscribers };
  }
  const yt = require("./youtube");
  const data = await yt.dataApi(
    "channels",
    { part: "statistics,snippet", id: channelId },
    1,
    "Scrap-o-matic",
    "Infos chaîne"
  );
  const it = data.items && data.items[0];
  if (!it) throw new Error("Chaîne introuvable sur YouTube");
  c.totalVideos = Number(it.statistics?.videoCount || 0);
  c.avatar = it.snippet?.thumbnails?.default?.url || c.avatar || null;
  c.subscribers = Number(it.statistics?.subscriberCount || c.subscribers || 0);
  // Nb de vidéos LONGUES : playlist automatique UULF<id> (uploads long-form)
  try {
    const pl = await yt.dataApi(
      "playlists",
      { part: "contentDetails", id: "UULF" + channelId.slice(2) },
      1,
      "Scrap-o-matic",
      "Vidéos longues chaîne"
    );
    c.longVideos = pl.items && pl.items[0] ? Number(pl.items[0].contentDetails?.itemCount || 0) : 0;
  } catch {
    c.longVideos = c.longVideos ?? null;
  }
  saveWatchlist(w);
  return { totalVideos: c.totalVideos, longVideos: c.longVideos, avatar: c.avatar, subscribers: c.subscribers };
}

// ---------- Recherche/résolution d'une chaîne à ajouter à la main ----------
// Colle une URL / @handle / ID -> résolution directe (1 unité) ; sinon nom -> search (100 u) + stats (1 u).
async function searchChannels(query) {
  const q = String(query || "").trim();
  if (!q) throw new Error("Saisis un nom, une URL, un @handle ou un ID de chaîne");
  const yt = require("./youtube");
  const wl = new Set(watchlist().channels.map((c) => c.channelId));
  const pack = (items) =>
    (items || []).map((it) => ({
      channelId: it.id,
      title: it.snippet?.title || "Chaîne",
      description: (it.snippet?.description || "").replace(/\s+/g, " ").slice(0, 160),
      avatar: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url || "",
      subscribers: Number(it.statistics?.subscriberCount || 0),
      totalVideos: Number(it.statistics?.videoCount || 0),
      inList: wl.has(it.id),
    }));

  // 1) Résolution directe (URL, @handle ou ID brut) — 1 unité
  let id = null, handle = null, username = null;
  const urlM = /youtube\.com\/(?:channel\/(UC[\w-]{22})|(@[\w.\-]+)|c\/([^/?#]+)|user\/([^/?#]+))/i.exec(q);
  if (urlM) {
    if (urlM[1]) id = urlM[1];
    else if (urlM[2]) handle = urlM[2];
    else username = urlM[3] || urlM[4];
  } else if (/^UC[\w-]{22}$/.test(q)) id = q;
  else if (/^@[\w.\-]+$/.test(q)) handle = q;

  if (id || handle || username) {
    const params = { part: "snippet,statistics" };
    if (id) params.id = id;
    else if (handle) params.forHandle = handle;
    else params.forUsername = username;
    const data = await yt.dataApi("channels", params, 1, "Scrap-o-matic", "Résolution chaîne");
    const packed = pack(data.items);
    if (packed.length) return packed; // sinon (handle/username introuvable) -> repli recherche par nom
  }

  // 2) Recherche par nom : search.list (100 u) puis channels.list (1 u) pour les stats
  const s = await yt.dataApi(
    "search",
    { part: "snippet", type: "channel", q, maxResults: "10" },
    100,
    "Scrap-o-matic",
    "Recherche chaîne"
  );
  const ids = (s.items || []).map((it) => it.id?.channelId).filter(Boolean);
  if (!ids.length) return [];
  const data = await yt.dataApi(
    "channels",
    { part: "snippet,statistics", id: ids.join(","), maxResults: "10" },
    1,
    "Scrap-o-matic",
    "Stats chaînes recherche"
  );
  const byId = {};
  for (const it of data.items || []) byId[it.id] = it;
  return pack(ids.map((i) => byId[i]).filter(Boolean)); // garde l'ordre de pertinence
}

// ---------- Logo de chaîne servi en local ----------
// yt3.ggpht.com renvoie souvent 403 quand le navigateur hotlinke l'image :
// on la télécharge une fois sur disque (lien du scrap, sinon YouTube API par id).
async function downloadAvatar(channelId, url) {
  if (!url) return false;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return false;
    fs.writeFileSync(path.join(AVATAR_DIR, `${channelId}.jpg`), Buffer.from(await resp.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

async function avatarPath(channelId) {
  const f = path.join(AVATAR_DIR, `${channelId}.jpg`);
  if (fs.existsSync(f)) return f;
  const c = watchlist().channels.find((x) => x.channelId === channelId);
  if (c?.avatar && (await downloadAvatar(channelId, c.avatar))) return f;
  try {
    const info = await channelInfo(channelId, true); // lien mort -> refetch API par id
    if (info.avatar && (await downloadAvatar(channelId, info.avatar))) return f;
  } catch {}
  return null;
}

// ---------- Miniatures d'une chaîne (chemins relatifs pour /media/) ----------
function channelThumbs(channelId) {
  const ch = watchlist().channels.find((c) => c.channelId === channelId);
  if (!ch) return [];
  const dir = path.join(OUTPUT_SCRAPING, safe(ch.title));
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
      .map((f) => `agent-os/output/scraping/${safe(ch.title)}/${f}`);
  } catch {
    return [];
  }
}

// ---------- Export CSV ----------
function toCsv(rows) {
  if (!rows.length) return "";
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v) => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(";"), ...rows.map((r) => cols.map((c) => cell(r[c])).join(";"))].join("\n");
}

function exportCsv(table) {
  const w = watchlist();
  if (table === "channels") return toCsv(w.channels);
  if (table === "videos") return toCsv(w.videos);
  if (table === "channel-videos") {
    const rows = [];
    for (const c of w.channels) {
      const r = channelResult(c.channelId);
      if (r) rows.push(...r.videos.map((v) => ({ chaine: c.title, ...v })));
    }
    return toCsv(rows);
  }
  if (table === "video-results") {
    return toCsv(
      w.videos
        .map((v) => videoResult(v.videoId))
        .filter(Boolean)
        .map((r) => ({ videoId: r.videoId, title: r.title, url: r.url, transcript: r.transcript, vision: r.vision }))
    );
  }
  throw new Error("Table inconnue");
}

module.exports = {
  watchlist,
  add,
  addVideoByUrl,
  remove,
  scrapeChannel,
  scrapeVideo,
  analyzeChannelVideos,
  channelResult,
  videoResult,
  videoDetails,
  channelInfo,
  searchChannels,
  avatarPath,
  channelThumbs,
  exportCsv,
  VISION_COST,
};
