/**
 * PROTOTYPE TIMELAPSE — « Evolution of Rome », caméra fixe.
 *
 * Ce qu'on cherche à savoir, et RIEN d'autre : le point de vue tient-il d'une époque à
 * l'autre ? C'est le seul point dur de la niche (cf. docs/niche-timelapse.md) — ce qui sépare
 * les chaînes à 300 k vues/vidéo de celles à 3 k.
 *
 * Méthode : une image d'ancrage, puis chaque époque suivante générée en i2i À PARTIR DE LA
 * PRÉCÉDENTE (le cadrage est la seule chose qu'on demande de conserver, tout le reste change),
 * puis un morphing seedance entre chaque paire d'images consécutives.
 *
 * Reprend les fichiers déjà produits : relancer ne repaie pas ce qui existe.
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const vault = require("../../lib/vault");
const google = require("../../lib/google");

const DIR = path.join(__dirname, "..", "..", "output", "prototype-timelapse");
fs.mkdirSync(DIR, { recursive: true });

const kieKey = () => { const k = vault.get("kie"); if (!k) throw new Error("Clé Kie absente du coffre"); return k; };

async function kieCreate(model, input) {
  const r = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
    method: "POST",
    headers: { Authorization: `Bearer ${kieKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  }).then((x) => x.json());
  if (!r.data?.taskId) throw new Error(`Kie ${model} : ${r.msg || JSON.stringify(r).slice(0, 200)}`);
  return r.data.taskId;
}
async function kiePoll(taskId, timeoutMs = 15 * 60 * 1000) {
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 12000));
    if (Date.now() - t0 > timeoutMs) throw new Error("Kie : délai dépassé");
    const r = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${taskId}`,
      { headers: { Authorization: `Bearer ${kieKey()}` } }).then((x) => x.json());
    if (r.data?.state === "success") return JSON.parse(r.data.resultJson).resultUrls[0];
    if (r.data?.state === "fail") throw new Error(`Kie : ${r.data?.failMsg || "échec"}`);
  }
}
async function dl(url, out) {
  const b = Buffer.from(await (await fetch(url)).arrayBuffer());
  fs.writeFileSync(out, b);
  return out;
}
/**
 * ⚠ DEUX PIEGES SEEDANCE, payes au prototype :
 *  1. le champ est `input_urls` (comme documente) ; `image_urls` est ACCEPTE puis IGNORE en
 *     silence — on obtient une video sans rapport avec les images fournies, sans aucune erreur.
 *     Un echec explicite valait mieux que ce succes muet.
 *  2. son telechargeur ne sait PAS suivre `drive.google.com/uc?export=download` (redirection) :
 *     il faut la forme `drive.google.com/thumbnail?id=...&sz=w1920`, servie directement.
 *     Mesure : uc?export=download -> "resource download failed" ; thumbnail -> OK.
 */
async function uploadPublic(name, file, mime) {
  const u = await google.driveUpload(name, mime, fs.readFileSync(file));
  await google.ensurePublic(u.id).catch(() => {});
  return `https://drive.google.com/thumbnail?id=${u.id}&sz=w1920`;
}
/** Seedance digere mieux un JPEG leger qu'un PNG de 2 Mo. */
async function toJpg(png) {
  const out = png.replace(/\.png$/, ".jpg");
  if (!fs.existsSync(out)) await ff(["-i", png, "-q:v", "3", out]);
  return out;
}
const ff = (args) => new Promise((res, rej) => {
  const c = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
  let e = ""; c.stdout.on("data", () => {}); c.stderr.on("data", (d) => (e += d));
  c.on("close", (k) => (k === 0 ? res() : rej(new Error(e.slice(-300)))));
});

// ── LE POINT DE VUE, décrit une fois et répété à l'identique dans CHAQUE prompt.
// C'est la seule chose qui ne doit jamais bouger.
const VUE =
  "FIXED CAMERA, absolutely identical framing in every image: a wide eye-level view looking " +
  "north-east across the valley where the Colosseum stands, the Caelian hill rising on the " +
  "right, the Palatine slope on the left, the same horizon line at exactly one third from the " +
  "top, the same vanishing point at the centre of the frame. The camera NEVER moves, never " +
  "rotates, never changes lens. 16:9 cinematic wide shot, photorealistic, natural daylight";

const EPOQUES = [
  { id: "01-antique", an: "80 après J.-C.",
    quoi: "the Flavian Amphitheatre newly inaugurated, bright travertine facade intact, awning masts on top, marble temples and tiled roofs of imperial Rome all around, crowds in tunics, the Colossus of Nero statue nearby" },
  { id: "02-medievale", an: "1200",
    quoi: "the same amphitheatre half-ruined and turned into a fortress, upper tiers collapsed, a medieval tower built into its arches, the valley filled with vegetable gardens, low brick houses, a bell tower, mud tracks instead of paved roads" },
  { id: "03-baroque", an: "1780",
    quoi: "the ruin overgrown with wild vegetation and shrubs growing from the arches, a baroque church nearby, carriages and cattle in a dusty open field, pilgrims, a stone cross planted in the arena, low papal-era houses" },
  { id: "04-moderne", an: "2026",
    quoi: "the cleared and restored monument fenced and lit, modern paved avenue with cars and buses, tourists in bright clothes, street lamps, metro entrance, contemporary Rome skyline behind" },
];

const IMG_MODEL = "gpt-image-2-text-to-image";
const I2I_MODEL = "gpt-image-2-image-to-image";
const VID_MODEL = "bytedance/seedance-1.5-pro";

(async () => {
  console.log("PROTOTYPE — Evolution of Rome, caméra fixe\n");

  // 1) les images d'époque : la 1re en texte→image, les suivantes ANCRÉES sur la précédente
  const imgs = [];
  for (let i = 0; i < EPOQUES.length; i++) {
    const e = EPOQUES[i];
    const f = path.join(DIR, `${e.id}.png`);
    if (fs.existsSync(f)) { console.log(`[${i + 1}/4] ${e.an} — déjà générée, reprise`); imgs.push(f); continue; }
    console.log(`[${i + 1}/4] ${e.an} …`);
    let url;
    if (i === 0) {
      url = await kiePoll(await kieCreate(IMG_MODEL, {
        prompt: `Rome in ${e.an}. ${e.quoi}. ${VUE}.`,
        aspect_ratio: "16:9", resolution: "1K",
      }));
    } else {
      // ⚠ L'image précédente est la SEULE source de vérité du cadrage. On ne redécrit jamais
      //   la géographie : on demande de garder le point de vue et de changer l'époque.
      const ref = await uploadPublic(`timelapse-rome-${EPOQUES[i - 1].id}.png`, imgs[i - 1], "image/png");
      url = await kiePoll(await kieCreate(I2I_MODEL, {
        prompt:
          `Keep EXACTLY the same camera position, the same framing, the same horizon line and the ` +
          `same vanishing point as the reference image — the viewpoint must be pixel-for-pixel ` +
          `identical. Only the ERA changes: now it is Rome in ${e.an}. ${e.quoi}. ` +
          `Same hills, same valley, same skyline geometry. ${VUE}.`,
        input_urls: [ref], aspect_ratio: "16:9", resolution: "1K",
      }));
    }
    imgs.push(await dl(url, f));
    console.log(`      -> ${path.basename(f)}`);
  }

  // 2) les morphings entre époques consécutives
  const clips = [];
  for (let i = 0; i < imgs.length - 1; i++) {
    const out = path.join(DIR, `morph-${i + 1}.mp4`);
    if (fs.existsSync(out)) { console.log(`[morph ${i + 1}] déjà généré, reprise`); clips.push(out); continue; }
    console.log(`[morph ${i + 1}] ${EPOQUES[i].an} -> ${EPOQUES[i + 1].an} …`);
    const a = await uploadPublic(`tl-a-${i}.jpg`, await toJpg(imgs[i]), "image/jpeg");
    const b = await uploadPublic(`tl-b-${i}.jpg`, await toJpg(imgs[i + 1]), "image/jpeg");
    const url = await kiePoll(await kieCreate(VID_MODEL, {
      prompt:
        "Extremely SLOW and GRADUAL architectural time-lapse seen from a COMPLETELY FIXED camera. " +
        "Centuries pass: stone weathers, roofs sag, walls are slowly overgrown, new structures " +
        "rise quietly in place. " +
        "⚠ ABSOLUTELY NO explosion, NO debris flying through the air, NO collapse in a burst, NO " +
        "disaster, NO earthquake, NO objects launched upward. Everything settles DOWNWARD, slowly, " +
        "as erosion — never as destruction. " +
        "The camera does not move, does not pan, does not zoom, does not rotate. No text, no captions. " +
        "Again: a slow patient erosion from a fixed camera, never an explosion.",
      input_urls: [a, b], aspect_ratio: "16:9", duration: 6, resolution: "720p",
    }));
    clips.push(await dl(url, out));
    console.log(`      -> ${path.basename(out)}`);
  }

  // 3) montage bout à bout
  const list = path.join(DIR, "clips.txt");
  fs.writeFileSync(list, clips.map((f) => `file '${f}'`).join("\n"));
  const final = path.join(DIR, "rome-timelapse.mp4");
  await ff(["-f", "concat", "-safe", "0", "-i", list, "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30", final]);
  console.log(`\nTERMINÉ -> ${final}`);
  console.log(`Coût ≈ ${(EPOQUES.length * 0.03 + clips.length * 6 * 0.015).toFixed(2)} $`);
})().catch((e) => { console.error("ÉCHEC :", e.message); process.exit(1); });
