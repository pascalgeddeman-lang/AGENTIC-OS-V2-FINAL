/**
 * GÉNÉRIQUE DE CHAÎNE — brique PARTAGÉE par toutes les machines.
 *
 * Pourquoi ici et pas dans chaque machine : cinq machines en ont besoin, et le skill est
 * explicite — « une brique dont plusieurs machines ont besoin vit hors des machines ».
 *
 * ⚠ LE POINT QUI COMPTE : le générique est IDENTIQUE pour toutes les vidéos d'une chaîne.
 *   Le rendre à chaque vidéo serait une pure perte (≈ 40 s de Remotion + un encodage). Il est
 *   donc rendu UNE FOIS et mis en cache, la clé couvrant tout ce qui change son apparence
 *   (logo, textes, couleur, dimensions, durée, musique). Les runs suivants le réutilisent tel quel.
 *
 * ⚠ Il est produit en DEUX morceaux : une piste vidéo MUETTE (mêmes paramètres que les
 *   segments des machines — h264, yuv420p, SAR 1:1, 30 fps) et, à part, son jingle.
 *   Raison : les segments des machines sont muets, et `concat -c copy` exige des flux
 *   identiques — un générique sonore casserait le collage et forcerait à ré-encoder les
 *   18 minutes qui suivent. La machine colle donc la vidéo, puis décale la voix du temps du
 *   générique et mixe le jingle au début.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const music = require("./music");

const ROOT = path.join(__dirname, "..", "..");
const REMOTION_DIR = path.join(ROOT, "remotion");
const CACHE_DIR = path.join(__dirname, "..", "output", "intros");
fs.mkdirSync(CACHE_DIR, { recursive: true });

const run = (cmd, args, opt) => new Promise((res, rej) => {
  const c = spawn(cmd, args, { windowsHide: true, ...opt });
  let err = "";
  c.stdout.on("data", () => {});           // OBLIGATOIRE : un pipe non lu fige le process
  c.stderr.on("data", (d) => (err += d.toString()));
  c.on("error", rej);
  c.on("close", (k) => (k === 0 ? res() : rej(new Error(err.slice(-300) || `code ${k}`))));
});
const ffmpeg = (a, o) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...a], o);

/** Le logo doit être accessible à Remotion : on le copie dans remotion/public/ si besoin. */
function ensureLogo(logoPath) {
  const pub = path.join(REMOTION_DIR, "public");
  const base = path.basename(logoPath);
  const dest = path.join(pub, base);
  if (path.resolve(logoPath) !== path.resolve(dest)) fs.copyFileSync(logoPath, dest);
  return base;
}

/**
 * @param {object} o
 * @param {string} o.logoPath  chemin du PNG (transparence conseillée)
 * @param {string} [o.title]   nom de la chaîne
 * @param {string} [o.subtitle]
 * @param {string} [o.accent]  couleur des particules et du halo
 * @param {number} [o.width]   doit correspondre à la vidéo de la machine
 * @param {number} [o.height]
 * @param {number} [o.seconds] 5 par défaut
 * @param {string} [o.musicId] piste de la banque (usage « intro ») ; sinon la 1re disponible
 * @param {boolean} [o.silent] true = générique muet
 * @returns {Promise<{video:string, audio:string|null, seconds:number}|null>} — `video` est
 *   MUETTE ; `audio` est le jingle déjà coupé et fondu, ou null. `null` global si le rendu
 *   échoue (jamais d'exception : un générique manquant ne doit pas faire échouer une vidéo).
 */
async function build(o = {}) {
  const {
    logoPath, title = "", subtitle = "", accent = "#c9a227",
    width = 1280, height = 720, seconds = 5, musicId = null, silent = false,
  } = o;
  if (!logoPath || !fs.existsSync(logoPath)) return null;

  let track = null;
  if (!silent) {
    const pool = music.list({ usage: "intro" });
    track = musicId ? pool.find((m) => m.id === musicId) || null : pool[0] || null;
  }

  const key = crypto.createHash("sha1").update(JSON.stringify({
    logo: fs.statSync(logoPath).size + "-" + path.basename(logoPath),
    title, subtitle, accent, width, height, seconds, track: track?.id || null,
  })).digest("hex").slice(0, 12);
  const out = path.join(CACHE_DIR, `intro-${key}.mp4`);
  const outA = path.join(CACHE_DIR, `intro-${key}.m4a`);
  const done = () => ({ video: out, audio: fs.existsSync(outA) ? outA : null, seconds });
  if (fs.existsSync(out)) return done();                  // déjà rendu : coût nul

  const logo = ensureLogo(logoPath);
  const rel = `intro-${key}`;
  const propsFile = path.join(REMOTION_DIR, rel + ".json");
  fs.writeFileSync(propsFile, JSON.stringify({ logo, title, subtitle, accent, seconds }));
  const seq = path.join(REMOTION_DIR, rel);

  try {
    await run("npx", ["remotion", "render", "ChannelIntro", rel, "--sequence", "--image-format=png",
      `--props=${rel}.json`, `--width=${width}`, `--height=${height}`,
      `--frames=0-${Math.round(seconds * 30) - 1}`], { cwd: REMOTION_DIR, shell: true });

    // 1) la VIDÉO, muette, aux paramètres exacts des segments des machines
    await ffmpeg(["-framerate", "30", "-start_number", "0", "-i", path.join(seq, "element-%03d.png"),
      "-t", seconds.toFixed(2), "-vf", "format=yuv420p,setsar=1", "-an",
      "-c:v", "libx264", "-crf", "20", "-r", "30", "-pix_fmt", "yuv420p", out]);

    // 2) le JINGLE à part, coupé à la bonne durée avec un fondu de sortie : la machine le
    //    mixera au début de sa propre bande-son, sans toucher au collage vidéo.
    if (track) {
      const f = music.filePath(track.id);
      if (fs.existsSync(f)) {
        await ffmpeg(["-i", f, "-t", seconds.toFixed(2),
          "-af", `afade=t=in:st=0:d=0.4,afade=t=out:st=${Math.max(0, seconds - 1.2).toFixed(2)}:d=1.2,aformat=channel_layouts=stereo`,
          "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", outA]);
      }
    }
    return done();
  } catch (e) {
    return null;                                          // best-effort, jamais bloquant
  } finally {
    try { fs.rmSync(seq, { recursive: true, force: true }); } catch {}
    try { fs.unlinkSync(propsFile); } catch {}
  }
}

/** Vide le cache (après changement de logo, par exemple). */
function clearCache() {
  let n = 0;
  for (const f of fs.readdirSync(CACHE_DIR)) if (/\.(mp4|m4a)$/.test(f)) { fs.unlinkSync(path.join(CACHE_DIR, f)); n++; }
  return n;
}

/**
 * Colle le générique EN TÊTE d'une vidéo DÉJÀ TERMINÉE, sans jamais la ré-encoder.
 *
 * Pourquoi cette variante : Drama et Bouddhisme mêlent vidéo et audio dans un seul
 * `filter_complex`. Y injecter le générique rouvrirait le défaut de désynchronisation
 * rencontré sur Crime (voir la note « Ne pas faire cohabiter vidéo et audio dans un même
 * graphe de filtres »). On ne touche donc pas à leur montage : on ajoute le générique après,
 * par simple concaténation par copie.
 *
 * ⚠ Sans danger pour les sous-titres de ces deux machines : elles les GRAVENT dans l'image.
 *   Une machine qui produirait un `.srt` séparé devrait le décaler de `seconds`.
 *
 * Best-effort : en cas d'échec, la vidéo d'origine est laissée intacte.
 * @returns {Promise<number>} secondes ajoutées (0 si rien n'a été fait)
 */
async function prepend(videoPath, o = {}) {
  if (!fs.existsSync(videoPath)) return 0;
  const probe = (args) => new Promise((res) => {
    const c = spawn("ffprobe", args, { windowsHide: true });
    let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", () => {});
    c.on("close", () => res(out.trim())); c.on("error", () => res(""));
  });
  const v = (await probe(["-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream=width,height,r_frame_rate", "-of", "csv=p=0", videoPath])).split(",");
  const a = (await probe(["-v", "error", "-select_streams", "a:0", "-show_entries",
    "stream=sample_rate,channels", "-of", "csv=p=0", videoPath])).split(",");
  const W = +v[0], H = +v[1];
  const fpsNum = String(v[2] || "30/1").split("/");
  const FPS = Math.round((+fpsNum[0] || 30) / (+fpsNum[1] || 1));
  const AR = +a[0] || 48000, AC = +a[1] || 2;
  if (!W || !H) return 0;

  const built = await build({ ...o, width: W, height: H });
  if (!built) return 0;

  // le générique doit porter EXACTEMENT les mêmes paramètres que la vidéo cible,
  // sinon `concat -c copy` refuse (ou produit un fichier illisible).
  const key = crypto.createHash("sha1").update(built.video + `${W}x${H}@${FPS}/${AR}x${AC}`).digest("hex").slice(0, 10);
  const clip = path.join(CACHE_DIR, `clip-${key}.mp4`);
  if (!fs.existsSync(clip)) {
    const args = ["-i", built.video];
    if (built.audio) args.push("-i", built.audio);
    else args.push("-f", "lavfi", "-i", `anullsrc=r=${AR}:cl=${AC === 1 ? "mono" : "stereo"}`);
    args.push("-t", String(built.seconds), "-r", String(FPS),
      "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-ar", String(AR), "-ac", String(AC), "-shortest", clip);
    try { await ffmpeg(args); } catch { return 0; }
  }

  const dir = path.dirname(videoPath);
  const list = path.join(dir, "_intro-concat.txt");
  const tmp = path.join(dir, "_avec-intro.mp4");
  fs.writeFileSync(list, [clip, videoPath].map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"));
  try {
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", tmp]);
    // GARDE : on ne remplace la vidéo que si la durée a bien augmenté du bon montant.
    const before = parseFloat(await probe(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", videoPath])) || 0;
    const after = parseFloat(await probe(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", tmp])) || 0;
    if (after < before + built.seconds - 0.5) { fs.unlinkSync(tmp); return 0; }
    fs.renameSync(tmp, videoPath);
    return built.seconds;
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
    return 0;
  } finally {
    try { fs.unlinkSync(list); } catch {}
  }
}

module.exports = { build, prepend, clearCache, CACHE_DIR };
