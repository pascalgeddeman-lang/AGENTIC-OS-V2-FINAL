# Agentic Os — contexte pour les agents

Agentic Os est l'OS agentique local servi sur `http://localhost:4100`.

## Point d'entrée obligatoire

Avant de piloter la plateforme, lire :

- `GET http://localhost:4100/api/agent/manifest`
- `docs/agents-locaux.md`
- Hermès : lire aussi `docs/guide-hermes.md` (guide de connexion qui t'est destiné)

Le manifest est la source de vérité pour les machines et routes disponibles.

## Démarrage et santé

- Démarrage : `npm start`
- Santé : `GET http://localhost:4100/api/health`
- Ne pas redémarrer le serveur pendant qu'un run est en génération.

## Règles opérationnelles

- Ne jamais régénérer pendant qu'un run est en statut `*_running`; attendre `*_ready`.
- Le cache des APIs externes est rafraîchi manuellement : ne pas marteler les APIs externes.
- Les routes locales peuvent être interrogées librement.
- Respecter les modifications non validées présentes dans le dépôt; ne jamais les écraser.
- Pour les conventions générales du dépôt parent, consulter `../CLAUDE.md`.

## Vérification

Après une modification, vérifier au minimum `/api/health` et les routes touchées. Pour les changements d'interface, charger la page locale et contrôler visuellement le comportement.
