# Guide de connexion à Agentic Os — destiné à Hermès

> Hermès : ce document t'est adressé. Il décrit comment la plateforme t'intègre et comment
> t'y connecter proprement. Lis-le en entier avant d'agir. L'utilisateur peut te le faire
> lire avec : « Lis agent-os/docs/guide-hermes.md et connecte-toi à Agentic Os ».

## Ce qu'est Agentic Os et ta place dedans

Agentic Os est une plateforme locale de production de contenu (machines vidéo, calendrier de
publication, chaînes YouTube, scraping) servie sur **`http://127.0.0.1:4100`**. Deux agents y
sont branchés : **Claude Code** (référent de la plateforme, chat + curateur) et **toi, Hermès**
(second agent : chat web + crons durables). Tu n'as rien à installer côté plateforme : les ponts
existent déjà, ils appellent ton CLI.

## Étape 1 — Vérifier que la plateforme tourne

```
GET http://127.0.0.1:4100/api/health
```

Réponse attendue : `ok: true`, avec un objet `hermes` (ton propre état vu par la plateforme).
Si le serveur ne répond pas : `cd agent-os && npm start` (ne jamais le redémarrer si un run de
génération est en cours).

## Étape 2 — Lire le manifest (source de vérité)

```
GET http://127.0.0.1:4100/api/agent/manifest
```

Le manifest liste toutes les routes utilisables (machines, tâches, analytics, tes crons…).
Complément lisible : `agent-os/docs/agents-locaux.md`. Ne devine jamais une route : lis le manifest.

## Comment la plateforme t'appelle (à ne pas casser)

- **Chat Hermès** (page `#/hermes`) : le backend lance
  `hermes chat -Q --source agentic-os-web --pass-session-id --yolo -q <message>`, puis
  `--resume <session_id>` pour la suite de la conversation. Les conversations web vivent dans
  `agent-os/data/hermes-chats.json`. Ta ligne `session_id: …` émise sur stderr est capturée par
  la plateforme — ne change pas ce comportement, la reprise de session en dépend.
- **Tes crons** : la page Tâches & Cron lit TON planificateur durable via
  `GET /api/hermes/crons` (pont `scripts/hermes-cron-bridge.py`). La **création est
  exclusivement verbale** : quand l'utilisateur te demande un cron (dans le chat web, sur
  Telegram ou en CLI), crée-le dans ton propre scheduler — il apparaîtra automatiquement dans
  l'interface. L'interface ne sert qu'à activer / mettre en pause / supprimer.

## Routes utiles pour tes automatisations

| Besoin | Route |
|---|---|
| Santé globale | `GET /api/health` |
| Ton état vu par la plateforme | `GET /api/hermes/status` |
| Tâches des machines | `GET /api/tasks` · `POST/PATCH /api/tasks` |
| Notifier l'utilisateur (Telegram plateforme) | `POST /api/notify {"text"}` |
| Analytics chaînes (lecture) | voir manifest (`/api/channels/overview`, `/api/stats/…`) |
| Tes crons | `GET/POST /api/hermes/crons` · `/:id/toggle` · `DELETE /:id` |

## Règles opérationnelles (non négociables)

1. **Ne modifie jamais le code de la plateforme** sauf demande explicite de l'utilisateur.
2. **Loopback uniquement** : le serveur écoute sur `127.0.0.1` parce que ton pont tourne en
   `--yolo` (sans confirmation). Ne le remets jamais sur `0.0.0.0`, ne l'exposes jamais.
3. **Cache manuel** : la plateforme ne rafraîchit ses APIs externes (YouTube, Kie…) que sur
   action de l'utilisateur. Ne déclenche pas de rafraîchissements agressifs ni de polling.
4. **Aucune génération payante** (image, vidéo, musique) de ta propre initiative — uniquement
   sur demande claire de l'utilisateur.
5. **Pas de double notification** : la plateforme notifie déjà Telegram en fin de tâche
   (`done`/`published`/`failed`). N'envoie pas de doublon.
6. Ne redémarre jamais le serveur pendant qu'un run est en statut `*_running`.

## Auto-test de connexion ET de capacités (obligatoire à la première connexion)

Ne te contente pas de dire « je suis connecté » : **teste réellement chaque capacité**, dans
cet ordre, et rends compte à l'utilisateur de ce qui marche et de ce qui manque.

1. **Santé** : `GET /api/health` → `ok: true` ;
2. **Ton état** : `GET /api/hermes/status` → `connected: true` (sinon : l'utilisateur vérifie
   `hermes --version` dans un terminal puis clique ⟳ Reconnecter Hermès, page Connexions) ;
3. **Chat** : demande à l'utilisateur d'envoyer un message d'essai dans la page Chat Hermès et réponds-y ;
4. **Manifest** : `GET /api/agent/manifest` lu, liste des routes disponibles comprise ;
5. **Cron (cycle complet)** : crée dans TON scheduler un cron de test clairement nommé
   (ex. « TEST capacités — à supprimer », désactivé ou à horaire lointain), vérifie qu'il
   apparaît dans `GET /api/hermes/crons`, mets-le en pause via `POST /api/hermes/crons/:id/toggle`,
   puis **supprime-le** ;
6. **Tâches** : `POST /api/tasks` (titre « TEST Hermès — à supprimer », machine « Test »),
   `PATCH` sa progression, puis `DELETE` — la carte doit apparaître/disparaître page Tâches & Cron ;
7. **Machines & données (LECTURE SEULE)** : liste des machines, runs d'une machine, stock,
   `/api/channels/overview`, analytics, banque de niches, fichiers — **aucune génération
   payante pour tester** (interdit) ;
8. **Notification** : avec l'accord de l'utilisateur, `POST /api/notify {"text":"Hermès connecté à Agentic Os ✓"}` (une seule fois) ;
9. **Rapport final** : résume à l'utilisateur ce qui fonctionne, ce qui est absent (clé API
   manquante, Google non connecté, 0 chaîne…) et ce que tu recommandes de configurer ensuite.

## Gateway Telegram — wizard de création du bot (à ta charge)

Quand l'utilisateur veut la gateway Telegram (propose-le en fin de setup), mène un **wizard
pas à pas** — ne le laisse pas se débrouiller :

1. Fais-lui ouvrir **@BotFather** dans Telegram → `/newbot` → choisir le nom puis le username
   du bot → BotFather rend un **token**. Demande-lui de te le coller (ne l'écris jamais dans
   un fichier versionné) ;
2. Enregistre le token et configure ta gateway selon **ta propre documentation officielle**
   (https://hermes-agent.nousresearch.com/docs/) ;
3. ⚠️ **Démarre la gateway DEPUIS LA RACINE DE CE PROJET** (le dossier du dépôt — demande le
   chemin exact à l'utilisateur s'il ne te l'a pas donné). Une gateway lancée depuis un autre
   répertoire tourne sans le contexte du projet (AGENTS.md, ce guide, accès locaux) : les
   conversations Telegram se comportent alors comme si Agentic Os n'existait pas — problème
   déjà rencontré. Le répertoire de travail de la gateway = la racine du projet, toujours ;
4. Mets en place le **démarrage automatique** de la gateway (ex. tâche planifiée Windows) en
   t'assurant que la tâche définit **ce même répertoire de travail** (champ « Commencer dans »
   / `WorkingDirectory`) — un auto-démarrage qui part d'ailleurs reproduit le même bug ;
5. Fais-lui envoyer un premier message au bot et réponds-y pour valider le canal — vérifie
   dans cette réponse que tu as bien le contexte du projet (tu dois savoir que tu es dans
   Agentic Os) ;
6. Vérifie qu'un cron avec destination Telegram livre bien son résultat sur le bot.
