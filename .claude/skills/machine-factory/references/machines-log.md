# Journal des machines

Une entrée par machine construite. But : capturer **ce qui était spécifique à la niche** (donc à refaire à chaque fois) et **tout mécanisme générique né sur cette machine** (donc à remonter dans le squelette du SKILL.md). Quand une couture se répète sur 2 machines, elle devient squelette.

---

## #1 — Time Travel (`timetravel`) — gabarit fondateur

Vlogs « voyage dans le temps » : une fille se filme en selfie face-cam dans une époque, une journée par facettes. Livrée juillet 2026 ; c'est **la** machine de référence dont tout le monde se clone.

### Ce qui était spécifique à la niche (les coutures)
- **Personnage** = noyau dur `{name, appearance (EN), persona, language, referenceRel}` : une identité récurrente à l'écran, ancre i2i pour images + miniature.
- **Recette** = `coreRules` (selfie-vlog unique, **voix féminine fixe** décrite à l'identique, tenue moderne fixe, plan continu sans multishot, progression jour→nuit, **une action nette par scène**) + `vlogRecipe` (époque/zone **large** découpée en **blocs thématiques** de longueur variable : arrivée→logement→marché→bouffe→métier→pouvoir→croyance→climax collectif→soirée→conclusion ; hook à l'arrivée, comparaisons anachroniques, food-reviews notées, myth-busts chiffrés, CTA).
- **Schéma de scène** : `{i, mode:"vlog", cta, action, voiceover, image_prompt, video_prompt}`.
- **`suggestTheme`** : propose des époques larges (Rome, Edo, Tenochtitlan) → `{era, place, pitch}`.
- **Modèles** : image `gpt-image-2-image-to-image` (i2i ancré référence), vidéo `grok-imagine-video-1-5-preview` (voix intégrée, `image_urls`, 720p, image publique Drive). Montage : réutilise `CtaClip` (FFmpeg concat + CTA PNG).
- **Packaging** : titre 85-100 car, tags 480-500 car, miniature i2i ancrée référence.
- **Frontend** : `actionChip` = badge 🤳 selfie-action ; `charDialog` = appearance/persona/language ; `LANGS`.

### Mécanismes GÉNÉRIQUES nés ici (→ squelette, réutilisables partout)
- Génération de prompts **parallèle + reprenable** (`BATCH_LONG=6`, `BATCH_CONCURRENCY=5`, `genJson` avec relances, outline+scènes persistés au fil de l'eau).
- **Anti-répétition par storyboard** : outline pré-assigne un beat unique par scène en 1 appel ; lots parallèles = simple étoffage. (Sans ça : 17 répétitions au 1er test 60 scènes.)
- **Garde `promptsComplete`** dans `deriveStatus` : plus de « saut aux images » sur un run partiel ; `run.sceneCount` figé.
- **Régé non destructive + parallèle** : `getLiveRun`/`releaseLiveRun` ref-comptés, écrasement seulement si succès, flag `scene.pending` persistant, cache-buster `ts`.
- **`sweepRuns()`** au boot (nettoie `rendering`/`pending` périmés).
- **Montage hybride FFmpeg + CTA Remotion PNG** → extrait dans le skill [[clip-montage-cta]] (Remotion se fige sur les vidéos longues).
- Machine à états `advance`/`deriveStatus`/`validate`/`resumeRun` reprenable après crash/restart.

### Pièges & règles opérationnelles apprises
- Ne jamais redémarrer le serveur pendant un run `*_running` (tué une fois → récupéré par `POST /resume`).
- Ne pas régé pendant un `advance()` actif (writes perdus).
- Le CLAUDE.md du projet n'est **pas** responsable de la lenteur (~2-4 min/appel = incompressible côté modèle ; absorbé par la concurrence).

### Dette connue à régler avant la machine #2
- `config()` lit `machines/timetravel.json` **en dur** → à namespacer par `machineId`.
- `stock.json` **partagé unique** → collision → à namespacer.
- Label `spend.record(…, "Time Travel", …)` hardcodé (~4 sites).
- `GET /api/machines` = tableau à 1 élément codé en dur → vraie liste.

---

## #2 — Linguistique (`linguistique`) — 2ᵉ machine (juillet 2026)

Vidéos d'apprentissage de langue par l'écoute (chaîne « listening ») : intro présentateur → N dialogues entre 2 protagonistes → outro présentateur, niveau A1/A2, sous-titres, CTA. **Portée depuis le workflow n8n `[Atelier 3] Niche Linguistique #1`.** Niche liée par défaut = « English ». C'est la 1re machine qui a validé la thèse squelette-vs-coutures « pour de vrai ».

### Coutures de niche (le 10 %)
- **Input** : 3 personnages par run (présentateur + 2 protagonistes). Personnage = `{name, appearance, sex M/F, voice (ElevenLabs), referenceRel}` — **pas de persona ni de langue** (la langue est un paramètre de run, pas du perso). Voix filtrée par sexe.
- **Recette** : `coreRules` (3 identités + voix fixes + niveau + langue + préambule d'identité image du workflow) + `dialogueRecipe` (intro pose une question d'écoute → histoire en scènes distinctes → outro répond + CTA). Storyboard = liste de **situations** distinctes (au lieu des `beats` de TT).
- **Schéma de scène** : segments à `role` (`intro`/`dialogue`/`outro`) ; dialogue = `turns:[{speaker:"A|B", text}]`, intro/outro = `narration`. Les 2 speakers A/B mappent vers les 2 voix de protagonistes.
- **Modèles** : image i2i **multi-référence** (les 2 protagonistes dans une scène ; le présentateur seul en intro/outro) via le catalogue studio. Voix = FAL `fal-ai/elevenlabs/text-to-dialogue/eleven-v3` (`{inputs:[{text,voice}]}`). **Pas de modèle i2v** : les clips sont montés localement (FFmpeg image fixe tenue = durée audio + mux). Lipsync présentateur optionnel via FAL (`veed/lipsync` par défaut, configurable). Sous-titres via FAL `fal-ai/whisper` → SRT → gravés par FFmpeg. **CTA en haut à droite** (nouvelle compo Remotion `CtaTopRight`).
- **Packaging** : titre/desc/tags YouTube listening + miniature i2i ancrée sur le présentateur.

### Mécanismes GÉNÉRIQUES nés/prouvés ici (→ remontés dans SKILL.md)
- **`lib/fal.js`** : transport FAL réutilisable (submit `queue.fal.run/<model>` → poll `status_url` → GET `response_url`, `Authorization: Key <fal>`). Réutilisable par toute future machine FAL (voix, lipsync, whisper, ffmpeg-api…).
- **Namespacing prouvé** (la « dette » du skill est réglée par CONVENTION) : config `machines/<id>.json`, stock `machines/<id>-stock.json`, label `spend.record(api, "<Nom>", …)`, et surtout **runs dans un SOUS-DOSSIER `data/machines/runs/<id>/`** — indispensable pour que le `listRuns` de chaque machine ne ramasse pas les runs des autres (TT lit le dossier plat, ignore les sous-dossiers). `GET /api/machines` = vraie liste `[card(tt), card(ling)]`.
- **Étape supplémentaire dans la machine à états** : le pipeline passe de 4 à 5 étapes média (Dialogues → Images → **Voix** → Vidéos → Montage). `advance`/`deriveStatus`/`validate` + le rail du wizard s'étendent trivialement (ajouter un statut `_running`/`_ready`, une vue, un libellé de validation).
- **Montage ≠ toujours CtaClip** : une machine peut ajouter sa propre compo Remotion (ici CTA haut-droite) et enrichir le FFmpeg (ici sous-titres `subtitles=subs.srt:force_style=…`, cwd = dossier du run pour éviter l'échappement de chemin Windows). Le reste du montage (concat normalisé + overlay PNG best-effort) est réutilisé tel quel.

### Pièges rencontrés
- `spend.record()` est **synchrone** : pas de `.catch()` dessus (bug attrapé à la relecture).
- Sous-titres FFmpeg sous Windows : lancer ffmpeg avec `cwd = dossier du run` et référencer `subs.srt` en relatif (le `:` d'un chemin absolu casse le filtergraph).
- Lipsync `veed/lipsync` attend une **vidéo** publique : on fabrique d'abord le clip de base (image+audio), on l'uploade sur Drive public, puis on lipsynce.
- Une compo Remotion cassée casse **tout le bundle** (donc aussi le CTA de TT) : vérifier `npx remotion compositions` après ajout.

### Raffinements (session suivante — Grok, présentateur, tenue)
- **Personnage = `sex` (F/M) + `presenter` (bool)**, exposés en UN menu « Sexe / rôle » (Femme/Homme/Présentatrice/Présentateur). Le flag `presenter` pilote le CADRAGE de la réf : présentateur = plan serré tête/buste (bon lip-sync), acteur = plan moyen. `regenCharacterImage(id)` régénère la réf (bouton « 🔄 16:9 » par carte).
- **Grok i2i reproduit la TAILLE de la référence** → toutes les réfs sont générées en **16:9** (`generateReference` aspect 16:9 via `gpt-image-2-text-to-image`), et on n'envoie **pas** d'`aspect_ratio` à Grok (`conf.noRatio`). Grok i2i ne prend qu'**1 image** (`maxImages:1`) : pour un dialogue à 2 protagonistes, on compose une **référence DUO 16:9** (FFmpeg `hstack` A+B → 1280×720) uploadée publique, passée en `image_urls`. Règle générale : `conf.maxImages < 2` → duo, sinon 2 réfs.
- **`ensureRefUrls` anti-périmé** : mémorise (`refSrc`) le `referenceRel` uploadé ; réf régénérée → ré-upload auto (sinon le run garde l'ancienne image). Idem duo (rebuild si A/B changent).
- **TENUE FIXE** dans `coreRules` : chaque perso garde EXACTEMENT sa tenue signature dans TOUTES les scènes (le modèle changeait les habits selon le décor — ex. chez le coiffeur avant/après). + cadrage imposé (dialogue = plan moyen 2 persos ; intro/outro = présentateur plan rapproché pour le lip-sync).
- **`regenSceneImages(runId, {except|indices})`** : régé en masse des images d'un sous-ensemble de scènes (background, non destructif, pool 4) — sert à tout re-générer sauf intro/outro après un changement de modèle/réf.

### Raffinements (session +2 — émotions, montage/timing, miniature, tags)
- **Émotions ElevenLabs v3** : Claude insère des balises `[tag]` INLINE dans les répliques ET la narration (`[excited] [nervous] [whispers] [laughs] [sigh] [curious]`…). Ce sont des directions audio **non prononcées** → **absentes des sous-titres** (Whisper transcrit l'audio, pas les crochets). 1-2 max/réplique.
- **Concurrence = 10** pour images ET voix (pool ROULANT `pool()` : dès qu'une finit, la suivante démarre — pas de « blocs » de 4/8). regenSceneImages aussi.
- **Montage / durée (bug « son coupé » + sous-titres décalés)** : ElevenLabs ajoute parfois du **silence de fin** → le clip (`-loop 1 … -shortest`) devient plus long que la parole. Fix : **trim du silence de fin** en sortie de voix (`ffmpeg -af "areverse,silenceremove=start_periods=1:start_duration=0.3:start_threshold=-50dB,areverse"`, début gardé pour l'alignement Whisper). SURTOUT : sous-titres et CTA **offsettés sur les durées RÉELLES des clips** (`ffprobe seg-N.mp4`), JAMAIS sur `audio.duration` — sinon dérive cumulative (sous-titre qui apparaît avant sa scène). Lipsync = **audio trimmé uploadé** (pas l'audio FAL brut) pour que la durée colle au clip. Sous-titres descendus (`MarginV=22`).
- **completeCharacter** : variété FORCÉE (origine/peau, cheveux, âge, morpho, **tenue** — pas tous en pull moutarde) + on passe les personnages DÉJÀ créés au prompt pour rendre le nouveau différent.
- **Intro** : la question d'écoute doit DÉCOULER du contexte posé (jamais « sortie de nulle part »).
- **Miniature** : `bank.inspiration(..., {maxVisions})` injecté (style des miniatures concurrentes) + gros plan visage, expression forte, couleurs saturées, sujet décentré, zéro texte.
- **Tags cap DUR 500 car** : helper `capTags(tags, 500)` (empile jusqu'à ≤500) appliqué dans packaging + regenTexts + publishRun (le LLM dépassait — 700/500).

### Raffinements (session +3 — durée audio/vidéo DÉFINITIVE, sous-titres 1 passe)
- **⛔ TRIM AUDIO INTERDIT (annule le trim de la session +2)** : le `silenceremove` (-50dB / start_duration 0.3) **mangeait la fin de la dernière syllabe** — prouvé au volumedetect : la tranche coupée (0,47 s) contenait de la parole à -2,5 dB de pic. Une syllabe finale < 0,3 s passe pour du silence. L'audio ElevenLabs est livré **TEL QUEL**, aucune modification, jamais.
- **RÈGLE D'OR clip image+audio (méthode n8n)** : 1) audio, 2) **metadata** (ffprobe → durée D), 3) vidéo générée à **EXACTEMENT D** (`-t D.toFixed(3)`), 4) mux sans rien couper. **JAMAIS `-shortest` avec `-loop 1`** : le buffering du muxer fait déborder la vidéo de 1-2 s (constaté : audio 24,8 s → clip 26,4 s sur TOUTES les scènes) et donne l'impression d'un son coupé. L'offset-par-clips de la session +2 ne compensait pas ce débordement à la source.
- **Lipsync : ré-injecter l'audio original** : veed/lipsync réencode (et écourte) la piste son → après téléchargement, remux `-map 0:v -map 1:a -c:v copy` avec l'audio local intégral (durée finale = max des deux, rien de coupé).
- **Sous-titres = 1 SEULE passe Whisper sur la vidéo ASSEMBLÉE** (remplace le Whisper par segment + offsets) : montage passe 1 = concat + CTA → `assembled.mp4` ; extraction `full-audio.mp3` → upload public → `fal-ai/whisper` (timestamps déjà = ceux de la vidéo finale, zéro calcul d'offset) ; passe 2 = gravure `subtitles=` avec **`-c:a copy`** (l'audio ne peut plus être touché). Moins cher (1 appel au lieu de N) et sync parfaite.
- `uploadPublic(name, file, mime)` généralisé (audio/mpeg pour Whisper).
- **Prix réels (source utilisateur)** : ElevenLabs v3 = **0,10 $/1000 caractères ENVOYÉS** (contenu des dialogues — comptés au réel dans `generateVoice`, plus de forfait/segment) ; Veed = **0,40 $/minute** de vidéo traitée (lipsync, seulement si activé — facturé sur la durée réelle du clip).

### Dépendances
- Clé **FAL** dans le coffre (champ « FAL.ai » déjà présent). Sans elle : voix/lipsync/whisper échouent.
- 3 personnages avec image de référence obligatoires avant un run.
- Modèle image **Grok** = réfs 16:9 obligatoires (voir Raffinements).

---

## #3 — Musique (27 juillet 2026)

Vidéos musicales longues (mix/compilation), calquées sur les vidéos cyberpunk du workflow n8n 2-11. `lib/machines/musique.js` + `public/js/pages/musique.js`.

- **Niche / format dominant** : mix long = 1 image fixe + waveform + N musiques. Le style vient d'un onglet « Style musical » : profils `{name, desc, sunoStyle, visualPrompt}` **dérivés de la banque de niches par Claude** (`deriveStyle`) — titres concurrents → codes de titres, tags → mots-clés, visions de miniatures → codes visuels. Chaque élément scrapé sert.
- **Input / noyau dur** : styleId (noyau dur = sunoStyle, jamais quitté), thème/ambiance (💡 exclut les idées produites), **nombre de musiques par 2** (Suno rend TOUJOURS une paire, 0,06 $/requête, ~3-5 min/titre), instrumental Y/N (style martelé « NO vocals » + flag), waveform Y/N + couleur (bulles), effets {titre, glitch}, CTA Y/N + langue, publication auto, mode semi/auto.
- **Structure du run** : PAS de scenes[] — `run.pairs[]` (une paire = une requête Suno = 2 audios) + `run.visual` (LE visuel unique). Wizard 3 étapes : Visuel → Musiques → Montage (+ Fini). Les prompts Claude ne sont PAS affichés (choix utilisateur).
- **Transport Suno (Kie)** : `POST /api/v1/generate` (model V5_5, customMode, instrumental, style, title, prompt=paroles, weights 0.65) → poll `GET /api/v1/generate/record-info?taskId` → `data.response.sunoData[].audioUrl` quand `status==="SUCCESS"` ; statuts d'échec `*_FAILED|SENSITIVE`. 2 titres par requête → fichiers `mus-<i>a.mp3` / `mus-<i>b.mp3`.
- **Montage 100 % FFmpeg local** (règle d'or durée respectée) : concat demuxer des mp3 → `full-audio.m4a` → durée ffprobe → `-loop 1 -i visual.png -t <durée>` + filtres : **waveform** `showwaves=s=1280x150:mode=cline:colors=0x<hex>` + `colorkey=black` + overlay bas ; **titre** `drawtext=textfile=title.txt:fontfile='C\\:/Windows/Fonts/arialbd.ttf'` (textfile = zéro échappement) 1-8 s ; **glitch** `rgbashift=rh=9:bv=-9:enable='lt(mod(t,12),0.28)'` (effet « bug » cyberpunk sans Remotion) ; **CTA** = même séquence PNG Remotion `CtaTopRight` que les autres machines.
- **Régé non destructive** : `regenPair` garde les anciennes pistes si la nouvelle génération échoue ; `regenVisual` réécrit le prompt via observation.
- **Nouveaux mécanismes génériques (remontés dans le squelette)** : `patchStock` (archived/posted, onglet Archives), `strandedRuns()` + cron « Sauvetage » serveur (5 min, Telegram), tâches `machineId+runId` cliquables → wizard, `producedThemes()` (idée jamais reproduite), `google.youtubeUpload` (résumable par chunks 8 Mo + erreurs lisibles — le scope `youtube.upload` MANQUAIT dans SCOPES, cause du « post YouTube ne fonctionne pas » ; reconnecter les chaînes), catégorie YouTube 10 (Musique) vs 27 (Éducation).
- **Pièges** : `card()` de `/api/machines` supposait `characters[]` (musique a `styles[]`) ; réglette musiques step=2 obligatoire ; showwaves rend sur fond noir → colorkey obligatoire avant overlay ; **le nom du champ coffre est `kie`** (pas `kie_api_key`).
- **⚠ PIÈGE CRITIQUE spawn (3 gels identiques avant diagnostic)** : `spawn("npx remotion render …")` SANS lecteur sur **stdout** → Remotion y écrit sa progression, le tampon du pipe (64 Ko) se remplit vers la frame ~900 et le rendu SE FIGE en écriture (pre-encode.mp4 gelé au même octet à chaque fois). TOUJOURS `child.stdout.on("data", …)` (au minimum un drain vide) sur tout process long spawné avec `stdio` par défaut. Bonus : parser `Rendered X/Y` pour la progression de la tâche.
- **Montage musique = compo Remotion complète `MusiqueMontage`** (image + waveform + CTA + effets rendus en MP4 direct — pas de gel car AUCUNE vidéo décodée, juste une image + audio). **Waveform PRÉCALCULÉE côté Node** (FFT offline 64 bandes → JSON base64, `computeWaveformData`) : `useWindowedAudioData` n'est pas fiable sur un long fichier et exige du WAV ; le JSON statique rend le rendu déterministe. Audio final : `<Audio>` CŒUR de remotion (pas @remotion/media) sur le WAV concaténé.
- **Vision vidéo = INUTILE pour une niche musique** (réponses vides/hallucinées sur des mixes de 2 h, transcripts sans parole payés pour rien). Le visuel d'un mix EST sa miniature : `analyzeThumbs()` = UNE requête OpenRouter multimodale sur les IMAGES des miniatures (image_url) → codes visuels fiables (a identifié « anime hard-SF GitS/Akira, cel-shading » du premier coup), stockés dans `style.visualCodes` + miniatures top-vues en **références i2i** du visuel/miniature.
- **Publier 400 « invalid video keywords »** : YouTube compte **+2 caractères (guillemets) pour CHAQUE tag contenant un espace** → une liste ≤ 500 « bruts » dépasse la limite réelle. `sanitizeYtTags` (google.js) : strip `<>`, tag ≤ 100 car., total pondéré ≤ 470, appliqué à tout upload.
- **Telegram interactif** : `sendWithButtons` (inline_keyboard) + `startCallbackLoop` (long-poll getUpdates timeout=50, un seul consommateur) → le cron Sauvetage envoie ✅ Reprendre / ❌ Ignorer, le clic déclenche `resumeRun` côté serveur. `resumeRun` de TOUTES les machines refuse si un `advance()` est déjà actif (anti double-lancement, protège aussi le bouton ⚡).
- **Miniature (régé)** : le prompt de régé DOIT réinjecter le THÈME du run + les situations des scènes comme noyau dur (sinon Claude change de sujet) — l'observation utilisateur passe en « PRIORITÉ ABSOLUE ».
- **Analytics YouTube** : ~48 h de retard + les vues peuvent être antérieures à la fenêtre → défaut « Depuis la création » et message explicite, jamais un « ça ne marche pas ».

## Round transverse « commandes sans wizard » (28 juillet 2026)

Mécanismes GÉNÉRIQUES à donner à toute nouvelle machine (copiés des 3 existantes) :
- **`orderRun({publishChannelId, publishPrivacy, publish, overrides, theme})`** : clone les params du run le plus récent (le « modèle »), applique les overrides, thème imposé ou `suggestTheme()`, mode auto, `allowNoPublish: !publish` (une commande « vers stock » passe outre l'autoPublish de la config — sinon createRun jette). Sert au restock ET au calendrier de publication (`lib/schedule.js`).
- **`suggestThemes(n, opts)`** : N idées en UN appel avec règle « RADICALEMENT différentes entre elles ET des idées produites » (jamais deux variantes d'une même famille — train après avion interdit).
- Routes génériques : `GET /order-info` (params du dernier run + persos/styles pour le mini-wizard), `POST /ideas`, stock `GET/PATCH/publish` via le map MACHINES.
- **PIÈGE suivi** : `listRuns()` renvoie des résumés SANS `published` → tout suivi externe (événements du calendrier) se base sur `run.status` (`done|failed`).
- **PIÈGE feedback** : orderRun met 2-4 min (thème) avant de créer le run → toujours créer une tâche visible immédiatement, la supprimer quand le run démarre.
- **Défaut « privée » PARTOUT** dans les UI de publication (un select sur « publique » = vidéo publique accidentelle, vécu).

## #4 — Stickman (`stickman`) — 24 août 2026 — machine EXTERNE installée, pas construite ici

Documentaires de vulgarisation anthropologique animés en stickman. Livrée en paquet tiers
(github.com/Alex-sia99/machine-stickman) avec son propre installateur idempotent ; les 16 points
d'ancrage du dépôt correspondaient exactement à notre `server.js`/`machines.js`/`Root.tsx`.
`lib/machines/stickman.js` (60 Ko) + `lib/machines/stickman-cast.js` + `public/js/pages/stickman.js`
+ `remotion/src/StickmanCta.tsx`.

### Coutures de niche
- **Pipeline inversé par rapport aux machines 1-3** : le SCRIPT vient en premier, la voix ensuite,
  et **le découpage des plans est déduit de la voix off**, pas l'inverse. Étapes : Script → Voix →
  Casting → Prompts → Images → Montage → Packaging.
- **Découpage au sens, jamais à l'horloge** (`buildShots`) : Whisper rend les mots horodatés, la
  coupe tombe sur une frontière de phrase (`.!?`) au-delà de 2 s, ou de virgule au-delà de la cible
  de 3,4 s ; détection de **rafale d'énumération** (≥ 3 virgules dans une fenêtre de 6 s) qui
  autorise des plans jusqu'à 0,75 s ; refonte des plans trop courts hors rafale ; puis plans rendus
  **strictement jointifs** (sinon les silences de respiration ne sont couverts par aucune image).
- **Constantes mesurées, pas inventées** : `WPM=165` (relevé sur 5 chaînes), `SHOT_TARGET=3.4`
  (médiane des 2 meilleures performeuses), `SHOT_MIN=1.30`, `SHOT_MAX=7.00`. C'est l'application
  la plus littérale du « dériver la recette depuis la data ».
- **Recette narrative en 8 temps** : hook universel → fausse réponse → pattern interrupt → problème
  de la preuve → retournement de méthode → preuves par vagues → mythe démonté → élargissement.
- **Voix** : FAL `inworld-tts` (12 langues), texte chunké à 1900 car. (l'API refuse au-delà de 2000).
- **Images** : Kie i2i ancré sur la fiche du personnage — `nano-banana-2-lite` (0,02 $) par défaut,
  `seedream/5-lite-image-to-image`, `gpt-image-2-image-to-image`. `IMG_STYLE` + `IMG_NEG` très longs
  (le négatif interdit tout texte à l'écran — la niche n'en a aucun).
- **Montage 100 % FFmpeg** : clips avec léger mouvement d'appareil, sous-titres SRT gravés, séquence
  PNG Remotion `StickmanCta` (1920×1080, 5 s) en overlay best-effort.
- **Pas de durée de clip réglable** : elle se déduit du sens. Réglages exposés = modèle d'images,
  fréquence du CTA, part de schémas (5-45 %, la niche tourne à 20-26 %), langue de chaîne.

### Mécanisme GÉNÉRIQUE à retenir : la troupe dérivée d'une base neutre
Le vrai apport réutilisable. **Problème** : générer N images depuis une seule référence rhabille
tout le monde avec la tenue de cette référence (des hommes préhistoriques en t-shirt bleu).
**Solution** : un stickman **neutre** (nu, chauve, sans accessoire) sert de gabarit unique, et
chaque personnage est *habillé depuis lui* en i2i (`Take the neutral stickman in the reference
image and DRESS HIM as…`). Le corps ne change jamais → trait identique d'un personnage à l'autre
ET d'une vidéo à l'autre. À transposer dès qu'une niche a une troupe récurrente plutôt qu'un
personnage unique.

Corollaire : **le casting est automatique, il n'y a aucun sélecteur de personnage dans l'input.**
`planCast` demande à Claude de réutiliser en priorité, et un **garde-fou en CODE double le prompt**
(`MAX_NEW` créations par vidéo, zéro si l'époque compte déjà 4 fiches) — toute création refusée est
rabattue sur la fiche la plus proche, que le modèle a lui-même dû nommer (`closest` + `why`
obligatoires). Leçon générale : **un plafond énoncé dans le prompt ne suffit pas, un modèle qui
hésite crée** ; il faut le réappliquer côté machine.

### Coutures serveur inhabituelles (par rapport aux machines 1-3)
- `card()` de `GET /api/machines` supposait `characters[]`/`styles[]` → étendu à
  `mac.cast ? mac.cast.list().characters.length : …` (la troupe vit dans un module séparé).
- Bloc de routes propre `/api/machines/stickman/cast/**` (liste, création, brouillon, régé,
  fiche PNG, base neutre remplaçable par upload).
- Namespacing conforme au skill : `machines/stickman.json`, `machines/stickman-cast.json`,
  runs dans le **sous-dossier** `data/machines/runs/stickman/`.

### Pièges rencontrés à l'installation
- **L'installateur ne touche PAS `/api/agent/manifest`** : la machine reste invisible pour Hermès
  et tout agent local tant qu'on n'y ajoute pas sa ligne à la main. À vérifier pour toute machine
  installée depuis un paquet externe.
- Il dépose des `.bak` à côté de chaque fichier modifié, non gitignorés → à sortir du dépôt.
- `npx remotion compositions` reste le contrôle obligatoire après ajout d'une compo (une compo
  cassée casse le bundle, donc le CTA de TOUTES les machines). Vérifié : 9 compos listées.
- Défaut mineur du paquet : la liste de règles de `planCast` numérote deux fois « 4. » et « 5. ».

## #5 — Bouddhisme (`bouddhisme`) — 25 août 2026

Vidéos contemplatives de sagesse bouddhiste : une parabole dite par une voix douce sur des
visuels lents, lit musical continu, sous-titres gravés, CTA animé.
`lib/machines/bouddhisme.js` (1456 l.) + `public/js/pages/bouddhisme.js` (716 l.) +
`remotion/src/BouddhismeCta.tsx`. Précédée d'un **pilote complet de 8 min fabriqué à la main**
(scratchpad/pilote/) — c'est lui qui a produit toutes les constantes de la machine.

### La méthode qui a marché : mesurer la niche AVANT d'écrire quoi que ce soit

5 vidéos de 3 chaînes téléchargées (yt-dlp), décortiquées avec FFmpeg, transcrites, analysées
en direction artistique via OpenRouter `qwen/qwen3.7-flash` (0,03 $/M tokens — planches contact
en une requête par vidéo). Doc complète : `agent-os/docs/niche-bouddhisme.md`.

**L'invariant trouvé** : les durées de plan varient du simple au double (11 à 25 s) et le débit
de parole aussi (120 à 163 mots/min), mais le nombre de **mots par image** reste entre 29 et 44.
L'image ne change pas au bout de N secondes, elle change **à chaque unité de sens**. C'est ça
qu'on encode — pas une durée. Corollaire : `images ≈ mots ÷ 25`.

Le brief initial annonçait « 6-12 s par image, 12 min ≈ 80-110 images ». La mesure donne ~48.
**Deux fois moins d'images que l'intuition** — et autant de coût en moins.

### Coutures de niche
- **Vitesse de narration** : Inworld (FAL) n'expose AUCUN réglage de vitesse (schéma :
  `text`, `voice`, `sample_rate_hertz`). Sortie brute 173 mots/min, niche 120-135. Solution
  reprise dans la machine : synthèse **paragraphe par paragraphe** (même coût, facturé au
  caractère) + `atempo` (0,85 « lente » / 0,78 « très lente ») + **respiration entre paragraphes
  dont la durée est calculée pour atteindre la cible** : `pause = (cible − parole)/(n−1)`,
  bornée [0,8 ; 3,2 s]. Un seul mécanisme sert la durée demandée ET les silences de la niche.
- **Voix filtrable par genre** : l'API ne donne pas le genre, il est déduit du prénom dans la
  table `VOICES` (`[["Alain","H"], …]`) et servi par `GET /voices?language=&gender=`. L'UI
  enchaîne langue → genre → liste rechargée.
- **Musique Suno réutilisable** : chaque variante retenue entre dans une bibliothèque
  (`machines/bouddhisme-music.json`) proposée en `<optgroup>` dans le sélecteur de l'input.
  Reprendre une piste = 0,06 $ et 5 min d'attente en moins.
- **Plan visuel global avant les prompts** : un appel qui attribue à CHAQUE visuel un lieu, un
  cadrage, un moment et une saison UNIQUES, puis les lots parallèles ne font qu'étoffer. Sans
  lui, les lots refont tous le même temple.
- Montage : Ken Burns alterné (zoompan sur source ×2), `xfade` de 1 s, lit musical bouclé en
  `acrossfade` couvrant TOUTE la vidéo, ducking sidechain, sous-titres gravés, CTA overlay.

### Mécanismes GÉNÉRIQUES à remonter dans le squelette
- **Calibrer un niveau audio sur le FICHIER FINI, jamais sur un maillon.** `loudnorm`, `amix` et
  l'encodage AAC déplacent tous le niveau : trois mesures des mêmes réglages ont donné 29 / 21 /
  17 dB. Méthode : RMS par fenêtre de 0,5 s sur le .mp4, plancher = p05 (musique seule entre deux
  phrases), voix = p50. Pour itérer vite, **remuxer l'audio sur la vidéo déjà encodée**
  (`-c:v copy`, 30 s au lieu de 5 min).
- **Forcer `-ar 48000 -ac 2` en sortie** et `aformat`/`aresample` explicites dans le filtergraph,
  sinon `loudnorm`+`amix` sortent du **mono 96 kHz** sans prévenir.
- **Recoller les tokens Whisper avant de composer des sous-titres** : Whisper découpe les
  élisions françaises en deux (`t` + `'a`, `d` + `'elle`) et sort la ponctuation isolée. Sans
  `weld()`, un saut de ligne tombe au milieu d'un mot. Remplir les lignes **au caractère**
  (46 max à 1080p — au-delà le texte touche les bords), pas au nombre de mots.
- **Textes de CTA en props, jamais en dur** : `StickmanCta` avait « New video every week » codé
  dans le composant. Dès la deuxième langue c'est une dette. `BouddhismeCta` prend `channel`,
  `tagline`, `taglineDone`, `label`, `labelDone`, `logo` (vrai logo via `staticFile`).
- **Un CTA calé sur la voix** : chercher le mot « abonne/subscribe » dans le transcript et poser
  le bouton 0,6 s avant. Bat une grille horaire fixe.
- **Whisper incrémental** : pour un bloc audio ajouté à une voix off déjà transcrite (outro),
  ne transcrire QUE le bloc et décaler les timings. 0,02 $ au lieu de 0,38 $.

### Pièges rencontrés
- **Kie renvoie du JPEG** même quand on nomme le fichier `.png` : nommer d'après les octets
  (`FFD8FF`), sinon tout décodage échoue. `download()` le fait désormais.
- **`fps=1/N` échantillonne au MILIEU de l'intervalle** : une planche contact étiquetée
  « 0 s, 20 s… » montre en réalité 10 s, 30 s… M'a fait croire à un décalage de sous-titres
  inexistant, puis rater la fenêtre du CTA.
- **`ffmpeg -ss` AVANT `-i`** remet les timestamps à zéro : le filtre `subtitles` n'affiche
  alors rien. Utiliser `-copyts -ss` pour contrôler une frame.
- **Une virgule dans un `drawtext`** casse le filtergraph → toujours `textfile=`.
- **Miniature** : pour pousser le sujet vers la DROITE il faut recadrer vers la partie GAUCHE
  de la source (contre-intuitif). Vérifier en superposant un rectangle rouge à l'emplacement
  du texte sur des candidats.
- `.grid-4` n'existait pas dans `app.css` — ajouté (avec sa règle responsive).

### Reste à faire
L'onglet **Bibliothèque visuelle** du cahier des charges n'est PAS implémenté. Le pilote a
montré pourquoi il compte : en text-to-image pur, la cohérence des personnages ne tient pas
sur une parabole (le vieux moine du plan 4 n'est pas celui du plan 7). Il faut le pipeline i2i
avec références persistantes — même mécanisme que la troupe neutre de Stickman (#4).

### Bouddhisme — correctifs après le PREMIER run réel (25 août 2026)

Cinq défauts, tous invisibles au montage à blanc. Ce que le run réel a appris :

1. **Publication impossible — `youtubeUpload(channelId, filePath, meta)` prend TROIS arguments.**
   Appelée avec un objet en 2e position, elle faisait `fs.statSync(objet)` →
   « The "path" argument must be of type string […] Received an instance of Object ».
   **À vérifier systématiquement lors du clonage d'une machine** : cette signature ne ressemble
   pas au reste des libs, qui prennent un objet unique.

2. **Musique inaudible malgré un niveau « correct ».** Le calibrage du pilote (26 dB sous la
   voix) avait été fait avec des BOLS TIBÉTAINS, dont les attaques percent. Le run a tourné en
   « Nappe ambiante » — un drone sans transitoire — qui disparaît complètement au même niveau.
   Deux corrections : le lit est désormais **normalisé (`loudnorm=I=<musicLufs>`) au lieu d'être
   multiplié (`volume=`)**, car Suno rend chaque piste à un niveau différent ; et le défaut passe
   à **-34 LUFS ≈ 19 dB sous la voix** (mesuré sur le fichier fini du run).
   **Leçon générale : un niveau musical se calibre par STYLE, pas une fois pour toutes.**

3. **« Impossible de régénérer la miniature » — en réalité le cache navigateur.** Le serveur la
   régénérait bien (4 fois dans le journal), mais l'image est réécrite au MÊME chemin et
   l'`<img>` n'avait pas de cache-buster. Ajout de `run.thumbTs` + `?v=` + inclusion dans la
   `shellKey` du wizard. **Ce piège est déjà dans le skill — je l'ai quand même reproduit.**

4. **Texte de miniature incohérent** : `thumbLines` + `thumbAccent` s'affichent l'un sous l'autre
   mais rien n'imposait qu'ils forment une phrase → « 1 MINUTE AU RÉVEIL TOUT ». Le prompt exige
   désormais UNE phrase complète, avec un exemple valide ET un exemple invalide, et 14 caractères
   maximum par ligne.

5. **Sujet derrière le texte, et texte débordant du cadre.** Demander le cadrage dans le prompt
   ne suffit pas : le modèle recentre. Deux garde-fous en CODE :
   - l'image est **poussée de 260 px vers la droite** sur un fond flouté d'elle-même, avec un
     **dégradé d'alpha de 150 px** sur le bord du calque (sans ce fondu, une barre verticale nette
     coupait l'image en deux) ;
   - la **taille de police est calculée** d'après la ligne la plus longue
     (`fontsize = 780 / (0,62 × nb_caractères)`, plafonnée) — à 136 px fixes, « CALME TON ESPRIT »
     sortait du cadre.

6. **Génération des prompts non reprenable en auto.** Un lot revenait systématiquement incomplet
   (8 prompts manquants, 5 relances manuelles). L'étape échouait au lieu de rattraper. Elle
   rejoue désormais les manquants **un par un** (pool de 4) avant d'échouer : plus d'omission
   possible, plus de réponse trop longue. **En mode auto, l'ancienne version aurait planté.**

### Bouddhisme — l'outro (25 août 2026)

**Oubli de portage** : l'outro avait été fabriqué à la main dans le pilote (scripts du
scratchpad) et jamais repris dans la machine. Le premier run réel s'est donc terminé sans lui.
**Règle à retenir : tout ce qu'un pilote fabrique à la main doit figurer sur la checklist de
portage de la machine** — sinon seul un run réel le révèle.

Implémentation : le texte de fin est un **réglage** (`settings.outro`, pré-rempli avec le texte
de référence de la chaîne) + un interrupteur `outroVary`. Par défaut **verbatim** : c'est une
signature de chaîne, elle doit être reconnaissable d'une vidéo à l'autre ; activé, Claude la
reformule en gardant structure et phrases-clés.

Points d'assemblage :
- l'outro est synthétisé **à la suite du récit**, même voix, même `atempo`, même respiration,
  séparé par un silence plus large (`OUTRO_GAP = 2 s`) ;
- **la durée demandée ne porte que sur le récit** : la respiration est calculée sur les seuls
  paragraphes du script, l'outro s'ajoute après (une vidéo « 10 min » fait 10 min + ~40 s) ;
- `run.paras` (récit + outro) devient la source du découpage : l'outro reçoit donc ses propres
  visuels et ses propres sous-titres, sans code spécifique ;
- le CTA calé sur le mot « abonne » tombe naturellement dessus (vérifié : bouton posé à 47,4 s
  sur un test où l'outro démarre à 19 s).

### Bouddhisme — alignement esthétique sur les autres machines (25 août 2026)

Retour utilisateur après le 2e run : l'écran « Fini » ne ressemblait pas à celui de Linguistique.
**Une machine qui invente sa propre disposition casse la cohérence de l'OS** — l'écran de
packaging est le plus regardé, il doit être identique partout.

Repris à l'identique de `linguistique.js` : miniature à gauche (290 px) avec son champ
d'observation + bouton 🎨 Régénérer + ⬇ Télécharger la vidéo ; à droite un champ d'observation
commun puis Titre / Description / Tags, chacun avec **compteur** (`89/100`, `420/500`, nombre de
mots) et **boutons `mini-btn` 📋 copier et ↻💡 régénérer** ; sélecteur de chaîne + confidentialité
+ Publier (désactivé tant qu'aucune chaîne n'est choisie) ; bandeau d'état de publication.

Deux corrections de fond au passage :

- **Les règles de packaging vivaient en double.** `generatePackaging` avait été enrichi
  (description longue, hashtags) mais `regenTexts` gardait son propre prompt, plus court : une
  description régénérée perdait les hashtags. Extraites dans une constante `PACK_RULES`
  partagée par les deux. **Règle : tout prompt qui existe en version « génération » ET
  « régénération » doit partager ses règles, sinon les deux divergent en silence.**
- **Miniature en escalier** : une taille de police par ligne (calculée sur la longueur de
  chaque ligne) produisait « CROIS EN TOI » énorme au-dessus de « TOUT VACILLE » petit. Une
  SEULE taille, dictée par la ligne la plus longue, aligne le bloc — c'est ce que font les
  miniatures de la niche.

Description : passée de 120-200 mots à **230-320 mots** avec une structure imposée en 6 temps
(accroche qui rejoue la tension → puces à émoji → invitation à s'abonner personnelle →
apaisement → avertissement médical → 8-12 hashtags sans accents).

### Bouddhisme — bibliothèque visuelle i2i (25 août 2026)

Le chantier annoncé comme « reste à faire » est fait. `lib/machines/bouddhisme-library.js`
(395 l.) + onglet Bibliothèque + étape dans le wizard.

**Le mécanisme, transposable à toute machine narrative** : une entrée = une identité
récurrente (personnage ou lieu) avec sa fiche de référence persistante (3:4 pour un
personnage, 16:9 pour un lieu, pose et fond neutres) et son URL publique Drive. À chaque
run, `planLibrary` décide quoi réutiliser et quoi créer, `assignRefs` attribue 0 à 2
références par plan, et `generateImage` bascule en image-to-image quand un plan en porte.

Trois décisions qui comptent :

1. **L'étape Bibliothèque passe AVANT les prompts.** C'est ce qui permet au prompt d'un plan
   ancré de dire « the exact same X as in the reference image » et de ne PLUS décrire le
   physique ni l'architecture. Sans cet ordre, les deux se contredisent.
2. **Deux références maximum par plan.** Au-delà, l'i2i mélange les identités.
3. **Les plafonds sont en CODE** (3 créations/vidéo, 0 si 6 entrées de la même nature),
   pas seulement dans le prompt — même leçon que la troupe Stickman.

Piège d'affichage : une grille qui mélange des fiches 3:4 et 16:9 doit être en
`object-fit: contain` sur fond sombre. En `cover`, les portraits sont décapités.

---

## Round transverse « qualifier une niche » (31 août 2026) — deux machines NON construites

Aucune machine livrée. C'est le point : deux projets ont été **arrêtés par la mesure**, avant la
première ligne de code. Le mécanisme qui en sort est remonté dans SKILL.md en **étape 0**.

**Demande initiale** : une machine GTA 6, sous deux angles au choix — (1) actualité avec avatar,
(2) fiction originale dans l'univers GTA (missions inventées, balades véhicules, dialogues entre
personnages connus). Ma première réponse recommandait la fiction, au motif qu'elle recombinait
presque à l'identique des machines existantes (bibliothèque i2i de Bouddhisme + dialogues de
Linguistique + Suno de Musique + montage commun) et ne dépendait d'aucune actualité.

**L'utilisateur a objecté par l'observation** (« j'ai analysé les chaînes de film à la GTA, ça
n'a pas l'air de fonctionner »). La mesure lui a donné raison et m'a donné tort.

### Ce que 6 recherches Niche Finder ont établi (rapport : `agent-os/docs/niche-gta.md`)

- **Fiction GTA générée par IA : zéro exemple** sur ~1 400 vidéos échantillonnées. Ce qui occupe
  la case « GTA stories », c'est **Franklin + Shinchan** : du GTA 5 moddé, capturé à l'écran et
  re-doublé en tamoul/télougou/bengali/pachto. Méthode de production non reproductible par une
  machine générative. En français : 5 résultats, aucun n'étant de la fiction GTA.
- **Le format qui gagne n'est PAS l'actualité** mais l'evergreen « Everything We Know About X » —
  35 résultats de chaînes < 25k subs, RENZI à 3 640 abonnés faisant 212k puis 239k vues, sur des
  vidéos de 35 à 98 minutes. Donc **le capteur de veille que j'avais conçu était inutile**, et
  **aucun gagnant n'utilise d'avatar parlant** (la ligne Heygen/lipsync sautait du budget).
- **Anglais ≫ français** : à format identique, 10 à 20× (RENZI 3 640 subs → 212k vues, contre
  SLavague 1 430 subs → 24k vues côté FR).

### Le piège s'est représenté IMMÉDIATEMENT sur la niche suivante

Pivot vers le micro-drama (mélodrame de revanche : PDG, trahison, retournement de fortune),
suggéré par la convergence d'une prévision Deloitte (7,8 Md$ en 2026) et de la donnée locale —
ce genre polluait des recherches qui n'avaient rien à voir, à des ratios vues/abonnés de 100 à 235×.

La **sonde de calibrage** a donné le meilleur taux de percée jamais mesuré (26,5 %) ET révélé
que l'essaim majoritaire **redistribue un catalogue chinois sous licence** : le même épisode
(« The Hidden Queen ») sur trois chaînes, des noms au gabarit (Lucky Short Dramas / Lux Short
Drama / Great Short Drama / SnapDrama Lab). Exactement le piège Franklin/Shinchan, sous un autre
déguisement, quinze minutes plus tard.

La sonde a aussi sorti la minorité qui **produit** : EPISODE ZERO (4 300 subs → 188k vues,
« Korean **Ai** BL Drama Series »), Silent Bloom Stories (« 2D Animation »), Cinematic Sins.
C'est cette voie que mesure `agent-os/scripts/mesure-niche-drama.js`.

### Ce qu'il faut retenir

1. **Un outlier énorme ne dit pas qu'une niche est ouverte** — il dit qu'il faut identifier la
   méthode de production. Deux fois de suite, les plus gros chiffres étaient inaccessibles.
2. **L'absence totale d'exemples n'est pas un terrain vierge**, c'est un signal.
3. **Le taux de percée `afterMaxSubs / afterDuration`** est l'instrument le plus discriminant du
   Niche Finder ; il n'était pas exploité. Sous ~5 % la niche est fermée, au-dessus de ~15 % il y
   a une place.
4. **Toujours une sonde de calibrage avant une batterie** : une requête mal formulée (l'angle
   musique de GTA) a ramené 26 vidéos au lieu de 300, échantillon perdu.
5. **Mesurer coûte ~750 unités de quota et zéro dollar d'API générative.** Les deux machines
   évitées auraient coûté des semaines de construction et ~10 $/vidéo à l'usage.

---

## #6 — Drama (`drama`) — 1er septembre 2026

Mélodrame de revanche africain francophone. **Première machine précédée d'une étape 0 complète**
(`docs/niche-gta.md` puis `docs/niche-drama.md`) et d'un prototype de 7 phases à 1,89 $ qui a
fixé toutes les constantes AVANT la première ligne de code. `lib/machines/drama.js` (1094 l.) +
`drama-cast.js` (353 l.) + `public/js/pages/drama.js` (306 l.) + `remotion/src/DramaCta.tsx`.

### Coutures de niche
- **Recette DÉRIVÉE des 27 titres de la banque**, pas inventée : humiliation → karma, trahison
  familiale, riche déguisé en pauvre, majuscules sur les mots-chocs, points de suspension avant
  le retournement, suffixe « | Histoire Africaine ». La victime ne se venge jamais : elle réussit,
  et ceux qui l'ont méprisée viennent à elle.
- **Pipeline à 8 étapes** (record) : Script → Casting → Prompts → Images → Voix → Clips → Montage
  → Packaging. L'extension du squelette reste triviale, comme annoncé.
- **Intro en 3 temps imposée** (demande utilisateur) : ouverture à froid sur le pic d'humiliation
  → rembobinage annoncé à voix haute → promesse d'inversion. Relevé mot pour mot chez Temple des
  Récits, la chaîne la plus performante de la banque.
- **Règle produit en dur** : toute voiture est une Mercedes noire vitres teintées (`CAR_RULE`,
  injectée dans coreRules ET dans chaque prompt image).
- 5 langues, français par défaut ; sous-titres optionnels ; CTA à 20 s puis toutes les 2 min.

### Mécanismes GÉNÉRIQUES nés ici (→ à réutiliser)
- **`lib/voices.js` — bibliothèque de voix partagée.** Trois machines avaient besoin d'une voix ;
  la table était dupliquée. Désormais : catalogue unique, échantillon audio écoutable par voix,
  débit mesuré, page 🎙 Voix. `engineRef()` centralise LE piège (Inworld veut `"Alain (fr)"`,
  ElevenLabs un nom ou un ID).
- **`lib/music.js` — banque de MP3 versés par l'utilisateur.** Suno coûte 0,06 $ et 3-5 min PAR
  vidéo ; une piste versée ici sert à l'infini pour zéro. Supprime une étape bloquante du pipeline.
- **Banque de niches : vidéos ISOLÉES.** `bank.addVideo()` — une vidéo peut entrer dans une niche
  sans sa chaîne, et elle remonte dans `inspiration()` avec son transcript et sa vision.
- **`card()` de `/api/machines` robuste** : la troupe s'appelle `characters` chez Stickman et
  `entries` ici → repli en cascade, plus `MACHINE_ID`/`MACHINE_NAME` en secours.

### Constantes MESURÉES par le prototype (ne pas les relâcher)
- **13-14 mots par plan animé.** Au-delà, la phrase dépasse les 6 s de Grok, le clip est ralenti
  et la vidéo entière paraît molle (4 clips sur 5 ralentis en phase 3). Garde-fou en CODE : la
  réplique est tronquée si le modèle déborde.
- **Une réplique EXIGE un plan rapproché quasi frontal.** Sur un plan large de 3/4, `veed/lipsync`
  ne produit **rien du tout** — vérifié en lecture par l'utilisateur après que j'ai d'abord lu
  « faible » sur des images fixes.
- **2 références i2i maximum par plan** — validé : deux identités tiennent parfaitement.
- **Un accessoire distinctif dans la fiche ancre l'identité** mieux que toute consigne de prompt
  (le bandeau rouge est réapparu dans 5 plans sur 5, y compris là où il n'était pas mentionné).
- **Le débit d'une voix varie de 12-16 % d'une synthèse à l'autre**, chez ElevenLabs comme chez
  Inworld. Donc : le débit sert à CHOISIR une voix, jamais à PRÉDIRE une durée. Aucun montage
  n'est calculé depuis un débit attendu — on synthétise, on sonde, on cale la vidéo.

### Pièges rencontrés pendant la construction
- **`kieRetry` ne doit PAS rejouer une erreur déterministe.** Une requête malformée ne devient pas
  correcte au second essai. Filtre `must be|invalid|required|not found`. **À porter dans
  `genWithRetry` du squelette.**
- **`lib/google.js` doit être durci** : quand Drive throttle il renvoie du HTML, et le `.json()`
  de `driveUpload` remonte un « Unexpected token '<' » illisible. Toutes les machines uploadent
  avant chaque appel Grok — sur 60 plans, un throttle casse un run entier sans message exploitable.
  Contourné ici par un `uploadPublic` à 3 tentatives ; la lib elle-même reste à corriger.
- **Nommer d'après les octets ne vaut QUE pour les images.** Appliqué à une vidéo, le reniflage
  produisait `clip-A.mp4.png` — un H264 déguisé en PNG, introuvable au run suivant. Bonne règle,
  appliquée trop largement.
- **Les clips Grok contiennent une piste AAC** même avec interdiction de parole : toujours
  remapper explicitement l'audio au montage, ne jamais supposer un clip muet.
- **Un job Kie perdu ne finit jamais** : le plan 4 a échoué à 12 min de polling puis abouti en
  167 s au deuxième essai. Relancer, pas allonger le délai.

### Coûts réels
| Durée | Rythme | Plans | Animés | Coût |
|---|---|---|---|---|
| 8 min | Images fixes | 77 | 0 | ~2,90 $ |
| 12 min | Mixte | 116 | 41 | ~8,00 $ |
| 20 min | Tout animé | 194 | 194 | ~24,70 $ |

Le **rythme visuel est LE levier de coût** — d'où le menu déroulant exigé par l'utilisateur.

### Drama — import de fiches existantes (2 septembre 2026)

Demande utilisateur : réutiliser dans la Troupe les références déjà produites par le prototype,
au lieu de les regénérer. Elles sont déjà payées ET déjà validées à l'œil — les refaire serait
doublement absurde.

`cast.importEntry({ name, kind, role, desc, voiceId, dataUrl|srcPath })` :

- **Normalisation 16:9 automatique.** Grok reproduit la TAILLE de sa référence : une fiche 3:4 ou
  carrée contaminerait tous les plans du film. Une image hors ratio est posée sans déformation sur
  un fond gris neutre 1280×720 — le même fond que les fiches générées. L'interface signale le
  recadrage et affiche le format d'origine.
- **`role` devenu PERSISTANT** sur la fiche (« protagoniste — l'humiliée qui triomphe »). Il
  n'existait que le temps d'un run. Il entre maintenant dans trois endroits : l'inventaire lu par
  `planLibrary`, les `coreRules` du script (« respecte le rôle indiqué, c'est le choix de
  l'utilisateur »), et il sert de repli quand le plan de casting n'en propose pas.
- **Une fiche importée peut n'avoir aucune description** : le prompt de casting le dit
  explicitement et demande de se fier au nom et au rôle, en réutilisant ces fiches en priorité —
  ce sont les personnages de la chaîne.

Vérifié : les 3 références du prototype font 1672×941, soit exactement 16:9, importées sans
recadrage. Pas de note au second cerveau pour cette évolution — le piège du format de référence
est propre à Grok, il reste dans ce journal (critère de la « Clôture obligatoire »).

### Reste à faire
- Mesurer le rythme de plan réel sur les vidéos sources (planches contact FFmpeg) : les 6,2 s par
  plan sont déduits des 13 mots, pas mesurés sur la niche. Sur Bouddhisme, cette mesure avait
  divisé par deux le nombre d'images attendu.
- Le premier run réel révélera ce qu'aucun montage à blanc ne montre (leçon Bouddhisme : 5 défauts
  invisibles avant le run réel, dont la signature à 3 arguments de `youtubeUpload` — déjà prise en
  compte ici).

---

## #7 — Crime (`crime`) — 3 septembre 2026

True crime francophone, pour une chaîne EXISTANTE (« Au creux de la nuit », 251 abonnés,
**> 9 000 h de visionnage** — il ne manque que les 1 000 abonnés pour la monétisation).
`lib/machines/crime.js` (847 l.) + `lib/heygen.js` + `public/js/pages/crime.js`.
Rapport d'étape 0 : `docs/niche-truecrime.md`.

### Première machine construite pour une chaîne qui existe déjà

Différence majeure avec les six précédentes : on disposait des données de l'utilisateur.
Elles ont dit l'essentiel — 62 vidéos, **médiane 90 vues**, trois succès portés par la seule
notoriété des dossiers (Dupont de Ligonnès, Grégory). Les concurrents font 10 400 et 6 831 vues
par vidéo avec **moins de vidéos** (38 et 31 contre 62).

**Le problème n'était donc pas la production mais l'angle.** J'ai déconseillé la machine, puis
suivi la décision de l'utilisateur — en exigeant que la machine porte la RECETTE et pas seulement
le pipeline. Une machine qui produit plus vite ce qui fait 90 vues est un piège.

### Coutures de niche
- **Pipeline SCRIPT-FIRST** (modèle Stickman #4) : en narration documentaire le découpage des
  plans se déduit de la voix. Étapes : Script → Voix → Intro avatar → Plans → Images → Montage
  → Packaging.
- **Le titre est le levier mesuré** : amorce narrative, JAMAIS le nom de l'affaire. Nommer
  l'affaire = jouer sur la recherche contre des chaînes à 1-2 M d'abonnés ; raconter une amorce
  = jouer sur la recommandation, où la taille ne pénalise pas.
- **Affaires internationales encouragées** : Nuits de Crime fait 49 k vues avec une affaire
  britannique racontée en français, hors du terrain des géants francophones.
- **AUCUN visage réel généré** — contrainte absolue de la niche. Les concurrents utilisent des
  photos de presse, ce qu'une machine ne peut ni ne doit reproduire. Prompt négatif systématique.
- Débit **165 mots/min** (Kael, écart 3 % — la voix la plus stable mesurée), aucun atempo.

### Mécanisme GÉNÉRIQUE né ici : `lib/heygen.js`
Avatar parlant, brique partagée. Trois choses la caractérisent :

1. **Elle refuse AVANT d'appeler.** Le plan gratuit impose 3 vidéos/mois et 60 s ; un run ne
   doit jamais mourir au milieu pour une limite connue d'avance.
2. **Elle compte juste** : registre local + API, on retient le maximum. Et seules les vidéos
   `completed` comptent — une génération `failed` ne consomme rien (vérifié), la compter aurait
   bloqué l'utilisateur une fois sur trois.
3. **API v3 obligatoire.** `/v2/video/generate` est LEGACY, retiré le 31/10/2026, et son propre
   avertissement dit aux agents de ne pas l'employer. Le `CLAUDE.md` du projet documentait déjà
   v3 — j'ai sondé l'API à l'aveugle au lieu de le lire.

### L'architecture qui résout la contrainte : l'avatar MIME, il ne parle pas
La TTS HeyGen est inaccessible sur le plan gratuit (403). Donc : **une seule voix ElevenLabs
narre TOUT**, et les 60 premières secondes de cet audio sont envoyées à HeyGen en `audio_url`.
L'avatar se contente d'animer le visage dessus. Même voix du début à la fin, et zéro dépendance
à la TTS du fournisseur d'avatar. `type:"audio"` est accepté et la soumission ne consomme rien.

**Bascule automatique** : réglage `intro: auto | toujours | jamais`. En `auto`, quota épuisé →
intro illustrée, tracé dans le journal, **jamais d'échec**.

### Miniature — gabarit validé avec l'utilisateur après trois maquettes
Portrait ILLUSTRÉ anonyme à droite (texture de pinceau visible, jamais une photo) · médaillon
circulaire cerclé de rouge à gauche · flèche · deux lignes blanc puis rouge.
Ligne éthique posée : **l'illustration est une évocation, jamais présentée comme la personne
réelle** — mention obligatoire imposée dans le prompt de description.

Trois maquettes ont été produites et comparées à 0,09 $ avant décision. La première version de
l'option retenue était **mal cadrée** (je découpais la droite alors que le visage était à gauche) :
c'est en regardant le portrait BRUT, pas la maquette, que je l'ai vu.

### Coûts
| Durée | Mots | Illustrations | Total |
|---|---|---|---|
| 15 min | 2 475 | 77 | **3,78 $** |
| 18 min | 2 970 | 94 | **4,57 $** |
| 25 min | 4 125 | 132 | **6,37 $** |

### Reste à faire
`WORDS_PER_IMAGE = 30` est **déduit**, pas mesuré (30 mots ≈ 11 s par image). Il doit l'être sur
les vidéos sources par planches contact FFmpeg — la méthode Bouddhisme, qui avait divisé par deux
le nombre d'images attendu et donc le coût.

### Crime — sous-titres à trois modes (3 septembre 2026)

Le menu ne propose plus « gravés ou rien » mais **Fichier .srt (défaut) · Gravés · Aucun**.
Le `.srt` est meilleur dans presque tous les cas : référencement du texte par YouTube,
traduction automatique vers d'autres langues, désactivable par le spectateur. La gravure ne
garde l'avantage que si la vidéo doit être repartagée hors YouTube.

Même coût dans les deux modes (0,86 $ de Whisper sur 18 min, soit **19 % du prix de la vidéo**) :
c'est la transcription qui coûte, pas la gravure.

⚠ **Piège de scope, le même qu'en son temps pour `youtube.upload`.** `captions.insert` exige
`youtube.force-ssl` — le scope `youtube` complet NE SUFFIT PAS. Aucune chaîne connectée ne
l'avait. Ajouté à `SCOPES`, mais **les chaînes existantes doivent être reconnectées**. Un 403
est traduit en consigne actionnable (« reconnecte la chaîne depuis Connexions ») au lieu d'être
laissé brut, et l'envoi est best-effort : il n'annule jamais une publication réussie.

**Règle générale à retenir : avant d'appeler une API Google jamais utilisée, vérifier son scope
dans les jetons DÉJÀ accordés — pas seulement dans la constante SCOPES.** Les deux divergent dès
qu'on ajoute un scope sans reconnecter.

### Crime — la miniature ne peut pas hériter de la direction artistique du film (3 septembre 2026)

Le portrait de miniature sortait **de dos, dans le noir**. Cause : il héritait des deux
constantes globales de la machine, dont `NEG` = « no identifiable human face, no portrait of a
real individual ». Consigne juste pour les plans du film — absurde pour une miniature dont le
sujet EST un visage. `ART` (« deep blacks, single hard light source ») achevait le travail.

Premier correctif inefficace : ajouter « eyes clearly visible » à la composition. Sans effet,
puisque le négatif interdisait le visage. **Un ajout positif ne bat jamais une interdiction.**

Correctif réel : `PORTRAIT_ART` + `PORTRAIT_NEG` dédiés (fond noir et texture peinte conservés,
lumière franche de face, et un négatif qui interdit la ressemblance à une personne réelle sans
interdire le visage), plus une table `RECETTE` qui donne à chaque élément SA direction. Le
prompt de packaging a été aligné dans le même mouvement : il demandait « face turned away ».

**Règle pour toute machine : une direction artistique globale et un prompt négatif global
doivent lister leur périmètre. Dès qu'un élément fait exception, il lui faut ses propres
constantes — pas une rustine ajoutée par-dessus.**

### Toutes machines — le stock doit être rattrapé au démarrage (3 septembre 2026)

Une vidéo Crime terminée, montée, packagée et miniaturée était **absente de l'onglet Stock** —
donc impossible à publier. Redémarrer le serveur n'y changeait rien.

Cause : `addToStock()` n'est appelé que par `onDone()`, en **sortie normale** de la boucle
`advance()`. Un run dont l'`advance()` meurt (redémarrage, process tué) mais qui atteint quand
même `done` — par reclassement de `deriveStatus` au balayage suivant — ne passe jamais par
`onDone()`. Tous les fichiers sont sur le disque ; il manque juste la ligne de stock.

**Le défaut était latent dans les SEPT machines.** Mesuré avant de patcher : seule Crime avait
un orphelin réel (les 4 « orphelins » de Linguistique étaient un faux positif de ma sonde — ses
entrées de stock ont leur propre `id` `vmt…` et gardent le run dans `runId`).

Correctif : un `backfillStock()` appelé en fin de `sweepRuns()` dans chaque machine — il
parcourt les runs `done` et appelle `addToStock`, déjà idempotent partout (garde sur `id` ou
`runId`). Vérifié par triple exécution : zéro doublon sur les sept.

**Règle : une étape terminale qui n'existe que sur le chemin nominal finit par être sautée.
Tout ce qui doit être vrai quand un run est `done` doit être (re)vérifié au balayage de
démarrage, pas seulement écrit à la sortie de la boucle.**

### Crime — quatre défauts relevés au premier visionnage (3 septembre 2026)

**1. Aucun CTA.** `ctaEveryMin` était resté à `0`. La composition `BouddhismeCta` étant
entièrement pilotée par des props (logo, nom de chaîne, textes), elle est réutilisée telle
quelle sous l'id `CrimeCta` — aucune duplication de composant. Incrustation sur la vidéo
**assemblée** (intro comprise), donc calée sur le temps final : premier à 20 s, puis toutes les
2 min, plus un garanti pendant l'outro. Best-effort.

**2. Le Ken Burns se figeait.** Taux FIXE (`zoom+0.0009`) + plafond `1.10` ⇒ butée en 3,7 s sur
des plans de 11 s. Amplitude désormais répartie sur la durée via `on`. **Et `x`/`y` manquaient :
sans eux, zoompan zoome vers le coin haut-gauche, pas vers le centre.** Vérifié au PSNR entre
t=5 s et t=10 s : 42 dB avant (figé), 21 dB après.

**3. L'intro durait 8,6 s au lieu de 60.** Elle était définie comme « le premier paragraphe » —
un découpage décidé par le modèle. Elle se construit maintenant par cumul jusqu'au plafond.
Une génération HeyGen sur trois par mois était gâchée à chaque run.

**4. L'intro racontait l'histoire.** `INTRO_RULES` impose accroche + énigme + promesse + demande
de rester, et **interdit** la chronologie ; le récit commence au deuxième paragraphe.
`OUTRO_RULES` ajoute l'appel au like et à l'abonnement.

**Règle : une durée qui compte ne doit jamais être le sous-produit d'un réglage qui l'ignore
(un taux, un découpage de texte). Voir [[Une durée imposée ne se déduit pas, elle se construit]].**

### Crime — le tremblement du Ken Burns vient des pixels entiers (4 septembre 2026)

Signalé au visionnage : « un petit mouvement en saccade » en plus du zoom. Ce n'était pas un
effet parasite mais un défaut du zoom.

`zoompan` calcule l'origine du recadrage en **pixels ENTIERS**. Avec une amplitude de 0,14
étalée sur 330 images et une largeur de travail de 2560 px, l'origine n'avance que d'environ
0,5 px par image : elle reste figée une image, saute d'un pixel la suivante, à intervalles
irréguliers puisque le pas dépend du zoom courant.

**Mesure du défaut** : PSNR entre images CONSÉCUTIVES. Un mouvement régulier donne une valeur
stable ; ici elle oscillait entre 28 et 39 dB (écart-type 3,01 dB).

| largeur de travail | irrégularité | coût |
|---|---|---|
| 2560 (avant) | 3,01 dB | 1,3 s/plan |
| 3840 | 2,25 dB | 1,4 s |
| **5120 (retenu)** | **1,36 dB** | 1,5 s |
| 7680 | 1,87 dB ⚠ | 2,5 s |

Non monotone : au-delà de ~3× la source (les images font 1672 px), l'interpolation ajoute plus
de bruit qu'elle n'enlève de saccade. **Une courbe qualité/coût doit être mesurée, pas supposée
monotone.**

### Crime — où passe VRAIMENT le temps d'un run (mesuré, contre mon estimation)

J'avais affirmé que « le montage a pris près d'une heure, presque entièrement dans le rendu des
94 segments Ken Burns », et proposé de baisser le suréchantillonnage pour gagner du temps.
**C'était faux, et le conseil aurait dégradé l'image sans rien gagner.** Chronométrage réel :

| étape | durée |
|---|---|
| script | 6,9 min |
| voix | 1,8 min |
| intro HeyGen | 3,0 min |
| prompts d'image | 7,5 min |
| génération des 94 images (Kie) | 46,1 min |
| montage complet | 51,1 min |
| packaging | 3,2 min |

Les 94 segments Ken Burns ne pèsent qu'environ **2 min** dans ces 51. Le reste, ce sont **trois
ré-encodages COMPLETS d'une vidéo de 18 min** : `illustre.mp4`, la normalisation avant concat,
puis l'incrustation du CTA. Gisement d'optimisation réel (fusionner ces passes), à l'inverse de
ce que j'avais suggéré.

**Règle : ne jamais désigner un coupable de lenteur sans chronomètre. Les journaux horodatés
sont déjà là — les lire coûte une commande.**

### Crime — une seule passe d'encodage au montage (4 septembre 2026)

Le montage ré-encodait **quatre fois** une vidéo de 18 min : les segments, puis `illustre` pour
coller l'audio, puis la normalisation avant concat, puis l'incrustation du CTA. 51 minutes, dont
~2 pour les segments Ken Burns.

Le déclic : **les segments sortent déjà aux paramètres finaux** (1280x720, 30 fps, yuv420p,
SAR 1:1). Il suffisait de normaliser l'intro SANS audio pour que `concat -c copy` colle tout —
intro comprise — sans rien ré-encoder. Une seule passe finale ajoute la voix, le CTA et la
gravure éventuelle ; **sans CTA ni gravure, cette passe est un `-c:v copy`**.

Deux observations qui rendaient la fusion possible, vérifiées avant d'écrire le code :
- HeyGen rend une vidéo de la durée EXACTE de l'audio envoyé (49,632 s contre 49,6326 s) ;
- l'audio final est donc `voix.mp3` en entier — l'avatar mime le début de cette même piste, il
  n'y a rien à recoller côté son. Whisper tourne du coup directement sur `voix.mp3` : plus
  d'extraction audio depuis la vidéo.

**Mesuré : 51 min → 1 min 54 s** (segments déjà rendus), soit ~4 min avec les segments.
Sortie vérifiée identique : même durée à 0,4 s près (`-shortest` retire les images finales sans
son), CTA au même instant, audio aligné à 20 ms près avec une corrélation d'enveloppe de 0,993.

⚠ **Piège de vérification** : ma première comparaison audio, échantillon par échantillon, criait
« décalé » — elle comparait deux encodages AAC DIFFÉRENTS. Comparer des signaux compressés
demande une corrélation d'ENVELOPPE, jamais une différence brute.

**Règle : compter les ré-encodages d'un montage. Chaque passe complète sur une vidéo longue coûte
plus que tout le reste de la machine réuni.**

### Crime — musique de banque, logo permanent, CTA calé sur la voix (4 septembre 2026)

**Musique sans génération.** La niche n'a pas besoin de Suno : l'utilisateur alimente la
bibliothèque (onglet Musique) et la machine pioche au hasard 1 ou 2 pistes en usage « fond »
dont le nom commence par un préfixe réglable (« Machine crime »). Tirage figé à la CRÉATION du
run — sinon une reprise de montage changerait la bande-son en cours de route. Enchaînement en
`acrossfade` puis bouclage jusqu'à couvrir la voix. Mixage repris tel quel de Bouddhisme
(loudnorm + `sidechaincompress`). Mesuré : musique à −21 dB seule, creusée à −34/−43 dB sous la
parole, voix à −18,6 dB.

**⚠ Synchroniser un élément animé, c'est synchroniser son MOMENT SAILLANT.** Le CTA final devait
tomber sur l'appel parlé à s'abonner. Le placer à l'instant du mot était faux : l'animation dure
5 s et son CLIC arrive à 2 s. Il faut donc démarrer à `mot − 2 s`. Vérifié : mot à 1093,76 s,
clic à 1093,76 s.

Corollaire : la borne de fin ne doit protéger que le clic, pas l'animation entière. Exiger les
5 s complètes reculait le départ et décalait le clic de 0,9 s ; perdre une demi-seconde de fondu
à la toute fin d'une vidéo est invisible, un clic désynchronisé ne l'est pas.

**Un défaut peut devenir une option — mais refait proprement.** Le style « dérive vers la
gauche » vient d'un BUG de la première vidéo (coordonnées de centrage oubliées, `zoompan`
partait dans le coin haut-gauche). L'utilisateur a trouvé le rendu intéressant. On ne recopie
pas le bug : on en fait une dérive latérale maîtrisée, verticalement centrée, offerte au choix
à côté du zoom centré. Le dire explicitement à l'utilisateur — il choisissait sans savoir que
c'était un accident.

### Crime — phrase de clôture fixe et fondu au noir (4 septembre 2026)

**La signature de chaîne ne se demande pas au modèle.** « Merci d'avoir regardé la vidéo
jusqu'au bout… » est un texte FIXE ajouté après la génération du script (réglage `outroLine`),
pas une consigne de prompt : une formule de remerciement doit être identique d'une vidéo à
l'autre, or un modèle la reformule à chaque fois. `OUTRO_RULES` lui interdit en retour d'en
écrire une, sinon on l'aurait en double.

**Un effet visuel ne doit jamais manger ce qu'on veut entendre.** Le fondu au noir de 2,5 s
n'est pas pris sur la fin existante — il avalerait les derniers mots. La dernière image est
PROLONGÉE (`tpad=stop_mode=clone`), la voix se termine en clair, puis l'image s'éteint.
Même raisonnement que pour le CTA final. Conséquence technique : `-shortest` couperait
justement cette queue, il faut borner par `-t` et compléter le son par `apad`.

**⚠ `-af` ne s'applique PAS à une sortie de `filter_complex`.** Le padding audio doit vivre
DANS le graphe, sur la branche réellement utilisée (`[aout]` avec musique, `[1:a]` sans).

**⚠ Simuler un graphe de filtres avant d'encoder.** Ma première version produisait
`aresample=48000apad[aout]` — une virgule manquante qui aurait fait échouer tout le montage
après plusieurs minutes. Construire la chaîne en `node -e` et l'imprimer coûte une commande ;
la découvrir après un encodage raté coûte le double.

### Prototype timelapse « Evolution of Rome » (4 septembre 2026)

Niche mesurée dans `docs/niche-timelapse.md`. Prototype total : **~0,75 $**.

**Le point dur — tenir un point de vue sur 2000 ans — est résolu.** Quatre époques (80, 1200,
1780, 2026) gardent le même point de fuite, la même ligne d'horizon, le même cadrage.

**Trois règles d'ancrage, découvertes en corrigeant** (voir [[Une ancre unique, jamais une chaîne]]) :
1. **ancre UNIQUE** — toutes les époques descendent de la même image, jamais de la précédente.
   En chaîne, le Colisée devenait un château à tours et à croix en trois étapes ;
2. **décrire la géométrie, pas le nom** — « ellipse basse, arcades superposées, plus large que
   haut » + interdictions nommées (jamais château, clocher, dôme, croix) ;
3. **nommer ce qui DISPARAÎT** — l'ancre verrouille aussi ce qui devait s'effacer : le Colosse de
   Néron survivait jusqu'en 2026.

**Trois pièges de transport Kie**, consignés dans CLAUDE.md : seedance veut `input_urls`
(`image_urls` est accepté puis IGNORÉ en silence → vidéo sans rapport avec les images, sans
erreur) ; son téléchargeur ne suit pas `uc?export=download`, il faut `thumbnail?id=…&sz=w1920` ;
sans interdiction explicite il fait EXPLOSER les bâtiments au lieu de les éroder.

**Reste à trancher** : les morphings hallucinent quand les images clés sont trop éloignées
(un dôme inventé sur un saut de 500 ans). Hypothèse à tester : des pas de quelques décennies.

### Générique de chaîne — brique partagée (5 septembre 2026)

5 s en tête de chaque vidéo : logo qui naît de particules, nom de la chaîne, fondu au noir.
Modèle analysé à l'Œil sur une chaîne de référence (Dreamia).

**Architecture** — `lib/intro.js` + composition Remotion `ChannelIntro`, tout en props (logo,
titre, sous-titre, couleur d'accent, dimensions, durée). Une seule composition sert toutes les
machines.

**⚠ Deux décisions qui font tout le coût :**
1. **Cache.** Le générique est IDENTIQUE pour toutes les vidéos d'une chaîne. Rendu une fois,
   clé = tout ce qui change son apparence. Les runs suivants le réutilisent gratuitement.
2. **Vidéo MUETTE + jingle séparé.** Les segments des machines sont muets ; `concat -c copy`
   exige des flux identiques. Un générique sonore aurait forcé un ré-encodage de 18 min. La
   machine colle la vidéo, décale la voix de `stingSec` et mixe le jingle à t=0.

**⚠ TROIS recalages, tous obligatoires, aucun évident :**
- le `.srt` (Whisper tourne sur la voix, qui commence APRÈS le générique) ;
- la voix ET le lit musical (`adelay`), sinon la narration couvre le générique ;
- la durée finale (`max(vidéo, voix + générique) + fondu`).
Le CTA calé sur l'appel parlé, lui, lit le `.srt` DÉJÀ décalé : ne rien y ajouter. Commentaire
posé dans le code pour empêcher une « correction » future.

**⚠ Bug révélateur : ne jamais tester une valeur particulière quand on veut le cas général.**
Le bloc de fondu testait `amap === "[aout]"` — vrai tant qu'il n'existait que deux configurations
audio. Le jingle en a créé une troisième (`[amix]`) : le test échouait, la branche par défaut se
déclenchait, et TOUT le graphe audio restait débranché (`Filter 'aresample' has output
unconnected`). Corrigé en chaînant sur `amap`, quelle qu'en soit la valeur. Même famille que le
`ctaEveryMin` resté à 0 dans la config stockée.

**Et : une étape qui réussit doit EFFACER `run.error`.** Sans cela un run réparé continue
d'afficher son échec précédent, et on croit qu'il a re-échoué.

### Générique de chaîne — décliné sur les machines (5 septembre 2026)

Nom de la chaîne **sous** le logo (validé), et **couleur d'accent par machine**.

**Les couleurs ne sont pas choisies, elles sont EXTRAITES du logo** : on relève la teinte
dominante saturée (par pas de 10°), puis on force S=0,62 / V=0,88 pour qu'elle brille sur le
fond noir. Résultat : Crime 220° → `#5583e0`, Drama 30° → `#e09a55`, Bouddhisme 40° → `#e0b255`.
Un premier essai qui gardait la couleur telle quelle donnait des accents délavés (`#686889`) :
c'est la TEINTE qu'il faut reprendre, pas la couleur.

**⚠ DEUX modes d'intégration, et le choix dépend des horodatages :**

| machine | mode | pourquoi |
|---|---|---|
| Crime | **intégré au montage** | son `.srt` part sur YouTube et son CTA se cale sur l'appel parlé : ces deux temps devaient être décalés de 5 s |
| Drama, Bouddhisme | **`intro.prepend()` après coup** | leurs montages mêlent vidéo et audio dans un seul `filter_complex` — la configuration qui a désynchronisé la voix sur Crime. Sous-titres GRAVÉS, donc rien à décaler |

`intro.prepend(video, opts)` relève la résolution, la cadence et les paramètres audio de la
vidéo cible, fabrique un générique aux mêmes réglages, et colle par `concat -c copy`. **Garde :
il ne remplace la vidéo que si la durée a augmenté du bon montant** ; sinon la vidéo d'origine
reste intacte.

⚠ Avertissement laissé dans le code de Drama : si cette machine produit un jour un `.srt`
SÉPARÉ, il faudra le décaler de la durée du générique. C'est le type de dépendance invisible qui
casse des mois plus tard.

### Générique — Linguistique et bilan des quatre machines (5 septembre 2026)

Logo « French Talk Real » : **vrai PNG transparent** (1254 px, coins à alpha 0) — les particules
passent derrière, contrairement aux logos ronds opaques qu'il faut compenser par un halo.

⚠ **Sa teinte dominante (bleu 220°) donnait EXACTEMENT l'accent de Crime.** On a pris la seconde
teinte du logo, le rouge du drapeau (`#e05555`). Extraire une couleur ne dispense pas de vérifier
qu'elle distingue la chaîne des autres.

⚠ **Piège rencontré une fois de plus : les défauts du code ne rejoignent pas une config déjà
stockée.** Les nouveaux réglages sortaient `undefined`. Le code avait des valeurs de repli, donc
ça marchait — mais l'utilisateur n'aurait rien pu régler. Config stockée patchée. Même famille
que le `ctaEveryMin` resté à 0.

**Bilan : les quatre machines ont leur générique.**

| machine | logo | accent | intégration |
|---|---|---|---|
| Crime | Au Creux de la Nuit | `#5583e0` | dans le montage (`.srt` + CTA à décaler) |
| Drama | Africa Drama TV | `#e09a55` | `intro.prepend()` |
| Bouddhisme | Zen Harmonie | `#e0b255` | `intro.prepend()` |
| Linguistique | French Talk Real | `#e05555` | `intro.prepend()` |

### Crime — le logo permanent s'évaporait (5 septembre 2026)

Signalé : le logo en haut à gauche avait disparu de toute la vidéo. Cause : il était fourni
comme **image unique** (`-i logo.png`). Avec **7** incrustations de CTA enchaînées — conséquence
du passage de la cadence de 2 à 3 min —, les `overlay` en cascade attendent des flux calés loin
dans le futur et l'image isolée n'est jamais resservie.

Reproduit : logo seul ✅ · logo + 1 CTA ✅ · logo + 7 CTA ❌.

**Correctif : `-loop 1 -framerate 30 -i logo.png`.** Toute image fixe servant d'incrustation
durable doit entrer en flux continu. Taille portée de 74 à 95 px sur retour utilisateur.

⚠ Le graphe imprimé était PARFAITEMENT correct — relu trois fois. Seule la bissection
expérimentale a trouvé. Et le journal annonçait « Logo en haut à gauche, toute la durée » : vrai
sur ce qu'il vérifiait, faux sur le résultat. **Un message de succès doit décrire un RÉSULTAT.**

### Page Machines — « en cours » désignait aussi ce qui n'avançait pas (5 septembre 2026)

Signalé : la carte Bouddhisme affichait « ⏳ 1 en cours » alors que rien ne tournait.

Le badge comptait **tout run qui n'était ni `done` ni `failed`**. Or un run laissé en
semi-manuel s'arrête en `*_ready` et attend une validation : il n'avance pas, il patiente.
Un run `cancelled` était compté aussi.

Corrigé en deux badges distincts :
- `⏳ N en cours` — uniquement `*_running`, une génération qui travaille vraiment ;
- `⏸ N en attente` — `*_ready`, un run en semi-manuel qui attend l'utilisateur.

**Règle : un indicateur d'activité doit distinguer « ça travaille » de « ça t'attend ».**
Les confondre fait croire à une dépense en cours, ou fait oublier un run à reprendre. Ici, un
run de trois jours était invisible en tant que tâche en attente.

### Bouddhisme — le décalage de miniature doit être MESURÉ, pas constant (5 septembre 2026)

Signalé : le moine était trop à droite, silhouette coupée au bord, large zone vide entre le
texte et lui.

Cause : l'image était poussée de **280 px fixes** vers la droite pour dégager le texte. Ce
décalage corrige le cas où le modèle CENTRE le sujet — mais quand le modèle a correctement
cadré à droite (ce que le prompt demande !), il l'expulse du cadre. **La correction ne
fonctionnait que lorsque le modèle se trompait.**

Correctif : `subjectCenterX()` mesure le centre de gravité lumineux colonne par colonne (le
sujet est éclairé, le fond sombre), et le décalage vaut `(0,72 − mesuré) × 1280`, borné à
[0, 380]. Sur l'image litigieuse : sujet à 70 % → décalage **20 px** au lieu de 280.
Repli sur l'ancien décalage fixe si la mesure échoue.

**Règle : une compensation en dur suppose une erreur systématique. Dès que la source est
parfois juste, la compensation devient elle-même le défaut.** Mesurer, puis corriger l'écart.

### Bouddhisme — la saccade du Ken Burns (5 septembre 2026)

Demande : « le même zoom que Crime » + suppression de la saccade.

⚠ **Le zoom était déjà bon.** Bouddhisme étalait déjà son amplitude sur toute la durée du plan
(`on/frames`) et alternait avant/arrière — il n'avait PAS le défaut de pas fixe plafonné qui
figeait l'image sur Crime. Ne pas recopier un correctif sans vérifier que le défaut existe.

Le seul vrai problème était la **saccade**, et sa cause est le rapport échelle de travail /
taille de sortie, `zoompan` recadrant en pixels entiers :
- Crime : 5120 pour une sortie 1280 → 1 px de travail = 0,25 px à l'écran
- Bouddhisme : 3840 pour une sortie **1920** → 1 px = 0,5 px, deux fois plus grossier

**Mesuré sur une image réelle** (écart-type du PSNR entre images consécutives, plan de 9 s) :

| travail | saccade | rendu |
|---|---|---|
| 3840 (avant) | 3,45 dB | 1,0 s/plan |
| **5120 (retenu)** | **1,84 dB** | 1,4 s |
| 7680 | 1,67 dB | 2,1 s |

5120 retire 47 % de la saccade pour +40 % de rendu ; 7680 ne gagne que 0,17 dB de plus en
doublant le temps. Surcoût total ≈ 36 s sur une vidéo de ~91 plans.

**Règle : la valeur d'un réglage ne se transpose pas d'une machine à l'autre — c'est le RAPPORT
à la sortie qui compte.** Copier `5120` de Crime aurait été un hasard heureux ; le mesurer était
nécessaire, la résolution de sortie n'étant pas la même.

### Linguistique — la bulle disait toujours « Bonjour » (5 septembre 2026)

Signalé : à chaque génération la bulle de dialogue portait le même mot, l'utilisateur devait
régénérer à la main avec le sujet de l'histoire.

⚠ **Cause : un EXEMPLE dans un prompt devient une consigne.** Le prompt disait « 1 à 2 mots
très courts en français (ex. « Bonjour ! », « Hello! ») ». Le modèle recopiait l'exemple.

Correctif : le packaging produit désormais un champ `thumb_bubble` — 1 à 3 mots tirés du SUJET
de cette histoire — et ce texte est injecté MOT POUR MOT dans le prompt de miniature
(« contains EXACTLY these words … and nothing else »). « Bonjour » est explicitement interdit
sauf si l'histoire parle de se saluer. Les exemples donnés au modèle sont désormais tirés
d'AUTRES histoires, pour qu'il ne puisse pas les recopier.

**Signature « Slow French » incrustée par FFmpeg, jamais demandée au modèle d'image.** Un modèle
écrit le texte de travers une fois sur trois, or une signature de chaîne doit être identique
partout. Le seul texte confié au modèle reste la bulle, qui fait partie du dessin.
Jaune `0xFFD400`, bordure noire, en bas à gauche. **Tailles en PROPORTION de l'image** : les
miniatures ne sortent pas toujours à la même définition (1672x941 observé) — une valeur en
pixels donnerait un texte minuscule ou géant selon le tirage.

### Logo permanent en haut à gauche — généralisé aux quatre machines (5 septembre 2026)

Seule Crime l'avait. Ajouté à Linguistique, Bouddhisme et Drama, chacune avec SON logo.

**Règle non négociable, apprise à la dure : `-loop 1 -framerate <fps>` sur l'entrée du logo.**
En image UNIQUE, il s'évapore de toute la vidéo dès que la chaîne compte plusieurs
incrustations — les `overlay` en cascade attendent des flux calés loin dans le futur et l'image
isolée n'est jamais resservie. Aucune erreur n'est levée.

**Taille : 95 px pour une sortie 1280.** Bouddhisme sortant en 1920, la valeur est mise à
l'échelle (`95 × 1920/1280`) plutôt que recopiée — sinon le logo serait un tiers trop petit.

⚠ **Drama : le logo devait s'appliquer même CTA désactivé.** Son incrustation vivait dans un
`if (p.cta)`. Le bloc a été restructuré pour couvrir les deux, dans un seul appel FFmpeg —
un second appel aurait ré-encodé la vidéo entière pour rien.

⚠ **Vérification faite par SIMULATION des indices d'entrée**, tous cas croisés (avec/sans lit
musical, avec/sans CTA, avec/sans logo). C'est le risque principal de ce genre de patch : un
décalage d'un rang fait pointer un filtre sur la mauvaise entrée, et le symptôme n'apparaît
qu'au montage suivant.

### ⚠ J'AI TUÉ UN RUN EN REDÉMARRANT LE SERVEUR (7 septembre 2026)

Run Linguistique `rmtr2xqma` lancé à 10:10:17. J'ai redémarré le serveur à 10:14:44 puis à
10:16:33 pour tester mes propres correctifs — **deux fois en pleine génération**.

Le skill de ce projet dit textuellement : « **Ne JAMAIS redémarrer le serveur pendant qu'un run
génère** (tue la génération en mémoire ; récupérable par `POST /resume`). **Vérifier les runs
`*_running` avant tout restart.** » Je ne l'ai pas fait. La règle existait, elle était écrite,
je ne l'ai pas appliquée.

Dégâts : nuls financièrement (0,00 $ — dialogues écrits, aucune image encore payée), mais
l'utilisateur a vu sa machine se couper deux fois et a perdu du temps.

**Procédure obligatoire avant tout redémarrage :**
```
node -e "for (const m of ['crime','linguistique','bouddhisme','drama','musique','stickman','timetravel']) {
  try { const x=require('./agent-os/lib/machines/'+m+'.js');
    const r=(x.listRuns?x.listRuns():[]).filter(v=>/_running$/.test(String(v.status)));
    if (r.length) console.log('⚠', m, r.map(v=>v.id).join(',')); } catch {} }"
```

### Bandeau « Claude déconnecté » — ne pas alarmer sur un échec isolé

Dans la foulée, l'état global basculait sur UN seul échec d'authentification, et y restait
jusqu'au contrôle suivant (45 min). Un incident passager faisait donc clignoter le bandeau en
pleine génération. Il faut désormais **deux échecs consécutifs**, et le moindre appel réussi
remet le compteur à zéro.

### ⚠ « Pas encore vérifié » n'est pas « cassé » (7 septembre 2026)

Le bandeau « Claude déconnecté » s'affichait à CHAQUE ouverture de page après un redémarrage,
alors que tout fonctionnait.

Cause : l'état initial du serveur est `connected: false`, et il accepte des requêtes AVANT la
fin de son premier contrôle. Ce contrôle est passé de ~0,3 s (`--version`) à ~3 s (vrai appel
d'authentification) : la fenêtre s'est élargie dix fois, et c'est exactement celle qu'on
traverse en rouvrant la page après une remise à zéro.

**Un état INCONNU était affiché comme une PANNE, en rouge, avec un message alarmant.**

Correctif : `state.checked` (faux jusqu'au premier contrôle terminé). Le bandeau exige
`checked && !connected` — un constat réel, jamais une ignorance.

**Règle : tout indicateur d'état a TROIS valeurs — bon, mauvais, pas encore su. En confondre
deux produit soit une fausse alerte, soit une panne silencieuse.** Ici, rendre un contrôle plus
rigoureux (donc plus lent) a réveillé un défaut latent : l'absence de troisième état.

### ⚠ `-loop 1` SANS borne = encodage infini (7 septembre 2026)

Le logo permanent entre en `-loop 1` (obligatoire, sinon il s'évapore). Crime et Bouddhisme
bornaient déjà leur sortie par `-t` — **par hasard**, pour d'autres raisons. Linguistique et
Drama ne bornaient rien.

Vécu : montage bloqué à 86 %, **900 % de CPU pendant 57 min**, Mac brûlant, fichier de **727 Mo
pour une vidéo qui en pèse 30**. Aucune erreur, aucun message : l'encodage suivait une source
sans fin.

**`-shortest` ajouté à Linguistique et Drama.** Contrôle automatisé ajouté : toute machine avec
`-loop 1` doit avoir `-shortest` ou `-t`.

**Le diagnostic n'est venu ni du journal ni du pourcentage, mais de la COMPARAISON avec des
sorties connues** : 30 Mo pour 9 min sur trois vidéos terminées, contre 727 Mo ici. Garder des
repères de taille sur les productions réussies rend l'anomalie visible en une commande.

⚠ Et deux machines s'en tiraient par accident : un mécanisme ajouté partout doit voir ses
préconditions vérifiées PARTOUT, pas seulement là où on l'a testé.

### Prototype « duo en contact » — capacité acquise, niche écartée (8 septembre 2026)

Étape 0 sur @CageFiction (17,3 M de vues) : voir `docs/niche-combat.md`.

**Niche écartée** — le format repose sur des sportifs réels identifiables et, pour ses plus gros
succès, sur des IP tierces. La variante sans personne réelle n'est PAS démontrée : mesurée, elle
n'est occupée que par des captures de jeux de simulation, irreproductibles.

⚠ **J'ai proposé cette variante avant de la mesurer**, sur un seul point de donnée. C'est le
piège « aucun exemple = signal, pas terrain vierge » que ce skill énonce — enfreint en le citant.

**✅ MAIS le prototype technique a réussi, et il sert ailleurs.** Pour 0,18 $ :
deux fiches de référence → i2i à **DEUX références** pour un plan unique où les corps se
touchent → seedance 6 s où le contact TIENT (prise debout, passage au sol, contrôle).

**C'est le point dur que Drama contournait en champ-contrechamp.** La recette est dans
`scripts/prototype-combat/duel.js` : décrire le CONTACT explicitement (« their bodies TOUCH and
press against each other, weight visibly transferred, feet planted »), et le marteler dans le
prompt vidéo (« bodies never pass through each other, feet never slide »).

⚠ Le script de test n'avait pas de relance sur job perdu — 12 min gaspillées sur une tâche
évaporée chez Kie. **Tout script qui appelle Kie doit avoir la relance des machines**, et ne
rejouer QUE les délais dépassés, jamais une requête refusée.
