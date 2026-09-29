---
name: n8n-workflow-builder
description: Construit, modifie et débogue des workflows n8n complets (JSON importable) pour des usines à contenu IA — génération d'images/vidéos/musique/voix via Kie.ai, FAL.ai, Suno, Heygen, OpenRouter, assemblage FFmpeg, livraison Google Drive/Sheets. Utiliser cette skill dès que l'utilisateur veut créer un workflow n8n, éditer un fichier .n8n ou un export JSON n8n, ajouter/corriger des nodes (HTTP Request, AI Agent, Wait, Split Out…), construire un system prompt d'agent n8n, ou mentionne Kie, FAL, Suno, polling d'API asynchrone, ou l'automatisation de contenu YouTube — même s'il ne prononce pas le mot « workflow ».
---

# Constructeur de workflows n8n — usines à contenu IA

Cette skill permet de produire des workflows n8n **complets et directement importables** (nodes + connections + settings), de les modifier et de les déboguer. Le domaine cible : pipelines de génération de contenu IA (histoires, documentaires, musique, miniatures, scraping) orchestrés autour de Kie.ai, FAL.ai, OpenRouter et Google Workspace.

## Livrables attendus

Quand l'utilisateur demande un workflow, produire le **JSON complet** dans un fichier `.n8n` (même format qu'un export n8n) : clés `name`, `nodes`, `connections`, `settings`, éventuellement `pinData: {}`. Jamais un fragment : le fichier doit s'importer tel quel.

Règles transverses :
- `settings` contient toujours `"executionOrder": "v1"` (et `"binaryMode": "separate"` si le workflow manipule du binaire).
- Référencer les credentials **par leur nom** dans le champ `credentials` du node (ex. « Kie FORMATION V2 »). Ne jamais inscrire de clé API, token ou secret en dur dans un node.
- Espacer les positions des nodes d'environ 200–250 px sur l'axe X pour un rendu lisible ; empiler les sous-nodes d'agent (modèle, outils, parser) sous l'agent.
- Documenter les blocs avec des sticky notes quand le workflow dépasse ~10 nodes.
- IDs externes (spreadsheet, dossier Drive, chat Telegram) : si l'utilisateur ne les a pas fournis, mettre un placeholder explicite `<SHEET_ID>`, `<FOLDER_ID>`, `<CHAT_ID>` et le signaler dans la réponse.

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

Adapter ce squelette à la demande, mais s'en écarter consciemment, pas par oubli d'une étape.

## Les 3 patterns fondamentaux

### 1. Appel API asynchrone avec polling (cœur de tout)

Les APIs média (Kie, FAL, Heygen) sont asynchrones. Jamais de callback réel : `callBackUrl` est toujours un placeholder (`https://your-domain.com/api/callback`) ; la récupération se fait par **Wait fixe + GET**.

**Kie.ai** (credential httpHeaderAuth, ex. « Kie FORMATION V2 ») :
1. `POST https://api.kie.ai/api/v1/jobs/createTask` — body JSON : `{ "model": "...", "input": { "prompt": {{ JSON.stringify($json.prompt) }}, "input_urls": [...], "aspect_ratio": "16:9", "resolution": "...", "duration": N } }`
2. Node **Wait** — image ≈ 2-3 min, vidéo ≈ 10 min, musique ≈ 8 min
3. `GET https://api.kie.ai/api/v1/jobs/recordInfo?taskId={{ $json.data.taskId }}`
4. URL du résultat : `{{ JSON.parse($json.data.resultJson).resultUrls[0] }}`
5. **Filter anti-échec obligatoire** juste après le GET (voir Conventions)

Cas particulier Suno (musique) : `POST /api/v1/generate` (bodyParameters, model `V5_5`, customMode, instrumental, style, title, styleWeight/weirdnessConstraint/audioWeight 0.65) puis `GET /api/v1/generate/record-info?taskId=...` ; audios dans `data.response.sunoData[].audioUrl` (2 titres par génération → prévoir title1/title2).

**FAL.ai** (credential httpHeaderAuth, ex. « FAL FORMATION V2 ») :
1. `POST https://queue.fal.run/<endpoint>` — body JSON
2. **Wait** (60 s à 2 min)
3. `GET {{ $json.response_url }}` — **avec la même credential**
4. Résultat : `$json.video.url`, `$json.audio.url` ou `$json.media.*`

Endpoints FAL : `fal-ai/ffmpeg-api/images-to-video` (images `[{url, frames}]` + `fps`), `merge-videos` (`video_urls`), `merge-audios` (`audio_urls`, max ~5 par appel → chunker), `merge-audio-video` (`video_url` + `audio_url`), `metadata` (`media_url` → durée), `fal-ai/workflow-utilities/trim-video` (`video_url`, `start_time`, `duration`), `fal-ai/inworld-tts` (`text`, `voice` : « Hélène (fr) » / « Alain (fr) », `sample_rate_hertz` 48000), `veed/subtitles` (`video_url`, `preset` "flex").

**Heygen** (credential httpHeaderAuth) : `POST https://api.heygen.com/v3/videos` (type avatar, avatar_id, script, voice_id, resolution, aspect_ratio) → Wait → `GET /v3/videos/{{ $json.data.video_id }}` → `$json.data.video_url`.

→ **JSON exact des nodes** : lire [references/api-polling-nodes.md](references/api-polling-nodes.md) avant d'écrire ces chaînes.

### 2. AI Agent : le quatuor obligatoire

Chaque fois qu'un workflow contient un AI Agent, instancier **systématiquement les 4 nodes** (sauf demande contraire explicite) :

| Node | Type | Connexion | Points clés |
|---|---|---|---|
| Agent | `@n8n/n8n-nodes-langchain.agent` v3.1 | `main` | `retryOnFail: true`, `hasOutputParser: true`, prompt user court avec variables, `options.systemMessage` = prompt A-G-E-N-T |
| Modèle | `@n8n/n8n-nodes-langchain.lmChatOpenRouter` | `ai_languageModel` | credential OpenRouter ; modèle par défaut `google/gemini-3.1-flash-lite` (alternative : `openai/gpt-5.4-nano`) |
| Think | `@n8n/n8n-nodes-langchain.toolThink` | `ai_tool` | toujours branché ; le system prompt impose son usage |
| Parser | `@n8n/n8n-nodes-langchain.outputParserStructured` | `ai_outputParser` | `jsonSchemaExample` = schéma de sortie ; si `autoFix: true`, connecter aussi le modèle au parser en `ai_languageModel` |

Le system prompt suit le **cadre A-G-E-N-T** (Ask · Guidance · Examples · Notation · Tools) : procédure complète dans [references/agent-prompt-blueprint.md](references/agent-prompt-blueprint.md) — la lire pour rédiger tout system prompt d'agent, même hors workflow complet.

Application des « deux blocs » du blueprint dans le JSON du workflow :
- Bloc 1 (system prompt YAML) → champ `systemMessage` du node agent (préfixé `=` s'il contient des expressions)
- Bloc 2 (schéma JSON seul, sans clé englobante ni commentaire) → champ `jsonSchemaExample` du parser
- Les deux doivent être parfaitement cohérents (mêmes champs, même forme que `example_output`).

Règles récurrentes pour les prompts média générés par l'agent :
- Prompts longs et riches : **image ≥ 500 caractères, vidéo/animation ≥ 400**, style martelé (« illustration enfantine… HD 4K » ou « photorealistic National Geographic »), cohérence personnage/décor entre scènes.
- Prompts média en **anglais**, voix off en **français** ; contraintes de comptage strictes (voix off 10 mots max, requête stock exactement 5 mots…) ; contraintes critiques répétées en début ET fin de prompt.
- Personnage avec image de référence (i2i) : ne JAMAIS décrire couleur/race/pelage — la référence est la seule source de vérité (« the exact same cat as in the reference image ») ; décrire tenue, émotion, action, jamais le physique.
- Vidéo sans bande-son ajoutée : interdiction de parole ABSOLUE, répétée en début ET fin de chaque prompt vidéo (« The cat never speaks… no talking mouth movements, no voiceover »).
- Multishot grok 1.5 : durée min technique 6 s ; 6-7 s → 2 plans, 8-10 s → 3 plans (chaque plan change cadrage/axe/action, scènes dynamiques, jamais statiques).

Après l'agent : **Split Out** sur `output.scenes` (ou `output.songs`).

→ **JSON exact du quatuor + connections** : lire [references/ai-agent-nodes.md](references/ai-agent-nodes.md).

### 3. Google Sheets = machine à états

- Colonnes types : `id`, `prompt_image`, `voix_off`, `status`, `lien_images`, `lien_video`
- `status` avance : `PROMPT` → `IMAGE` → `VIDEO` ; chaque workflow lit les lignes à son statut (`filtersUI` lookup `status`) et écrit le statut suivant
- Création d'id : `==ROW()-1` ; mise à jour : opération `appendOrUpdate` avec `matchingColumns: ["id"]`
- Recorrélation après une chaîne de nodes : `{{ $('Get row(s) in sheet').item.json.id }}`

**Google Drive** : upload dans un dossier cible (`<FOLDER_ID>`), nom du fichier avec l'id de ligne (ex. `=Image-{{ id }}`) ; lien direct réutilisable par les APIs : `https://drive.google.com/uc?export=download&id={{ $json.id }}`. **Google Docs** : Create a document puis Update (insert texte) pour stocker des transcripts.

→ **JSON exact** (Sheets, Drive, Docs, triggers, Switch, Telegram) : [references/triggers-and-integrations.md](references/triggers-and-integrations.md).

## Conventions & astuces récurrentes

- **Toujours** `{{ JSON.stringify($json.champ) }}` pour injecter un prompt/texte dans un `jsonBody` (échappement des guillemets et retours à la ligne — un prompt brut casse le JSON).
- **Filter anti-échec** (node `filter` v2.3) après CHAQUE GET de polling Kie : condition string `notEmpty` sur `={{ $json.data.resultJson }}` (typeValidation strict). Sans lui, une génération échouée casse toute la suite ; avec lui, elle est simplement écartée (image manquante → pas d'appel vidéo ; vidéo manquante → exclue du merge).
- **Batching anti rate-limit** sur les appels en masse : `options.batching` avec `batchSize` 5-10, `batchInterval` 15000.
- Téléchargement binaire = simple node HTTP Request avec l'URL en expression ; s'enchaîne direct sur un upload Drive.
- **Aggregate** (`fieldsToAggregate`) pour passer de N items → 1 liste d'URLs avant un merge-videos/merge-audios.
- **Merge mode combine / combineByPosition** pour synchroniser 2 branches parallèles (ex. vidéo + TTS lancées depuis la même source, réunies par position pour merge-audio-video). Branche parallèle = un node avec 2 connexions sortantes.
- **Switch** pour router selon un champ (type de formulaire, texte vs vocal Telegram).
- **Code node (JS)** quand le mapping ne suffit pas : flatten/extraction (sunoData), chunking par 5, scoring/sélection de clips, payloads chaînés first-frame/last-frame (scène N + image N+1), binaire → base64 (`this.helpers.getBinaryDataBuffer(0,'data')`).
- **Analyse multimodale directe** via `POST https://openrouter.ai/api/v1/chat/completions` (credential openRouterApi) avec content `[{type:"text"},{type:"video_url"}]` — Gemini analyse une vidéo YouTube par URL ; transcription vocale via `/api/v1/audio/transcriptions` (whisper-1, audio base64).
- **Pexels** : `GET https://api.pexels.com/v1/videos/search` (query 5 mots anglais générés par l'agent, per_page 10, landscape, medium).
- `executeOnce: true` sur un node qui ne doit tourner qu'une fois malgré N items entrants ; `onError: continueRegularOutput` sur les nodes non critiques.

## Modèles média (état janvier 2026, via Kie.ai sauf mention)

| Usage | Modèle |
|---|---|
| Texte → image (rapide/éco) | `nano-banana-2-lite` |
| Image → image (édition, personnage de référence, miniatures) | `gpt-image-2-image-to-image` (resolution 1K/4K) |
| Texte → image (qualité) | `gpt-image-2-text-to-image` |
| Image → vidéo 10 s avec voix off intégrée au prompt | `grok-imagine-video-1-5-preview` (720p) |
| First frame → last frame (morphing continu) | `bytedance/seedance-1.5-pro` (6 s, input_urls = [frameN, frameN+1]) |
| Musique | Suno `V5_5` via Kie `/generate` |
| TTS français | FAL `fal-ai/inworld-tts` |
| Avatar parlant | Heygen v3 |

## Modifier / déboguer un workflow existant

1. Lire le JSON existant en entier avant de toucher quoi que ce soit ; repérer le squelette (trigger → agent → split → génération → assemblage → livraison).
2. Vérifier les suspects habituels, dans l'ordre :
   - GET de polling sans **Filter anti-échec** derrière (cause n°1 de chaîne cassée)
   - Prompt injecté sans `JSON.stringify` dans un `jsonBody`
   - Durée de Wait trop courte pour le média généré
   - Expression de recorrélation qui pointe vers le mauvais node (`$('Nom exact du node')`)
   - Agent sans parser structuré, ou `jsonSchemaExample` incohérent avec `example_output` du system prompt
   - Connexion `ai_languageModel` manquante vers le parser quand `autoFix: true`
   - merge-audios avec plus de ~5 URLs par appel (chunker)
3. En cas de modification, préserver les noms de nodes existants (les expressions `$('...')` d'autres nodes en dépendent) et ne pas casser les positions.

## Fichiers de référence

| Fichier | Quand le lire |
|---|---|
| [references/api-polling-nodes.md](references/api-polling-nodes.md) | Avant d'écrire toute chaîne Kie / Suno / FAL (JSON exact des nodes POST/Wait/GET/Filter) |
| [references/ai-agent-nodes.md](references/ai-agent-nodes.md) | Avant d'instancier un AI Agent (quatuor + connections exactes) |
| [references/agent-prompt-blueprint.md](references/agent-prompt-blueprint.md) | Pour rédiger un system prompt au cadre A-G-E-N-T (avec ou sans workflow) |
| [references/utility-nodes.md](references/utility-nodes.md) | Nodes utilitaires : Aggregate, Merge, Split Out, download binaire, Drive, Sheets, connections, settings |
| [references/triggers-and-integrations.md](references/triggers-and-integrations.md) | Triggers (manual/form/telegram), Switch, Sheets/Docs, OpenRouter direct, Telegram bot |
