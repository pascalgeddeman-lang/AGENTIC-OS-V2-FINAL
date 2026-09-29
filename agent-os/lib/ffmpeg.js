/**
 * FFmpeg / ffprobe : sondage de durée et préflight, partagés par les machines.
 *
 * RÈGLE NON NÉGOCIABLE (leçon du run Linguistique rms69ual7, 29/07/2026) :
 * un ffprobe qui échoue ne doit JAMAIS se traduire par une durée 0 « valide ».
 * Ce jour-là, 27 spawns de ffprobe ont échoué instantanément (machine chargée) ;
 * l'ancien helper renvoyait 0 en silence, les 27 voix ont été enregistrées avec
 * `duration: 0` comme des SUCCÈS, puis l'étape vidéo a échoué 27 fois sur
 * « durée audio introuvable », et le montage est quand même parti avec 0 clip.
 * Une erreur avalée à l'étape N devient un état corrompu qui explose à l'étape N+2,
 * là où le message n'a plus aucun rapport avec la cause.
 *
 * Donc ici : on réessaie (les échecs de spawn sont transitoires), et si ça ne passe
 * toujours pas on LÈVE une erreur qui dit la vraie cause. Les appelants pour qui la
 * durée est cosmétique utilisent explicitement probeDurationSafe().
 */
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Exécution d'un binaire FFmpeg avec un message d'erreur qui NOMME la cause
// (ENOENT = pas dans le PATH, ENOMEM = plus de ressources pour forker, etc.).
function exec(bin, args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (e, out, err) => {
      if (!e) return resolve(String(out));
      const code = e.code || e.errno || "";
      if (code === "ENOENT") return reject(new Error(`${bin} introuvable (installe FFmpeg ou ajoute-le au PATH)`));
      const detail = String(err || e.message || "").trim().slice(-200);
      reject(new Error(`${bin} a échoué${code ? ` (${code})` : ""}${detail ? ` : ${detail}` : ""}`));
    });
  });
}

/**
 * Durée d'un média, en secondes. Lève une erreur explicite si elle est illisible.
 * `tries` : les échecs de spawn étant transitoires, on réessaie avec un backoff
 * croissant avant d'abandonner — bien moins cher que de regénérer le média.
 */
async function probeDuration(file, { tries = 5, label = "" } = {}) {
  const who = label ? `${label} : ` : "";
  if (!file) throw new Error(`${who}aucun fichier à sonder`);
  if (!fs.existsSync(file)) throw new Error(`${who}fichier absent (${path.basename(file)})`);
  let last = null;
  for (let a = 1; a <= tries; a++) {
    try {
      const out = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nk=1:nw=1", file]);
      const d = Number(String(out).trim());
      if (isFinite(d) && d > 0) return d;
      last = new Error(`durée illisible (« ${String(out).trim().slice(0, 40) || "réponse vide"} ») — fichier probablement corrompu`);
    } catch (e) {
      last = e;
    }
    if (a < tries) await sleep(400 * a);
  }
  throw new Error(`${who}durée introuvable après ${tries} tentatives — ${last.message}`);
}

/** Variante pour les usages COSMÉTIQUES (coût affiché, position des CTA…) : 0 si illisible. */
function probeDurationSafe(file) {
  return probeDuration(file, { tries: 2 }).catch(() => 0);
}

/**
 * Préflight : ffmpeg ET ffprobe doivent répondre AVANT de dépenser en images et en voix.
 * Le run qui a motivé ce module a brûlé 1,87 $ avant de mourir sur un outil local.
 */
let verified = false;
async function ensureTools() {
  if (verified) return;
  for (const bin of ["ffmpeg", "ffprobe"]) {
    try {
      await exec(bin, ["-version"], 30000);
    } catch (e) {
      throw new Error(`FFmpeg indisponible — ${e.message}. Installe FFmpeg (build gyan.dev) puis redémarre Agentic Os.`);
    }
  }
  verified = true;
}

module.exports = { probeDuration, probeDurationSafe, ensureTools };
