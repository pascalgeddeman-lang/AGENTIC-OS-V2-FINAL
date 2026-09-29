# Agentic Os — Starter (formation automatisation & contenu IA)

Ce dépôt est une **coquille vide** de la plateforme Agentic Os : aucune donnée, aucune clé, aucune chaîne connectée. Tout se configure localement, guidé par Claude.

## 🚀 Première installation (Claude : c'est TOI qui guides)

Quand l'utilisateur demande d'installer, de démarrer ou dit « installe-moi le projet », suis CE plan pas à pas, en vérifiant chaque étape avant de passer à la suivante :

1. **Prérequis** — vérifie et aide à installer si absent :
   - Node.js ≥ 18 (`node --version`)
   - FFmpeg dans le PATH (`ffmpeg -version`) — build gyan.dev sous Windows
   - Claude Code connecté (c'est toi) ; Python 3 optionnel (pont crons Hermès uniquement)
2. **Environnement** : copie `.env.example` → `.env` (ne JAMAIS committer `.env`). Les clés API peuvent rester vides : le coffre chiffré de l'interface est la méthode recommandée.
3. **Démarrage** : `cd agent-os && npm start` → ouvre http://localhost:4100 (le serveur n'écoute que sur 127.0.0.1). Alternative : double-clic sur « Lancer Agent OS.bat ».
4. **Tests** : `cd agent-os && npm test` doit être vert (les tests Hermès échouent proprement si Hermès n'est pas installé — c'est optionnel, voir §Hermès).
5. **Clés API** (page **Paramètres** → coffre chiffré, stocké dans `agent-os/data/`, gitignoré) :
   - `Kie.ai` (génération image/vidéo/musique) — https://kie.ai
   - `FAL.ai` (montage cloud, TTS, sous-titres) — https://fal.ai
   - `OpenRouter` (LLM) — https://openrouter.ai
   - Clé(s) **YouTube Data** (quota 10 000 unités/jour chacune)
   - Optionnel : `Telegram` (token de bot + chat id, pour les notifications), `Apify` (scraping)
6. **Google OAuth** (Drive + chaînes YouTube) : guide l'utilisateur pour créer SON projet Google Cloud (console.cloud.google.com) → activer les APIs Drive, Sheets, YouTube Data + Analytics → créer un client OAuth → coller client id/secret dans Paramètres → connecter Drive puis ses chaînes YouTube.
7. **Remotion** (rendu des CTA animés des machines) : `cd remotion && npm install`.
8. **Première machine** : page Machines → Time Travel (machine de référence) → créer un personnage (image de référence) → lancer un run d'essai en Semi-Manuel avec peu de scènes.

Points d'attention :
- **Rien de pré-rempli** : au premier lancement, dashboard vide, 0 chaîne, 0 machine configurée — c'est normal.
- L'utilisateur paie ses propres APIs : privilégie des essais courts (2-3 scènes) avant les gros runs.
- **Hermès (optionnel)** : la page Chat Hermès et Cron Hermes exigent le CLI `hermes` installé et configuré — procédure complète dans la section « Installer Hermès » ci-dessous. Sans lui, l'interface affiche simplement « déconnecté » — tout le reste fonctionne.
- **Second cerveau (optionnel)** : définir `SECOND_BRAIN_DIR` dans `.env` (chemin du coffre Obsidian),
  puis générer le graphe avec `node agent-os/scripts/build-graph.js`. Le serveur doit être **redémarré**
  après modification du `.env`. Ensuite, le bouton « ⟳ Réindexer » de la page suffit.

## Installer Hermès (optionnel — Chat Hermès + crons durables)

[Hermes Agent](https://github.com/NousResearch/hermes-agent) est un agent open source (MIT) de Nous Research. Il apporte à la plateforme : la page **Chat Hermès**, les **Cron Hermes** durables (survivent aux redémarrages) et, si on le souhaite, un gateway Telegram. Claude : guide l'utilisateur dans CET ordre — chaque étape a son piège.

1. **Installer** (PowerShell, sans admin) :
   ```powershell
   iex (irm https://hermes-agent.nousresearch.com/install.ps1)
   ```
   L'installeur apporte tout (uv, Python 3.11, Node, ripgrep, ffmpeg, MinGit portable) dans `%LOCALAPPDATA%\hermes`.
   ⚠️ Sous Windows, utiliser cette **installation NATIVE** (pas WSL2) : le pont cron d'Agent OS cherche `%LOCALAPPDATA%\hermes\hermes-agent\venv\Scripts\python.exe` — une install WSL2 ne sera pas trouvée. (Linux/macOS : `curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash`.)
2. **Ouvrir un NOUVEAU terminal** (le PATH vient de changer), puis premier lancement : `hermes` → l'onboarding demande un fournisseur de modèle (Nous Portal, OpenRouter, OpenAI…) et sa clé API. `hermes model` permet d'en changer ensuite.
3. **Vérifier** : `hermes --version` doit répondre (ex. `Hermes Agent v0.19.x`).
4. **Redémarrer Agent OS depuis un nouveau terminal** — piège classique : le serveur Node garde le PATH du terminal qui l'a lancé ; s'il a été démarré avant l'installation d'Hermès, il ne trouvera jamais `hermes`. Fermer le serveur, rouvrir un terminal, `cd agent-os && npm start`.
5. **Contrôler** : page Connexions → carte Hermès « connecté » (ou bouton ⟳ Reconnecter Hermès) ; `http://localhost:4100/api/hermes/status` doit renvoyer `connected: true`. Envoyer un message d'essai dans Chat Hermès.
   Puis dire à Hermès : « Lis `agent-os/docs/guide-hermes.md` et connecte-toi à Agentic Os » — ce guide lui est destiné (routes, règles, auto-test de connexion).
6. **Crons Hermes** : création **verbale uniquement** (demander dans Chat Hermès, à Claude, ou sur Telegram) — la page Tâches & Cron sert à activer/mettre en pause/supprimer. `npm test` doit maintenant être entièrement vert, tests Hermès inclus.
7. **Auto-test des capacités** : Hermès doit dérouler l'auto-test complet de son guide (`agent-os/docs/guide-hermes.md`) — chat, cycle cron créer/pauser/supprimer, tâches, lectures machines/analytics (jamais de génération payante) — et rendre compte.
8. **Gateway Telegram (facultatif)** : demander à Hermès de lancer son **wizard bot Telegram** (section « Gateway Telegram » de son guide) : création du bot via @BotFather, enregistrement du token, démarrage automatique de la gateway, message de test.

Sécurité : le pont Chat Hermès tourne en mode sans confirmation (`--yolo`) — c'est pour ça que le serveur n'écoute QUE sur `127.0.0.1:4100`. Ne jamais l'exposer en `0.0.0.0` sans authentification.

## Volet Agent OS (plateforme centralisée)

[agent-os/](agent-os/) est l'OS agentique local : `cd agent-os && npm start` → http://localhost:4100 (zéro dépendance npm). Le serveur lance aussi le Kie Image Studio (port 3210, intégré page « Miniature Creator ») et connecte Claude CLI au démarrage. Cache disque à rafraîchissement MANUEL uniquement (F5 ou bouton « Actualiser » — jamais de polling API). Coffre-fort chiffré des credentials + OAuth Google (Drive, chaînes YouTube) dans `agent-os/data/` (gitignoré). Les machines déclarent leurs tâches via `POST/PATCH /api/tasks` (statuts done/published/failed → notifications Telegram) — voir [agent-os/README.md](agent-os/README.md).

**Créer une nouvelle machine** (autre niche que Time Travel) : utiliser le skill `machine-factory` (`.claude/skills/machine-factory`) — modèle mental squelette-vs-coutures, checklist des fichiers, règles non-négociables. On clone `agent-os/lib/machines/timetravel.js` (machine de référence) et on ne change que les coutures de niche.

Le skill `ffmpeg-usage` (`.claude/skills/ffmpeg-usage`) donne les bonnes pratiques FFmpeg (conversion, concat, GIF, sous-titres, presets réseaux sociaux).

## Volet Remotion

Le projet Remotion vit dans [remotion/](remotion/) (`npm run dev` pour le Studio, `npx remotion render <CompId> <sortie>` pour le rendu). Les skills officiels `remotion-dev/skills` sont dans `.claude/skills/` (remotion-create, -markup, -best-practices, -render, -captions, -interactivity, -saas, mediabunny) : les consulter systématiquement quand on écrit ou modifie des compositions Remotion.

## Volet n8n

Le dossier [n8n/Workflows n8n/](n8n/Workflows%20n8n/) contient la bibliothèque de workflows de référence (exports JSON n8n). Les IDs Google ont été remplacés par des placeholders (`VOTRE_SHEET_ID`, `VOTRE_DOSSIER_DRIVE_ID`) : chaque utilisateur les remplace par ses propres documents. Quand on crée un nouveau workflow, produire le JSON complet (nodes + connections + settings) directement exploitable.

Domaine : usines à contenu IA pour YouTube/réseaux (histoires enfants, documentaires, musique, miniatures, scraping) orchestrées autour de Kie.ai, FAL.ai, OpenRouter et Google Workspace.

## Squelette standard d'un workflow

```
Trigger (manualTrigger "START" / formTrigger / telegramTrigger)
  → Set "Data" (paramètres d'entrée : Thème, Nombre scène, URLs…)
  → AI Agent (génère N prompts structurés en JSON)
  → Split Out (1 item par scène)
  → Génération média par API asynchrone (POST → Wait → GET résultat)
  → Assemblage FFmpeg via FAL (trim / merge audio-vidéo / merge vidéos / sous-titres)
  → Livraison : Google Drive (upload) + Google Sheets (état) — ou téléchargement direct
```

## Pattern n°1 : appel API asynchrone avec polling (cœur de tout)

Jamais de callback réel : `callBackUrl` est toujours un placeholder, la récupération se fait par **Wait fixe + GET**.

**Kie.ai** (credential httpHeaderAuth, ex. « Kie FORMATION V2 ») :
1. `POST https://api.kie.ai/api/v1/jobs/createTask` — body JSON : `{ "model": "...", "input": { "prompt": {{ JSON.stringify($json.prompt) }}, "input_urls": [...], "aspect_ratio": "16:9", "resolution": "...", "duration": N } }`
2. Node **Wait** (image ≈ 2-3 min, vidéo ≈ 10 min, musique ≈ 8 min)
3. `GET https://api.kie.ai/api/v1/jobs/recordInfo?taskId={{ $json.data.taskId }}`
4. URL du résultat : `{{ JSON.parse($json.data.resultJson).resultUrls[0] }}`
- Cas particulier Suno (musique) : `POST /api/v1/generate` (bodyParameters, model `V5_5`, customMode, instrumental, style, title, styleWeight/weirdnessConstraint/audioWeight 0.65) puis `GET /api/v1/generate/record-info?taskId=...` ; audios dans `data.response.sunoData[].audioUrl` (2 titres par génération → prévoir title1/title2).

**FAL.ai** (credential httpHeaderAuth, ex. « FAL FORMATION V2 ») :
1. `POST https://queue.fal.run/<endpoint>` — body JSON
2. **Wait** (60 s à 2 min)
3. `GET {{ $json.response_url }}` **avec la même credential**
4. Résultat : `$json.video.url`, `$json.audio.url` ou `$json.media.*`

Endpoints FAL utilisés : `fal-ai/ffmpeg-api/images-to-video` (images `[{url, frames}]` + `fps`), `merge-videos` (`video_urls`), `merge-audios` (`audio_urls`, max ~5 par appel → chunker), `merge-audio-video` (`video_url` + `audio_url`), `metadata` (`media_url` → durée), `fal-ai/workflow-utilities/trim-video` (`video_url`, `start_time`, `duration`), `fal-ai/inworld-tts` (`text`, `voice`: « Hélène (fr) » / « Alain (fr) », `sample_rate_hertz`: 48000), `veed/subtitles` (`video_url`, `preset`: "flex").

**Heygen** (credential « Heygen ») : `POST https://api.heygen.com/v3/videos` (type avatar, avatar_id, script, voice_id, resolution, aspect_ratio) → Wait → `GET /v3/videos/{{ $json.data.video_id }}` → `$json.data.video_url`.

## Pattern n°2 : AI Agent (RÈGLE DE CONSTRUCTION OBLIGATOIRE)

**Chaque fois qu'un workflow généré contient un AI Agent, instancier systématiquement le quatuor complet dans le JSON du workflow** (sauf demande contraire explicite) :
- `@n8n/n8n-nodes-langchain.agent` (v3.1, souvent `retryOnFail: true`, `hasOutputParser: true`) — prompt user court avec les variables — et `options.systemMessage` = le system prompt au format A-G-E-N-T
- `@n8n/n8n-nodes-langchain.lmChatOpenRouter` — credential OpenRouter, modèle **`google/gemini-3.1-flash-lite` par défaut** (alternative connue : `openai/gpt-5.4-nano`) — connexion `ai_languageModel`
- `@n8n/n8n-nodes-langchain.toolThink` — toujours branché (`ai_tool`), et le system prompt impose son usage systématique
- `@n8n/n8n-nodes-langchain.outputParserStructured` — connexion `ai_outputParser`, `jsonSchemaExample` = le schéma JSON de sortie ; option `autoFix: true` possible (le modèle doit alors aussi être connecté au parser en `ai_languageModel`)

**Le system prompt suit le cadre A-G-E-N-T** — procédure canonique dans [n8n/Workflows n8n/Blueprint A G E N T.md](n8n/Workflows%20n8n/Blueprint%20A%20G%20E%20N%20T.md). Structure YAML-like : 🅰️ A – Demande (tâche + « EXACTEMENT N sorties », jamais de fourchette), 🇬 G – Orientation (rôle, ton, contraintes chiffrées), 🇪 E – Exemples (good 🟢 / bad 🔴 commentés), 🇳 N – Format (JSON only, example_output), 🇹 T – Outils (Think Tool obligatoire avec checklist).

**Application des « deux blocs » du blueprint** : bloc 1 (system prompt YAML) → champ `systemMessage` du node agent (préfixé `=` si expressions) ; bloc 2 (schéma JSON seul) → champ `jsonSchemaExample` du Structured Output Parser. Les deux doivent être parfaitement cohérents.
Défauts intelligents si info manquante (signalés 🔧) : 1 sortie, JSON, 100-300 caractères/résultat, Think Tool, langue = celle de l'utilisateur final. Clés YAML en anglais, contenu en français.
Règles récurrentes : prompts média longs et riches — image ≥ 500 caractères, vidéo/animation ≥ 400 — avec style martelé, cohérence personnage/décor entre scènes, prompts média en anglais / voix off en français, contraintes de comptage strictes, contraintes critiques répétées en début ET fin de prompt.
Personnage avec image de référence (i2i) : ne JAMAIS décrire sa couleur/race/pelage dans les prompts — la référence est la seule source de vérité ; on décrit tenue, émotion, action, jamais le physique. Vidéos sans bande-son ajoutée : interdiction de parole ABSOLUE, répétée en début ET fin de chaque prompt vidéo. Multishot grok 1.5 : durée min 6 s ; 6-7 s → 2 plans, 8-10 s → 3 plans.

Après l'agent : **Split Out** sur `output.scenes` (ou `output.songs`).

## Pattern n°3 : Google Sheets = base d'état (machine à états)

- Colonnes types : `id`, `prompt_image`, `voix_off`, `status`, `lien_images`, `lien_video`
- `status` avance : `PROMPT` → `IMAGE` → `VIDEO` ; chaque workflow lit les lignes à son statut (`filtersUI` lookup `status`) et écrit le statut suivant
- Création d'id : `==ROW()-1` ; mise à jour : `appendOrUpdate` avec `matchingColumns: ["id"]`
- Recorrélation après une chaîne de nodes : `{{ $('Get row(s) in sheet').item.json.id }}`
- Chaque utilisateur crée SES documents et remplace `VOTRE_SHEET_ID` / `VOTRE_DOSSIER_DRIVE_ID` dans les workflows importés

**Google Drive** : lien direct réutilisable par les APIs : `https://drive.google.com/uc?export=download&id={{ $json.id }}`. **Google Docs** : Create a document puis Update (insert texte) pour stocker des transcripts.

## Conventions & astuces récurrentes

- **Toujours** `{{ JSON.stringify($json.champ) }}` pour injecter un prompt/texte dans un `jsonBody` (échappement)
- Téléchargement binaire = node HTTP Request avec l'URL en expression ; s'enchaîne direct sur Upload Drive
- **Batching anti rate-limit** : `options.batching` `batchSize` 5-10, `batchInterval` 15000
- **Filter anti-échec** (node `filter` v2.3) après CHAQUE GET de polling Kie : condition string `notEmpty` sur `={{ $json.data.resultJson }}` (typeValidation strict)
- **Aggregate** (fieldsToAggregate) pour passer de N items → 1 liste d'URLs avant un merge
- **Merge mode combine / combineByPosition** pour synchroniser 2 branches parallèles
- **Switch** pour router selon un champ ; **Code node (JS)** quand le mapping ne suffit pas
- **Analyse multimodale directe** via `POST https://openrouter.ai/api/v1/chat/completions` avec content `[{type:"text"},{type:"video_url"}]` ; transcription vocale via `/api/v1/audio/transcriptions` (whisper-1, audio base64)
- **Telegram bot** : telegramTrigger → Switch texte/vocal → agent avec `telegramTool` en ai_tool
- **Pexels** : `GET https://api.pexels.com/v1/videos/search` (query 5 mots anglais, per_page 10, landscape, medium)
- `executeOnce: true` sur un node qui ne doit tourner qu'une fois ; `onError: continueRegularOutput` sur les nodes non critiques
- Settings systématiques : `executionOrder: "v1"`, `binaryMode: "separate"`

## Modèles média (état janvier 2026, via Kie.ai sauf mention)

| Usage | Modèle |
|---|---|
| Texte → image (rapide/éco) | `nano-banana-2-lite` |
| Image → image (édition, personnage de référence, miniatures) | `gpt-image-2-image-to-image` (resolution 1K/4K) |
| Texte → image (qualité) | `gpt-image-2-text-to-image` |
| Image → vidéo 10 s avec voix off intégrée au prompt | `grok-imagine-video-1-5-preview` (720p) |
| First frame → last frame (morphing continu) | `bytedance/seedance-1.5-pro` (6 s, `input_urls`, URL Drive en `thumbnail?id=…&sz=w1920`) |
| Musique | Suno `V5_5` via Kie `/generate` |
| TTS français | FAL `fal-ai/inworld-tts` |
| Avatar parlant | Heygen v3 |

## Pièges de transport Kie (mesurés, pas supposés)

- **Le nom du champ image dépend du MODÈLE, et un mauvais champ est ignoré EN SILENCE.**
  Grok vidéo veut `image_urls` ; `bytedance/seedance-1.5-pro` veut `input_urls`. Donner à
  seedance un `image_urls` ne produit aucune erreur : il génère une vidéo **sans rapport avec
  les images fournies**. Toujours REGARDER le résultat, jamais se fier au code de retour.
- **Seedance ne sait pas télécharger `drive.google.com/uc?export=download`** (redirection) :
  il répond `resource download failed`. Utiliser `drive.google.com/thumbnail?id=<id>&sz=w1920`,
  servi directement. Grok, lui, accepte les deux.
- **Un JPEG léger (~300 Ko) passe mieux qu'un PNG de 2 Mo.**
- **Seedance interprète « decay » comme une catastrophe** : sans interdiction explicite, il fait
  EXPLOSER les bâtiments (débris projetés en l'air). Interdire nommément explosion, débris,
  effondrement brutal, et exiger « erosion, settles downward, slowly ».

## Credentials n8n (créer les vôtres, référencer par nom)

Dans n8n, créer ses propres credentials et les nommer de façon stable (les workflows de référence utilisent ces types) :

| Type | Service |
|---|---|
| openRouterApi | OpenRouter (LLM + multimodal) |
| httpHeaderAuth | api.kie.ai / queue.fal.run / api.pexels.com / api.heygen.com |
| OAuth2 Google | Sheets / Drive / Docs |
| telegramApi | Bot Telegram |
