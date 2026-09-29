# Agentic Os — Starter

Plateforme locale d'**usines à contenu IA pour YouTube** (machines de génération vidéo, calendrier de publication, analytics, scraping, miniatures), pilotée par **Claude Code**. Ce dépôt est une coquille vide : aucune clé, aucune donnée, aucune chaîne — tout se configure chez vous, guidé par Claude.

## Installation (5 minutes pour démarrer)

1. Installez [Claude Code](https://claude.com/claude-code), [Node.js ≥ 18](https://nodejs.org) et [FFmpeg](https://www.gyan.dev/ffmpeg/builds/) (dans le PATH).
2. Clonez ce dépôt, ouvrez le dossier dans un terminal, lancez `claude`.
3. Dites simplement : **« Installe-moi le projet »** — Claude suit le guide d'installation du `CLAUDE.md` : démarrage du serveur, clés API (Kie.ai, FAL.ai, OpenRouter…), connexion Google/YouTube, première machine.

Démarrage manuel : `cd agent-os && npm start` → http://localhost:4100 (ou double-clic sur « Lancer Agent OS.bat »).

## Ce qu'il y a dedans

- **agent-os/** — la plateforme (serveur Node zéro dépendance + interface web) : Dashboard, Machines (Time Travel, Linguistique, Musique), Calendrier de publication, Chaînes, Niche Finder, Scrap-o-matic, Banque de niches, Miniature Creator, Chat Claude (+ Chat Hermès optionnel)
- **remotion/** — compositions de rendu (CTA animés des machines) ; `cd remotion && npm install`
- **n8n/Workflows n8n/** — bibliothèque de workflows n8n de référence de la formation (IDs remplacés par `VOTRE_SHEET_ID` / `VOTRE_DOSSIER_DRIVE_ID` : mettez les vôtres)
- **kie-image-studio/** — studio de génération d'images (intégré à la page Miniature Creator)
- **.claude/skills/** — skills Claude du projet : `machine-factory` (créer une nouvelle machine), `clip-montage-cta`, `ffmpeg-usage`, `n8n-workflow-builder`, skills Remotion officiels

## À savoir

- Vos clés vivent dans un **coffre chiffré local** (`agent-os/data/`, jamais commité). Ne commitez jamais `.env`.
- Le serveur n'écoute que sur `127.0.0.1` : il n'est pas accessible depuis l'extérieur.
- Chaque utilisateur paie ses propres APIs (Kie.ai, FAL.ai, OpenRouter, YouTube) — commencez par des runs courts.
- Hermès et le « second cerveau » Obsidian sont **optionnels** : sans eux, tout le reste fonctionne.
- Pour installer Hermès (Chat Hermès + crons durables) : suivez la section « Installer Hermès » du `CLAUDE.md` (installeur officiel en une ligne), puis faites lire à Hermès son guide de connexion `agent-os/docs/guide-hermes.md`.
