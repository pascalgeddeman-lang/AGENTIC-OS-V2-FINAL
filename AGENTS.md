# Instructions pour les agents (Hermès, etc.)

Ce dépôt est **Agentic Os** : plateforme locale d'usines à contenu IA, servie sur `http://127.0.0.1:4100`.

## Hermès : ta feuille de route de connexion

Si tu es Hermès (ou tout agent local autre que Claude Code), suis CET ordre :

1. **Lis ton guide dédié : [`agent-os/docs/guide-hermes.md`](agent-os/docs/guide-hermes.md)** — il contient tout : comment la plateforme t'appelle, les routes, les règles, et l'auto-test de connexion en 4 points. C'est ta référence principale.
2. Vérifie la plateforme : `GET http://127.0.0.1:4100/api/health` (si le serveur ne répond pas : `cd agent-os && npm start`).
3. Lis le manifest des routes : `GET http://127.0.0.1:4100/api/agent/manifest` (source de vérité), complété par [`agent-os/docs/agents-locaux.md`](agent-os/docs/agents-locaux.md).

## Règles valables pour TOUS les agents

- **Ne jamais modifier le code de la plateforme** sans demande explicite de l'utilisateur.
- Serveur en **loopback uniquement** (`127.0.0.1:4100`) — ne jamais l'exposer sur le réseau.
- **Cache manuel** : ne pas marteler les APIs externes ; les routes locales sont libres.
- **Aucune génération payante** de ta propre initiative.
- Ne jamais redémarrer le serveur pendant qu'un run de génération tourne.
- Contexte général du projet (volets, patterns, installation) : voir [`CLAUDE.md`](CLAUDE.md).
