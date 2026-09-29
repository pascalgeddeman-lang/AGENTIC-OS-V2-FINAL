# Agentic Os — plateforme centralisée (v0.1)

OS agentique local : dashboard YouTube, tâches/cron, chat Claude CLI, second cerveau
Graphify, niche finder, miniature creator, fichiers, coffre-fort de credentials.

## Démarrage

```bash
cd agent-os
npm start        # -> http://localhost:4100
```

Zéro dépendance npm (Node ≥ 18). Au démarrage, le serveur :
- vérifie et connecte **Claude CLI** (commande `claude` du PATH) ;
- démarre le scheduler des tâches planifiées (tick 30 s).

Le **Miniature Creator** est natif (plus d'iframe ni de login) : génération Kie
directe (clé du coffre ou `.env`), chaque job suivi dans Tâches & Cron, alerte
Telegram à la fin, résultats dans `agent-os/output/miniatures/` (dossier unique
des résultats, visible dans Mes fichiers). Sources i2i importables depuis
« Mes fichiers » (local + Drive). Le **Second Cerveau** lit le coffre Obsidian
désigné par `SECOND_BRAIN_DIR` : `scripts/build-graph.js` en extrait les wikilinks
et les tags vers `<coffre>/graphify-out/` (`graph.json` + `rings.html`), servi sur
`/brain/graph/` et rendu en canvas (anneaux par connectivité, recherche, filtre par
tag, panneau de détail). Bouton « ⟳ Réindexer » = `POST /api/brain/reindex`. Claude (chat + curateur)
est le référent de la plateforme : il connaît l'API locale (génération d'images,
niche finder, `/api/notify` Telegram, tâches, fichiers, stats).

## Politique de cache (importante)

Aucune actualisation automatique des APIs. Les données (stats YouTube, chaînes)
sont servies depuis `data/cache/` et ne sont refetchées que :
- au **rechargement manuel** de la page (F5) ;
- au clic sur **« Actualiser »** en haut à droite.

La puce orange du header affiche l'âge des données.

## Configuration (page Paramètres)

1. **Coffre-fort** : coller Kie, FAL, HeyGen, OpenRouter, Pexels, Apify,
   token + chat id Telegram, Client ID/Secret Google. Chiffré AES-256-GCM
   (`data/vault.json` + clé machine `data/.vaultkey`), jamais renvoyé en clair.
2. **Clés API YouTube** : chaque clé ajoute 10 000 unités/jour (pool avec ledger
   quotidien, fuseau Pacifique). Requises pour le Niche Finder.
3. **Google OAuth** : dans Google Cloud Console, créer un client OAuth « Web »
   avec `http://localhost:4100/api/google/callback` en URI de redirection, activer
   YouTube Data API v3, YouTube Analytics API et Drive API. Puis « Connecter
   Google Drive » et « Connecter une chaîne YouTube » (répéter par chaîne/compte).

## Architecture des fichiers

```
agent-os/
  server.js          routeur HTTP + spawn studio + warmup Claude
  lib/
    cache.js         cache disque à refresh manuel uniquement
    vault.js         coffre AES-256-GCM + pool de clés YouTube
    claude.js        pont Claude CLI (sessions --resume, chat + curateur)
    google.js        OAuth Drive/YouTube, tokens, fichiers Drive
    youtube.js       Data API v3 (quota) + Analytics (séries vues/abonnés)
    niche.js         recherche d'outliers (score = vues / moyenne précédentes, cap 999×)
    tasks.js         tâches + cron jobs + événements Telegram
    spend.js         registre des dépenses (par API / par machine)
    files.js         fichiers locaux (studio, vidéos, exports)
    telegram.js      envoi de notifications
  public/            SPA (aucun framework) : js/pages/*.js
  data/              état local (gitignoré) : coffre, tokens, caches, chats
```

## API pour les futures machines

Les machines (workflows n8n + interface) se brancheront via :
- `POST /api/tasks` `{title, machine, channel, step, progress, status}` ;
- `PATCH /api/tasks/:id` — passer `status` à `done` / `published` / `failed`
  déclenche les notifications Telegram correspondantes (cron jobs activables) ;
- `spend.record()` côté serveur pour les dépenses par machine.

La page Machines est volontairement vide en v0.1.
