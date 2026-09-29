/**
 * MACHINE « Time Travel » — usine à vlogs de voyage dans le temps.
 * Pipeline : Claude (prompts) → GPT Image 2 (images i2i personnage) → Grok 1.5 (vidéos 10 s
 * avec voix intégrée) → Remotion local (montage).
 * Modes : semi (validation étape par étape, régénération par scène) / auto (bout en bout).
 * Le « noyau dur » (apparence du personnage, langue, structure selfie) survit à toutes
 * les régénérations : seules les instructions de l'utilisateur s'y ajoutent.
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { readJSON, writeJSON, ensureDir, DATA_DIR } = require("../store");
const claude = require("../claude");
const vault = require("../vault");
const google = require("../google");
const tasks = require("../tasks");
const spend = require("../spend");
const bank = require("../bank");
const ff = require("../ffmpeg");

const OUT_ROOT = path.join(__dirname, "..", "..", "output", "machines");
const REMOTION_DIR = path.join(__dirname, "..", "..", "..", "remotion");
ensureDir(OUT_ROOT);
ensureDir(path.join(DATA_DIR, "machines", "runs"));

const PRICES = { image: 0.03, videoPerSec: 0.015 };
// Génération des prompts d'une vidéo longue : petits lots (sortie plus courte = plus rapide
// et bien moins de timeouts/troncatures) générés EN PARALLÈLE (plus de 35 min en série).
// La lenteur résiduelle vient du TEMPS DE GÉNÉRATION par appel (~2-4 min pour ~6 Ko de JSON
// riche) — incompressible sans changer de modèle ; on l'absorbe donc par la concurrence.
// Concurrence API (pas CPU) : 5 lots simultanés → 60 scènes = 12 lots en ~2-3 vagues.
const BATCH_LONG = 6;
const BATCH_CONCURRENCY = 5;
// Modèle du CLI Claude pour l'écriture des prompts/scénarios/packaging (indépendant du
// modèle de CETTE session Claude Code — le moteur spawn un CLI à part).
// settings.promptModel : "opus" = force Opus 4.8 ; "" ou absent = défaut du CLI (Fable 5,
// plus capable qu'Opus pour l'écriture créative — c'est lui qui a écrit le script du Grand Incendie).
function genModel() {
  return config().settings.promptModel || undefined;
}
const askGen = (prompt, ms = 6 * 60 * 1000) => claude.ask(prompt, { timeoutMs: ms, model: genModel() });

// Appel Claude + parse JSON, avec RELANCES (timeout ou JSON invalide). Objectif « coûte que
// coûte » : un délai dépassé ne tue plus toute l'étape, on retente. L'annulation, elle, remonte.
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

// Nombre de scènes visé par un run (mémorisé à la création — insensible à un changement
// ultérieur de clipSeconds dans les réglages).
function expectedSceneCount(run) {
  if (run.sceneCount) return run.sceneCount;
  const clip = Number(config().settings.clipSeconds) || 10;
  return Math.max(1, Math.round(Number(run.params.durationSec) / clip));
}
// Une scène est « complète » côté prompts si elle a bien ses deux prompts média.
function sceneComplete(s) {
  return !!(s && s.i && s.image_prompt && s.video_prompt);
}
// Les prompts sont terminés SEULEMENT si toutes les scènes attendues existent et sont complètes.
// (empêche un run de prompts partiel de « sauter » aux images à la reprise.)
function promptsComplete(run) {
  const exp = expectedSceneCount(run);
  const sc = run.scenes || [];
  if (sc.length < exp) return false;
  for (let i = 1; i <= exp; i++) {
    if (!sceneComplete(sc.find((s) => s.i === i))) return false;
  }
  return true;
}

// ---------- Config machine (personnages, réglages, niche liée) ----------
function config() {
  return readJSON("machines/timetravel.json", {
    id: "timetravel",
    name: "Time Travel",
    nicheId: null,
    linkedChannelId: null,
    autoPublish: false,
    characters: [],
    settings: { imageModel: "gpt", clipSeconds: 10, ctaEveryMin: 2, promptModel: "" },
  });
}
function saveConfig(c) {
  writeJSON("machines/timetravel.json", c);
}
function patchConfig(patch) {
  const c = { ...config(), ...patch };
  saveConfig(c);
  return c;
}
function upsertCharacter(ch) {
  const c = config();
  if (ch.id) {
    const i = c.characters.findIndex((x) => x.id === ch.id);
    if (i >= 0) c.characters[i] = { ...c.characters[i], ...ch };
  } else {
    ch.id = "p" + Date.now().toString(36);
    c.characters.push(ch);
  }
  saveConfig(c);
  return ch;
}
function removeCharacter(id) {
  const c = config();
  c.characters = c.characters.filter((x) => x.id !== id);
  saveConfig(c);
}

// ---------- Runs ----------
function runPath(id) {
  return `machines/runs/${id}.json`;
}
function listRuns() {
  const dir = path.join(DATA_DIR, "machines", "runs");
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJSON(`machines/runs/${f.replace(/\.json$/, "")}.json`, null))
      .filter(Boolean)
      .map(({ id, mode, status, params, theme, createdAt, scenes, cost, error }) => ({
        id, mode, status, params, theme, createdAt, error,
        sceneCount: scenes ? scenes.length : 0,
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

// ---------- Noyau dur du prompt (survit aux régénérations) ----------
function coreRules(character, clipSeconds) {
  // Signature VOIX (NOYAU DUR) : décrite à l'IDENTIQUE dans chaque video_prompt pour que Grok
  // produise TOUJOURS la même voix de femme (elle parle toujours face caméra en vlog).
  const voice = `the same warm, clear, natural adult woman's voice speaking ${character.language} in a friendly, upbeat vlogger tone — the EXACT SAME female voice in every single scene`;
  return [
    `PERSONNAGE (NOYAU DUR — ne jamais modifier) : ${character.name}. Apparence : ${character.appearance}.`,
    `Langue de la voix : ${character.language}. Personnalité/ton : ${character.persona}.`,
    `VOIX FIXE (NOYAU DUR) : sa voix est TOUJOURS « ${voice} ». Décris-la à l'IDENTIQUE dans CHAQUE video_prompt (début ET fin). JAMAIS de narrateur masculin, JAMAIS une autre voix, JAMAIS de silence : c'est ELLE qui parle face caméra dans chaque scène.`,
    "IDENTITÉ (NOYAU DUR) : de l'image de référence, ne reprendre QUE le visage et les cheveux —",
    "« the exact same person (same face and hair) as in the reference image ». Ne jamais décrire son physique (la référence fait foi).",
    `TENUE FIXE (NOYAU DUR) : elle porte EXACTEMENT la même tenue MODERNE signature dans TOUTES les scènes (${character.appearance}),`,
    "décrite à l'IDENTIQUE dans chaque prompt. Voyageuse temporelle MODERNE : jamais de vêtements d'époque, tenue inchangée d'une",
    "scène à l'autre. Ne JAMAIS ajouter d'accessoire ni d'objet tenu en main (boussole…) hors de sa tenue de base. Cohérence vestimentaire TOTALE.",
    "FORMAT UNIQUE — VLOG SELFIE (NOYAU DUR) : CHAQUE scène est un SELFIE face caméra, bras tendu HORS CHAMP (jamais visible), AUCUN",
    "téléphone/perche/caméra visible, cadrage buste/épaules, elle REGARDE l'objectif et parle à son audience. AUCUN plan POV subjectif,",
    "AUCUN plan « témoin » objectif, AUCUN plan large sans elle : c'est TOUJOURS son selfie, elle est au premier plan dans chaque image.",
    "DYNAMISME (NOYAU DUR — CRITIQUE) : ce n'est JAMAIS une tête parlante statique. Dans chaque scène elle FAIT une action nette tout en",
    "restant en selfie, avec le décor de la FACETTE du bloc bien visible derrière/autour d'elle : elle MARCHE (l'arrière-plan défile),",
    "pointe/montre un détail, goûte une nourriture et la note, réagit à une odeur/au froid/à la foule, sursaute, marchande, participe",
    "(danse, rame, monte un animal, tamise…), s'infiltre/chuchote, interpelle un passant, s'émerveille devant un monument, contemple au",
    "coucher du soleil. UNE action claire par scène, DIFFÉRENTE des scènes voisines (jamais 2 fois la même action en 3 scènes).",
    "ÉMOTION (NOYAU DUR) : l'expression COLLE au ton (émerveillement, dégoût, peur, fou rire, gravité). JAMAIS de sourire déplacé sur un",
    "moment grave ; émerveillement/rire réservés aux moments légers.",
    "COHÉRENCE TEMPORELLE (NOYAU DUR) : la vidéo suit UNE journée, de l'AUBE à la NUIT. Chaque prompt précise le MOMENT (aube, matin, midi,",
    "après-midi, crépuscule, nuit) et la lumière ; progression continue et réaliste (pas de saut jour/nuit incohérent).",
    "CONTINUITÉ (NOYAU DUR) : UNE seule journée continue. Chaque scène reprend LÀ où la précédente s'arrête (même lieu, ou déplacement",
    "JUSTIFIÉ à l'écran/dans la voix). JAMAIS de téléportation. Chaque scène apporte du NOUVEAU — jamais deux scènes qui tournent en rond.",
    `Chaque scène dure ${clipSeconds} s. UN SEUL PLAN CONTINU (JAMAIS de multishot, aucune coupure interne) : une seule action nette et crédible`,
    "(mieux vaut une action simple parfaite qu'un plan bâclé qui hallucine).",
    "PROMPTS IMAGE (ANGLAIS, >= 500 caractères) : hyper-photorealistic SELFIE face-cam au premier plan, période détaillée, décor riche de la",
    "facette du bloc, lumière cohérente avec l'heure, tenue signature identique, émotion juste, l'action en cours. Chaque prompt image DOIT inclure :",
    "« vlog selfie shot at arm's length, her arm out of frame, no phone or camera visible; use ONLY her face and hair from the reference image;",
    " keep her exact same modern signature outfit in every scene; no compass or extra held objects ».",
    `PROMPTS VIDÉO (Grok, ANGLAIS, >= 400 caractères) : plan SELFIE de ${clipSeconds}s, elle parle face caméra + action DYNAMIQUE (mouvement net,`,
    "décor vivant du début à la fin, jamais figée). Répéter la consigne de voix en DÉBUT ET EN FIN du prompt. Format :",
    `« She looks into the camera in a selfie vlog shot (arm out of frame, no phone visible), [ACTION dynamique], and speaks in ${character.language} with ${voice}: "…". » puis rappeler en fin : « her voice is ${voice}; no other person speaks (background figures stay silent). »`,
  ].join("\n");
}

// Recette VLOG par BLOCS THÉMATIQUES, reconstruite sur la data de la niche (les 4 vidéos les
// plus vues — 2,5M à 419K — sont TOUTES des « I time travelled to [époque/lieu] (Vlog) », des
// tours d'époque par facettes ; les « I Witnessed [événement] » plafonnent bien plus bas).
// PAS de mission inventée, PAS d'ironie dramatique : c'est la VARIÉTÉ DES FACETTES qui tient les 10 min.
function vlogRecipe() {
  return [
    "RECETTE (tour d'époque façon « Chloe VS History », VLOG-ONLY, format le plus vu de la niche) :",
    "1. UNE époque + UNE zone précises, parcourues comme UNE JOURNÉE (aube → nuit), découpée en BLOCS THÉMATIQUES (facettes).",
    "   PAS d'événement-catastrophe unique, PAS de mission inventée, PAS d'ironie dramatique, PAS de « je dois sauver quelqu'un ».",
    "2. HOOK (scène 1) : cold-open à l'arrivée = choc SENSORIEL immédiat (odeur/chaleur/foule) + « I've just arrived in [LIEU] in",
    "   [ANNÉE] » + ANNONCE DU PROGRAMME de la journée (2-3 rendez-vous teasés) + petit clin d'œil aux abonnés.",
    "3. BLOCS de longueur VARIABLE (surtout pas tous égaux). Ordre canonique (à ADAPTER à l'époque — tous ne s'appliquent pas) :",
    "   arrivée/orientation → logement & se préparer → MARCHÉ/RUE (le plus long) → nourriture & boisson (food-review) → un métier / la",
    "   vie quotidienne → un lieu emblématique / le pouvoir (aperçu d'un VIP de loin) → croyance/rituel (beat émotionnel) → LE CLIMAX",
    "   (spectacle collectif : arène, festival, place publique, chasse) → soirée/vie nocturne → wind-down & conclusion.",
    "4. Chaque scène = 1 plan selfie de 10s = 1 ACTION nette + 1 réplique parlée (~25-30 mots max ≈ 10s). Varier les actions, jamais 2",
    "   fois la même en 3 scènes (voir la liste d'actions du noyau dur).",
    "5. RÉTENTION : programme annoncé tôt, payoffs différés teasés (« later we're heading to the games… »), micro-cliffhangers entre blocs",
    "   (« okay, next stop… »). Chaque bloc s'ouvre par une transition parlée depuis le précédent.",
    "6. VOIX (sa voix, face cam) : 1re personne, présent, influenceuse décontractée. Comparaisons anachroniques (« this is basically the",
    "   internet », « ancient Airbnb », « the least glamorous Uber »), food-review (goût → texture → verdict/note « 8 out of 10 »), panique",
    "   low-stakes + auto-dérision, focus SENSORIEL (surtout l'ODEUR), adresse directe (« guys »).",
    "7. 3 à 5 RÉVÉLATIONS « did you know » / myth-bust (« you'd think it was white marble — it wasn't ») + chiffres EXACTS, glissés dans la",
    "   réaction, jamais en cours magistral. Chocs sensoriels (odeurs, goûts, températures).",
    "8. Émotion en DENTS DE SCIE (haut-bas-haut). Vers la fin, un PIVOT SINCÈRE : après tout l'humour, un beat grave et vrai (mortalité,",
    "   connexion humaine, « same sky »).",
    "9. CONCLUSION : monologue réflexif face cam (leçon universelle) + sign-off + CTA « where should I go next? Let me know below ».",
    "   AUCUN appel à s'abonner dans la voix (le CTA est un élément VISUEL ajouté au montage).",
  ].join("\n");
}

// ---------- Étape 1 : génération des prompts (Claude) ----------
async function generatePrompts(run) {
  const c = config();
  const character = c.characters.find((x) => x.id === run.params.characterId);
  if (!character) throw new Error("Personnage introuvable");
  const s = c.settings;
  const clip = Number(s.clipSeconds) || 10;
  const sceneCount = expectedSceneCount(run);
  run.sceneCount = sceneCount; // figé sur le run (reprise fiable même si les réglages changent)
  const ctaEvery = Math.max(1, Math.round(((Number(s.ctaEveryMin) || 2) * 60) / clip));
  const inspiration = c.nicheId ? bank.inspiration(c.nicheId) : "(aucune niche liée)";
  const t = run.params.theme;
  const themeAsk = t
    ? `THÈME IMPOSÉ : ${t.text || `époque « ${t.era} », lieu « ${t.place || t.event || ""} »`}.`
    : "THÈME LIBRE : choisis une ÉPOQUE + une ZONE/VILLE précises, LARGES et riches en facettes (pas un événement-catastrophe unique),"
      + " très visuelles et documentées, en t'inspirant des titres « I time travelled to [époque/lieu] (Vlog) » de la niche (le format le plus vu).";

  const SCENE_SCHEMA =
    '"scenes":[{"i":1,"cta":false,"voiceover":"réplique EXACTE dite face caméra par le personnage (dans SA langue, ~25-30 mots ≈ 10s)",' +
    '"action":"l\'action dynamique de la scène (2-5 mots, ex: tasting street food)",' +
    '"image_prompt":"...>=500 chars EN, SELFIE face-cam, action, décor de la facette...","video_prompt":"...>=400 chars EN, selfie 10s, elle parle + action dynamique, voix fixe rappelée début et fin..."}]';
  const common = [
    "Tu écris le plan de tournage d'un VLOG de voyage dans le temps (selfie face caméra uniquement) pour une usine à contenu YouTube.",
    coreRules(character, clip),
    vlogRecipe(),
    "AUCUN appel à s'abonner dans la voix : les CTA sont des éléments VISUELS ajoutés au montage, le personnage n'en parle jamais.",
    "La réplique de chaque scène : ~25-30 mots MAXIMUM (10 secondes de parole face caméra), ton conforme au persona.",
    "TOUTES les scènes sont des SELFIES vlog (aucun autre type de plan). Chaque scène a une ACTION dynamique différente des scènes voisines.",
  ];

  if (sceneCount <= 12) {
    // Vidéo courte : un seul appel
    const prompt = [
      ...common,
      themeAsk,
      `NOMBRE DE SCÈNES : EXACTEMENT ${sceneCount}. Mini-parcours d'une journée (arrivée qui accroche → 2-3 facettes → conclusion), du jour vers le soir.`,
      "",
      inspiration,
      "",
      "RÉPONDS UNIQUEMENT EN JSON (aucun texte autour, aucune fence) :",
      '{"theme":{"era":"...","place":"...","title":"titre YouTube « I time travelled to … (Vlog) » dans la langue du personnage"},' + SCENE_SCHEMA + "}",
    ].join("\n");
    const parsed = await genJson(prompt, { tries: 3, label: "scènes" });
    if (!Array.isArray(parsed.scenes) || !parsed.scenes.length) throw new Error("Claude n'a pas renvoyé de scènes");
    run.theme = parsed.theme || run.params.theme || null;
    run.scenes = parsed.scenes.map((sc, i) => ({ i: i + 1, mode: "vlog", cta: !!sc.cta, action: sc.action || "", voiceover: sc.voiceover || "", image_prompt: sc.image_prompt || "", video_prompt: sc.video_prompt || "", image: null, video: null }));
    log(run, `Prompts générés : ${run.scenes.length} scènes — thème « ${run.theme?.title || "?"} »`);
    return;
  }

  // Vidéo longue : phase 1 = OUTLINE (époque+zone découpée en BLOCS THÉMATIQUES), phase 2 = scènes
  // par lots PARALLÈLES (chaque lot est autonome grâce au bloc qui décrit facette + lieu + transition).
  // Reprenable : si l'outline existe déjà (reprise après plantage), on ne le régénère pas.
  if (!run.outline || !Array.isArray(run.outline.beats) || run.outline.beats.length < sceneCount) {
    log(run, `Vidéo longue (${sceneCount} scènes) : écriture de la structure + storyboard scène par scène…`);
    const outlinePrompt = [
      ...common,
      themeAsk,
      `La vidéo fera ${sceneCount} scènes de ${clip}s (${Math.round((sceneCount * clip) / 60)} minutes), sur UNE époque + UNE zone LARGE.`,
      "Construis la STRUCTURE selon la RECETTE : une JOURNÉE (aube → nuit) découpée en BLOCS THÉMATIQUES (facettes : arrivée, logement,",
      "marché/rue, nourriture, un métier/vie quotidienne, lieu emblématique/pouvoir, croyance, LE CLIMAX collectif, soirée, conclusion —",
      "à ADAPTER à l'époque). Chaque bloc = UNE facette, longueur VARIABLE (marché/rue et climax les plus longs ; croyance/conclusion courts).",
      `Répartis EXACTEMENT ${sceneCount} scènes sur les blocs : plage \"scenes\" contiguë par bloc (ex \"1-4\",\"5-16\"…), couvrant 1 à ${sceneCount} sans trou.`,
      "",
      `PUIS — LE PLUS IMPORTANT — écris un STORYBOARD scène par scène : un tableau \"beats\" de EXACTEMENT ${sceneCount} entrées (i = 1 à ${sceneCount}).`,
      "Chaque entrée = le contenu PRÉCIS et UNIQUE de cette scène : une ACTION (2-5 mots) + un BEAT (ce qu'elle fait/montre/révèle + l'anecdote,",
      "le chiffre ou la vanne de CETTE scène). RÈGLE ABSOLUE : chaque beat est DIFFÉRENT de tous les autres — JAMAIS deux fois la même",
      "anecdote, le même plat, la même vanne, la même action. La journée AVANCE en continu (chaque scène apporte du NEUF).",
      "CHAQUE FAIT / CHIFFRE / RÉVÉLATION surprenante (ex. « ça vaut plus que l'or », « pas de chevaux », « le cacao sert de monnaie ») n'apparaît",
      "que dans UNE SEULE scène de tout le storyboard : ne le ré-assène jamais dans une autre scène. Avant de finir, relis et supprime tout doublon de fait.",
      "Répartis les actions variées (marcher, goûter, marchander, réagir à une odeur, s'infiltrer, participer…) sans jamais répéter la même en 3 scènes.",
      "",
      inspiration,
      "",
      "RÉPONDS UNIQUEMENT EN JSON (aucun texte autour, aucune fence) :",
      '{"theme":{"era":"...","place":"ville/zone précise","title":"titre YouTube « I time travelled to [lieu] in [année]! (Vlog) » style niche (85-100 car.), langue du personnage"},',
      `"blocks":[{"scenes":"1-4","facet":"arrival|lodging|market|food|craft|power|belief|climax|nightlife|conclusion","location":"lieu précis","moment":"aube|matin|midi|après-midi|crépuscule|nuit"}],`,
      `"beats":[{"i":1,"action":"2-5 mots","beat":"le contenu UNIQUE de la scène (action + anecdote/chiffre/vanne, distinct de toutes les autres)"}]}`,
    ].join("\n");
    const outline = await genJson(outlinePrompt, { tries: 3, label: "structure" });
    if (!Array.isArray(outline.blocks) || !outline.blocks.length) throw new Error("Claude n'a pas renvoyé de structure");
    if (!Array.isArray(outline.beats) || outline.beats.length < sceneCount) throw new Error(`Storyboard incomplet (${(outline.beats || []).length}/${sceneCount} beats)`);
    run.theme = outline.theme || run.params.theme || null;
    run.outline = { blocks: outline.blocks, beats: outline.beats };
    saveRun(run);
  }
  const outline = run.outline;

  // Scènes déjà écrites (reprise : on ne régénère QUE les lots dont il manque des scènes)
  const byIndex = new Map();
  for (const sc of run.scenes || []) if (sceneComplete(sc)) byIndex.set(sc.i, sc);
  const assemble = () => {
    const arr = [];
    for (let i = 1; i <= sceneCount; i++) if (byIndex.has(i)) arr.push(byIndex.get(i));
    return arr;
  };
  // Range "1-4" -> [1,4] ; blocs sans plage exploitable = ignorés pour le mapping.
  const blockRange = (b) => {
    const m = /(\d+)\s*[-–]\s*(\d+)/.exec(String(b.scenes || ""));
    return m ? [+m[1], +m[2]] : null;
  };
  // Blocs qui recouvrent la plage d'un lot (CONTEXTE de facette). Si aucun, le bloc le plus proche.
  const blocksFor = (start, end) => {
    const hit = outline.blocks.filter((b) => {
      const r = blockRange(b);
      return r && r[0] <= end && r[1] >= start;
    });
    if (hit.length) return hit;
    const mid = Math.round((start + end) / 2);
    let best = outline.blocks[0], bestD = Infinity;
    for (const b of outline.blocks) {
      const r = blockRange(b);
      const c = r ? (r[0] + r[1]) / 2 : mid;
      const d = Math.abs(c - mid);
      if (d < bestD) (bestD = d), (best = b);
    }
    return best ? [best] : [];
  };
  // Storyboard pré-assigné (un beat UNIQUE par scène — garantit zéro répétition entre lots parallèles).
  const beatsFor = (start, end) => (run.outline.beats || []).filter((x) => Number(x.i) >= start && Number(x.i) <= end).sort((a, b) => a.i - b.i);
  // Lots à générer : fenêtres FIXES contiguës (couverture exacte 1..N, aucun chevauchement) ;
  // chaque lot reçoit ses beats pré-assignés + le(s) bloc(s) qui recouvre(nt) sa plage.
  const batches = [];
  for (let start = 1; start <= sceneCount; start += BATCH_LONG) {
    const end = Math.min(start + BATCH_LONG - 1, sceneCount);
    let need = false;
    for (let i = start; i <= end; i++) if (!byIndex.has(i)) need = true;
    if (need) batches.push({ start, end, blocks: blocksFor(start, end), beats: beatsFor(start, end) });
  }
  if (batches.length) log(run, `Écriture de ${sceneCount} scènes : ${batches.length} lot(s) de ${BATCH_LONG}, ${Math.min(BATCH_CONCURRENCY, batches.length)} en parallèle…`);

  const genBatch = async (b) => {
    const need = b.end - b.start + 1;
    const prompt = [
      ...common,
      `THÈME (époque + lieu) : ${JSON.stringify(run.theme)}.`,
      `BLOC(S) THÉMATIQUE(S) (facette, lieu, moment de la journée) : ${JSON.stringify(b.blocks)}`,
      `STORYBOARD PRÉ-ASSIGNÉ de ces scènes (action + beat UNIQUE de chaque scène — À RESPECTER, un beat par "i") : ${JSON.stringify(b.beats)}`,
      "Ta tâche : ÉTOFFER chaque beat pré-assigné en une scène complète. N'INVENTE PAS d'autre contenu, ne pioche PAS dans les autres",
      "scènes, ne répète AUCUNE anecdote/plat/vanne d'une autre scène : reste STRICTEMENT sur le beat + l'action assignés à chaque \"i\".",
      b.start === 1 ? "Scène 1 = HOOK à l'arrivée (choc sensoriel + « I've just arrived in [lieu] in [année] » + annonce du programme + clin d'œil abonnés)." : "Ouvre par une courte transition parlée depuis la scène précédente (aucune téléportation).",
      `Écris les scènes ${b.start} à ${b.end} (champ "i" de ${b.start} à ${b.end}, EXACTEMENT ${need} scènes), toutes en SELFIE vlog. Réplique ~25-30 mots qui délivre le beat. Reprends l'\"action\" assignée (tu peux la préciser).`,
      "RÉPONDS UNIQUEMENT EN JSON (aucun texte autour, aucune fence) : {" + SCENE_SCHEMA + "}",
    ].join("\n");
    // Relance jusqu'à obtenir au moins `need` scènes valides
    let parsed = null;
    for (let a = 1; a <= 3; a++) {
      try {
        const r = await genJson(prompt, { tries: 1, label: `scènes ${b.start}-${b.end}` });
        if (Array.isArray(r.scenes) && r.scenes.length >= need) {
          parsed = r;
          break;
        }
        parsed = parsed || r;
      } catch (e) {
        if (/Annulée/.test(e.message)) throw e;
      }
    }
    if (!parsed || !Array.isArray(parsed.scenes) || !parsed.scenes.length) throw new Error(`Claude n'a pas renvoyé les scènes ${b.start}-${b.end}`);
    // Numérotation EXPLICITE par position (parallèle : impossible de se fier à l'ordre global)
    parsed.scenes.slice(0, need).forEach((sc, k) => {
      const i = b.start + k;
      byIndex.set(i, { i, mode: "vlog", cta: !!sc.cta, action: sc.action || "", voiceover: sc.voiceover || "", image_prompt: sc.image_prompt || "", video_prompt: sc.video_prompt || "", image: null, video: null });
    });
    run.scenes = assemble(); // persistance au fil de l'eau (les scènes survivent à un plantage)
    saveRun(run);
    log(run, `Scènes ${b.start}-${b.end} écrites (${byIndex.size}/${sceneCount}).`);
  };

  await pool(batches, genBatch, BATCH_CONCURRENCY);
  run.scenes = assemble();
  saveRun(run);
  // Aucune scène ne doit manquer : sinon on RESTE en échec (reprenable) — jamais d'avance vers les images.
  const missing = [];
  for (let i = 1; i <= sceneCount; i++) if (!byIndex.has(i)) missing.push(i);
  if (missing.length) throw new Error(`Prompts incomplets : ${missing.length} scène(s) manquante(s) (${missing.slice(0, 12).join(", ")}${missing.length > 12 ? "…" : ""}) — clique « Reprendre » pour ne régénérer que les manquantes.`);

  // Vérification finale de cohérence : une passe qui relit TOUTE la voix off d'un bloc
  log(run, "Vérification finale de la cohérence du récit…");
  try {
    const check = await genJson(
      [
        "Tu es SCRIPT-DOCTOR. Relis la voix off complète d'un vlog de voyage dans le temps et repère les VRAIS problèmes de continuité :",
        "sauts de lieu inexpliqués (téléportation), répétitions (deux scènes qui disent la même chose), incohérences chronologiques,",
        "ou trous narratifs. Ne signale que les problèmes RÉELS et sérieux.",
        `SCÉNARIO : ${JSON.stringify(run.outline)}`,
        `VOIX OFF : ${JSON.stringify(run.scenes.map((s) => ({ i: s.i, v: s.voiceover })))}`,
        'RÉPONDS UNIQUEMENT EN JSON : {"ok":true|false,"issues":[{"scene":N,"problem":"..."}]}',
      ].join("\n"),
      { tries: 2, label: "cohérence" }
    );
    if (check.ok && (!check.issues || !check.issues.length)) log(run, "✓ Cohérence validée : aucun problème détecté.");
    else {
      run.coherenceIssues = check.issues || [];
      for (const iss of run.coherenceIssues) log(run, `⚠ Cohérence scène ${iss.scene} : ${iss.problem}`);
      log(run, `⚠ ${run.coherenceIssues.length} point(s) à revoir — régénère ces scènes (↻) avant de valider.`);
    }
    saveRun(run);
  } catch (e) {
    log(run, "Vérification de cohérence ignorée : " + e.message);
  }
  log(run, `Prompts générés : ${run.scenes.length} scènes — thème « ${run.theme?.title || "?"} »`);
}

// ---------- Kie direct (images GPT + vidéos Grok) sans tâche individuelle ----------
function kieKey() {
  const k = vault.get("kie");
  if (!k) throw new Error("Clé Kie absente du coffre");
  return k;
}
async function kieCreate(model, input) {
  const r = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
    method: "POST",
    headers: { Authorization: `Bearer ${kieKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  }).then((x) => x.json());
  if (!r.data?.taskId) throw new Error(`Kie ${model} : ${r.msg || JSON.stringify(r).slice(0, 150)}`);
  return r.data.taskId;
}
// Runs annulés : les boucles de polling s'arrêtent immédiatement
const cancelledRuns = new Set();
async function kiePoll(taskId, { timeoutMs = 15 * 60 * 1000, intervalMs = 15000, runId } = {}) {
  const t0 = Date.now();
  while (true) {
    await new Promise((res) => setTimeout(res, intervalMs));
    if (runId && cancelledRuns.has(runId)) {
      // Meilleur effort côté Kie (endpoint non garanti — le job distant peut finir seul)
      fetch("https://api.kie.ai/api/v1/jobs/cancelTask", {
        method: "POST",
        headers: { Authorization: `Bearer ${kieKey()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      }).catch(() => {});
      throw new Error("Annulée par l'utilisateur");
    }
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

// ---------- Étape 2 : images ----------
async function generateImage(run, scene) {
  const c = config();
  const character = c.characters.find((x) => x.id === run.params.characterId);
  const dir = path.join(OUT_ROOT, run.id);
  ensureDir(dir);
  // Référence personnage rendue publique sur Drive (une fois par run)
  if (!run.refUrl) {
    const refAbs = path.join(__dirname, "..", "..", "..", character.referenceRel);
    const up = await google.driveUpload(`machine-ref-${character.name}.png`, "image/png", fs.readFileSync(refAbs));
    run.refUrl = `https://drive.google.com/uc?export=download&id=${up.id}`;
    saveRun(run);
  }
  // Modèle d'image choisi dans les paramètres (ids exacts repris du studio)
  const IMG_PRICE = { gpt: 0.03, nano: 0.02, grok: 0.02, seedream: 0.0275 };
  const toolId = IMG_PRICE[c.settings.imageModel] ? c.settings.imageModel : "gpt";
  const conf = require("../studio").TOOLS[toolId].i2i;
  // Garde-fou : la référence ne donne QUE le visage + les cheveux. La tenue vient du PROMPT
  // (tenue signature identique à chaque scène) ; on ignore la boussole/objet tenu dans la référence.
  const IDENTITY_ONLY = " Use ONLY the person's face and hair from the reference image. Her clothing is exactly as described in this prompt — the same signature modern outfit in every scene. Do NOT copy or add the compass or any object held in the reference image.";
  const promptMax = conf.promptMax || 3000;
  const input = { prompt: scene.image_prompt.slice(0, promptMax - IDENTITY_ONLY.length) + IDENTITY_ONLY, aspect_ratio: "16:9" };
  if (toolId === "gpt") input.resolution = "1K";
  // Cache-buster : une régénération sans instructions doit produire une NOUVELLE image
  input[conf.imgField || "input_urls"] = [run.refUrl + "&r=" + Date.now().toString(36)];
  scene.rendering = true; // marqueur « en cours de rendu » (barre de chargement UI)
  saveRun(run);
  try {
    const prev = await kieRecover(scene.pendingImg, scene.image_prompt);
    let url = prev?.url;
    if (!url) {
      const taskId = prev?.taskId || (await kieCreate(conf.model, input));
      scene.pendingImg = { id: taskId, prompt: scene.image_prompt };
      saveRun(run);
      url = await kiePoll(taskId, { timeoutMs: 8 * 60 * 1000, runId: run.id });
    }
    const file = path.join(dir, `scene-${scene.i}.png`);
    await download(url, file);
    // Publique sur Drive pour Grok
    const up = await google.driveUpload(`${run.id}-scene-${scene.i}.png`, "image/png", fs.readFileSync(file));
    scene.image = {
      rel: `agent-os/output/machines/${run.id}/scene-${scene.i}.png`,
      driveUrl: `https://drive.google.com/uc?export=download&id=${up.id}`,
      ts: Date.now(), // cache-buster : le fichier garde le même nom, l'UI doit recharger l'image régénérée
    };
    delete scene.pendingImg;
    run.cost.images += IMG_PRICE[toolId];
    delete scene.error; // succès : efface une éventuelle erreur précédente
    spend.record("Kie.ai", "Time Travel", IMG_PRICE[toolId], "USD", `Image scène ${scene.i} (${toolId})`);
  } finally {
    delete scene.rendering;
    saveRun(run);
  }
}

// ---------- Étape 3 : vidéos (Grok 1.5, voix intégrée) ----------
async function generateVideo(run, scene) {
  const clip = Number(config().settings.clipSeconds) || 10;
  const dir = path.join(OUT_ROOT, run.id);
  ensureDir(dir);
  if (!scene.image?.driveUrl) throw new Error(`Scène ${scene.i} : pas d'image de référence — génère l'image d'abord`);
  // Pré-vol : l'image doit être réellement téléchargeable par Grok (une permission Drive
  // qui a raté en silence = vidéo tournée sans le personnage)
  const head = await fetch(scene.image.driveUrl, { method: "HEAD", redirect: "follow" }).catch(() => null);
  if (!head || !head.ok) {
    const id = /id=([\w-]+)/.exec(scene.image.driveUrl)?.[1];
    if (id) await google.ensurePublic(id);
    const retry = await fetch(scene.image.driveUrl, { method: "HEAD", redirect: "follow" }).catch(() => null);
    if (!retry || !retry.ok) throw new Error(`Scène ${scene.i} : image de référence inaccessible publiquement (Drive)`);
  }
  // Grok attend image_urls (PAS input_urls, qu'il ignore en silence → vidéo sans le personnage).
  // Cache-buster : payload unique à chaque tentative, sinon Kie peut resservir un job identique.
  scene.rendering = true; // barre de chargement UI (uniquement les scènes réellement en vol)
  saveRun(run);
  try {
    const prev = await kieRecover(scene.pendingVid, scene.video_prompt);
    let url = prev?.url;
    if (!url) {
      const taskId = prev?.taskId || (await kieCreate("grok-imagine-video-1-5-preview", {
        prompt: scene.video_prompt,
        image_urls: [scene.image.driveUrl + "&r=" + Date.now().toString(36)],
        duration: clip,
        resolution: "720p",
        aspect_ratio: "16:9",
      }));
      scene.pendingVid = { id: taskId, prompt: scene.video_prompt };
      saveRun(run);
      url = await kiePoll(taskId, { timeoutMs: 20 * 60 * 1000, runId: run.id });
    }
    const file = path.join(dir, `scene-${scene.i}.mp4`);
    await download(url, file);
    scene.video = { url, rel: `agent-os/output/machines/${run.id}/scene-${scene.i}.mp4`, file, ts: Date.now() };
    delete scene.pendingVid;
    run.cost.videos += PRICES.videoPerSec * clip;
    delete scene.error; // succès : efface une éventuelle erreur précédente
    spend.record("Kie.ai", "Time Travel", PRICES.videoPerSec * clip, "USD", `Vidéo scène ${scene.i} (${clip}s)`);
  } finally {
    delete scene.rendering;
    saveRun(run);
  }
}

// ---------- Étape 4 : montage HYBRIDE (Remotion pour le CTA, FFmpeg pour l'assemblage) ----------
// Remotion re-rendait CHAQUE frame de la vidéo finale via Chromium + OffthreadVideo : sur 60 clips
// (18000 frames) ça se figeait. Désormais FFmpeg concatène les clips DÉJÀ rendus (rapide, fiable),
// et Remotion ne rend QUE le bouton CTA animé en clip transparent court (aucune vidéo source →
// pas de blocage), que FFmpeg incruste aux bons instants.
const CTA_LABELS = {
  English: "Subscribe ▶", "Français": "Abonne-toi ▶", "Español": "¡Suscríbete! ▶", Deutsch: "Abonnieren ▶",
  Italiano: "Iscriviti ▶", "Português": "Inscreva-se ▶", "日本語": "チャンネル登録 ▶", "한국어": "구독 ▶",
  "العربية": "اشترك ▶", "हिन्दी": "सब्सक्राइब करें ▶", "Русский": "Подпишись ▶", "中文": "订阅 ▶",
};

// Rendu du bouton CTA animé (Remotion) en SÉQUENCE PNG : l'encodage vidéo de Remotion écrase
// le canal alpha, mais chaque PNG le conserve → vraie transparence à l'incrustation. Chemins
// RELATIFS au dossier remotion (les espaces du projet cassent le parsing --props sous Windows).
function renderCtaClip(run, label) {
  return new Promise((resolve, reject) => {
    const rel = `cta-${run.id}`;
    fs.writeFileSync(path.join(REMOTION_DIR, rel + ".json"), JSON.stringify({ label })); // utf8 sans BOM
    const child = spawn("npx", ["remotion", "render", "CtaClip", rel, "--sequence", "--image-format=png", `--props=${rel}.json`], { cwd: REMOTION_DIR, shell: true, windowsHide: true });
    let err = "";
    child.stdout.on("data", () => {}); // drainer stdout : un pipe non lu (64 Ko) fige le rendu
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      const folder = path.join(REMOTION_DIR, rel);
      if (code === 0 && fs.existsSync(path.join(folder, "element-000.png"))) resolve(folder);
      else reject(new Error(err.slice(-300) || "code " + code));
    });
  });
}

async function renderMontage(run) {
  const dir = path.join(OUT_ROOT, run.id);
  // Ne monte que les scènes réellement tournées (une scène échouée n'interrompt pas le montage)
  const ready = run.scenes.filter((s) => s.video);
  if (!ready.length) throw new Error("Aucune vidéo à monter");
  if (ready.length < run.scenes.length) log(run, `⚠ Montage de ${ready.length}/${run.scenes.length} scènes (les manquantes sont exclues).`);
  const c = config();
  const clip = Number(c.settings.clipSeconds) || 10;
  const character = c.characters.find((x) => x.id === run.params.characterId) || {};
  const label = CTA_LABELS[character.language] || "Subscribe ▶";
  const total = ready.length * clip;
  const every = (Number(c.settings.ctaEveryMin) || 2) * 60;
  const starts = [];
  for (let t = 1; t < total - 4; t += every) starts.push(t);

  // Phase 1 : bouton CTA animé (Remotion, séquence PNG transparente) — best-effort
  let ctaSeq = null;
  if (starts.length) {
    try {
      log(run, `Rendu du bouton CTA animé « ${label} » (Remotion)…`);
      ctaSeq = await renderCtaClip(run, label);
    } catch (e) {
      log(run, "CTA Remotion indisponible (" + String(e.message).slice(0, 80) + ") — montage sans bouton animé");
    }
  }

  // Phase 2 : concaténation + incrustation du CTA (FFmpeg)
  const outFile = path.join(dir, "final.mp4");
  const inputs = [];
  const vparts = [];
  const aparts = [];
  ready.forEach((s, i) => {
    inputs.push("-i", path.join(dir, `scene-${s.i}.mp4`));
    vparts.push(`[${i}:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:-1:-1:color=black,setsar=1,fps=30[v${i}]`);
    aparts.push(`[${i}:a]aresample=48000[a${i}]`);
  });
  const N = ready.length;
  const concatIns = ready.map((_, i) => `[v${i}][a${i}]`).join("");
  let filter = `${vparts.join(";")};${aparts.join(";")};${concatIns}concat=n=${N}:v=1:a=1[base][ca]`;
  let vmap = "[base]";
  if (ctaSeq && starts.length) {
    inputs.push("-framerate", "30", "-start_number", "0", "-i", path.join(ctaSeq, "element-%03d.png")); // entrée N = séquence PNG (alpha)
    filter += `;[${N}:v]format=rgba,split=${starts.length}${starts.map((_, k) => `[k${k}]`).join("")}`;
    starts.forEach((S, k) => (filter += `;[k${k}]setpts=PTS+${S}/TB[c${k}]`));
    let cur = "[base]";
    starts.forEach((S, k) => {
      const nl = k === starts.length - 1 ? "[vout]" : `[o${k}]`;
      filter += `;${cur}[c${k}]overlay=0:0:eof_action=pass:enable='between(t,${S},${S + 4})'${nl}`;
      cur = nl;
    });
    vmap = "[vout]";
  }
  const args = ["-y", ...inputs, "-filter_complex", filter, "-map", vmap, "-map", "[ca]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", outFile];
  log(run, `Montage FFmpeg : ${N} clips concaténés${ctaSeq ? ` + CTA incrusté (${starts.length}×)` : ""}…`);
  await new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { windowsHide: true });
    let err = "";
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => reject(new Error("FFmpeg introuvable : " + e.message)));
    child.on("close", (code) => {
      if (code === 0 && fs.existsSync(outFile)) resolve();
      else reject(new Error("FFmpeg montage : " + err.slice(-500)));
    });
  });
  // Nettoyage des fichiers temporaires du CTA
  try {
    if (ctaSeq) fs.rmSync(ctaSeq, { recursive: true, force: true });
    fs.unlinkSync(path.join(REMOTION_DIR, `cta-${run.id}.json`));
  } catch {}
  return outFile;
}

// ---------- Étape 5 : packaging (titre, description, tags, miniature) ----------
async function generatePackaging(run) {
  const c = config();
  const character = c.characters.find((x) => x.id === run.params.characterId) || {};
  const inspiration = c.nicheId ? bank.inspiration(c.nicheId, { maxTitles: 15, maxVisions: 0 }) : "";
  const prompt = [
    "Tu prépares la PUBLICATION YouTube d'un vlog de voyage dans le temps.",
    `Thème : ${JSON.stringify(run.theme)}. Langue du personnage (et de la vidéo) : ${character.language}.`,
    `Scènes (voix off) : ${JSON.stringify(run.scenes.map((s) => ({ i: s.i, voiceover: s.voiceover })))}`,
    inspiration,
    "Fournis :",
    "- title : titre YouTube dans la langue du personnage, calqué sur les codes des titres concurrents (émotion, curiosité, « I … »).",
    "  Vise 85-100 caractères (JAMAIS moins de 70) sans dépasser 100 — exploite la longueur disponible (accroche + précision d'époque/lieu/enjeu).",
    "- description : description YouTube dans la langue du personnage — accroche 2 lignes, résumé de l'histoire, 3-5 hashtags — max 1000 caractères",
    "- tags : BEAUCOUP de mots-clés (langue du personnage + anglais + variantes/longue traîne). Vise 480-500 caractères une fois joints par",
    "  des virgules (le maximum YouTube est 500) — remplis au maximum, ne descends pas sous 450.",
    `- thumb_scene : le numéro de la scène dont le décor/l'action fera la meilleure miniature (spectacle maximal)`,
    `- thumb_prompt : prompt EN (>= 300 caractères) pour une miniature YouTube cliquable mettant en scène LE MÊME personnage`,
    `  (${character.name}, ${character.appearance}) — visage et cheveux IDENTIQUES à la référence, gros plan sur son émotion FORTE`,
    "  (peur, effroi, stupeur), arrière-plan spectaculaire de l'événement, couleurs saturées très contrastées, AUCUN texte dans l'image.",
    'RÉPONDS UNIQUEMENT EN JSON (aucun texte autour) : {"title":"...","description":"...","tags":["..."],"thumb_scene":1,"thumb_prompt":"..."}',
  ].join("\n");
  const p = claude.parseJson(await askGen(prompt));
  run.pack = { title: p.title || run.theme?.title || "Time travel vlog", description: p.description || "", tags: Array.isArray(p.tags) ? p.tags : [] };
  saveRun(run);
  try {
    await generateThumbnail(run, p.thumb_prompt);
  } catch (e) {
    const scene = run.scenes.find((s) => s.i === Number(p.thumb_scene)) || run.scenes[0];
    log(run, "Miniature : " + e.message + " — image de scène utilisée en secours");
    run.pack.thumbRel = scene && scene.image ? scene.image.rel : null;
    saveRun(run);
  }
  log(run, `Packaging prêt : « ${run.pack.title} »`);
}

// Génère la miniature (i2i ancré sur la RÉFÉRENCE du personnage — visage/cheveux garantis —
// pas sur l'image de scène, qu'un prompt « gros plan » régénérait en une autre personne).
async function generateThumbnail(run, thumbPrompt) {
  const c = config();
  const character = c.characters.find((x) => x.id === run.params.characterId) || {};
  const scene = run.scenes.find((s) => s.image) || run.scenes[0];
  const conf = require("../studio").TOOLS.gpt.i2i;
  const IDENT = ` Use ONLY the exact same woman's face and hair as in the reference image (${character.name}) — same person, same signature modern outfit; do not change her identity, do not add a compass or held objects. No text anywhere in the image.`;
  const base = thumbPrompt || "Dramatic clickable YouTube thumbnail: emotional shocked close-up of the character, spectacular disaster background, saturated contrasted colors";
  const input = { prompt: base.slice(0, 3000 - IDENT.length) + IDENT, aspect_ratio: "16:9", resolution: "1K" };
  const identityRef = run.refUrl || (scene && scene.image && scene.image.driveUrl);
  if (!identityRef) throw new Error("Pas de référence de personnage pour la miniature");
  input[conf.imgField || "input_urls"] = [identityRef + "&r=" + Date.now().toString(36)];
  const taskId = await kieCreate(conf.model, input);
  const url = await kiePoll(taskId, { timeoutMs: 8 * 60 * 1000, runId: run.id });
  await download(url, path.join(OUT_ROOT, run.id, "thumbnail.png"));
  run.pack = run.pack || {};
  run.pack.thumbRel = `agent-os/output/machines/${run.id}/thumbnail.png`;
  run.pack.thumbTs = Date.now(); // anti-cache navigateur après régénération
  run.cost.images += PRICES.image;
  spend.record("Kie.ai", "Time Travel", PRICES.image, "USD", "Miniature");
  saveRun(run);
}

// Régénère UNIQUEMENT la miniature, en tenant compte d'une observation optionnelle.
async function regenThumbnail(runId, instructions) {
  const run = getRun(runId);
  if (!run.finalRel && !(run.scenes || []).some((s) => s.image)) throw new Error("Rien à illustrer pour la miniature");
  const c = config();
  const character = c.characters.find((x) => x.id === run.params.characterId) || {};
  let thumbPrompt = null;
  try {
    const p = claude.parseJson(
      await askGen(
        [
          "Écris le prompt EN d'une MINIATURE YouTube cliquable pour un vlog de voyage dans le temps.",
          `Thème : ${JSON.stringify(run.theme)}.`,
          `Personnage (identique, à ne pas changer) : ${character.name}, ${character.appearance}.`,
          instructions ? `OBSERVATION DE L'UTILISATEUR (à respecter absolument) : ${instructions}` : "Rends-la la plus cliquable et spectaculaire possible.",
          "Gros plan sur l'émotion FORTE du personnage (visage/cheveux identiques à la référence), arrière-plan spectaculaire de l'événement,",
          "couleurs saturées très contrastées, >= 300 caractères, AUCUN texte dans l'image.",
          'RÉPONDS UNIQUEMENT EN JSON : {"thumb_prompt":"..."}',
        ].join("\n"),
        4 * 60 * 1000
      )
    );
    thumbPrompt = p.thumb_prompt;
  } catch (e) {
    thumbPrompt = instructions || null; // repli : on passe l'observation brute
  }
  await generateThumbnail(run, thumbPrompt);
  return getRun(runId);
}

// Régénère un texte de packaging (pas la miniature) : field = "title" | "description" |
// "tags" (ou vide = les trois), avec observation optionnelle.
async function regenTexts(runId, instructions, field) {
  const run = getRun(runId);
  const c = config();
  const character = c.characters.find((x) => x.id === run.params.characterId) || {};
  const inspiration = c.nicheId ? bank.inspiration(c.nicheId, { maxTitles: 15, maxVisions: 0 }) : "";
  const SPECS = {
    title: "- title : dans la langue du personnage, codes des concurrents (émotion, curiosité, « I … »). Vise 85-100 caractères (jamais < 70, max 100).",
    description: "- description : accroche 2 lignes + résumé de l'histoire + 3-5 hashtags, max 1000 caractères.",
    tags: "- tags : BEAUCOUP de mots-clés (langue + anglais + variantes/longue traîne). Vise 480-500 caractères joints par virgules (max 500, jamais < 450).",
  };
  const one = SPECS[field] ? field : null;
  const FR = { title: "le TITRE", description: "la DESCRIPTION", tags: "les TAGS" };
  const specLines = one ? [SPECS[one]] : [SPECS.title, SPECS.description, SPECS.tags];
  const schema = one ? (one === "tags" ? '{"tags":["..."]}' : `{"${one}":"..."}`) : '{"title":"...","description":"...","tags":["..."]}';
  const p = claude.parseJson(
    await askGen(
      [
        `Tu améliores le packaging YouTube d'un vlog de voyage dans le temps (la vidéo est déjà montée). Réécris ${one ? FR[one] : "le TITRE, la DESCRIPTION et les TAGS"}.`,
        `Thème : ${JSON.stringify(run.theme)}. Langue du personnage (et de la vidéo) : ${character.language}.`,
        `Scènes (voix off) : ${JSON.stringify(run.scenes.map((s) => ({ i: s.i, voiceover: s.voiceover })))}`,
        instructions ? `OBSERVATION DE L'UTILISATEUR (à respecter absolument) : ${instructions}` : "Propose une NOUVELLE variante, différente de l'actuelle, plus accrocheuse.",
        run.pack ? `Versions actuelles (à varier/améliorer) : titre = « ${run.pack.title || ""} » (${(run.pack.title || "").length} car) ; ${(run.pack.tags || []).length} tags.` : "",
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
  if ((!one || one === "tags") && Array.isArray(p.tags) && p.tags.length) run.pack.tags = p.tags;
  saveRun(run);
  log(run, `${one ? FR[one].replace(/^l(e|a|es) /, "") : "Textes"} régénéré(s)` + (instructions ? ` — « ${instructions.slice(0, 50)} »` : ""));
  return getRun(runId);
}

// ---------- Stock de vidéos terminées ----------
function stock() {
  return readJSON("machines/stock.json", []);
}
// Archiver / désarchiver / marquer publiée à la main (vidéo postée hors Agentic Os).
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
  writeJSON("machines/stock.json", list);
  return v;
}
function addToStock(run) {
  const list = stock();
  if (list.some((v) => v.runId === run.id)) return;
  const c = config();
  const ch = c.characters.find((x) => x.id === run.params.characterId) || {};
  list.push({
    id: "v" + Date.now().toString(36),
    runId: run.id,
    title: run.pack?.title || run.theme?.title || run.id,
    description: run.pack?.description || "",
    tags: run.pack?.tags || [],
    thumbRel: run.pack?.thumbRel || null,
    finalRel: run.finalRel,
    language: ch.language || "",
    durationSec: run.params.durationSec,
    createdAt: new Date().toISOString(),
    posted: false,
    channelId: null,
    videoId: null,
  });
  writeJSON("machines/stock.json", list);
}

// ---------- Publication YouTube (upload resumable + miniature) ----------
async function publishRun(runId, { channelId, title, description, tags, privacyStatus } = {}) {
  const run = getRun(runId);
  if (!run.finalRel) throw new Error("Pas de vidéo finale à publier");
  if (!channelId) throw new Error("Choisis une chaîne");
  const ROOT = path.join(__dirname, "..", "..", "..");
  // Upload résumable par chunks + erreurs lisibles (scope upload manquant, quota…) — helper partagé.
  const finalTitle = (title || run.pack?.title || "Time travel vlog").slice(0, 100);
  const vid = await google.youtubeUpload(channelId, path.join(ROOT, run.finalRel), {
    title: finalTitle,
    description: description || run.pack?.description || "",
    tags: (tags && tags.length ? tags : run.pack?.tags || []).slice(0, 60),
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
    writeJSON("machines/stock.json", list);
  }
  tasks.emit("video_published", { title: finalTitle, machine: "Time Travel", kind: "video", detail: "https://youtube.com/watch?v=" + vid.id }).catch(() => {});
  log(run, "Publiée sur YouTube : https://youtube.com/watch?v=" + vid.id);
  return { videoId: vid.id, url: "https://youtube.com/watch?v=" + vid.id };
}

// ---------- Orchestration ----------
// Référence personnage uploadée sur Drive UNE seule fois (avant le pool parallèle,
// pour éviter que 10 générations simultanées la ré-uploadent chacune).
async function ensureRefUrl(run) {
  if (run.refUrl) return;
  const c = config();
  const character = c.characters.find((x) => x.id === run.params.characterId);
  const refAbs = path.join(__dirname, "..", "..", "..", character.referenceRel);
  const up = await google.driveUpload(`machine-ref-${character.name}.png`, "image/png", fs.readFileSync(refAbs));
  run.refUrl = `https://drive.google.com/uc?export=download&id=${up.id}`;
  saveRun(run);
}

// Pool de concurrence : TOUJOURS `concurrency` tâches en vol — dès qu'une finit, la
// suivante démarre (pas d'attente de fin de lot). Seule l'annulation interrompt le pool.
async function pool(items, worker, concurrency = 10) {
  const q = items.slice();
  let aborted = null;
  const runOne = async () => {
    while (q.length && !aborted) {
      const item = q.shift();
      try {
        await worker(item);
      } catch (e) {
        aborted = e; // seul un throw (annulation) arrive ici : les autres erreurs sont gérées en amont
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, q.length) }, runOne));
  if (aborted) throw aborted;
}

// Génération d'UNE scène avec relances automatiques : sur échec (souvent un refus de
// politique de contenu), on réécrit le prompt via Claude pour le faire passer, puis on
// retente — jusqu'à MAX_TRIES. Objectif « coûte que coûte » (surtout en mode auto).
const MAX_TRIES = 3;
async function genWithRetry(run, scene, kind) {
  const gen = kind === "image" ? generateImage : generateVideo;
  const field = kind === "image" ? "image_prompt" : "video_prompt";
  const fr = kind === "image" ? "Image" : "Vidéo";
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    try {
      await gen(run, scene);
      return;
    } catch (e) {
      if (/Annulée/.test(e.message)) throw e; // annulation = abandon réel du pool
      log(run, `${fr} scène ${scene.i} : tentative ${attempt}/${MAX_TRIES} échouée (${e.message.slice(0, 70)})`);
      if (attempt >= MAX_TRIES) {
        scene.error = e.message;
        delete scene.rendering;
        saveRun(run);
        return;
      }
      // Réécrit le prompt pour contourner l'échec sans changer le sens de la scène
      try {
        const c = config();
        const character = c.characters.find((x) => x.id === run.params.characterId);
        const fix = claude.parseJson(
          await askGen(
            [
              `Une génération ${kind === "image" ? "d'IMAGE" : "de VIDÉO"} a ÉCHOUÉ. Réécris le prompt pour qu'il PASSE cette fois, SANS changer le sens de la scène.`,
              `Raison de l'échec : ${e.message}`,
              coreRules(character, Number(c.settings.clipSeconds) || 10),
              `Prompt actuel : ${scene[field]}`,
              "Si c'est un refus de politique de contenu : rends la violence / la mort / le sang SUGGÉRÉS et pudiques (jamais explicites), sans corps ni blessures montrés — garde l'émotion, l'action, le décor, la tenue signature et le personnage. Respecte le noyau dur.",
              `RÉPONDS UNIQUEMENT EN JSON : {"${field}":"..."}`,
            ].join("\n"),
            4 * 60 * 1000
          )
        );
        if (fix[field]) {
          scene[field] = fix[field];
          saveRun(run);
          log(run, `Prompt ${kind} scène ${scene.i} réécrit pour la tentative ${attempt + 1}.`);
        }
      } catch (rw) {
        /* réécriture indisponible : on retente le prompt tel quel (cache-buster) */
      }
    }
  }
}

/**
 * Fin d'étape : DEUXIÈME VAGUE, puis VERROU.
 *
 * 1) Deuxième vague — un échec en masse est presque toujours transitoire (API qui tousse,
 *    ressources système saturées). genWithRetry a déjà réessayé MAX_TRIES fois d'affilée ;
 *    on laisse respirer, puis on relance UNIQUEMENT ce qui manque — jamais ce qui a réussi.
 * 2) Verrou — s'il manque encore quelque chose, l'étape N'EST PAS FRANCHIE. Se contenter d'un ⚠
 *    dans le log laissait le pipeline avancer sur un état troué et mourir au montage, deux
 *    étapes plus loin, avec un message sans rapport avec la cause (constaté sur Linguistique,
 *    run rms69ual7 : montage lancé avec 0 clip sur 27).
 *    En mode semi c'est l'utilisateur qui arbitre (validate() bloque déjà) : on l'informe.
 */
async function finishStep(run, { kind, field, label, concurrency, tick, eligible }) {
  let missing = run.scenes.filter((s) => !s[field]);
  const retryable = () => missing.filter((s) => (eligible ? eligible(s) : true));
  if (retryable().length) {
    log(run, `⚠ ${missing.length} ${label} manquant(s) — pause de 20 s, puis deuxième vague sur ces scènes seules…`);
    await new Promise((r) => setTimeout(r, 20000));
    if (cancelledRuns.has(run.id)) throw new Error("Annulée par l'utilisateur");
    await pool(retryable(), (s) => genWithRetry(run, s, kind).then(tick), concurrency);
    missing = run.scenes.filter((s) => !s[field]);
  }
  if (!missing.length) return;
  const why = (missing.find((s) => s.error) || {}).error || "cause inconnue";
  const list = missing.slice(0, 8).map((s) => s.i).join(", ") + (missing.length > 8 ? "…" : "");
  const msg = `${missing.length}/${run.scenes.length} ${label} manquant(s) (scène ${list}) — ${why}`;
  if (run.mode === "auto") throw new Error(`${msg}. Étape non franchie : corrige la cause, puis « Reprendre ».`);
  log(run, `⚠ ${msg} — régénère-les (↻) avant de valider.`);
}

async function stepImages(run) {
  const total = run.scenes.length;
  const tick = () => {
    const done = run.scenes.filter((s) => s.image).length;
    const live = run.scenes.filter((s) => s.rendering).length;
    tasks.updateTask(run.taskId, { step: `Images : ${done}/${total} générées · ${live} en cours…`, progress: 30 + Math.round((25 * done) / total), status: "running" }).catch(() => {});
  };
  const pend = run.scenes.filter((s) => !s.image);
  if (!pend.length) return;
  await ensureRefUrl(run); // upload de la référence AVANT le pool (une seule fois)
  tick();
  log(run, `Génération des images : ${pend.length} scène(s), 10 en parallèle en continu…`);
  await pool(pend, (s) => genWithRetry(run, s, "image").then(tick), 10);
  await finishStep(run, { kind: "image", field: "image", label: "image(s)", concurrency: 10, tick });
}
async function stepVideos(run) {
  const total = run.scenes.length;
  const tick = () => {
    const done = run.scenes.filter((s) => s.video).length;
    const live = run.scenes.filter((s) => s.rendering).length;
    tasks.updateTask(run.taskId, { step: `Vidéos : ${done}/${total} tournées · ${live} en cours…`, progress: 58 + Math.round((25 * done) / total), status: "running" }).catch(() => {});
  };
  const pend = run.scenes.filter((s) => !s.video && s.image); // sans image de réf : on saute
  if (pend.length) tick();
  log(run, `Tournage des vidéos : ${pend.length} scène(s), 10 en parallèle en continu…`);
  await pool(pend, (s) => genWithRetry(run, s, "video").then(tick), 10);
  // Une vidéo ne se retente que si son image de référence existe (sinon c'est l'étape d'avant).
  await finishStep(run, { kind: "video", field: "video", label: "vidéo(s)", concurrency: 10, tick, eligible: (s) => s.image });
}

// Runs dont un advance() est actuellement en vol (pour savoir qui écrit l'état final)
const activeAdvance = new Set();

/**
 * Annule un run : stoppe le pipeline et les pollings en cours, et MÉMORISE l'étape en
 * cours (cancelledFrom) pour que la reprise redémarre exactement là où on s'est arrêté.
 */
function cancelRun(id) {
  const run = getRun(id);
  cancelledRuns.add(id);
  if (run.status !== "done" && run.status !== "failed" && !run.cancelledFrom) run.cancelledFrom = run.status;
  tasks.updateTask(run.taskId, { step: "Annulée par l'utilisateur", status: "failed" }).catch(() => {});
  if (!activeAdvance.has(id)) {
    // Aucune génération en vol (run à l'arrêt sur une étape validable) : on écrit l'état ici.
    run.status = "failed";
    run.error = "Annulée par l'utilisateur";
    log(run, "Run annulé");
    saveRun(run);
  } else {
    // Une génération tourne : advance() détectera l'annulation et écrira l'état final
    // (en conservant les scènes déjà produites). On persiste juste cancelledFrom.
    saveRun(run);
    log(run, "Annulation demandée — abandon des requêtes en cours…");
  }
  return getRun(id);
}

/** Étape la plus avancée réellement atteinte, déduite des données (reprise de secours). */
function deriveStatus(run) {
  // Tant que TOUTES les scènes attendues ne sont pas écrites, on reste aux prompts : un run
  // de prompts partiel (ex. planté à 50/60) ne doit JAMAIS sauter aux images.
  if (!promptsComplete(run)) return "prompts_running";
  if (run.scenes.some((s) => !s.image)) return "images_running";
  if (run.scenes.some((s) => !s.video)) return "videos_running";
  if (!run.finalRel) return "montage_running";
  if (!run.pack) return "packaging_running";
  return "done";
}

/**
 * Reprend un run après annulation / interruption. On repart de l'étape mémorisée
 * (cancelledFrom) : une étape « _ready » revient en attente de validation, une étape
 * « _running » reprend et ne refait QUE ce qui manque (les scènes déjà produites sont gardées).
 */
function resumeRun(id, forcedStatus) {
  if (activeAdvance.has(id)) throw new Error("Le run tourne déjà — la décharge ⚡ n'est utile que s'il est à l'arrêt.");
  const run = getRun(id);
  cancelledRuns.delete(id);
  const status = forcedStatus || run.cancelledFrom || (run.status === "failed" ? deriveStatus(run) : run.status);
  run.status = status;
  run.error = null;
  delete run.cancelledFrom;
  (run.scenes || []).forEach((s) => {
    delete s.rendering; // marqueurs de rendu périmés
    delete s.pending;
  });
  saveRun(run);
  log(run, `Reprise à l'étape « ${status.replace("_running", " (en cours)").replace("_ready", " (validé)")} »`);
  advance(run.id);
  return getRun(id);
}

async function advance(runId) {
  cancelledRuns.delete(runId); // une reprise ré-arme le run
  activeAdvance.add(runId);
  const run = getRun(runId);
  const auto = run.mode === "auto";
  let curStep = run.status; // dernière étape entamée (pour mémoriser le point d'annulation)
  // Chaque mise à jour ré-affirme status running : une tâche marquée « failed » par un
  // redémarrage (sweepOrphans) redevient visible dans « En cours » quand le run reprend
  const t = (patch) => tasks.updateTask(run.taskId, Object.assign({ status: "running" }, patch)).catch(() => {});
  try {
    // Préflight : ffmpeg/ffprobe doivent répondre AVANT de dépenser en images et en vidéos.
    await ff.ensureTools();
    while (true) {
      curStep = run.status;
      if (cancelledRuns.has(runId)) throw new Error("Annulée par l'utilisateur");
      if (run.status === "prompts_running") {
        await t({ step: "Écriture des prompts (Claude)…", progress: 10 });
        await generatePrompts(run);
        run.status = auto ? "images_running" : "prompts_ready";
      } else if (run.status === "images_running") {
        await t({ step: "Génération des images (GPT Image 2)…", progress: 35 });
        await stepImages(run);
        run.status = auto ? "videos_running" : "images_ready";
      } else if (run.status === "videos_running") {
        await t({ step: "Génération des vidéos (Grok 1.5)…", progress: 60 });
        await stepVideos(run);
        run.status = auto ? "montage_running" : "videos_ready";
      } else if (run.status === "montage_running") {
        await t({ step: "Montage Remotion…", progress: 82 });
        const out = await renderMontage(run);
        run.finalRel = `agent-os/output/machines/${run.id}/final.mp4`;
        run.status = "packaging_running";
        log(run, "Montage terminé : " + out);
      } else if (run.status === "packaging_running") {
        await t({ step: "Packaging : titre, description, tags, miniature…", progress: 90 });
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
      if (!auto && ["prompts_ready", "images_ready", "videos_ready"].includes(run.status)) break;
      if (run.status === "done") break;
    }
    if (run.status === "done") {
      await t({
        step: `Vidéo finale prête (${run.scenes.length} scènes, ${(run.cost.images + run.cost.videos).toFixed(2)}$)`,
        progress: 100,
        status: "done",
      });
    } else if (!auto) {
      await t({ step: `En attente de validation (${run.status.replace("_ready", "")})`, progress: run.status === "prompts_ready" ? 25 : run.status === "images_ready" ? 50 : 75 });
    }
  } catch (e) {
    const cancelled = cancelledRuns.has(runId) || /Annulée/.test(e.message);
    // Relit l'état disque : conserve les scènes produites par les autres promesses du lot
    const fresh = getRun(runId);
    fresh.status = "failed";
    fresh.error = cancelled ? "Annulée par l'utilisateur" : e.message;
    if (cancelled && !fresh.cancelledFrom) fresh.cancelledFrom = curStep;
    (fresh.scenes || []).forEach((s) => {
      delete s.rendering;
      delete s.pending;
    });
    log(fresh, cancelled ? "Run annulé — les requêtes en cours sont abandonnées" : "ÉCHEC : " + e.message);
    saveRun(fresh);
    await t({ step: fresh.error, status: "failed" });
  } finally {
    activeAdvance.delete(runId);
  }
  return getRun(runId);
}

function createRun({ characterId, durationSec, theme, mode, publishChannelId, publishPrivacy, allowNoPublish }) {
  const c = config();
  if (!c.characters.find((x) => x.id === characterId)) throw new Error("Choisis un personnage");
  // allowNoPublish : une commande explicite « vers stock » (restock/calendrier) passe outre l'autoPublish de la config
  if (c.autoPublish && !publishChannelId && !allowNoPublish) throw new Error("Publication auto activée : choisis la chaîne de publication");
  const dur = Number(durationSec) || 60;
  const clip = Number(c.settings.clipSeconds) || 10;
  const run = {
    id: "r" + Date.now().toString(36),
    machineId: "timetravel",
    mode: mode === "auto" ? "auto" : "semi",
    params: { characterId, durationSec: dur, theme: theme || null, publishChannelId: publishChannelId || null, publishPrivacy: publishPrivacy || "private" },
    sceneCount: Math.max(1, Math.round(dur / clip)), // figé : la reprise sait combien de scènes viser
    status: "prompts_running",
    theme: theme || null,
    scenes: [],
    cost: { images: 0, videos: 0 },
    createdAt: new Date().toISOString(),
    log: [],
  };
  const task = tasks.createTask({
    title: `Time Travel — run ${run.id} (${run.mode})`,
    desc: `${run.params.durationSec}s · personnage ${c.characters.find((x) => x.id === characterId).name}`,
    machine: "Time Travel",
    machineId: "timetravel",
    runId: run.id,
    kind: "video",
    step: "Démarrage…",
    progress: 5,
    status: "running",
  });
  run.taskId = task.id;
  saveRun(run);
  advance(run.id); // asynchrone
  return run;
}

/** Validation d'une étape en mode semi-manuel -> passe à l'étape suivante. */
function validate(runId) {
  const run = getRun(runId);
  // On NE valide PAS pendant qu'une régénération tourne (image/vidéo pas encore prête)
  const busy = (run.scenes || []).filter((s) => s.pending || s.rendering);
  if (busy.length) throw new Error(`Régénération en cours (scène${busy.length > 1 ? "s" : ""} ${busy.map((s) => s.i).join(", ")}) — attends la fin avant de valider.`);
  // On NE passe PAS à l'étape suivante tant qu'il manque une image / une vidéo
  if (run.status === "images_ready") {
    const miss = run.scenes.filter((s) => !s.image);
    if (miss.length) throw new Error(`${miss.length} image(s) manquante(s) (scène${miss.length > 1 ? "s" : ""} ${miss.map((s) => s.i).join(", ")}) — régénère-les avant de continuer.`);
  }
  if (run.status === "videos_ready") {
    const miss = run.scenes.filter((s) => !s.video);
    if (miss.length) throw new Error(`${miss.length} vidéo(s) manquante(s) (scène${miss.length > 1 ? "s" : ""} ${miss.map((s) => s.i).join(", ")}) — régénère-les avant de continuer.`);
  }
  // Étape intermédiaire « videoprompts_ready » : après les images, on relit les prompts
  // vidéo AVANT de lancer le tournage (pas de génération surprise)
  const next = { prompts_ready: "images_running", images_ready: "videoprompts_ready", videoprompts_ready: "videos_running", videos_ready: "montage_running" }[run.status];
  if (!next) throw new Error(`Rien à valider (statut ${run.status})`);
  run.status = next;
  saveRun(run);
  if (next === "videoprompts_ready") {
    tasks.updateTask(run.taskId, { step: "Relecture des prompts vidéo avant tournage…", progress: 55, status: "running" }).catch(() => {});
    return run; // rien à générer : simple pause de relecture
  }
  advance(run.id);
  return run;
}

// Objet run PARTAGÉ pendant les régénérations concurrentes : deux ↻ simultanés mutent le
// MÊME objet (chacun sa scène) au lieu de relire/réécrire le disque chacun de leur côté
// (ce qui perdait une scène — dernier qui écrit gagne). Ref-compté : libéré quand plus personne
// ne l'utilise. (Les régés n'ont lieu qu'aux étapes « _ready », pas pendant un advance().)
const liveRuns = new Map();
function getLiveRun(id) {
  let e = liveRuns.get(id);
  if (!e) {
    e = { run: getRun(id), refs: 0 };
    liveRuns.set(id, e);
  }
  e.refs++;
  return e.run;
}
function releaseLiveRun(id) {
  const e = liveRuns.get(id);
  if (!e) return;
  if (--e.refs <= 0) liveRuns.delete(id);
}

// Réécrit les prompts d'UNE scène (mode/voix off/image/vidéo) en gardant le noyau dur, en
// appliquant les instructions. Non bloquant : sur échec Claude, on garde les prompts actuels.
async function rewriteScenePrompts(run, scene, instructions) {
  const c = config();
  const character = c.characters.find((x) => x.id === run.params.characterId);
  try {
    const parsed = await genJson(
      [
        "Tu modifies UNE scène d'un VLOG selfie de voyage dans le temps. GARDE LE NOYAU DUR intact :",
        coreRules(character, Number(c.settings.clipSeconds) || 10),
        `Thème du run : ${JSON.stringify(run.theme)}.`,
        `Scène actuelle ${scene.i}${scene.action ? ` (action « ${scene.action} »)` : ""}${scene.cta ? " — contient le CTA, le conserver" : ""} :`,
        JSON.stringify({ action: scene.action, voiceover: scene.voiceover, image_prompt: scene.image_prompt, video_prompt: scene.video_prompt }),
        `INSTRUCTIONS DE MODIFICATION : ${instructions || "améliore la scène"}.`,
        "Applique les instructions SANS toucher au noyau dur (personnage, langue, tenue, SELFIE vlog face caméra). Reste un plan selfie dynamique.",
        'RÉPONDS UNIQUEMENT EN JSON : {"action":"...","voiceover":"...","image_prompt":"...","video_prompt":"..."}',
      ].join("\n"),
      { tries: 3, label: `réécriture scène ${scene.i}` }
    );
    if (parsed.action) scene.action = parsed.action;
    scene.voiceover = parsed.voiceover || scene.voiceover;
    scene.image_prompt = parsed.image_prompt || scene.image_prompt;
    scene.video_prompt = parsed.video_prompt || scene.video_prompt;
    saveRun(run);
    log(run, `Scène ${scene.i} réécrite (${(instructions || "").slice(0, 60) || "sans instructions"})`);
  } catch (e) {
    log(run, `Réécriture scène ${scene.i} indisponible (${e.message.slice(0, 60)}) — média régénéré avec le prompt actuel.`);
  }
}

// Cœur de la régénération (réécriture du prompt + média), résilient et NON destructif.
async function doRegen(run, scene, step, instructions) {
  const t = (patch) => tasks.updateTask(run.taskId, Object.assign({ status: "running" }, patch)).catch(() => {});
  const STEP_FR = { prompts: "prompts", images: "image", videos: "vidéo" };
  await t({ step: `Régénération scène ${scene.i} (${STEP_FR[step] || step})…` });

  // 1) Réécriture des prompts (si instructions données ou étape « prompts »).
  if (instructions || step === "prompts") await rewriteScenePrompts(run, scene, instructions);

  // 2) Média, avec RELANCES (genWithRetry) et SANS détruire l'existant : generateImage/Video
  //    n'écrasent le champ qu'en cas de SUCCÈS ; sur échec l'ancien média est conservé.
  if (step === "images") {
    await genWithRetry(run, scene, "image");
    if (scene.error) throw new Error(scene.error); // échec après relances : ancienne image gardée
    if (scene.video) {
      scene.video = null; // image régénérée → vidéo obsolète
      saveRun(run);
    }
  } else if (step === "videos") {
    if (!scene.image) {
      await genWithRetry(run, scene, "image");
      if (scene.error) throw new Error(scene.error);
    }
    await genWithRetry(run, scene, "video");
    if (scene.error) throw new Error(scene.error);
  }
  saveRun(run);
  await t({ step: `Scène ${scene.i} régénérée — en attente de validation (${run.status.replace("_ready", "")})` });
}

/**
 * Régénération d'UNE scène avec instructions, en gardant le noyau dur.
 * step: "prompts" (réécrit les prompts de la scène) | "images" | "videos".
 * Plusieurs régés peuvent tourner EN PARALLÈLE (objet run partagé). Le flag `scene.pending`
 * (persisté) garde le grisé UI et bloque la validation même après un rafraîchissement.
 */
async function regenScene(runId, sceneI, step, instructions) {
  const run = getLiveRun(runId);
  try {
    const scene = run.scenes.find((s) => s.i === Number(sceneI));
    if (!scene) throw new Error("Scène introuvable");
    scene.pending = true; // « régé en cours » (durable) : grisage + blocage validation
    delete scene.error;
    saveRun(run);
    try {
      await doRegen(run, scene, step, instructions);
    } finally {
      delete scene.pending;
      saveRun(run);
    }
    return getRun(runId);
  } finally {
    releaseLiveRun(runId);
  }
}

/**
 * Régénération EN MASSE de toutes les scènes d'un ou plusieurs modes (ex. corriger tous les
 * POV + témoins d'un coup après un changement de règles). Non destructif : les prompts sont
 * réécrits avec le noyau dur À JOUR, puis on régénère les images des POV (cadrage) et les
 * vidéos de toutes les scènes ciblées (voix off + dynamisme). Tourne en arrière-plan.
 * imageModes = modes dont on régénère AUSSI l'image (par défaut pov_action : cadrage à refaire).
 */
function regenScenesByMode(runId, modes, instructions, imageModes = ["pov_action"]) {
  const run = getLiveRun(runId);
  const targets = (run.scenes || []).filter((s) => modes.includes(s.mode));
  if (!targets.length) {
    releaseLiveRun(runId);
    return { count: 0 };
  }
  const imgTargets = targets.filter((s) => imageModes.includes(s.mode));
  const t = (patch) => tasks.updateTask(run.taskId, Object.assign({ status: "running" }, patch)).catch(() => {});
  targets.forEach((s) => {
    s.pending = true; // grisage UI + validation bloquée pendant toute l'opération
    delete s.error;
  });
  saveRun(run);
  log(run, `Régénération ciblée : ${targets.length} scène(s) [${modes.join("/")}] — réécriture prompts + ${imgTargets.length} image(s) POV + ${targets.length} vidéo(s).`);

  (async () => {
    try {
      // 1) Réécriture des prompts (noyau dur à jour) — pool Claude modéré
      await t({ step: `Régé ciblée : réécriture de ${targets.length} prompts…`, progress: 62 });
      await pool(targets, (s) => rewriteScenePrompts(run, s, instructions), BATCH_CONCURRENCY);
      // 2) Images des POV (nouveau cadrage) — pool Kie, non destructif
      if (imgTargets.length) {
        await t({ step: `Régé ciblée : ${imgTargets.length} images POV…`, progress: 68 });
        let di = 0;
        await pool(imgTargets, (s) => genWithRetry(run, s, "image").then(() => t({ step: `Régé ciblée : images ${++di}/${imgTargets.length}…` })), 10);
      }
      // 3) Vidéos de toutes les cibles (voix off + dynamisme) — POV utilisent la nouvelle image
      let dv = 0;
      await t({ step: `Régé ciblée : ${targets.length} vidéos…`, progress: 78 });
      await pool(targets.filter((s) => s.image), (s) => genWithRetry(run, s, "video").then(() => t({ step: `Régé ciblée : vidéos ${++dv}/${targets.length}…` })), 10);
      const failImg = imgTargets.filter((s) => !s.image).length;
      const failVid = targets.filter((s) => !s.video).length;
      log(run, `Régénération ciblée terminée${failImg || failVid ? ` (⚠ ${failImg} image(s) + ${failVid} vidéo(s) à revoir)` : ""}.`);
      await t({ step: `Régé ciblée terminée — ${targets.length} scène(s) [${modes.join("/")}]`, progress: 80 });
    } catch (e) {
      log(run, `Régénération ciblée interrompue : ${e.message}`);
    } finally {
      targets.forEach((s) => delete s.pending);
      saveRun(run);
      releaseLiveRun(runId);
    }
  })();

  return { count: targets.length, images: imgTargets.length };
}

// Toutes les idées DÉJÀ produites (runs passés + stock) — pour ne JAMAIS reproposer la même.
function producedThemes() {
  const seen = new Set();
  for (const r of listRuns()) {
    const t = r.theme?.title || r.theme?.text || (r.params && r.params.theme && r.params.theme.text);
    if (t) seen.add(String(t));
  }
  for (const v of stock()) if (v.title) seen.add(String(v.title));
  return [...seen];
}
/** Bouton 💡 : Claude propose un thème (époque + événement) inspiré de la niche. */
async function suggestTheme() {
  const c = config();
  const inspiration = c.nicheId ? bank.inspiration(c.nicheId, { maxTitles: 10, maxVisions: 0 }) : "";
  const done = producedThemes();
  const parsed = claude.parseJson(
    await askGen(
      [
        "Propose UN thème de VLOG de voyage dans le temps à FORT potentiel d'audience (format « I time travelled to … (Vlog) »,",
        "le plus vu de la niche). Choisis une ÉPOQUE + une ZONE/VILLE précises, LARGES et riches en facettes (marché, nourriture,",
        "métiers, monuments, vie quotidienne, un spectacle collectif…), TRÈS VISUELLES et documentées — surtout PAS un événement-",
        "catastrophe unique ni une mission (ça tourne en rond sur 10 min). Ex de bons choix : Rome impériale 80 apr. J.-C., Edo (Tokyo) vers",
        "1700, Tenochtitlan aztèque ~1500, Constantinople byzantine, Bagdad abbasside… Original vs les titres ci-dessous (ne pas copier).",
        inspiration,
        done.length ? `IDÉES DÉJÀ PRODUITES sur cette machine — INTERDICTION ABSOLUE de reprendre l'une d'elles (époque OU lieu déjà traités) :\n- ${done.slice(0, 40).join("\n- ")}` : "",
        'RÉPONDS UNIQUEMENT EN JSON : {"era":"...","place":"ville/zone","pitch":"1 phrase en français (les facettes qu\'elle explorera dans la journée)"}',
      ].join("\n"),
      3 * 60 * 1000
    )
  );
  parsed.text = [parsed.era, parsed.place].filter(Boolean).join(" — ");
  return parsed;
}

// ---------- Images de référence des personnages ----------
const CHAR_DIR = path.join(OUT_ROOT, "characters");
ensureDir(CHAR_DIR);
const slug = (s) => String(s || "perso").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);

/** Sauvegarde une image uploadée (dataUrl base64) comme référence. Renvoie le chemin relatif. */
function saveUploadedReference(name, dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(String(dataUrl));
  if (!m) throw new Error("Image invalide (png/jpg/webp attendu)");
  const file = `${slug(name)}-${Date.now().toString(36)}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
  fs.writeFileSync(path.join(CHAR_DIR, file), Buffer.from(m[2], "base64"));
  return `agent-os/output/machines/characters/${file}`;
}

/** Génère l'image de référence avec l'IA (portrait GPT Image 2 à partir de l'apparence). */
async function generateReference(name, appearance) {
  const prompt =
    `Hyper-photorealistic YouTube channel avatar portrait of ${appearance}. ` +
    "Chest-up framing, the person looks straight into the camera with a warm expression, " +
    "soft cinematic lighting, shallow depth of field, natural realistic skin texture with visible pores, " +
    "shot on a full-frame camera, ultra detailed, photorealistic, HD 8K quality. " +
    "Absolutely no text, no letters, no watermark, no logo anywhere in the image.";
  const taskId = await kieCreate("gpt-image-2-text-to-image", { prompt, aspect_ratio: "1:1", resolution: "1K" });
  const url = await kiePoll(taskId, { timeoutMs: 8 * 60 * 1000, intervalMs: 10000 });
  const file = `${slug(name)}-${Date.now().toString(36)}.png`;
  await download(url, path.join(CHAR_DIR, file));
  spend.record("Kie.ai", "Time Travel", PRICES.image, "USD", `Référence personnage ${name}`);
  return `agent-os/output/machines/characters/${file}`;
}

/**
 * 💡 Complète un personnage : l'IA part de rien ou du minimum fourni
 * (ex. « femme rousse ») et enrichit apparence + personnalité (+ nom si absent).
 */
async function completeCharacter({ name, appearance, persona, language } = {}) {
  const lang = language || "English";
  const parsed = claude.parseJson(
    await askGen(
      [
        "Complète la fiche d'un personnage d'influenceuse IA pour des vlogs YouTube de voyage dans le temps.",
        `LANGUE DU PERSONNAGE : ${lang}. Le personnage s'adresse à une audience ${lang} :`,
        `son look, son style et sa vibe doivent être crédibles et attachants pour cette audience,`,
        `et le nom doit sonner naturel dans cette langue.`,
        `Fourni par l'utilisateur (à respecter et enrichir, jamais contredire) : nom=${name || "(vide)"} ; apparence=${appearance || "(vide)"} ; personnalité=${persona || "(vide)"}.`,
        "Règles : apparence en ANGLAIS (elle sert de prompt image), riche et précise (~40-60 mots : âge, cheveux, yeux, peau, tenue moderne signature, accessoire) — utilisable telle quelle pour générer un portrait photoréaliste.",
        `Personnalité rédigée EN ${lang} (~25-40 mots : ton, énergie, humour, rapport à l'audience). Nom court et mémorable si vide.`,
        'RÉPONDS UNIQUEMENT EN JSON : {"name":"...","appearance":"...","persona":"..."}',
      ].join("\n"),
      3 * 60 * 1000
    )
  );
  return parsed;
}

// Nettoyage au démarrage : un redémarrage tue les générations en vol, mais les flags
// transitoires (rendering/pending) restaient « collés » sur le disque → cellule figée en
// chargement + validation bloquée. On les efface pour tous les runs non terminés.
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
  for (const meta of listRuns()) {
    let run;
    try {
      run = getRun(meta.id);
    } catch {
      continue;
    }
    let touched = false;
    for (const s of run.scenes || []) {
      if (s.rendering) (delete s.rendering, (touched = true));
      if (s.pending) (delete s.pending, (touched = true));
    }
    if (touched) {
      saveRun(run);
      n++;
    }
  }
  backfillStock();
  return n;
}

// Runs plantés = statut *_running mais plus aucun advance() en mémoire (serveur redémarré, crash…).
function strandedRuns() {
  return listRuns()
    .filter((r) => String(r.status || "").endsWith("_running") && !activeAdvance.has(r.id))
    .map((r) => ({ id: r.id, status: r.status, theme: r.theme?.title || r.theme?.text || r.id, machine: "Time Travel", machineId: "timetravel" }));
}

/**
 * Commande une vidéo SANS passer par le wizard (restock / calendrier de publication) :
 * clone les paramètres du run le plus récent (le « modèle »), génère un thème neuf,
 * force le mode auto et cible la chaîne/confidentialité demandées.
 */
async function orderRun({ publishChannelId, publishPrivacy, publish, overrides, theme } = {}) {
  const last = listRuns().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if (!last || !last.params || !last.params.characterId)
    throw new Error("Aucun run modèle : lance d'abord un run manuel sur la machine Time Travel");
  const base = { ...last.params, ...(overrides || {}) };
  const th = theme || (await suggestTheme());
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
async function suggestThemes(count) {
  const c = config();
  const k = Math.min(Math.max(Number(count) || 1, 1), 8);
  const inspiration = c.nicheId ? bank.inspiration(c.nicheId, { maxTitles: 10, maxVisions: 0 }) : "";
  const done = producedThemes();
  const parsed = claude.parseJson(
    await askGen(
      [
        `Propose EXACTEMENT ${k} thèmes de VLOG de voyage dans le temps (format « I time travelled to … (Vlog) ») : ÉPOQUE + ZONE/VILLE précises, larges et riches en facettes, très visuelles.`,
        `RÈGLE CAPITALE : les ${k} thèmes doivent être RADICALEMENT différents ENTRE EUX — jamais deux époques proches ni deux zones de la même civilisation : varie les continents et les millénaires.`,
        "Surtout PAS d'événement-catastrophe unique ni de mission.",
        done.length
          ? `IDÉES DÉJÀ PRODUITES — interdiction de les reprendre OU d'en proposer une PROCHE (même civilisation/époque déjà traitée = interdit) :\n- ${done.slice(0, 40).join("\n- ")}`
          : "",
        inspiration,
        `RÉPONDS UNIQUEMENT EN JSON : {"ideas":[{"era":"...","place":"ville/zone","pitch":"1 phrase en français"}]} — exactement ${k} entrées.`,
      ].join("\n"),
      4 * 60 * 1000
    )
  );
  return (parsed.ideas || []).slice(0, k).map((i) => ({ ...i, text: [i.era, i.place].filter(Boolean).join(" — ") }));
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
  saveUploadedReference,
  generateReference,
  completeCharacter,
  upsertCharacter,
  removeCharacter,
  listRuns,
  getRun,
  createRun,
  validate,
  regenScene,
  regenScenesByMode,
  regenThumbnail,
  regenTexts,
  suggestTheme,
  advance,
  resumeRun,
  stock,
  publishRun,
  PRICES,
};
