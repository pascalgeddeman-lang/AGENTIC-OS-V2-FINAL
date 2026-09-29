---
name: machine-factory
description: "Créer une NOUVELLE machine de génération de contenu dans Agent OS (agent-os/) pour une nouvelle niche/thématique, en réutilisant ~90 % du moteur de la 1re machine (Time Travel). Donne le modèle mental squelette-vs-coutures, la checklist des fichiers à toucher, le refactor de namespacing à faire AVANT la 2e machine, l'étape 0 de qualification d'une niche (un gros outlier ne signifie pas une niche ouverte : vérifier QUI produit et COMMENT), le process de dérivation de la recette depuis la banque de niches, et les règles non-négociables (fiabilité + prompt-craft) qui traversent toutes les niches. À utiliser dès qu'on dit « nouvelle machine », « autre niche », ou qu'on adapte la Time Travel à un autre thème. Ce skill se nourrit de chaque machine créée, et impose en clôture TROIS écritures : journal des machines, rapport de niche, et second cerveau (voir « Clôture obligatoire »)."
---

# Machine Factory — cloner le moteur, changer la niche

## Quand l'utiliser

Dès qu'on crée une **nouvelle machine** dans `agent-os/` pour une **nouvelle niche de contenu** (autre que Time Travel), ou qu'on adapte le moteur existant à un autre thème. Une « machine » = un pipeline de génération avec **assistant d'input (wizard) → génération par étapes → output** (stock vidéo + publication YouTube).

**Référence canonique = la 1re machine, `agent-os/lib/machines/timetravel.js` (+ `public/js/pages/timetravel.js`).** Ce skill dit quoi **garder tel quel** (le squelette, ~90 %) et quoi **remplacer** (les coutures de niche, ~10 %). On ne réécrit jamais le moteur : on **clone** `timetravel.js` et on ne touche qu'aux coutures.

## Le modèle mental : SQUELETTE vs COUTURES

> [!important] La thèse
> Le dur (concurrence, reprise, machine à états, régénération non destructive, transport Kie, montage) est **générique** : il marche pareil pour n'importe quelle niche. Ce qui change d'une niche à l'autre, c'est **la recette** (ce qu'on raconte), **l'input** (le personnage/les paramètres) et **les modèles média**. Tout le reste se copie.

| | SQUELETTE (garder) | COUTURES (remplacer) |
|---|---|---|
| **Backend** | `pool`, `genJson`, `genWithRetry`, `kieCreate/kiePoll`, `advance`, `deriveStatus`, `promptsComplete`, `createRun`, `validate`, `cancelRun`/`resumeRun`, `sweepRuns`, `getLiveRun`/`releaseLiveRun`, `regenScene`, persistance des runs, `stock`/`publishRun` | `coreRules`, `vlogRecipe`, `SCENE_SCHEMA`, les prompts d'`generatePrompts` (outline + beats + batch + cohérence), `suggestTheme`, `completeCharacter`/`generateReference`, packaging, constantes (`PRICES`, modèles, `CTA_LABELS`) |
| **Frontend** | `openWizard`/`tick`/`renderWizard`/`patchWizard`/`sceneSig`/`sceneCard`/`wireRegen`, rail d'étapes, onglets, listes runs/stock | `LANGS`, `MODEL_NAMES`, `actionChip`, les champs de `charDialog`, le spec de packaging, tout le texte de domaine |

## Le squelette réutilisable (à cloner sans le comprendre en détail)

Copié quasi verbatim de `timetravel.js`. Ne pas réinventer :

1. **Persistance & config** — runs dans `data/machines/runs/<id>.json`, config dans `data/machines/<machine>.json`, output dans `output/machines/<runId>/`. Helpers `runPath/listRuns/getRun/saveRun/log`, `config/patchConfig`. Écriture atomique via `lib/store.js`.
2. **Concurrence + relances** — `pool(items, worker, concurrency=10)` (toujours N en vol), `genJson(prompt,{ms,tries=3})` (appel Claude + parse JSON avec relances, un timeout ne tue plus l'étape), `askGen`, `genWithRetry(run, scene, kind)` (média avec `MAX_TRIES`, réécrit le prompt en cas d'échec).
3. **Transport média** — Kie : `kieCreate(model, input)` → taskId ; `kiePoll(taskId,{timeoutMs,intervalMs=15000,runId})` → resultUrl ; `download`. FAL (voix/lipsync/whisper/ffmpeg-api) : **`lib/fal.js`** `fal.run(model, input, {cancelled})` (submit `queue.fal.run/<model>` → poll `status_url` → GET `response_url`, `Authorization: Key <fal>`) + `fal.download`. Réutilisable tel quel.
4. **Machine à états** — `advance(runId)` (boucle `while` qui enchaîne les étapes ; en `auto` ça va au bout, en `semi` ça s'arrête à chaque `_ready`), `deriveStatus(run)` (déduit l'étape la plus avancée **depuis les données**), `promptsComplete`/`expectedSceneCount`/`sceneComplete`, `createRun`, `validate` (garde-fou semi-mode : refuse d'avancer si des scènes sont `pending`/`rendering` ou média manquant), `cancelRun`/`resumeRun`, `sweepRuns` (nettoie les flags périmés au boot).
5. **Régé concurrente non destructive** — `getLiveRun`/`releaseLiveRun` (objet run partagé ref-compté → deux régés parallèles ne s'écrasent pas sur disque), `regenScene`/`doRegen`. L'ancien média n'est écrasé qu'en cas de **succès**.
6. **Stock + publication** — `stock`/`addToStock`/`publishRun` (upload YouTube resumable + miniature). Générique pour toute machine YouTube.
7. **Montage** — `renderMontage` (FFmpeg concatène les clips) + `renderCtaClip` (Remotion rend **seulement** le bouton CTA en séquence PNG). Voir le skill **`clip-montage-cta`** (le pourquoi : Remotion se fige sur les vidéos longues). Le squelette concat normalisé + overlay PNG best-effort se réutilise tel quel ; une machine peut **ajouter sa propre compo Remotion** (ex. `CtaTopRight` pour un CTA haut-droite) — l'enregistrer dans `remotion/src/Root.tsx` et vérifier `npx remotion compositions` (une compo cassée casse tout le bundle, donc le CTA des autres machines) — et **enrichir le FFmpeg** (ex. sous-titres `subtitles=subs.srt:force_style=…`, avec `cwd` = dossier du run pour éviter l'échappement Windows du `:`).
8. **Wizard frontend** — tout le cadre `openWizard`/`tick` (polling 4 s)/`renderWizard`/`patchWizard`/`sceneSig`/`sceneCard`/`globalPct`/`wireRegen` + le shell d'onglets + les listes runs/stock. Le **render/patch split** (`shellKey` décide full-render vs patch incrémental ; on ne re-crée jamais une vidéo en lecture) est le cœur de la fluidité — garder tel quel.

Constantes du squelette (ajustables mais éprouvées) : `BATCH_LONG=6` (scènes par lot de prompts), `BATCH_CONCURRENCY=5` (lots en parallèle), `MAX_TRIES=3`, pools média à 10 concurrents, `PRICES={image:0.03, videoPerSec:0.015}`.

## Les coutures à remplacer (le 10 % de chaque niche)

Dans l'ordre où on les écrit :

1. **L'input / le « noyau dur »** — objet **personnage** `{name, appearance (EN, ~40-60 mots, sert aussi de prompt image), persona, language, referenceRel}` géré par `upsertCharacter`/`completeCharacter`/`generateReference`. Si la niche n'a pas d'identité récurrente à l'écran, remplacer par les paramètres d'entrée pertinents (ex. sujet, produit, lieu…). Décider ce qui est **indispensable et fixe** (le noyau dur qui survit à toute régénération).
2. **La recette** = `coreRules(character, clipSeconds)` + `vlogRecipe()`. C'est **l'âme de la niche** : le format visuel (Time Travel = selfie-vlog, plan continu, voix féminine fixe, une action nette par scène), la structure narrative (journée en blocs thématiques), le ton, la rétention. **À dériver de la banque de niches, pas à inventer** (voir plus bas).
3. **Le schéma de scène** `SCENE_SCHEMA` + les prompts d'`generatePrompts` : garder la **structure** (outline pré-assigne un beat UNIQUE à chaque scène en 1 appel → lots parallèles qui ne font qu'ÉTOFFER → zéro répétition), remplacer le contenu : preamble `common`, prompt d'outline (l'enum des `facet`/blocs + les `beats`), prompt de `genBatch`, prompt de la passe de cohérence (script-doctor).
4. **`suggestTheme()`** — le prompt du bouton `💡 Idée` + son schéma de sortie (ex. `{era, place, pitch}`).
5. **Modèles média + montage** — `imageModel` (catalogue `lib/studio.js TOOLS`, i2i ancré sur la **référence du personnage**), modèle vidéo (Time Travel : `grok-imagine-video-1-5-preview`, `image_urls`, 720p, 16:9, image **publique sur Drive** obligatoire). Si le montage diffère, ajouter une composition Remotion + l'enregistrer dans `remotion/src/Root.tsx` ; sinon réutiliser `CtaClip`.
6. **Packaging** — `generatePackaging`/`generateThumbnail`/`regenTexts` : titre/description/tags YouTube (Time Travel : titre 85-100 car, tags 480-500 car) + prompt de miniature (i2i ancré sur la référence d'identité). Semi-générique pour YouTube ; le texte et les chaînes de verrouillage d'identité (`IDENT`/`IDENTITY_ONLY`) sont de niche.
7. **Frontend niche** — `LANGS`, `MODEL_NAMES`, `actionChip` (le badge d'action de la scène), les champs de `charDialog`, le bloc de spec packaging, tout le texte de domaine. Le moteur du wizard ne bouge pas.

## Le namespacing (RÉSOLU par convention — Linguistique en fait la preuve)

Chaque nouvelle machine se namespace elle-même (le moteur de Time Travel garde ses chemins « plats » historiques, aucun conflit) :

- **Config** : `machines/<machineId>.json` (pas le `timetravel.json` en dur).
- **Stock** : `machines/<machineId>-stock.json` (le `stock.json` unique de TT causerait une collision).
- **Runs** : **SOUS-DOSSIER `data/machines/runs/<machineId>/`** — CRUCIAL. Le `listRuns` de TT lit le dossier plat `machines/runs/` et **ignore les sous-dossiers**, donc chaque machine ne voit que ses propres runs. Sans le sous-dossier, `listRuns` ramasse les runs des autres machines.
- **Label de coût** : `spend.record(api, "<Nom Machine>", …)`.
- **`GET /api/machines`** (`server.js`) : vraie liste `[card(tt), card(ling), …]` (le `listMachines()`/`data/machines.json` historique est **mort** — l'ignorer). Ajouter aussi `<m>.sweepRuns()` au boot.

Media (`output/machines/<runId>/`) et réfs perso (`output/machines/characters/`) ne collisionnent pas (runId unique).

## Les fichiers à toucher (checklist pour UNE machine)

**Backend**
1. Créer `lib/machines/<machine>.js` — cloner `timetravel.js`, garder le squelette, remplacer les coutures, **namespacer** config + stock + label de coût.
2. Éditer `server.js` — (a) `const <m> = require("./lib/machines/<machine>");` (~ligne 30) ; (b) cloner le bloc de routes (~449-591) sous `/api/machines/<machine>/…` ; (c) inclure la machine dans `GET /api/machines` ; (d) ajouter `<m>.sweepRuns()` au boot.
3. (Si montage différent) `remotion/src/<Machine>.tsx` + enregistrer dans `remotion/src/Root.tsx` — sinon réutiliser `CtaClip`.

**Frontend**
4. Créer `public/js/pages/<machine>.js` — cloner `timetravel.js`, `AgentOS.register("<machine>", …)`, réutiliser le wizard, remplacer l'UI de niche.
5. Éditer `public/index.html` — ajouter `<script src="js/pages/<machine>.js">`.
6. Éditer `public/js/core.js` — ajouter `"<machine>"` au tableau (~ligne 125) qui redirige le highlight nav vers « machines ».
7. Éditer `public/js/pages/machines.js` — ajouter une carte hub (cloner celle de Time Travel) avec `href="#/<machine>"` (remplace le placeholder « Prochaine machine »).

**Conventions héritées (pas de code, juste la disposition des données)** : runs → `data/machines/runs/<id>.json` ; média → `output/machines/<runId>/` ; réfs perso → `output/machines/characters/` ; coût → `spend.record(api, "<Nom Machine>", …)` ; progression/alertes → `tasks.createTask/updateTask/emit` ; inspiration → `bank.inspiration(config().nicheId)`.

## Étape 0 — QUALIFIER la niche avant d'en dériver la recette

> [!warning] Un outlier énorme ne dit pas qu'une niche est ouverte.
> Il dit qu'il faut regarder **qui produit, et avec quelle méthode**. Deux fois de suite (GTA,
> micro-drama), les plus gros chiffres d'une niche étaient portés par une méthode de production
> que notre moteur ne peut pas — et ne doit pas — reproduire. Sans cette étape, on construit une
> machine pour un marché qui n'existe pas pour nous.

Pour chaque gagnant du haut de tableau, répondre à UNE question : **comment est-ce fabriqué ?**
Trois issues, trois décisions :

| Méthode observée | Décision |
|---|---|
| Générative / assemblable (script + voix + visuels) | **Vraie opportunité** → continuer vers la dérivation de recette |
| Non reproductible par une machine — capture d'un jeu moddé, redistribution d'un catalogue sous licence, tournage réel, projet personnel (« I made X ») | **Mirage** → abandonner, quel que soit le nombre de vues |
| **Aucun exemple du tout** | **Signal, pas terrain vierge** → exiger une raison indépendante d'y croire avant d'investir |

**Signaux de reconnaissance d'un mirage** (relevés sur le terrain) :
- **Le même titre sur plusieurs chaînes** → redistribution d'un catalogue sous licence. C'est LA
  contre-épreuve : relancer la recherche sur ce titre exact avec un `maxSubs` très haut et compter
  les chaînes qui le portent.
- **Noms de chaînes au gabarit** (Lucky Short Dramas / Lux Short Drama / Great Short Drama /
  SnapDrama Lab) → essaim, pas producteurs.
- **Conventions typographiques importées** (`【FULL】`, `【…】`) → catalogue étranger réempaqueté.
- **Doublage en langue régionale sur de la capture de jeu** (Franklin + Shinchan en tamoul,
  télougou, pachto) → studio de doublage.
- Et à l'inverse, les indices de la voie productible : « **Ai** Drama Series », « 2D Animation »,
  « EP01 » d'une série originale.

**Attention** : ces essaims sont exactement la cible de la politique YouTube « Generic or
Repetitive Content » (2026), qui vise les uploads produits en masse sur gabarit. Une machine ne
doit jamais sortir N variantes d'un même squelette visible.

### L'instrument : le taux de percée des petites chaînes

Le Niche Finder (`lib/niche.js`) renvoie un entonnoir `stages`. Le rapport
**`afterMaxSubs / afterDuration`** = part des vidéos qualifiantes venant de chaînes sous le
plafond d'abonnés. C'est la mesure la plus discriminante dont on dispose — elle dit s'il y a une
porte d'entrée :

| Niche mesurée (31/08/2026) | Taux | Lecture |
|---|---|---|
| GTA 6 actu, ≤ 5k subs | **0,7 %** | verrouillé par les chaînes installées |
| Fiction GTA en français, ≤ 50k | **1,8 %** | aucun exemple réel → pas une niche |
| GTA 6 « concept », ≤ 20k | 9,7 % | porte étroite |
| GTA 6 « everything we know », ≤ 25k | **17,5 %** | niche saine |
| Micro-drama, ≤ 25k | **26,5 %** | le plus ouvert… mais essaim de redistribution |

Repère : **sous ~5 %, la niche est fermée** quelle que soit la taille du marché. Au-dessus de
~15 %, il y a une place — sous réserve de l'étape 0 ci-dessus.

**Discipline de quota** : le quota YouTube (10 000 unités/jour/clé) se remet à zéro à **minuit
heure Pacifique** (`ptDay()` dans `lib/youtube.js`), soit 9 h à Paris — pas à minuit local. Une
recherche à `sampleSize: 300` coûte ~750 unités. Toujours passer une **sonde de calibrage** sur
UNE requête avant de lancer une batterie : une requête mal formulée ramène 26 vidéos au lieu de
300 et l'échantillon est perdu (vécu sur l'angle musique de GTA). Le quota non consommé expire,
il ne se reporte pas.

**Sortie de l'étape 0** : un `agent-os/docs/niche-<sujet>.md` (modèle : `docs/niche-gta.md`)
avec le tableau des entonnoirs, le verdict, et les implications de pipeline. Committé. C'est ce
document qui autorise — ou interdit — d'écrire la première ligne de la machine.

## Dériver la recette depuis la DATA (le process qui a sauvé Time Travel)

La recette d'une niche **ne s'invente pas** — elle se lit dans la **banque de niches** liée à la machine (`bank.inspiration(nicheId)` : titres + vues des concurrents, tags dominants, visions). Leçon Time Travel : on avait inventé des modes POV/témoin + une « mission » → ça hallucinait ; la data disait le contraire (les 4 titres les plus vus étaient tous des « I time travelled to [lieu] (Vlog) », les tours d'époque écrasaient 4× les vidéos-événement). **Le pivot vers le vlog-only par blocs est venu des chiffres, pas de l'intuition.**

Pour toute nouvelle niche, **une fois l'étape 0 franchie** et avant d'écrire `coreRules`/`vlogRecipe` :
1. Ouvrir la banque de niches associée, trier par vues, repérer le **format dominant** (pas les exceptions).
2. Décomposer la structure réelle des top vidéos (durée, découpage, ton, hook, rétention) — c'est ça qu'on encode dans la recette.
3. Ignorer le bruit (brainrot, formats hors-niche) : ne regarder QUE le contenu de la banque de la machine.
4. Ne pas dupliquer les béquilles d'un autre format (une mission/ironie dramatique sert les vidéos-événement, pas les tours d'ambiance).

## Règles non-négociables (elles traversent TOUTES les niches)

**Fiabilité & opérations** (durement acquises — voir [[Agent OS — plateforme]] et le log de session) :
- **Génération de prompts = parallèle + reprenable + storyboard.** L'outline pré-assigne un beat unique par scène en 1 appel ; les lots parallèles ne font qu'étoffer (sinon ils rejouent les mêmes anecdotes → répétitions). `promptsComplete()` garde `deriveStatus` : un run de prompts partiel reste en **échec reprenable**, il ne SAUTE PLUS aux images. `run.sceneCount` figé à la création.
- **Régé non destructive, relancée, parallèle** : l'ancien média n'est écrasé qu'en cas de succès ; flag `scene.pending` persistant (grise l'UI + bloque Valider) ; cache-buster `ts` (`?v=`) sur `<img>`/`<video>` régénérés (même nom de fichier → sinon le navigateur ressort le cache).
- **Ne JAMAIS redémarrer le serveur pendant qu'un run génère** (tue la génération en mémoire ; récupérable par `POST /resume`). Vérifier les runs `*_running` avant tout restart.
- **Ne pas lancer de régé pendant un `advance()` actif** (`getLiveRun` régé vs `getRun` pool divergent → écriture perdue). L'UI bloque la régé hors états `_ready` ; garde-fou serveur à ajouter (refuser si `run.status` finit par `_running`).

**Prompt-craft média** (voir [[media-prompt-feedback]], s'applique à toute machine image/vidéo) :
- **Voix fixe** : décrire la même voix, mot pour mot, dans **chaque** `video_prompt` (répétée en début ET fin). Le modèle vidéo (Grok) intègre la voix → sinon elle dérive.
- **Référence i2i = seule source de vérité** : ne JAMAIS décrire la couleur/le physique d'un personnage qui a une image de référence (« the exact same … as in the reference image ») ; on décrit tenue, émotion, action.
- **Prompts longs et riches** : image ≥ 500 caractères, vidéo/animation ≥ 400 ; style martelé ; contraintes critiques répétées **début ET fin**.
- **Une action nette et différente par scène** (menu d'actions), scènes dynamiques jamais statiques. **Pas de multishot** si la niche est du plan continu.
- **Interdiction de parole absolue** si la vidéo n'a pas de bande-son ajoutée (répétée début+fin).
- Prompts média en **anglais**, voix off dans la langue du personnage ; contraintes de comptage strictes.

## Acquis des machines #2 (Linguistique) et #3 (Musique) — remontés au squelette

**Mécanismes génériques désormais attendus dans TOUTE machine :**
- **Tâches liées aux runs** : `createTask({ machineId, runId, … })` → tâches ET événements du journal cliquables (le frontend a un repli nom-de-machine + `run rXXX` du titre pour l'existant).
- **Sauvetage** : exporter `strandedRuns()` (status `*_running` sans `advance()` en mémoire) — le cron serveur envoie un Telegram INTERACTIF ✅ Reprendre / ❌ Ignorer (`telegram.sendWithButtons` + `startCallbackLoop`). `resumeRun` refuse si un advance est déjà actif.
- **Stock** : `patchStock(id, {archived|posted})` + onglet Archives + marquer publiée à la main.
- **Publication** : `google.youtubeUpload` (chunks 8 Mo, erreurs lisibles, tags sanitisés — les espaces comptent +2 car. chez YouTube) ; **privé par défaut**, sélecteur de mode au Publier ET en publication auto (`publishPrivacy`) ; résultat stocké dans `run.published` → bannière claire sur l'écran Fini (✅ publiée + lien / ⏳ / ❌).
- **Idées** : `producedThemes()` (runs + stock) injecté dans `suggestTheme` — jamais une idée déjà produite NI une variante proche ; adapter l'idée à la taille demandée (ex. nombre de scènes).
- **UI** : prix SEUL en gros dans un cadre VERT à côté de Générer (détail en infobulle) ; pipeline en ligne brute alignée à droite (« A → B → C ») ; labels de formulaires sur UNE ligne + `align-items:end` sur la grille (sinon désalignement) ; ⚡ décharge sur chaque run (liste + fenêtre).
- **Langue de la chaîne ≠ langue du contenu** : titres/descriptions/tags (et le titre du run) s'écrivent dans la langue du PUBLIC (`chainLanguage`).

**⚠ Pièges système (coûteux à redécouvrir) :**
- **`spawn` d'un process long : TOUJOURS consommer stdout** (au minimum `child.stdout.on("data", () => {})`). Un pipe non lu (64 Ko) FIGE le process — 3 gels identiques de rendus Remotion avant diagnostic. Bonus : parser la progression (`Rendered X/Y`) pour la tâche.
- **Vision vidéo** : garde AVANT paiement (URL YouTube valide obligatoire, reconstruite depuis l'id si absente), URL répétée dans le texte du prompt, retry ×1, et REJET des réponses « je n'ai pas reçu de lien » (jamais stockées). Pour une niche où le visuel = la miniature (musique) : analyser les IMAGES des miniatures (`image_url` multimodal), pas la vidéo, et exiger références nommées + STYLE_PROMPT_EN prêt à l'emploi.
- **Réplication de style** : i2i avec les miniatures top-vues du concurrent en références + préambule « indistinguishable from the same artist » — le t2i descriptif seul dérive vers du générique.
- **Stats fraîches** : l'API Analytics a ~48 h de retard — la section temps réel du dashboard passe par l'API Data publique (compteurs à la minute, en barres par vidéo).

## ⚠ MONTAGE FFmpeg — les sept règles qui coûtent le plus cher

Toutes payées sur des machines en production (septembre 2026). À vérifier AVANT de livrer un
montage, pas après.

**1. `-loop 1` exige TOUJOURS `-shortest` ou `-t`.** Une entrée infinie (une image en boucle)
pilote l'encodage : sans borne il ne s'arrête JAMAIS, sans aucune erreur. Vécu : 727 Mo écrits
en 57 min à 900 % de CPU pour une vidéo qui en pèse 30.

**2. Une image fixe servant d'incrustation durable DOIT entrer en `-loop 1`.** En image unique,
elle s'évapore dès que la chaîne compte plusieurs `overlay` en cascade — silencieusement.
Corollaire des deux premières règles : `-loop 1` et `-shortest` forment une PAIRE indissociable.

**3. Ne jamais faire cohabiter vidéo et audio dans un même `filter_complex`** quand la source
vidéo vient d'un `concat -c copy` de morceaux encodés séparément. Les horodatages hétérogènes
décalent l'audio sans erreur (voix à 10 s au lieu de 5). Construire la bande-son dans une passe
SÉPARÉE, puis la muxer en `-c:a copy`.

**4. Coller par COPIE, pas par le filtre `concat`.** Si les segments sortent déjà au format
final (le vérifier par `ffprobe`), le démuxeur `concat -c copy` prend quelques secondes là où le
filtre décode tous les segments EN PARALLÈLE. Gains mesurés : Crime 51 min → 2 min.
Toujours prévoir le repli par filtre si les formats diffèrent.

**5. Compter les ré-encodages.** Chaque passe complète sur une vidéo longue coûte plus que tout
le reste de la machine. Un montage bien construit n'en fait qu'UNE.

**6. `zoompan` recadre en pixels ENTIERS.** La saccade dépend du rapport entre l'échelle de
travail et la taille de SORTIE — jamais d'une valeur absolue. Ne PAS recopier la constante d'une
autre machine : la mesurer (écart-type du PSNR entre images consécutives). Et l'amplitude doit
être répartie sur la durée du plan (`on/frames`), jamais un pas fixe plafonné, qui fige l'image
à mi-plan. `x`/`y` sont obligatoires, sinon le zoom part dans le coin.

**7. Un `-t`/`-shortest` ajouté quelque part doit être vérifié PARTOUT.** Deux machines s'en
tiraient par accident, ayant déjà une borne pour une raison sans rapport — ce qui masquait le
défaut sur les deux autres.

## ⚠ AVANT DE REDÉMARRER LE SERVEUR — vérifier les runs actifs

Un redémarrage TUE la génération en mémoire. La règle existait, je l'ai enfreinte et j'ai coupé
un run utilisateur deux fois. Passer systématiquement :

```
node -e "for (const m of ['crime','linguistique','bouddhisme','drama','musique','stickman','timetravel']) {
  try { const x=require('./agent-os/lib/machines/'+m+'.js');
    const r=(x.listRuns?x.listRuns():[]).filter(v=>/_running$/.test(String(v.status)));
    if (r.length) console.log('⚠', m, r.map(v=>v.id).join(',')); } catch {} }"
```

Et ne pas ÉDITER de fichier pendant que l'utilisateur redémarre : son serveur redevient « périmé »
à l'instant même où il le relance.

## ⚠ DIAGNOSTIC — ce qui a réellement tranché, et ce qui a menti

- **Garder des repères de taille et de durée sur les productions réussies.** L'anomalie du
  montage infini s'est vue en une commande : 30 Mo pour 9 min sur trois vidéos terminées, contre
  727 Mo. Ni le journal ni le pourcentage n'avaient rien dit.
- **Rendre la région que l'on mesure.** Quatre détecteurs automatiques successifs ont menti
  (horizon accroché à un nuage puis à un arbre, corrélations faussées par un jingle). Le relevé
  DIRECT — profil du niveau sonore, ligne de repère tracée sur l'image — a tranché à chaque fois.
- **Un succès annoncé ne prouve rien.** Un champ inconnu est ignoré en silence par l'API
  (`image_urls` sur seedance) ; un journal peut écrire « logo incrusté » alors qu'il n'y en a
  pas. Toujours REGARDER le résultat.
- **Tester un détecteur dans les DEUX sens.** Un motif `401` nu déclenchait sur « 401 mots » et
  « 0.401 $ ». Lui présenter aussi ce qu'il doit laisser passer.
- **Normaliser par l'âge** toute comparaison de vues YouTube : les totaux mesurent d'abord
  l'ancienneté. Trois verdicts se sont inversés après correction.

## Clôture obligatoire — TROIS écritures, pas une

> [!important] Une machine n'est pas finie quand elle tourne.
> Elle est finie quand ses leçons sont écrites aux trois endroits qui les rendront réutilisables.
> Sauté une fois (machine #6) : la mémoire générale « alimenter le coffre » ne s'est pas
> déclenchée au moment de livrer. Cette checklist est là pour ça — elle est lue au bon moment.

**1. Le journal du skill** — [references/machines-log.md](references/machines-log.md).
Une entrée par machine : les coutures de niche, les **mécanismes génériques découverts** (à
remonter dans le squelette ci-dessus), les pièges rencontrés, les coûts réels, le reste à faire.
C'est comme ça que le « 90 % réutilisable » grandit.

**2. Le rapport de niche** — `agent-os/docs/niche-<sujet>.md`.
Les mesures qui ont autorisé la machine : entonnoirs, verdict, constantes. Modèle :
`docs/niche-gta.md` et `docs/niche-drama.md`. C'est la trace de l'étape 0.

**3. Le second cerveau** — coffre `~/Documents/Second Cerveau`, puis
`node agent-os/scripts/build-graph.js` pour réindexer.
**Seulement ce qui resservira AILLEURS** : un principe, un piège transposable. Pas le journal de
bord — ça, c'est le rôle du point 1. Respecter le `CLAUDE.md` du coffre : une idée par note,
titre formulé comme une affirmation, frontmatter complet, au moins un `[[lien]]`.

*Le critère de tri, éprouvé :* **si le piège mérite d'être réexpliqué à la prochaine machine, il
mérite une note dans le coffre.** S'il ne concerne que cette niche, il reste dans le journal.
Vérifier d'abord si une note existante couvre l'idée — dans ce cas on l'**enrichit**, on ne crée
pas de jumelle (fait pour l'ancre d'identité, machine #6).
