/**
 * PROTOTYPE COMBAT — le POINT DUR, et rien d'autre.
 *
 * Question unique : sait-on mettre DEUX combattants dans le MÊME plan, en contact physique
 * crédible, sur 6 secondes ? C'est le seul obstacle sérieux du format « affrontement
 * impossible » (cf. docs/niche-combat.md). L'Œil relève que le leader du créneau n'y arrive
 * pas bien lui-même : impacts glissants, corps qui se traversent, coupes de 2-4 s pour masquer.
 *
 * ⚠ AUCUNE personne réelle, AUCUNE marque, AUCUNE propriété intellectuelle tierce : deux
 *   archétypes inventés. C'est la variante que la machine devra savoir produire.
 *
 * Reprend les fichiers existants : relancer ne repaie pas ce qui est déjà là.
 */
const fs = require("fs");
const path = require("path");
const R = "/Users/claudiobaldini/Documents/Agentic OS V2/agent-os";
const vault = require(R + "/lib/vault");
const google = require(R + "/lib/google");

const DIR = path.join(R, "output", "prototype-combat");
fs.mkdirSync(DIR, { recursive: true });
const key = () => vault.get("kie");

async function create(model, input) {
  const r = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
    method: "POST", headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  }).then((x) => x.json());
  if (!r.data?.taskId) throw new Error(r.msg || JSON.stringify(r).slice(0, 200));
  return r.data.taskId;
}
async function poll(id, ms = 12 * 60 * 1000) {
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 12000));
    if (Date.now() - t0 > ms) throw new Error("délai dépassé");
    const r = await fetch(`https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${id}`,
      { headers: { Authorization: `Bearer ${key()}` } }).then((x) => x.json());
    if (r.data?.state === "success") return JSON.parse(r.data.resultJson).resultUrls[0];
    if (r.data?.state === "fail") throw new Error(r.data?.failMsg || "échec");
  }
}
/** Relance un job PERDU (délai dépassé), jamais une requête refusée. Les machines ont cette
 *  protection ; ce script ne l'avait pas et a perdu 12 min sur une fiche évaporée chez Kie. */
async function gen(model, input, essais = 3) {
  let last;
  for (let i = 1; i <= essais; i++) {
    try { return await poll(await create(model, input), 8 * 60 * 1000); }
    catch (e) {
      last = e;
      if (!/délai dépassé|timeout|échec/i.test(e.message)) throw e;   // erreur déterministe : ne pas rejouer
      console.log(`      tentative ${i}/${essais} perdue (${e.message}) — on relance`);
    }
  }
  throw last;
}
const dl = async (u, o) => (fs.writeFileSync(o, Buffer.from(await (await fetch(u)).arrayBuffer())), o);
async function pub(name, file, mime) {
  const u = await google.driveUpload(name, mime, fs.readFileSync(file));
  await google.ensurePublic(u.id).catch(() => {});
  // ⚠ seule forme d'URL Drive que les modèles vidéo Kie savent télécharger (cf. CLAUDE.md)
  return `https://drive.google.com/thumbnail?id=${u.id}&sz=w1920`;
}

const LOOK = "Cinematic photoreal still, MMA cage at night, harsh overhead arena lights, " +
  "shallow depth of field, sweat and dust in the air, broadcast camera at cage level, 16:9";
const NEG = "No text, no letters, no logo, no brand, no watermark, no distorted hands, " +
  "no extra limbs, no resemblance to any real living person";

// Deux ARCHÉTYPES inventés — ni personne réelle, ni personnage sous licence.
const A = { id: "a-lutteur", desc:
  "A towering bald heavyweight wrestler in his forties, thick neck, cauliflower ears, " +
  "black shorts with a plain red waistband, heavily scarred shoulders, calm cold stare" };
const B = { id: "b-mystique", desc:
  "A tall lean bearded monk in a worn dark robe tied with rope, long unkempt hair, " +
  "intense focused gaze, bare feet, wiry build, standing very upright" };

(async () => {
  console.log("PROTOTYPE COMBAT — deux personnages dans le MÊME plan\n");

  // 1) une fiche de référence par combattant
  const refs = {};
  for (const p of [A, B]) {
    const f = path.join(DIR, p.id + ".png");
    if (!fs.existsSync(f)) {
      console.log(`[réf] ${p.id}…`);
      await dl(await gen("gpt-image-2-text-to-image", {
        prompt: `Full body reference sheet of one fighter, standing, neutral pose, plain dark background. ${p.desc}. ${LOOK}. ${NEG}.`,
        aspect_ratio: "16:9", resolution: "1K",
      }), f);
    } else console.log(`[réf] ${p.id} — déjà là`);
    refs[p.id] = await pub(`combat-${p.id}.png`, f, "image/png");
  }

  // 2) LE POINT DUR : les deux dans la même image, en CONTACT
  const duo = path.join(DIR, "duo-contact.png");
  if (!fs.existsSync(duo)) {
    console.log("[duo] les deux en contact physique (2 références)…");
    await dl(await gen("gpt-image-2-image-to-image", {
      prompt:
        "TWO fighters in the SAME shot, in real physical CONTACT: the bald heavyweight from the " +
        "first reference has just shot in for a takedown and grips the mystic from the second " +
        "reference around the waist; the mystic drives an elbow down on his back. Their bodies " +
        "TOUCH and press against each other, weight visibly transferred, feet planted on the mat. " +
        "Keep each fighter's face and outfit EXACTLY as in his reference image. " +
        `Medium wide shot, both fully in frame. ${LOOK}. ${NEG}.`,
      input_urls: [refs[A.id], refs[B.id]],
      aspect_ratio: "16:9", resolution: "1K",
    }), duo);
  } else console.log("[duo] déjà là");

  // 3) animation 6 s — le contact tient-il en mouvement ?
  const clip = path.join(DIR, "duel-6s.mp4");
  if (!fs.existsSync(clip)) {
    console.log("[clip] animation 6 s…");
    const u = await pub("combat-duo.png", duo, "image/png");
    await dl(await gen("bytedance/seedance-1.5-pro", {
      prompt:
        "Continuous 6-second MMA exchange from a FIXED cage-side camera. The two fighters stay " +
        "in CONTACT throughout: the takedown completes, they hit the mat together, the grip holds. " +
        "Real weight and impact — bodies never pass through each other, feet never slide on the " +
        "canvas. No cuts, no camera move, no speech, no text. " +
        "Again: the two bodies remain in physical contact, with weight, for the whole shot.",
      input_urls: [u], aspect_ratio: "16:9", duration: 6, resolution: "720p",
    }), clip);
  } else console.log("[clip] déjà là");

  console.log(`\nTERMINÉ -> ${clip}`);
  console.log("Coût ≈ 0,18 $");
})().catch((e) => { console.error("ÉCHEC :", e.message); process.exit(1); });
