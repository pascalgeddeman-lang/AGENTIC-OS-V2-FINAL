/**
 * TEST C — LES PAS COURTS SUPPRIMENT-ILS LES HALLUCINATIONS DU MORPHING ?
 *
 * Constat du test A : sur un saut de 500 ans, seedance a coiffé le Colisée d'un dôme inventé
 * et projeté des débris en l'air. Hypothèse : entre deux images clés très proches, il n'a
 * presque rien à inventer, donc il n'invente pas.
 *
 * Protocole : MÊME point de vue, MÊME ancre, mais des pas de 50 ans (1780 → 1830 → 1880 → 1930)
 * au lieu de 500. On ne change QUE l'écart temporel — tout le reste est identique au test B,
 * pour que le résultat soit attribuable.
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const R = "/Users/claudiobaldini/Documents/Agentic OS V2/agent-os";
const vault = require(R + "/lib/vault");
const google = require(R + "/lib/google");

const DIR = path.join(R, "output", "prototype-timelapse-c");
fs.mkdirSync(DIR, { recursive: true });
const ANCRE = path.join(R, "output", "prototype-timelapse-b", "e3-1780.png");

const key = () => vault.get("kie");
const ff = (a) => new Promise((res, rej) => { const c = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...a]); let e = ""; c.stdout.on("data", () => {}); c.stderr.on("data", d => e += d); c.on("close", k => k === 0 ? res() : rej(new Error(e.slice(-250)))); });
async function create(model, input) {
  const r = await fetch("https://api.kie.ai/api/v1/jobs/createTask", { method: "POST", headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, input }) }).then(x => x.json());
  if (!r.data?.taskId) throw new Error(r.msg || JSON.stringify(r).slice(0, 200));
  return r.data.taskId;
}
async function poll(id, ms = 12 * 60 * 1000) {
  const t0 = Date.now();
  for (;;) {
    await new Promise(r => setTimeout(r, 12000));
    if (Date.now() - t0 > ms) throw new Error("délai dépassé");
    const r = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${id}`, { headers: { Authorization: `Bearer ${key()}` } }).then(x => x.json());
    if (r.data?.state === "success") return JSON.parse(r.data.resultJson).resultUrls[0];
    if (r.data?.state === "fail") throw new Error(r.data?.failMsg || "échec");
  }
}
const dl = async (u, o) => (fs.writeFileSync(o, Buffer.from(await (await fetch(u)).arrayBuffer())), o);
async function pub(n, f, m) { const u = await google.driveUpload(n, m, fs.readFileSync(f)); await google.ensurePublic(u.id).catch(() => {}); return `https://drive.google.com/thumbnail?id=${u.id}&sz=w1920`; }
async function jpg(p) { const o = p.replace(/\.png$/, ".jpg"); if (!fs.existsSync(o)) await ff(["-i", p, "-q:v", "3", o]); return o; }

const MONUMENT =
  "THE MONUMENT AT THE CENTRE IS THE ROMAN COLOSSEUM AND MUST REMAIN RECOGNISABLY THE COLOSSEUM: " +
  "a large ELLIPTICAL amphitheatre, a low oval ring of superimposed ARCADES, wider than tall, flat " +
  "oval top, no roof. ⚠ NEVER a castle, NEVER a cathedral, NO towers, NO spires, NO dome, NO cross.";
const VUE =
  "FIXED CAMERA, framing strictly identical to the reference image: same viewpoint, same horizon " +
  "line, same vanishing point, same hills. 16:9 photorealistic wide shot, natural daylight";

const PAS = [
  { id: "p-1830", an: "1830", quoi: "Papal Rome. The ruin is being cleared of vegetation, first archaeological digs, scaffolding on one arcade, gas lamps, horse carriages on a dusty road.", disparu: "No cattle grazing inside the arena any more." },
  { id: "p-1880", an: "1880", quoi: "Newly unified Italy. A proper paved boulevard, early street lamps, horse trams, umbrella pines planted along the road, the excavated arena floor visible.", disparu: "No dirt track, no carriages with oxen, no scaffolding." },
  { id: "p-1930", an: "1930", quoi: "The monument fully cleared and isolated, a wide new avenue with early automobiles, ordered pine trees, pedestrians in 1930s clothing.", disparu: "No horse trams, no gas lamps." },
];

(async () => {
  console.log("TEST C — pas de 50 ans (1780 -> 1830 -> 1880 -> 1930)\n");
  const ancre = await pub("rome-c-ancre.png", ANCRE, "image/png");
  const imgs = [ANCRE];
  for (const e of PAS) {
    const f = path.join(DIR, e.id + ".png");
    if (fs.existsSync(f)) { console.log(`  ${e.an} — déjà générée`); imgs.push(f); continue; }
    console.log(`  ${e.an} …`);
    imgs.push(await dl(await poll(await create("gpt-image-2-image-to-image", {
      prompt: `Same place, same camera, ${e.an}. ${e.quoi}\n\nWHAT HAS DISAPPEARED: ${e.disparu}\n\n${MONUMENT}\n\n${VUE}.`,
      input_urls: [ancre], aspect_ratio: "16:9", resolution: "1K",
    })), f));
    console.log(`     -> ${e.id}.png`);
  }

  const clips = [];
  for (let i = 0; i < imgs.length - 1; i++) {
    const o = path.join(DIR, `m-${i + 1}.mp4`);
    if (fs.existsSync(o)) { clips.push(o); continue; }
    console.log(`  morph ${i + 1} …`);
    const a = await pub(`c-a${i}.jpg`, await jpg(imgs[i]), "image/jpeg");
    const b = await pub(`c-b${i}.jpg`, await jpg(imgs[i + 1]), "image/jpeg");
    clips.push(await dl(await poll(await create("bytedance/seedance-1.5-pro", {
      prompt: "Extremely SLOW and GRADUAL architectural time-lapse from a COMPLETELY FIXED camera. " +
        "A few decades pass: stone weathers slightly, vegetation is cleared, the road surface changes, " +
        "vehicles and lamps change. The Colosseum itself barely changes. " +
        "⚠ NO explosion, NO debris flying, NO collapse, NO new dome, NO tower appearing. " +
        "The camera does not move, pan, zoom or rotate. No text.",
      image_urls: undefined, input_urls: [a, b], aspect_ratio: "16:9", duration: 6, resolution: "720p",
    })), o));
    console.log(`     -> m-${i + 1}.mp4`);
  }
  const l = path.join(DIR, "l.txt");
  fs.writeFileSync(l, clips.map(f => `file '${f}'`).join("\n"));
  const out = path.join(DIR, "rome-pas-courts.mp4");
  await ff(["-f", "concat", "-safe", "0", "-i", l, "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30", out]);
  console.log(`\nTERMINÉ -> ${out}`);
  console.log(`Coût ≈ ${(PAS.length * 0.03 + clips.length * 6 * 0.015).toFixed(2)} $`);
})().catch(e => { console.error("ÉCHEC :", e.message); process.exit(1); });
