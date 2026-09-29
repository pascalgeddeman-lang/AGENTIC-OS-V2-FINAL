# Agents locaux (Hermès, Claude CLI, scripts) — accès à Agentic Os

Agentic Os est un serveur **local sans authentification**, lié uniquement à la boucle locale (`http://localhost:4100`). Tout agent tournant sur la machine (Hermès local, Claude CLI, script Node/Python) dispose donc **des mêmes accès que l'UI** : il suffit de parler HTTP. Le serveur ne doit pas être exposé au réseau sans ajouter une authentification.

## Point d'entrée : le manifest

```
GET http://localhost:4100/api/agent/manifest
```

Renvoie la liste des machines, les conventions de routes et un pointeur vers ce document. Un agent commence TOUJOURS par là (les routes évoluent, le manifest est la source de vérité).

## Conventions (identiques pour toutes les machines)

| Action | Route |
|---|---|
| Config machine | `GET /api/machines/<id>` · `PATCH` (mêmes champs) |
| Lancer un run | `POST /api/machines/<id>/runs` (voir le corps attendu dans la config/le frontend) |
| Suivre un run | `GET /api/machines/<id>/runs/:runId` (statuts `<étape>_running` / `<étape>_ready` / `done` / `failed`) |
| Piloter un run | `POST .../runs/:runId/validate` · `/cancel` · `/resume` (corps `{status}` optionnel pour forcer l'étape) · `/regen` |
| Publier | `POST .../runs/:runId/publish {channelId, title?, description?, tags?}` |
| Stock | `GET .../stock` · `PATCH .../stock/:id {archived?|posted?}` |
| Idée de thème | `POST .../idea` (exclut automatiquement les idées déjà produites) |
| Tâches/notifications | `GET/POST /api/tasks` · `PATCH /api/tasks/:id` (statuts done/published/failed → Telegram) |
| Cron Hermes durable | `GET/POST /api/hermes/crons` · `POST /api/hermes/crons/:id/toggle` · `/run` · `DELETE /api/hermes/crons/:id` |
| Telegram direct | `POST /api/notify {text}` |
| Fichiers générés | `GET /media/<chemin relatif>` |

Règles à respecter par tout agent (les mêmes que Claude CLI) :
- **Jamais** de régénération pendant qu'un run est en `*_running` (attendre `*_ready`).
- **Jamais** redémarrer le serveur pendant qu'un run génère (le cron « Sauvetage » rattrape, mais la génération en cours est perdue).
- Le cache des pages est manuel : ne pas marteler les APIs externes ; les routes locales sont libres.

## Architecture cible : calendrier de publication par chaîne (préparé, pas encore actif)

Objectif : chaque chaîne YouTube se construit son propre calendrier ; les machines remplissent le stock, le planificateur publie aux créneaux.

Données (fichier `data/schedule.json`, à créer quand la fonctionnalité s'activera) :

```json
{
  "channels": [
    {
      "channelId": "UC…",
      "slots": [ { "dow": 3, "time": "18:00" }, { "dow": 6, "time": "11:00" } ],
      "source": { "machineId": "linguistique", "pick": "oldest-unposted" },
      "paused": false
    }
  ],
  "queue": [
    { "stockId": "v…", "machineId": "linguistique", "channelId": "UC…", "publishAt": "2026-08-01T18:00:00+02:00", "status": "scheduled" }
  ]
}
```

Boucle prévue (à brancher dans `server.listen`, comme le cron Sauvetage) :
1. Toutes les 10 min : pour chaque chaîne non `paused`, si le prochain créneau < 24 h et rien en `queue` → prendre une vidéo du stock (`pick`) et l'inscrire en `queue`.
2. Quand `publishAt` est atteint → `publishRun` (déjà robuste : upload par chunks, erreurs lisibles) → statut `published`, alerte Telegram.
3. Échec → statut `failed` + alerte, la vidéo reste dans le stock.

Briques déjà en place aujourd'hui : stock par machine avec `posted/archived`, `publishRun` par machine, scope OAuth `youtube.upload`, événements Telegram (`video_published`), `PATCH stock` pour marquer publié à la main.
