/**
 * TEST B — CORRIGER LA DÉRIVE DU MONUMENT.
 *
 * Défaut constaté sur le test A : le Colisée devenait un château à tours et à croix.
 * Cause : chaque époque était générée à partir de la PRÉCÉDENTE. Les écarts s'additionnent —
 * une dérive classique de chaîne i2i. Notre propre skill l'énonce pour les personnages :
 * la référence est la SEULE source de vérité, jamais le plan d'avant.
 *
 * Deux corrections, testées ensemble parce qu'elles visent le même défaut :
 *   1. toutes les époques sont ancrées sur LA MÊME image de base (l'antique), jamais en chaîne ;
 *   2. la géométrie invariante du monument est décrite explicitement, et ce qu'il ne doit
 *      JAMAIS devenir est interdit nommément.
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const R = "/Users/claudiobaldini/Documents/Agentic OS V2/agent-os";
const vault = require(R + "/lib/vault");
const google = require(R + "/lib/google");

const DIR = path.join(R, "output", "prototype-timelapse-b");
fs.mkdirSync(DIR, { recursive: true });
const BASE = path.join(R, "output", "prototype-timelapse", "01-antique.png");  // l'ancre

const kieKey = () => vault.get("kie");
const ff = (a) => new Promise((res, rej) => { const c = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...a]); let e = ""; c.stdout.on("data", () => {}); c.stderr.on("data", d => e += d); c.on("close", k => k === 0 ? res() : rej(new Error(e.slice(-250)))); });
async function create(model, input) {
  const r = await fetch("https://api.kie.ai/api/v1/jobs/createTask", { method: "POST", headers: { Authorization: `Bearer ${kieKey()}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, input }) }).then(x => x.json());
  if (!r.data?.taskId) throw new Error(r.msg || JSON.stringify(r).slice(0, 200));
  return r.data.taskId;
}
async function poll(id, ms = 12 * 60 * 1000) {
  const t0 = Date.now();
  for (;;) {
    await new Promise(r => setTimeout(r, 12000));
    if (Date.now() - t0 > ms) throw new Error("délai dépassé");
    const r = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${id}`, { headers: { Authorization: `Bearer ${kieKey()}` } }).then(x => x.json());
    if (r.data?.state === "success") return JSON.parse(r.data.resultJson).resultUrls[0];
    if (r.data?.state === "fail") throw new Error(r.data?.failMsg || "échec");
  }
}
const dl = async (u, o) => (fs.writeFileSync(o, Buffer.from(await (await fetch(u)).arrayBuffer())), o);
async function pub(name, file, mime) {
  const u = await google.driveUpload(name, mime, fs.readFileSync(file));
  await google.ensurePublic(u.id).catch(() => {});
  return `https://drive.google.com/thumbnail?id=${u.id}&sz=w1920`;   // seule forme que seedance télécharge
}

// ── L'INVARIANT : ce qui ne doit JAMAIS changer, décrit et protégé.
const MONUMENT =
  "THE MONUMENT AT THE CENTRE IS THE ROMAN COLOSSEUM AND MUST REMAIN RECOGNISABLY THE COLOSSEUM " +
  "IN EVERY IMAGE: a large ELLIPTICAL amphitheatre, a low oval ring of superimposed ARCADES " +
  "(rows of repeated round arches), wider than it is tall, flat oval top, no roof. " +
  "⚠ It must NEVER become a castle, NEVER a cathedral, NEVER a palace. NO towers, NO spires, " +
  "NO bell tower, NO dome, NO cross, NO pointed roof, NO rectangular facade. " +
  "Its position, its ellipse and its arcades stay exactly as in the reference image.";
const VUE =
  "FIXED CAMERA, framing strictly identical to the reference image: same eye-level viewpoint, " +
  "same horizon line, same vanishing point at the centre, the same hills left and right. " +
  "16:9 photorealistic wide shot, natural daylight";

/**
 * ⚠ TROISIÈME LEÇON : l'ancre fixe verrouille AUSSI ce qui devait disparaître. Au test B, le
 * Colosse de Néron — détruit dans l'Antiquité — survivait jusqu'en 2026. Chaque époque doit
 * donc porter DEUX listes : ce qui persiste (l'ancre s'en charge) et ce qui a DISPARU, nommé
 * aussi explicitement que les interdictions de forme.
 */
const EPOQUES = [
  { id: "e2-1200", an: "1200", disparu:
      "The giant bronze Colossus statue on the hill is GONE — destroyed centuries ago, nothing " +
      "stands in its place. The marble temples and colonnades are gone, replaced by brick houses.",
    quoi: "The amphitheatre is now WEATHERED AND PARTLY RUINED — its outer arcade broken on one side, " +
          "grass growing between the stones — but still unmistakably the same elliptical arcaded ring. " +
          "Around it: medieval Rome, low brick houses, vegetable gardens, dirt tracks, no marble temples." },
  { id: "e3-1780", an: "1780", disparu:
      "No Colossus statue anywhere, no bronze figure on the hill. No medieval fortress towers.",
    quoi: "The amphitheatre is a romantic RUIN, still the same ellipse of arches, wild shrubs growing " +
          "from its arcades. Around it: a dusty open field, carriages, cattle, papal-era houses, an obelisk." },
  { id: "e4-2026", an: "2026", disparu:
      "No Colossus statue, no bronze figure on any hill. No dirt tracks, no cattle, no carriages.",
    quoi: "The amphitheatre is the RESTORED modern monument, same ellipse, same arcades, cleaned stone, " +
          "fenced and lit. Around it: paved avenues, cars and buses, tourists, street lamps, modern Rome." },
];

(async () => {
  console.log("TEST B — ancre FIXE + géométrie du monument protégée\n");
  const ancre = await pub("rome-ancre.png", BASE, "image/png");
  const imgs = [BASE];
  for (const e of EPOQUES) {
    const f = path.join(DIR, e.id + ".png");
    if (fs.existsSync(f)) { console.log(`  ${e.an} — déjà générée`); imgs.push(f); continue; }
    console.log(`  ${e.an} …`);
    const url = await poll(await create("gpt-image-2-image-to-image", {
      prompt: `Same place, same camera, ${e.an}. ${e.quoi}\n\nWHAT HAS DISAPPEARED BY THIS ERA: ${e.disparu}\n\n${MONUMENT}\n\n${VUE}.`,
      input_urls: [ancre],           // ⚠ TOUJOURS l'ancre, jamais l'image précédente
      aspect_ratio: "16:9", resolution: "1K",
    }));
    imgs.push(await dl(url, f));
    console.log(`     -> ${e.id}.png`);
  }
  // planche de contrôle : les 4 époques côte à côte
  const sheet = path.join(DIR, "controle.png");
  await ff([...imgs.flatMap(f => ["-i", f]),
    "-filter_complex", imgs.map((_, i) => `[${i}:v]scale=560:-1[s${i}]`).join(";") +
      `;[s0][s1]hstack[r1];[s2][s3]hstack[r2];[r1][r2]vstack`, "-update", "1", sheet]);
  console.log(`\nplanche -> ${sheet}`);
  console.log(`Coût ≈ ${(EPOQUES.length * 0.03).toFixed(2)} $`);
})().catch(e => { console.error("ÉCHEC :", e.message); process.exit(1); });
