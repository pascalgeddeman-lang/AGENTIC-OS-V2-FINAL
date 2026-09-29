/**
 * MACHINE « Musique » — usine à vidéos musicales (calquée sur les vidéos musique Cyberpunk du
 * workflow n8n 2-11 « Automatisation musicale »).
 * Pipeline : Claude (prompts — non affichés) → 1 VISUEL (image t2i, régénérable) → MUSIQUES
 *   (Suno V5_5 via Kie /generate — 2 titres par requête, 0,06 $) → VIDÉO FINALE (FFmpeg :
 *   concat audios + image tenue + waveform colorée + titre + effet glitch + CTA Remotion)
 *   → packaging (titre/description/tags + miniature).
 * Le style musical vient de l'onglet « Style » : profils dérivés de la banque de niches
 * (mots-clés, style musical, visuels). Squelette cloné du moteur Linguistique (machine-factory).
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { readJSON, writeJSON, ensureDir, DATA_DIR } = require("../store");
const claude = require("../claude");
const google = require("../google");
const tasks = require("../tasks");
const spend = require("../spend");
const bank = require("../bank");
const vault = require("../vault");
const ff = require("../ffmpeg");

const MACHINE_ID = "musique";
const MACHINE_NAME = "Musique";
const OUT_ROOT = path.join(__dirname, "..", "..", "output", "machines");
const REMOTION_DIR = path.join(__dirname, "..", "..", "..", "remotion");
const ROOT = path.join(__dirname, "..", "..", "..");
const RUNS_DIR = path.join(DATA_DIR, "machines", "runs", MACHINE_ID);
ensureDir(OUT_ROOT);
ensureDir(RUNS_DIR);

// Suno via Kie : 0,06 $ la requête (= 2 musiques de ~3-5 min). Image/miniature via Kie t2i.
const PRICES = { sunoPerRequest: 0.06, image: 0.03 };
const MAX_TRIES = 3;
// CTA néon (compo Remotion MusiqueCta — style des vidéos cyberpunk de la formation) : question + bouton.
const MUSIC_CTA = {
  English: { question: "ENJOYING THIS MIX?", button: "SUBSCRIBE ▶" },
  "Français": { question: "TU AIMES CE MIX ?", button: "ABONNE-TOI ▶" },
  "Español": { question: "¿TE GUSTA ESTE MIX?", button: "¡SUSCRÍBETE! ▶" },
  Deutsch: { question: "GEFÄLLT DIR DER MIX?", button: "ABONNIEREN ▶" },
  Italiano: { question: "TI PIACE QUESTO MIX?", button: "ISCRIVITI ▶" },
  "Português": { question: "CURTINDO ESSE MIX?", button: "INSCREVA-SE ▶" },
};

// ---------- Claude ----------
function genModel() {
  return config().settings.promptModel || undefined;
}
const askGen = (prompt, ms = 6 * 60 * 1000) => claude.ask(prompt, { timeoutMs: ms, model: genModel() });
async function genJson(prompt, { ms = 6 * 60 * 1000, tries = 3, label = "" } = {}) {
  let last;
  for (let a = 1; a <= tries; a++) {
    try {
      return claude.parseJson(await askGen(prompt, ms));
    } catch (e) {
      if (/Annulée/.test(e.message)) throw e;
      last = e;
    }
  }
  throw new Error(`${label ? label + " : " : ""}${last ? last.message : "échec"} (après ${tries} tentatives)`);
}

// ---------- Config + styles musicaux ----------
function config() {
  return readJSON(`machines/${MACHINE_ID}.json`, {
    id: MACHINE_ID,
    name: MACHINE_NAME,
    nicheId: null,
    linkedChannelId: null,
    autoPublish: false,
    styles: [], // {id, name, nicheId, desc, sunoStyle, visualPrompt}
    settings: { imageModel: "gpt", ctaEveryMin: 5, promptModel: "" },
  });
}
function saveConfig(c) {
  writeJSON(`machines/${MACHINE_ID}.json`, c);
}
function patchConfig(patch) {
  const c = { ...config(), ...patch };
  if (patch.settings) c.settings = { ...config().settings, ...patch.settings };
  saveConfig(c);
  return c;
}
function upsertStyle(st) {
  const c = config();
  if (st.id) {
    const i = c.styles.findIndex((x) => x.id === st.id);
    if (i >= 0) c.styles[i] = { ...c.styles[i], ...st };
  } else {
    st.id = "s" + Date.now().toString(36);
    c.styles.push(st);
  }
  saveConfig(c);
  return st;
}
function removeStyle(id) {
  const c = config();
  c.styles = c.styles.filter((x) => x.id !== id);
  saveConfig(c);
}
/**
 * Analyse les MINIATURES (images) des vidéos les plus vues de la niche en UNE requête multimodale.
 * Pour une niche musique, le visuel de la vidéo = sa miniature : pas de vision vidéo, pas de
 * transcript (gaspillage constaté). On regarde directement les images.
 */
async function analyzeThumbs(nicheId, n = 8) {
  if (!nicheId) return "";
  const thumbs = nicheThumbRefs(nicheId, n);
  if (!thumbs.length) return "";
  const key = vault.get("openrouter");
  if (!key) return "";
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3.1-flash-lite",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              // Objectif : pouvoir RÉPLIQUER le style à l'identique, pas juste le décrire vaguement.
              text: [
                `Voici ${thumbs.length} miniatures des vidéos les plus vues d'une chaîne YouTube de musique concurrente. Ton analyse servira à GÉNÉRER des visuels qu'on ne doit PAS pouvoir distinguer des leurs. Sois chirurgical :`,
                "1. RÉFÉRENCES NOMMÉES : quels animes/films/artistes précis ce style évoque-t-il (ex. Ghost in the Shell, Akira, Evangelion, Gunnm/Alita, Bubblegum Crisis, OVA 90s…) ?",
                "2. TECHNIQUE : type exact de rendu (cel animation 2D, ombres franches, grain VHS, lignes d'encrage…), époque imitée.",
                "3. SUJETS RÉCURRENTS : qui/quoi apparaît sur la majorité des miniatures (ex. femmes cyborgs, armures, mechas, ville néon…) — compte-les, sois factuel.",
                "4. PALETTE : couleurs dominantes exactes (hex approximatifs) et éclairage.",
                "5. COMPOSITION : cadrage type, position du sujet, arrière-plans.",
                '6. STYLE_PROMPT_EN : UNE ligne en ANGLAIS, prête à coller dans un prompt d\'image, qui verrouille tout ça (ex. "retro 90s cyberpunk anime, Japanese sci-fi OVA cel animation, techno-noir, female cyborg, neon green-red-violet palette, slight VHS grain").',
                "Réponds en français, sections numérotées, 250-350 mots.",
              ].join("\n"),
            },
            ...thumbs.map((u) => ({ type: "image_url", image_url: { url: u } })),
          ],
        },
      ],
    }),
  }).then((r) => r.json());
  const text = resp.choices?.[0]?.message?.content || "";
  if (text) spend.record("OpenRouter", MACHINE_NAME, 0.005, "USD", `Analyse de ${thumbs.length} miniatures (style)`);
  return text;
}
/**
 * Dérive un profil de style depuis la banque de niches : titres + tags de la banque, et
 * codes visuels lus DIRECTEMENT sur les images des miniatures concurrentes (analyzeThumbs).
 */
async function deriveStyle(nicheId, hint, name) {
  const inspiration = nicheId ? bank.inspiration(nicheId, { maxTitles: 15, maxVisions: 0 }) : "";
  const thumbCodes = await analyzeThumbs(nicheId).catch(() => "");
  const p = await genJson(
    [
      "Tu définis le PROFIL DE STYLE d'une chaîne YouTube de MUSIQUE (vidéos longues : mix/compilation, une image fixe + waveform).",
      "Analyse la niche ci-dessous (titres qui performent, tags dominants) et le STYLE VISUEL observé sur les miniatures, et déduis-en le style.",
      inspiration || "(pas de banque liée : appuie-toi sur le titre et l'indice utilisateur)",
      thumbCodes ? `STYLE VISUEL OBSERVÉ sur les miniatures concurrentes (analyse d'images directe — c'est la référence) :\n${thumbCodes}` : "",
      name ? `TITRE DU STYLE donné par l'utilisateur (à conserver tel quel) : ${name}` : "",
      hint ? `Indice utilisateur : ${hint}` : "",
      "Fournis :",
      "- name : nom court du style (2-4 mots, ex. « Cyberpunk Synthwave »).",
      "- desc : 2-3 phrases EN FRANÇAIS décrivant ce qui sera créé (ambiance, tempo, instruments, à quoi ressemblera la musique) — c'est affiché à l'écran quand on choisit le style.",
      "- suno_style : la description de style pour Suno, EN ANGLAIS, riche (~40-70 mots : genre, sous-genre, tempo/BPM, instruments, ambiance, production, références d'époque).",
      "- visual_prompt : prompt image EN ANGLAIS (>= 400 caractères) pour LE visuel unique 16:9 de ce style — REPRODUIS le STYLE VISUEL OBSERVÉ ci-dessus (même technique de rendu, même palette, mêmes sujets), décor + lumière précis, style martelé, HD 4K, sans texte.",
      'RÉPONDS UNIQUEMENT EN JSON : {"name":"...","desc":"...","suno_style":"...","visual_prompt":"..."}',
    ].join("\n"),
    { tries: 3, label: "dérivation de style" }
  );
  return upsertStyle({ name: name || p.name || "Style", nicheId: nicheId || null, desc: p.desc || "", sunoStyle: p.suno_style || "", visualPrompt: p.visual_prompt || "", visualCodes: thumbCodes || "" });
}

// ---------- Runs ----------
function runPath(id) {
  return `machines/runs/${MACHINE_ID}/${id}.json`;
}
function listRuns() {
  try {
    return fs
      .readdirSync(RUNS_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJSON(runPath(f.replace(/\.json$/, "")), null))
      .filter(Boolean)
      .map(({ id, mode, status, params, theme, createdAt, pairs, cost, error }) => ({
        id, mode, status, params, theme, createdAt, error,
        pairCount: pairs ? pairs.length : 0,
        cost,
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  } catch {
    return [];
  }
}
function getRun(id) {
  const r = readJSON(runPath(id), null);
  if (!r) throw new Error("Run introuvable");
  return r;
}
function saveRun(r) {
  writeJSON(runPath(r.id), r);
}
function log(r, msg) {
  r.log = r.log || [];
  r.log.push(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
  saveRun(r);
}
function styleOf(run) {
  const st = config().styles.find((s) => s.id === run.params.styleId);
  if (!st) throw new Error("Style musical introuvable — recrée-le dans l'onglet Style");
  return st;
}

// ---------- Transports Kie (images t2i + Suno) ----------
function kieKey() {
  const k = vault.get("kie"); // même nom de champ que les autres machines / le studio
  if (!k) throw new Error("Clé Kie.ai manquante dans le coffre");
  return k;
}
const cancelledRuns = new Set();
async function kieCreate(model, input) {
  const r = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
    method: "POST",
    headers: { Authorization: `Bearer ${kieKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  }).then((x) => x.json());
  if (!r.data?.taskId) throw new Error(`Kie ${model} : ${r.msg || JSON.stringify(r).slice(0, 150)}`);
  return r.data.taskId;
}
async function kiePoll(taskId, { timeoutMs = 8 * 60 * 1000, intervalMs = 15000, runId } = {}) {
  const t0 = Date.now();
  while (true) {
    await new Promise((res) => setTimeout(res, intervalMs));
    if (runId && cancelledRuns.has(runId)) throw new Error("Annulée par l'utilisateur");
    if (Date.now() - t0 > timeoutMs) throw new Error("Kie : délai dépassé");
    const r = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`, {
      headers: { Authorization: `Bearer ${kieKey()}` },
    }).then((x) => x.json());
    const st = r.data?.state;
    if (st === "success") return JSON.parse(r.data.resultJson).resultUrls[0];
    if (st === "fail") throw new Error(`Kie : génération échouée — ${r.data?.failMsg || "raison inconnue"}`);
  }
}
async function download(url, file) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Téléchargement ${resp.status}`);
  fs.writeFileSync(file, Buffer.from(await resp.arrayBuffer()));
  return file;
}
/**
 * Reprise après crash/redémarrage : si une génération Kie était déjà en vol pour ce
 * MÊME prompt (taskId persisté dans le run), on tente de récupérer son résultat au
 * lieu d'en repayer une nouvelle. Retourne { url } si elle a fini, { taskId } si elle
 * tourne encore (on re-pollera sans recréer), null sinon (échec/inconnue/prompt changé).
 */
async function kieRecover(pending, prompt) {
  if (!pending?.id || pending.prompt !== prompt) return null;
  try {
    const r = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${pending.id}`, {
      headers: { Authorization: `Bearer ${kieKey()}` },
    }).then((x) => x.json());
    const st = r.data?.state;
    if (st === "success") return { url: JSON.parse(r.data.resultJson).resultUrls[0] };
    if (st && st !== "fail") return { taskId: pending.id };
  } catch {}
  return null;
}
// Durée média : ff.probeDuration LÈVE une erreur explicite quand ffprobe ne répond pas
// (ne renvoie jamais 0 en silence) ; ff.probeDurationSafe est réservé aux usages cosmétiques.
function runFfmpeg(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { windowsHide: true, cwd });
    let err = "";
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => reject(new Error("FFmpeg introuvable : " + e.message)));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error("FFmpeg : " + err.slice(-400)))));
  });
}

/**
 * Suno (Kie /generate) : POST → taskId, puis poll record-info jusqu'à sunoData[].audioUrl.
 * Une requête = 2 titres (~3-5 min chacun). Instrumental : flag + style martelé « no vocals ».
 */
async function sunoGenerate({ title, style, lyrics, instrumental, runId }) {
  const body = {
    model: "V5_5",
    customMode: true,
    instrumental: !!instrumental,
    style: instrumental ? `${style}. Purely instrumental, absolutely NO vocals, NO lyrics, NO singing, NO voice.` : style,
    title,
    prompt: instrumental ? "" : String(lyrics || "").slice(0, 3000),
    styleWeight: 0.65,
    weirdnessConstraint: 0.65,
    audioWeight: 0.65,
    callBackUrl: "https://your-domain.com/api/callback",
  };
  const r = await fetch("https://api.kie.ai/api/v1/generate", {
    method: "POST",
    headers: { Authorization: `Bearer ${kieKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((x) => x.json());
  const taskId = r.data?.taskId;
  if (!taskId) throw new Error(`Suno : ${r.msg || JSON.stringify(r).slice(0, 150)}`);
  const t0 = Date.now();
  while (true) {
    await new Promise((res) => setTimeout(res, 20000));
    if (runId && cancelledRuns.has(runId)) throw new Error("Annulée par l'utilisateur");
    if (Date.now() - t0 > 15 * 60 * 1000) throw new Error("Suno : délai dépassé (15 min)");
    const d = await fetch(`https://api.kie.ai/api/v1/generate/record-info?taskId=${taskId}`, {
      headers: { Authorization: `Bearer ${kieKey()}` },
    }).then((x) => x.json());
    const st = d.data?.status;
    if (/FAILED|SENSITIVE|ERROR/i.test(String(st || ""))) throw new Error(`Suno : ${st} — ${d.data?.errorMessage || "génération refusée"}`);
    const tracks = (d.data?.response?.sunoData || []).filter((t) => t.audioUrl);
    if (st === "SUCCESS" && tracks.length) return tracks.slice(0, 2);
  }
}

// ---------- Étape 1 : prompts (Claude — non affichés dans le wizard) ----------
async function generatePrompts(run) {
  const st = styleOf(run);
  const c = config();
  // maxVisions:0 — les « visions vidéo » sont inutiles ici : le style visuel vient de st.visualCodes
  // (analyse d'images des miniatures) et des références i2i.
  const inspiration = c.nicheId || st.nicheId ? bank.inspiration(st.nicheId || c.nicheId, { maxTitles: 12, maxVisions: 0 }) : "";
  const n = run.pairCount;
  const done = producedThemes();
  const p = await genJson(
    [
      `Tu prépares une VIDÉO MUSICALE longue (compilation/mix) : ${n * 2} musiques (${n} requêtes Suno de 2 titres), une seule image visuelle, waveform.`,
      `STYLE (NOYAU DUR, ne jamais s'en éloigner) : ${st.name} — ${st.sunoStyle}`,
      "Choisis TOI-MÊME l'ambiance/le thème du mix, DÉRIVÉ du style (pas d'autre entrée).",
      done.length ? `VIDÉOS DÉJÀ PRODUITES — INTERDICTION de reprendre un de ces angles/titres :\n- ${done.slice(0, 30).join("\n- ")}` : "",
      run.params.instrumental ? "TOUT est INSTRUMENTAL : aucune parole, aucun chant — martèle-le dans chaque style." : "Paroles courtes et atmosphériques autorisées.",
      inspiration,
      "Fournis :",
      `- video_title : le titre AFFICHABLE de la vidéo/du mix (accrocheur, dans l'esprit des titres de la niche).`,
      `- pairs : EXACTEMENT ${n} éléments. Chaque élément : {"title1":"...","title2":"...","style":"variation du style Suno (~40-60 mots EN, cohérente avec le NOYAU DUR mais avec une nuance propre : tempo, instrument lead, ambiance)"${run.params.instrumental ? "" : ',"lyrics":"paroles courtes communes aux 2 titres (8-16 lignes, atmosphériques)"'}}.`,
      `- visual_prompt : prompt image EN (>= 500 caractères) pour LE visuel 16:9 unique de la vidéo.`,
      st.visualCodes ? `  OBLIGATOIRE — STYLE VISUEL DES MINIATURES CONCURRENTES (analyse d'images, à REPRODUIRE : même rendu, même palette, mêmes codes) :\n${st.visualCodes}` : "",
      `  Base de style à respecter aussi : ${st.visualPrompt || st.name}. Style martelé, HD 4K, AUCUN texte dans l'image.`,
      'RÉPONDS UNIQUEMENT EN JSON : {"video_title":"...","pairs":[...],"visual_prompt":"..."}',
    ].join("\n"),
    { tries: 3, label: "prompts musique" }
  );
  if (!Array.isArray(p.pairs) || !p.pairs.length) throw new Error("Prompts : aucune paire renvoyée");
  run.theme = { title: p.video_title || (run.theme && run.theme.text) || st.name };
  run.visualPrompt = p.visual_prompt || st.visualPrompt;
  run.pairs = p.pairs.slice(0, n).map((x, k) => ({
    i: k + 1,
    title1: x.title1 || `${st.name} ${k * 2 + 1}`,
    title2: x.title2 || `${st.name} ${k * 2 + 2}`,
    style: x.style || st.sunoStyle,
    lyrics: x.lyrics || "",
    audios: null, // [{rel,file,duration,title}]
  }));
  while (run.pairs.length < n)
    run.pairs.push({ i: run.pairs.length + 1, title1: `${st.name} ${run.pairs.length * 2 + 1}`, title2: `${st.name} ${run.pairs.length * 2 + 2}`, style: st.sunoStyle, lyrics: "", audios: null });
  saveRun(run);
  log(run, `Prompts prêts : ${run.pairs.length} paire(s) — « ${run.theme.title} »`);
}

// ---------- Étape 2 : LE visuel (i2i ancré sur les miniatures concurrentes) ----------
const T2I_MODELS = { gpt: "gpt-image-2-text-to-image", nano: "nano-banana-2-lite" };
// Miniatures des vidéos les plus vues de la banque du style → RÉFÉRENCES DE STYLE i2i.
// C'est la garantie que le rendu (anime, palette, composition) colle à ce qui marche dans la niche.
function nicheThumbRefs(nicheId, n = 2) {
  try {
    if (!nicheId) return [];
    return require("../bank")
      .summary(nicheId)
      .topVideos.map((v) => v.thumbnail)
      .filter(Boolean)
      .slice(0, n);
  } catch {
    return [];
  }
}
/**
 * Génère une image ANCRÉE sur le style de la niche : les miniatures les plus vues de la banque
 * du style servent de références i2i (le t2i seul dérivait vers du générique — ici la patte,
 * la palette et le rendu des concurrents sont garantis). Repli t2i si la banque n'a pas de miniatures.
 */
async function kieStyledImage(run, prompt, outFile) {
  const c = config();
  const st = styleOf(run);
  const refs = nicheThumbRefs(st.nicheId || c.nicheId, 4); // slicé au maxImages du modèle plus bas
  // Reprise après crash : si CETTE image était déjà en vol (taskId persisté), on la récupère au lieu de repayer
  const prev = await kieRecover(run.pendingVisual, prompt);
  if (prev?.url) {
    delete run.pendingVisual;
    saveRun(run);
    await download(prev.url, outFile);
    return outFile;
  }
  let taskId = prev?.taskId || null;
  if (taskId) {
    // génération toujours en cours côté Kie : on reprend le polling sans recréer
  } else if (refs.length) {
    const conf = require("../studio").TOOLS[c.settings.imageModel === "nano" ? "nano" : "gpt"].i2i;
    // RÉPLICATION maximale : le rendu doit être INDISCERNABLE des miniatures de référence
    // (même technique, même époque imitée, même palette, mêmes types de sujets) — seule la scène change.
    const stylePreamble =
      "Replicate the EXACT art style of the reference images so faithfully that the result is indistinguishable from the same artist: identical rendering technique, era, line work, shading, color palette, lighting and subject treatment. " +
      "Create a NEW scene (do not copy their composition), but it must look like it belongs to the exact same series. ";
    const input = { prompt: (stylePreamble + prompt).slice(0, (conf.promptMax || 3000) - 80) + " No text, letters, logo or watermark anywhere in the image." };
    if (!conf.noRatio) input.aspect_ratio = "16:9";
    if (c.settings.imageModel !== "nano") input.resolution = "1K";
    input[conf.imgField || "input_urls"] = refs.slice(0, conf.maxImages || 2);
    taskId = await kieCreate(conf.model, input);
  } else {
    const model = T2I_MODELS[c.settings.imageModel] || T2I_MODELS.gpt;
    const input = { prompt: String(prompt).slice(0, 2900) + " No text, letters, logo or watermark anywhere in the image.", aspect_ratio: "16:9" };
    if (model === T2I_MODELS.gpt) input.resolution = "1K";
    taskId = await kieCreate(model, input);
  }
  if (!prev?.taskId) {
    run.pendingVisual = { id: taskId, prompt };
    saveRun(run);
  }
  const url = await kiePoll(taskId, { runId: run.id });
  delete run.pendingVisual;
  saveRun(run);
  await download(url, outFile);
  return outFile;
}
async function generateVisual(run, instructions) {
  const c = config();
  const dir = path.join(OUT_ROOT, run.id);
  ensureDir(dir);
  const model = T2I_MODELS[c.settings.imageModel] || T2I_MODELS.gpt;
  let prompt = run.visualPrompt || styleOf(run).visualPrompt || "";
  if (instructions) {
    // Codes visuels = analyse d'images des miniatures du style (jamais de « vision vidéo »)
    const st = styleOf(run);
    const p = await genJson(
      [
        "Réécris ce prompt d'image en respectant l'OBSERVATION (garde le style, >= 500 caractères, EN, sans texte dans l'image) :",
        st.visualCodes ? `STYLE VISUEL DES MINIATURES CONCURRENTES (à respecter) :\n${st.visualCodes}` : "",
        `Prompt actuel : ${prompt}`,
        `OBSERVATION (priorité absolue) : ${instructions}`,
        'RÉPONDS UNIQUEMENT EN JSON : {"visual_prompt":"..."}',
      ].join("\n"),
      { tries: 2, label: "réécriture visuel" }
    ).catch(() => null);
    if (p && p.visual_prompt) prompt = p.visual_prompt;
  }
  run.visualRendering = true;
  saveRun(run);
  try {
    const file = path.join(dir, "visual.png");
    await kieStyledImage(run, prompt, file);
    run.visualPrompt = prompt;
    run.visual = { rel: `agent-os/output/machines/${run.id}/visual.png`, ts: Date.now() };
    run.cost.images += PRICES.image;
    spend.record("Kie.ai", MACHINE_NAME, PRICES.image, "USD", "Visuel principal");
  } finally {
    delete run.visualRendering;
    saveRun(run);
  }
}

// ---------- Étape 3 : musiques (Suno, paire par paire) ----------
async function generatePair(run, pair) {
  const dir = path.join(OUT_ROOT, run.id);
  ensureDir(dir);
  pair.rendering = true;
  saveRun(run);
  try {
    const fileOf = (k) => path.join(dir, `mus-${pair.i}${k ? "b" : "a"}.mp3`);
    // Ne JAMAIS repayer Suno pour un échec qui n'est pas le sien : si les pistes de cette paire
    // ont déjà été générées ET téléchargées (échec sur le sondage de durée, par exemple),
    // on réutilise les fichiers du disque au lieu de relancer la génération.
    let tracks = pair.pendingTracks;
    if (!(tracks && tracks.length && tracks.every((_, k) => fs.existsSync(fileOf(k))))) {
      tracks = await sunoGenerate({
        title: pair.title1,
        style: pair.style,
        lyrics: pair.lyrics,
        instrumental: !!run.params.instrumental,
        runId: run.id,
      });
      for (let k = 0; k < tracks.length; k++) await download(tracks[k].audioUrl, fileOf(k));
      pair.pendingTracks = tracks;
      run.cost.music += PRICES.sunoPerRequest;
      saveRun(run);
      spend.record("Kie.ai", MACHINE_NAME, PRICES.sunoPerRequest, "USD", `Suno paire ${pair.i} (2 titres)`);
    }
    const audios = [];
    for (let k = 0; k < tracks.length; k++) {
      audios.push({
        rel: `agent-os/output/machines/${run.id}/mus-${pair.i}${k ? "b" : "a"}.mp3`,
        file: fileOf(k),
        // La durée pilote le montage : un titre sans durée mesurable n'est pas exploitable.
        duration: await ff.probeDuration(fileOf(k), { label: `Musique ${pair.i}${k ? "b" : "a"}` }),
        title: k === 0 ? pair.title1 : pair.title2,
        ts: Date.now(),
      });
    }
    pair.audios = audios;
    delete pair.pendingTracks;
    delete pair.error;
  } finally {
    delete pair.rendering;
    saveRun(run);
  }
}
async function genPairWithRetry(run, pair) {
  let last;
  for (let a = 1; a <= MAX_TRIES; a++) {
    try {
      return await generatePair(run, pair);
    } catch (e) {
      if (/Annulée/.test(e.message)) throw e;
      last = e;
      pair.error = e.message;
      saveRun(run);
      log(run, `Paire ${pair.i} : tentative ${a}/${MAX_TRIES} échouée (${e.message.slice(0, 90)})`);
    }
  }
  throw last;
}
async function pool(items, worker, concurrency = 3) {
  const q = items.slice();
  let aborted = null;
  const runOne = async () => {
    while (q.length && !aborted) {
      const item = q.shift();
      try {
        await worker(item);
      } catch (e) {
        aborted = e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, q.length) }, runOne));
  if (aborted) throw aborted;
}
async function stepMusic(run) {
  const pend = run.pairs.filter((p) => !p.audios);
  if (!pend.length) return;
  log(run, `Génération Suno : ${pend.length} requête(s) (2 titres chacune), 3 en parallèle…`);
  const tick = () => {
    const done = run.pairs.filter((p) => p.audios).length;
    tasks.updateTask(run.taskId, { step: `Musiques : ${done * 2}/${run.pairs.length * 2}…`, progress: 30 + Math.round((40 * done) / run.pairs.length), status: "running" }).catch(() => {});
  };
  await pool(pend, (p) => genPairWithRetry(run, p).then(tick), 3);
  // DEUXIÈME VAGUE puis VERROU (même règle que la machine Linguistique) : un échec en masse est
  // presque toujours transitoire, on relance après une pause ce qui manque SEULEMENT ; et si ça
  // manque encore, l'étape n'est pas franchie — jamais de montage avec un pipeline troué.
  let missing = run.pairs.filter((p) => !p.audios);
  if (missing.length) {
    log(run, `⚠ ${missing.length} paire(s) sans audio — pause de 20 s, puis deuxième vague sur ces paires seules…`);
    await new Promise((r) => setTimeout(r, 20000));
    if (cancelledRuns.has(run.id)) throw new Error("Annulée par l'utilisateur");
    await pool(missing, (p) => genPairWithRetry(run, p).then(tick), 3);
    missing = run.pairs.filter((p) => !p.audios);
  }
  if (!missing.length) return;
  const why = (missing.find((p) => p.error) || {}).error || "cause inconnue";
  const msg = `${missing.length}/${run.pairs.length} paire(s) sans audio (requête ${missing.slice(0, 8).map((p) => p.i).join(", ")}) — ${why}`;
  if (run.mode === "auto") throw new Error(`${msg}. Étape non franchie : corrige la cause, puis « Reprendre ».`);
  log(run, `⚠ ${msg} — régénère-les (↻) avant de valider.`);
}

/**
 * PRÉCALCUL de la waveform (64 bandes de fréquences par frame) côté Node : FFT offline sur le PCM.
 * Pourquoi : useWindowedAudioData bloque le rendu au changement de fenêtre (constaté 2×, frame ~900).
 * La compo lit un JSON statique → zéro décodage audio dans Chrome, rendu déterministe et rapide.
 */
async function computeWaveformData(wavFile, totalSec, outFile) {
  const fps = 30, BARS = 64, SR = 16000, WIN = 1024;
  const dir2 = path.dirname(wavFile);
  const pcm = path.join(dir2, "wave.pcm");
  await runFfmpeg(["-y", "-i", path.basename(wavFile), "-f", "s16le", "-ac", "1", "-ar", String(SR), "wave.pcm"], dir2);
  const buf = fs.readFileSync(pcm);
  const N = Math.floor(buf.length / 2);
  const samples = new Float32Array(N);
  for (let i = 0; i < N; i++) samples[i] = buf.readInt16LE(i * 2) / 32768;
  const frames = Math.max(1, Math.round(totalSec * fps));
  const levels = Math.log2(WIN);
  const rev = new Uint32Array(WIN);
  for (let i = 0; i < WIN; i++) {
    let r = 0;
    for (let b = 0; b < levels; b++) r = (r << 1) | ((i >> b) & 1);
    rev[i] = r;
  }
  const hann = new Float32Array(WIN);
  for (let i = 0; i < WIN; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1));
  const re = new Float32Array(WIN), im = new Float32Array(WIN);
  const half = WIN / 2;
  const edges = [];
  for (let b = 0; b <= BARS; b++) edges.push(Math.max(1, Math.round(Math.pow(half, b / BARS))));
  const out = Buffer.alloc(frames * BARS);
  const MIN_DB = -70, MAX_DB = -14;
  for (let f = 0; f < frames; f++) {
    const center = Math.round((f / fps) * SR);
    for (let i = 0; i < WIN; i++) {
      const s = samples[center + i - half] || 0;
      re[rev[i]] = s * hann[i];
      im[rev[i]] = 0;
    }
    for (let size = 2; size <= WIN; size <<= 1) {
      const h2 = size >> 1;
      const step = (-2 * Math.PI) / size;
      for (let i = 0; i < WIN; i += size) {
        for (let j = 0; j < h2; j++) {
          const a = step * j;
          const wr = Math.cos(a), wi = Math.sin(a);
          const k = i + j, l = k + h2;
          const tr = re[l] * wr - im[l] * wi;
          const ti = re[l] * wi + im[l] * wr;
          re[l] = re[k] - tr;
          im[l] = im[k] - ti;
          re[k] += tr;
          im[k] += ti;
        }
      }
    }
    for (let b = 0; b < BARS; b++) {
      let sum = 0, n = 0;
      for (let k = edges[b]; k < Math.max(edges[b] + 1, edges[b + 1]); k++) {
        sum += Math.hypot(re[k], im[k]);
        n++;
      }
      const mag = sum / Math.max(1, n) / (WIN / 4);
      const db = 20 * Math.log10(Math.max(mag, 1e-10));
      out[f * BARS + b] = Math.round(Math.min(1, Math.max(0, (db - MIN_DB) / (MAX_DB - MIN_DB))) * 255);
    }
  }
  fs.writeFileSync(outFile, JSON.stringify({ fps, bars: BARS, frames, data: out.toString("base64") }));
  try { fs.unlinkSync(pcm); } catch {}
}

// ---------- Étape 4 : montage 100 % REMOTION (compo MusiqueMontage, recette de la leçon SynthwaveMix) ----------
// Fond image + waveform AUDIO-RÉACTIVE (64 barres, couleur choisie ou dégradé) + CTA néon périodique
// + effets (glitch/kenburns) — rendu directement en MP4. Pas d'OffthreadVideo (image fixe) : pas de gel.
// FFmpeg ne sert plus qu'à concaténer les audios. Chemins RELATIFS + cwd, props JSON sans BOM (règles connues).
async function renderMontage(run) {
  const dir = path.join(OUT_ROOT, run.id);
  const ready = run.pairs.filter((p) => p.audios && p.audios.length).sort((a, b) => a.i - b.i);
  if (!ready.length) throw new Error("Aucune musique à monter");
  if (!run.visual) throw new Error("Pas de visuel — génère-le d'abord");
  const c = config();
  const fx = run.params.effects || [];
  const fxList = Array.isArray(fx) ? fx : Object.keys(fx).filter((k) => fx[k]);

  // 1) Concat de TOUS les audios (méthode n8n : d'abord l'audio, la vidéo prend SA durée)
  const listFile = path.join(dir, "concat.txt");
  const allAudios = ready.flatMap((p) => p.audios);
  fs.writeFileSync(listFile, allAudios.map((a) => `file '${path.basename(a.file)}'`).join("\n"), "utf8");
  log(run, `Montage : concaténation de ${allAudios.length} musiques…`);
  // WAV OBLIGATOIRE : useWindowedAudioData (waveform) ne fait des lectures partielles que sur du
  // .wav — un m4a/AAC bloque le rendu à la frame 0 (constaté : 30 min sans une seule frame).
  await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", "concat.txt", "-c:a", "pcm_s16le", "-ar", "44100", "full-audio.wav"], dir);
  const total = (await ff.probeDurationSafe(path.join(dir, "full-audio.wav"))) || allAudios.reduce((s, a) => s + a.duration, 0);

  // 2) Assets copiés dans remotion/public/<rel>/ (staticFile) + props
  const rel = `mus-${run.id}`;
  const pubDir = path.join(REMOTION_DIR, "public", rel);
  ensureDir(pubDir);
  fs.copyFileSync(path.join(dir, "visual.png"), path.join(pubDir, "visual.png"));
  fs.copyFileSync(path.join(dir, "full-audio.wav"), path.join(pubDir, "full-audio.wav"));
  if (run.params.waveform !== false) {
    log(run, "Précalcul de la waveform (FFT offline, 64 bandes)…");
    await computeWaveformData(path.join(dir, "full-audio.wav"), total, path.join(pubDir, "waveform.json"));
  }
  const props = {
    dir: rel,
    image: "visual.png",
    audio: "full-audio.wav",
    waveData: "waveform.json",
    durationSec: Math.round(total * 1000) / 1000,
    waveform: run.params.waveform !== false,
    waveColor: run.params.waveColor || "gradient",
    cta: run.params.cta ? MUSIC_CTA[run.params.ctaLanguage] || MUSIC_CTA.English : null,
    ctaEverySec: (Number(c.settings.ctaEveryMin) || 5) * 60,
    effects: fxList,
  };
  fs.writeFileSync(path.join(REMOTION_DIR, rel + ".json"), JSON.stringify(props), "utf8"); // sans BOM

  // 3) Rendu Remotion (long sur un gros mix — assumé : c'est le prix du rendu propre)
  log(run, `Montage Remotion : ${allAudios.length} musiques · ${Math.round(total / 60)} min · waveform ${props.waveform ? (props.waveColor === "gradient" ? "dégradé" : props.waveColor) : "off"}${props.cta ? " + CTA néon" : ""}${fxList.length ? " + " + fxList.join(", ") : ""} — rendu en cours (peut prendre longtemps)…`);
  await new Promise((resolve, reject) => {
    const child = spawn("npx", ["remotion", "render", "MusiqueMontage", rel + ".mp4", `--props=${rel}.json`], { cwd: REMOTION_DIR, shell: true, windowsHide: true });
    let err = "";
    let lastPct = -1;
    // CRUCIAL : consommer stdout. Remotion y écrit sa progression ; sans lecteur, le tampon du pipe
    // (64 Ko) se remplit vers la frame ~900 et le rendu SE FIGE en écriture (3 gels constatés).
    child.stdout.on("data", (d) => {
      const m = /Rendered (\d+)\/(\d+)/.exec(d.toString());
      if (m) {
        const pct = Math.round((+m[1] / +m[2]) * 100);
        if (pct !== lastPct && pct % 2 === 0) {
          lastPct = pct;
          tasks.updateTask(run.taskId, { step: `Montage Remotion : ${pct}% (${m[1]}/${m[2]} frames)`, progress: 78 + Math.round(pct * 0.12), status: "running" }).catch(() => {});
        }
      }
    });
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => reject(e));
    child.on("close", (code) => (code === 0 && fs.existsSync(path.join(REMOTION_DIR, rel + ".mp4")) ? resolve() : reject(new Error("Remotion : " + err.slice(-400)))));
  });
  fs.copyFileSync(path.join(REMOTION_DIR, rel + ".mp4"), path.join(dir, "final.mp4"));
  try {
    fs.unlinkSync(path.join(REMOTION_DIR, rel + ".mp4"));
    fs.unlinkSync(path.join(REMOTION_DIR, rel + ".json"));
    fs.rmSync(pubDir, { recursive: true, force: true });
    fs.unlinkSync(path.join(dir, "full-audio.wav")); // ~400 Mo de WAV intermédiaire, plus utile
  } catch {}
  return path.join(dir, "final.mp4");
}

// ---------- Tags cap 500 ----------
function capTags(tags, max = 500) {
  const out = [];
  let len = 0;
  for (const t of (tags || []).map((x) => String(x).trim()).filter(Boolean)) {
    const add = (out.length ? 2 : 0) + t.length;
    if (len + add > max) break;
    out.push(t);
    len += add;
  }
  return out;
}

// ---------- Étape 5 : packaging ----------
async function generatePackaging(run) {
  const st = styleOf(run);
  const c = config();
  const inspiration = st.nicheId || c.nicheId ? bank.inspiration(st.nicheId || c.nicheId, { maxTitles: 15, maxVisions: 0 }) : "";
  const tracklist = run.pairs.flatMap((p) => (p.audios || []).map((a) => ({ t: a.title, d: Math.round(a.duration) })));
  const p = claude.parseJson(
    await askGen(
      [
        "Tu prépares la PUBLICATION YouTube d'une vidéo musicale (mix/compilation, image fixe + waveform).",
        `Style : ${st.name}. Titre de travail : ${JSON.stringify(run.theme?.title)}. ${tracklist.length} pistes.`,
        `Pistes : ${JSON.stringify(tracklist)}`,
        inspiration,
        "Fournis :",
        "- title : titre YouTube aux codes de la niche musique (style, ambiance, durée, « mix », année…). Vise 70-100 caractères, max 100.",
        "- description : accroche + TRACKLIST avec timestamps calculés depuis les durées des pistes (00:00 Piste 1…), + 3-5 hashtags. Max 2000 caractères.",
        "- tags : BEAUCOUP de mots-clés musique (genre, mood, usage : study, gaming, sleep…). Vise 480-500 caractères joints par virgules (max 500).",
        "- thumb_prompt : prompt EN (>= 250 caractères) pour la miniature : reprends le VISUEL du style (même ambiance que l'image de la vidéo), couleurs saturées, composition forte, AUCUN texte." + (st.visualCodes ? `\n  STYLE VISUEL DES MINIATURES CONCURRENTES (à reproduire) : ${st.visualCodes.slice(0, 800)}` : ""),
        'RÉPONDS UNIQUEMENT EN JSON : {"title":"...","description":"...","tags":["..."],"thumb_prompt":"..."}',
      ].join("\n"),
      5 * 60 * 1000
    )
  );
  run.pack = { title: p.title || run.theme?.title || st.name, description: p.description || "", tags: capTags(Array.isArray(p.tags) ? p.tags : []) };
  saveRun(run);
  // Miniature = LA MÊME IMAGE que le visuel de la vidéo (cohérence voulue pour cette niche,
  // et une génération de moins). Le bouton 🎨 Régénérer reste là pour faire une variante si besoin.
  run.pack.thumbRel = run.visual ? run.visual.rel : null;
  run.pack.thumbTs = Date.now();
  saveRun(run);
  log(run, `Packaging prêt : « ${run.pack.title} »`);
}
async function regenTexts(runId, instructions, field) {
  const run = getRun(runId);
  const st = styleOf(run);
  const inspiration = st.nicheId ? bank.inspiration(st.nicheId, { maxTitles: 15, maxVisions: 0 }) : "";
  const SPECS = {
    title: "- title : codes de la niche musique, 70-100 caractères max 100.",
    description: "- description : accroche + tracklist timestamps + hashtags, max 2000 caractères.",
    tags: "- tags : mots-clés musique, 480-500 caractères joints (max 500).",
  };
  const one = SPECS[field] ? field : null;
  const specLines = one ? [SPECS[one]] : [SPECS.title, SPECS.description, SPECS.tags];
  const schema = one ? (one === "tags" ? '{"tags":["..."]}' : `{"${one}":"..."}`) : '{"title":"...","description":"...","tags":["..."]}';
  const p = claude.parseJson(
    await askGen(
      [
        `Améliore le packaging YouTube de cette vidéo musicale (${st.name}).`,
        run.pack ? `Actuel : « ${run.pack.title} »` : "",
        instructions ? `OBSERVATION : ${instructions}` : "Propose une variante plus accrocheuse.",
        inspiration,
        ...specLines,
        "RÉPONDS UNIQUEMENT EN JSON : " + schema,
      ].join("\n"),
      4 * 60 * 1000
    )
  );
  run.pack = run.pack || {};
  if ((!one || one === "title") && p.title) run.pack.title = p.title;
  if ((!one || one === "description") && typeof p.description === "string") run.pack.description = p.description;
  if ((!one || one === "tags") && Array.isArray(p.tags) && p.tags.length) run.pack.tags = capTags(p.tags);
  saveRun(run);
  return getRun(runId);
}
async function regenThumbnail(runId, instructions) {
  const run = getRun(runId);
  const dir = path.join(OUT_ROOT, run.id);
  const base = `${run.visualPrompt || ""} YouTube thumbnail version: saturated colors, strong composition, dramatic lighting.`;
  const prompt = instructions ? `${base} IMPORTANT: ${instructions}` : base;
  await kieStyledImage(run, prompt, path.join(dir, "thumbnail.png"));
  run.pack = run.pack || {};
  run.pack.thumbRel = `agent-os/output/machines/${run.id}/thumbnail.png`;
  run.pack.thumbTs = Date.now();
  run.cost.images += PRICES.image;
  spend.record("Kie.ai", MACHINE_NAME, PRICES.image, "USD", "Miniature (régénération)");
  saveRun(run);
  return getRun(runId);
}

// ---------- Stock + publication ----------
function stock() {
  return readJSON(`machines/${MACHINE_ID}-stock.json`, []);
}
function patchStock(entryId, patch = {}) {
  const list = stock();
  const v = list.find((x) => x.id === entryId || x.runId === entryId);
  if (!v) throw new Error("Vidéo introuvable dans le stock");
  if (patch.archived !== undefined) v.archived = !!patch.archived;
  if (patch.posted !== undefined) {
    v.posted = !!patch.posted;
    if (v.posted && !v.postedAt) v.postedAt = new Date().toISOString();
    if (!v.posted) { v.postedAt = null; v.videoId = null; v.channelId = null; }
  }
  writeJSON(`machines/${MACHINE_ID}-stock.json`, list);
  return v;
}
function addToStock(run) {
  const list = stock();
  if (list.some((v) => v.runId === run.id)) return;
  list.push({
    id: "v" + Date.now().toString(36),
    runId: run.id,
    title: run.pack?.title || run.theme?.title || run.id,
    description: run.pack?.description || "",
    tags: run.pack?.tags || [],
    thumbRel: run.pack?.thumbRel || null,
    finalRel: run.finalRel,
    language: run.params.ctaLanguage || "",
    durationSec: null,
    createdAt: new Date().toISOString(),
    posted: false, channelId: null, videoId: null,
  });
  writeJSON(`machines/${MACHINE_ID}-stock.json`, list);
}
async function publishRun(runId, { channelId, title, description, tags, privacyStatus } = {}) {
  const run = getRun(runId);
  if (!run.finalRel) throw new Error("Pas de vidéo finale à publier");
  if (!channelId) throw new Error("Choisis une chaîne");
  const finalTitle = (title || run.pack?.title || "Music mix").slice(0, 100);
  const vid = await google.youtubeUpload(channelId, path.join(ROOT, run.finalRel), {
    title: finalTitle,
    description: description || run.pack?.description || "",
    tags: capTags(tags && tags.length ? tags : run.pack?.tags || []),
    categoryId: "10", // Musique
    privacyStatus: privacyStatus || "private",
  });
  if (run.pack?.thumbRel) {
    try { await google.youtubeSetThumbnail(channelId, vid.id, path.join(ROOT, run.pack.thumbRel)); }
    catch (e) { log(run, "⚠ " + e.message + " — la vidéo est en ligne, pose la miniature à la main."); }
  }
  const list = stock();
  const entry = list.find((v) => v.runId === run.id);
  if (entry) {
    entry.posted = true;
    entry.postedAt = new Date().toISOString();
    entry.channelId = channelId;
    entry.videoId = vid.id;
    if (title) entry.title = finalTitle;
    writeJSON(`machines/${MACHINE_ID}-stock.json`, list);
  }
  tasks.emit("video_published", { title: finalTitle, machine: MACHINE_NAME, kind: "video", detail: "https://youtube.com/watch?v=" + vid.id }).catch(() => {});
  log(run, "Publiée sur YouTube : https://youtube.com/watch?v=" + vid.id);
  return { videoId: vid.id, url: "https://youtube.com/watch?v=" + vid.id };
}

// ---------- Orchestration ----------
const activeAdvance = new Set();
function cancelRun(id) {
  const run = getRun(id);
  cancelledRuns.add(id);
  if (run.status !== "done" && run.status !== "failed" && !run.cancelledFrom) run.cancelledFrom = run.status;
  tasks.updateTask(run.taskId, { step: "Annulée par l'utilisateur", status: "failed" }).catch(() => {});
  if (!activeAdvance.has(id)) {
    run.status = "failed";
    run.error = "Annulée par l'utilisateur";
    log(run, "Run annulé");
    saveRun(run);
  } else {
    saveRun(run);
    log(run, "Annulation demandée — abandon des requêtes en cours…");
  }
  return getRun(id);
}
function deriveStatus(run) {
  if (!run.pairs || !run.pairs.length) return "prompts_running";
  if (!run.visual) return "visual_running";
  if (run.pairs.some((p) => !p.audios)) return "music_running";
  if (!run.finalRel) return "montage_running";
  if (!run.pack) return "packaging_running";
  return "done";
}
function resumeRun(id, forcedStatus) {
  if (activeAdvance.has(id)) throw new Error("Le run tourne déjà — la décharge ⚡ n'est utile que s'il est à l'arrêt.");
  const run = getRun(id);
  cancelledRuns.delete(id);
  const status = forcedStatus || run.cancelledFrom || (run.status === "failed" ? deriveStatus(run) : run.status);
  run.status = status;
  run.error = null;
  delete run.cancelledFrom;
  delete run.visualRendering;
  (run.pairs || []).forEach((p) => delete p.rendering);
  saveRun(run);
  log(run, `Reprise à l'étape « ${status.replace("_running", " (en cours)").replace("_ready", " (validé)")} »`);
  advance(run.id);
  return getRun(id);
}
async function advance(runId) {
  cancelledRuns.delete(runId);
  activeAdvance.add(runId);
  const run = getRun(runId);
  const auto = run.mode === "auto";
  let curStep = run.status;
  const t = (patch) => tasks.updateTask(run.taskId, Object.assign({ status: "running" }, patch)).catch(() => {});
  try {
    // Préflight : ffmpeg/ffprobe doivent répondre AVANT de dépenser en visuel et en musiques.
    await ff.ensureTools();
    while (true) {
      curStep = run.status;
      if (cancelledRuns.has(runId)) throw new Error("Annulée par l'utilisateur");
      if (run.status === "prompts_running") {
        await t({ step: "Écriture des prompts (Claude)…", progress: 8 });
        await generatePrompts(run);
        run.status = "visual_running";
      } else if (run.status === "visual_running") {
        await t({ step: "Génération du visuel…", progress: 18 });
        await generateVisual(run);
        run.status = auto ? "music_running" : "visual_ready";
      } else if (run.status === "music_running") {
        await t({ step: "Suno génère les musiques…", progress: 32 });
        await stepMusic(run);
        run.status = auto ? "montage_running" : "music_ready";
      } else if (run.status === "montage_running") {
        await t({ step: "Montage final (FFmpeg)…", progress: 78 });
        const out = await renderMontage(run);
        run.finalRel = `agent-os/output/machines/${run.id}/final.mp4`;
        run.status = "packaging_running";
        log(run, "Montage terminé : " + out);
      } else if (run.status === "packaging_running") {
        await t({ step: "Packaging : titre, description, tags, miniature…", progress: 92 });
        await generatePackaging(run);
        addToStock(run);
        run.status = "done";
        log(run, "Vidéo ajoutée au stock");
        if (run.params.publishChannelId) {
          await t({ step: "Publication YouTube…", progress: 97 });
          try {
            const r = await publishRun(run.id, { channelId: run.params.publishChannelId, privacyStatus: run.params.publishPrivacy || "private" });
            run.published = { url: r.url, videoId: r.videoId, channelId: run.params.publishChannelId, privacy: run.params.publishPrivacy || "private", at: new Date().toISOString() };
            saveRun(run);
            log(run, "Publication auto : " + r.url);
          } catch (e) {
            run.published = { error: e.message, at: new Date().toISOString() };
            saveRun(run);
            log(run, "Publication auto échouée : " + e.message + " — la vidéo reste dans le stock");
          }
        }
      } else break;
      saveRun(run);
      if (!auto && ["visual_ready", "music_ready"].includes(run.status)) break;
      if (run.status === "done") break;
    }
    if (run.status === "done") {
      await t({ step: `Vidéo musicale prête (${run.pairs.length * 2} pistes, ${(run.cost.images + run.cost.music).toFixed(2)}$)`, progress: 100, status: "done" });
    } else if (!auto) {
      const pcts = { visual_ready: 28, music_ready: 74 };
      await t({ step: `En attente de validation (${run.status.replace("_ready", "")})`, progress: pcts[run.status] || 50 });
    }
  } catch (e) {
    const cancelled = cancelledRuns.has(runId) || /Annulée/.test(e.message);
    const fresh = getRun(runId);
    fresh.status = "failed";
    fresh.error = cancelled ? "Annulée par l'utilisateur" : e.message;
    if (cancelled && !fresh.cancelledFrom) fresh.cancelledFrom = curStep;
    delete fresh.visualRendering;
    (fresh.pairs || []).forEach((p) => delete p.rendering);
    log(fresh, cancelled ? "Run annulé — requêtes en cours abandonnées" : "ÉCHEC : " + e.message);
    saveRun(fresh);
    await t({ step: fresh.error, status: "failed" });
  } finally {
    activeAdvance.delete(runId);
  }
  return getRun(runId);
}

function createRun(body = {}) {
  const c = config();
  const { styleId, theme, musicCount, instrumental, waveform, waveColor, effects, cta, ctaLanguage, publishChannelId, publishPrivacy, mode, allowNoPublish } = body;
  if (!styleId || !c.styles.find((s) => s.id === styleId)) throw new Error("Choisis un style musical (onglet Style)");
  // allowNoPublish : une commande explicite « vers stock » (restock/calendrier) passe outre l'autoPublish de la config
  if (c.autoPublish && !publishChannelId && !allowNoPublish) throw new Error("Publication auto activée : choisis la chaîne de publication");
  // Réglette 2 par 2 : 1 musique sélectionnée en compte 2 (Suno rend toujours une paire)
  const pairCount = Math.min(Math.max(Math.round((Number(musicCount) || 2) / 2), 1), 15);
  const run = {
    id: "r" + Date.now().toString(36),
    machineId: MACHINE_ID,
    mode: mode === "auto" ? "auto" : "semi",
    params: {
      styleId,
      theme: theme || null,
      musicCount: pairCount * 2,
      instrumental: !!instrumental,
      waveform: waveform !== false,
      waveColor: waveColor || "#4B9FFF",
      effects: effects || {}, // {title, glitch}
      cta: !!cta,
      ctaLanguage: ctaLanguage || "English",
      publishChannelId: publishChannelId || null,
      publishPrivacy: publishPrivacy || "private",
    },
    pairCount,
    status: "prompts_running",
    theme: theme && theme.text ? { title: theme.text, text: theme.text } : null,
    pairs: [],
    visual: null,
    cost: { images: 0, music: 0, videos: 0, voices: 0 },
    createdAt: new Date().toISOString(),
    log: [],
  };
  const task = tasks.createTask({
    title: `Musique — run ${run.id} (${run.mode})`,
    desc: `${pairCount * 2} musiques · ${(c.styles.find((s) => s.id === styleId) || {}).name || ""}`,
    machine: MACHINE_NAME,
    machineId: MACHINE_ID,
    runId: run.id,
    kind: "video",
    step: "Démarrage…",
    progress: 5,
    status: "running",
  });
  run.taskId = task.id;
  saveRun(run);
  advance(run.id);
  return run;
}

function validate(runId) {
  const run = getRun(runId);
  if (run.visualRendering || (run.pairs || []).some((p) => p.rendering)) throw new Error("Régénération en cours — attends la fin avant de valider.");
  if (run.status === "music_ready") {
    const miss = run.pairs.filter((p) => !p.audios);
    if (miss.length) throw new Error(`${miss.length} paire(s) sans musique (paire ${miss.map((p) => p.i).join(", ")}) — régénère-les avant de continuer.`);
  }
  const next = { visual_ready: "music_running", music_ready: "montage_running" }[run.status];
  if (!next) throw new Error(`Rien à valider (statut ${run.status})`);
  run.status = next;
  saveRun(run);
  advance(run.id);
  return run;
}

// ---------- Régénérations (visuel + paire) ----------
async function regenVisual(runId, instructions) {
  const run = getRun(runId);
  if (String(run.status).endsWith("_running")) throw new Error("Attends la fin de l'étape en cours avant de régénérer.");
  await generateVisual(run, instructions);
  log(run, "Visuel régénéré" + (instructions ? ` — « ${String(instructions).slice(0, 50)} »` : ""));
  return getRun(runId);
}
async function regenPair(runId, pairIndex, instructions) {
  const run = getRun(runId);
  if (String(run.status).endsWith("_running")) throw new Error("Attends la fin de l'étape en cours avant de régénérer.");
  const pair = (run.pairs || []).find((p) => p.i === Number(pairIndex));
  if (!pair) throw new Error("Paire introuvable");
  if (instructions) {
    const st = styleOf(run);
    const p = await genJson(
      [
        `Réécris la variation de style Suno de cette paire en respectant l'OBSERVATION (reste dans le NOYAU DUR : ${st.sunoStyle}).`,
        `Actuel : ${JSON.stringify({ title1: pair.title1, title2: pair.title2, style: pair.style })}`,
        `OBSERVATION : ${instructions}`,
        run.params.instrumental ? "Instrumental : AUCUNE parole." : "",
        'RÉPONDS UNIQUEMENT EN JSON : {"title1":"...","title2":"...","style":"..."}',
      ].join("\n"),
      { tries: 2, label: "réécriture paire" }
    ).catch(() => null);
    if (p) {
      if (p.title1) pair.title1 = p.title1;
      if (p.title2) pair.title2 = p.title2;
      if (p.style) pair.style = p.style;
    }
  }
  const old = pair.audios;
  pair.audios = null;
  saveRun(run);
  try {
    await genPairWithRetry(run, pair);
  } catch (e) {
    pair.audios = old; // non destructif : on garde les anciennes pistes si la régé échoue
    saveRun(run);
    throw e;
  }
  log(run, `Paire ${pair.i} régénérée`);
  return getRun(runId);
}

// ---------- Idée de thème (jamais réutiliser une idée produite) ----------
function producedThemes() {
  const seen = new Set();
  for (const r of listRuns()) {
    const t = r.theme?.title || r.theme?.text;
    if (t) seen.add(String(t));
  }
  for (const v of stock()) if (v.title) seen.add(String(v.title));
  return [...seen];
}
async function suggestTheme(styleId) {
  const c = config();
  const st = c.styles.find((s) => s.id === styleId) || c.styles[0];
  const inspiration = st && st.nicheId ? bank.inspiration(st.nicheId, { maxTitles: 12, maxVisions: 0 }) : "";
  const done = producedThemes();
  const parsed = await genJson(
    [
      `Propose UN thème/ambiance de vidéo musicale pour le style « ${st ? st.name : "musique"} » (mix long, image fixe + waveform).`,
      "Un thème = une AMBIANCE précise et évocatrice (ex. « pluie néon sur la ville la nuit », « garage de course rétro-futuriste »).",
      inspiration,
      done.length ? `IDÉES DÉJÀ PRODUITES — INTERDICTION ABSOLUE de les reprendre :\n- ${done.slice(0, 40).join("\n- ")}` : "",
      'RÉPONDS UNIQUEMENT EN JSON : {"theme":"l\'ambiance (3-6 mots)","pitch":"1 phrase en français"}',
    ].join("\n"),
    { tries: 3, label: "idée musique" }
  );
  parsed.text = parsed.theme;
  return parsed;
}

// ---------- Sauvetage / boot ----------
/**
 * ⚠ RATTRAPAGE DU STOCK — au demarrage.
 * `addToStock` n'est appele qu'en sortie NORMALE de la boucle advance(). Un run interrompu
 * (serveur redemarre, advance() tue) qui atteint quand meme `done` — par reclassement ou par
 * reprise — n'y passe jamais : la video, la miniature et le packaging sont sur le disque, mais
 * AUCUNE ligne de stock n'existe. Resultat : la video est invisible dans l'onglet Stock et
 * impossible a publier. Vecu sur la machine Crime (run cmtlpl0vt).
 * `addToStock` teste deja la presence de l'id : ce rattrapage est idempotent.
 */
function backfillStock() {
  for (const r of listRuns()) {
    if (String(r.status) !== "done") continue;
    try { const f = getRun(r.id); if (f) addToStock(f); } catch {}
  }
}

function sweepRuns() {
  let n = 0;
  for (const f of fs.readdirSync(RUNS_DIR).filter((x) => x.endsWith(".json"))) {
    const run = readJSON(runPath(f.replace(/\.json$/, "")), null);
    if (!run) continue;
    let touched = false;
    if (run.visualRendering) (delete run.visualRendering, (touched = true));
    for (const p of run.pairs || []) if (p.rendering) (delete p.rendering, (touched = true));
    if (touched) {
      saveRun(run);
      n++;
    }
  }
  backfillStock();
  return n;
}
function strandedRuns() {
  return listRuns()
    .filter((r) => String(r.status || "").endsWith("_running") && !activeAdvance.has(r.id))
    .map((r) => ({ id: r.id, status: r.status, theme: r.theme?.title || r.theme?.text || r.id, machine: MACHINE_NAME, machineId: MACHINE_ID }));
}

/**
 * Commande un mix SANS passer par le wizard (restock / calendrier de publication) :
 * clone les paramètres du run le plus récent, thème neuf dérivé du style, mode auto.
 */
async function orderRun({ publishChannelId, publishPrivacy, publish, overrides, theme } = {}) {
  const last = listRuns().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if (!last || !last.params || !last.params.styleId)
    throw new Error("Aucun run modèle : lance d'abord un run manuel sur la machine Musique");
  const base = { ...last.params, ...(overrides || {}) };
  const th = theme || (await suggestTheme(base.styleId));
  return createRun({
    ...base,
    theme: th,
    mode: "auto",
    publishChannelId: publish ? publishChannelId : null,
    publishPrivacy: publishPrivacy || "private",
    allowNoPublish: !publish,
  });
}

/** N idées d'un coup, RADICALEMENT différentes entre elles (restock multiple / calendrier). */
async function suggestThemes(count, opts = {}) {
  const c = config();
  const st = c.styles.find((s) => s.id === opts.styleId) || c.styles[0];
  const k = Math.min(Math.max(Number(count) || 1, 1), 8);
  const inspiration = st && st.nicheId ? bank.inspiration(st.nicheId, { maxTitles: 12, maxVisions: 0 }) : "";
  const done = producedThemes();
  const parsed = await genJson(
    [
      `Propose EXACTEMENT ${k} thèmes/ambiances de vidéos musicales pour le style « ${st ? st.name : "musique"} » (mix long, image fixe + waveform).`,
      `RÈGLE CAPITALE : les ${k} ambiances doivent être RADICALEMENT différentes ENTRE ELLES (lieux, moments, atmosphères variés).`,
      inspiration,
      done.length ? `IDÉES DÉJÀ PRODUITES — INTERDICTION de les reprendre ou d'en proposer une proche :\n- ${done.slice(0, 40).join("\n- ")}` : "",
      `RÉPONDS UNIQUEMENT EN JSON : {"ideas":[{"theme":"l'ambiance (3-6 mots)","pitch":"1 phrase en français"}]} — exactement ${k} entrées.`,
    ].join("\n"),
    { tries: 3, label: "idées musique" }
  );
  return (parsed.ideas || []).slice(0, k).map((i) => ({ ...i, text: i.theme }));
}

module.exports = {
  orderRun,
  suggestThemes,
  sweepRuns,
  strandedRuns,
  patchStock,
  cancelRun,
  config,
  patchConfig,
  upsertStyle,
  removeStyle,
  deriveStyle,
  listRuns,
  getRun,
  createRun,
  validate,
  regenVisual,
  regenPair,
  regenThumbnail,
  regenTexts,
  suggestTheme,
  advance,
  resumeRun,
  stock,
  publishRun,
  PRICES,
};
