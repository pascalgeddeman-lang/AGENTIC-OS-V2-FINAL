# Quatuor AI Agent — snippets JSON canoniques (n8n)

Extraits exacts des workflows de référence « 2-4 Agent IA » / « 2-5 Google Sheet ». Positions normalisées à `[0,0]`, IDs de credentials supprimés (référencer par nom uniquement).

## Table des matières

1. [Règle : le quatuor est obligatoire](#règle--le-quatuor-est-obligatoire)
2. [Node 1 — AI Agent (`@n8n/n8n-nodes-langchain.agent`)](#node-1--ai-agent)
3. [Node 2 — OpenRouter Chat Model (`lmChatOpenRouter`)](#node-2--openrouter-chat-model)
4. [Node 3 — Think Tool (`toolThink`)](#node-3--think-tool)
5. [Node 4 — Structured Output Parser (`outputParserStructured`)](#node-4--structured-output-parser)
6. [Bloc connections exact](#bloc-connections-exact)

## Règle : le quatuor est obligatoire

**Chaque fois qu'un workflow contient un AI Agent, instancier systématiquement les QUATRE nodes ci-dessous** (sauf demande contraire explicite) : l'agent lui-même, le modèle OpenRouter branché en `ai_languageModel`, le Think Tool branché en `ai_tool` (et imposé dans le system prompt), et le Structured Output Parser branché en `ai_outputParser` (avec `hasOutputParser: true` sur l'agent). Le `systemMessage` suit le cadre A-G-E-N-T ; le `jsonSchemaExample` du parser doit être parfaitement cohérent avec l'`example_output` du system prompt (mêmes champs, même forme, schéma JSON seul sans clé englobante ni commentaire). Après l'agent : Split Out sur `output.scenes` (ou `output.songs`).

## Node 1 — AI Agent

`typeVersion: 3.1`. Le prompt user (`text`) est court et injecte les variables du Set « Data ». Le `systemMessage` est préfixé `=` (il peut contenir des expressions). `hasOutputParser: true` obligatoire dès qu'un parser est branché. Optionnel mais fréquent : `"retryOnFail": true` au niveau du node.

```json
{
  "parameters": {
    "promptType": "define",
    "text": "=Je veux que tu me crée des prompts sur le thème : {{ $json['Thème'] }}\nNombre de scènes attendues : {{ $json['Nombre scène'] }}",
    "hasOutputParser": true,
    "options": {
      "systemMessage": "=system_prompt: |\n  ## SYSTEM PROMPT : Générateur de Prompts d'Images pour Histoires Enfantines\n\n  🅰️ A – Demande :\n    À partir du thème d'histoire et du nombre de scènes fournis dans le message\n    utilisateur, générer un prompt d'image détaillé pour CHAQUE scène.\n    Génère EXACTEMENT autant de prompts que le NOMBRE DE SCÈNES demandé\n    (N = nombre de scènes indiqué dans l'user message). Ni plus, ni moins.\n\n  🇬 G – Orientation :\n    role: Directeur artistique et conteur spécialisé dans l'illustration jeunesse\n    tone: imaginatif, chaleureux, féérique\n    output_count: N (= nombre de scènes fourni dans le message utilisateur)\n    character_limit: MINIMUM 250 caractères par prompt d'image (pas de maximum strict, mais rester riche et précis)\n    constraints:\n      - Chaque prompt doit décrire UNE scène qui fait avancer l'histoire de façon logique (scène 1 = début, dernière scène = fin).\n      - Style visuel OBLIGATOIRE à rappeler dans chaque prompt : illustration enfantine, douce et colorée, rendu HD, 4K, très haute qualité, détails nets.\n      - Maintenir la COHÉRENCE d'une scène à l'autre : mêmes personnages (apparence, couleurs, vêtements), même univers, même palette.\n      - Décrire concrètement : personnages, action, décor, lumière, ambiance, couleurs, angle de vue.\n      - Interdit : contenu effrayant, violent ou inadapté aux enfants ; texte ou lettres dans l'image ; prompts vagues ou génériques.\n\n  🇪 E – Exemples :\n    good_examples:   # 🟢\n      - \"Un petit renard roux au pelage doux joue dans une clairière ensoleillée au printemps, entouré de fleurs multicolores et de papillons bleus. Illustration enfantine chaleureuse, style storybook, couleurs pastel vives, lumière douce du matin, rendu HD 4K, ultra détaillé, très haute qualité.\"\n      - \"Le même petit renard roux, curieux, découvre une cabane en bois éclairée par des lucioles au crépuscule, dans une forêt tendre et magique. Ambiance féérique et rassurante, illustration jeunesse, palette chaude orangée, détails nets, rendu HD 4K, qualité premium.\"\n    bad_examples:    # 🔴\n      - \"Un renard dans une forêt.\" (trop court, vague, aucun style ni détail)\n      - \"Fox running, dark scary forest, blood, horror style.\" (effrayant, inadapté aux enfants, mauvaise langue, pas de style enfantin HD)\n\n  🇳 N – Format :\n    format: JSON\n    rules:\n      - Réponds UNIQUEMENT avec du JSON valide et parsable.\n      - N'ajoute AUCUN texte, préambule, commentaire ou balise ``` autour du JSON.\n      - Le tableau \"scenes\" doit contenir EXACTEMENT N éléments (N = nombre de scènes demandé).\n      - Chaque valeur \"prompt\" fait au minimum 250 caractères.\n    example_output: |\n      {\n        \"scenes\": [\n          { \"scene\": 1, \"prompt\": \"...\" },\n          { \"scene\": 2, \"prompt\": \"...\" }\n        ]\n      }\n\n  🇹 T – Outils :\n    Tu as accès aux outils suivants :\n      - Think Tool : à utiliser SYSTÉMATIQUEMENT avant de répondre, pour planifier l'arc narratif, définir l'apparence fixe des personnages et vérifier la cohérence entre les N scènes."
    }
  },
  "type": "@n8n/n8n-nodes-langchain.agent",
  "typeVersion": 3.1,
  "position": [0, 0],
  "name": "AI Agent"
}
```

## Node 2 — OpenRouter Chat Model

`typeVersion: 1`. Credential « COMPTE FORMATION V2 » (openRouterApi). Modèle par défaut : `google/gemini-3.1-flash-lite` ; alternative connue : `openai/gpt-5.4-nano` (utilisé dans 2-4/2-5).

```json
{
  "parameters": {
    "model": "google/gemini-3.1-flash-lite",
    "options": {}
  },
  "type": "@n8n/n8n-nodes-langchain.lmChatOpenRouter",
  "typeVersion": 1,
  "position": [0, 0],
  "name": "OpenRouter Chat Model",
  "credentials": {
    "openRouterApi": {
      "name": "COMPTE FORMATION V2"
    }
  }
}
```

## Node 3 — Think Tool

`typeVersion: 1.1`. Parameters vides — toujours branché en `ai_tool`, et le system prompt impose son usage systématique.

```json
{
  "parameters": {},
  "type": "@n8n/n8n-nodes-langchain.toolThink",
  "typeVersion": 1.1,
  "position": [0, 0],
  "name": "Think"
}
```

## Node 4 — Structured Output Parser

`typeVersion: 1.3`. Le `jsonSchemaExample` est le schéma JSON seul (sans clé englobante, sans commentaire), identique en forme à l'`example_output` du system prompt. Option possible : `autoFix: true` (le modèle doit alors aussi être connecté au parser en `ai_languageModel`).

```json
{
  "parameters": {
    "jsonSchemaExample": "{\n  \"scenes\": [\n    { \"scene\": 1, \"prompt\": \"...\" },\n    { \"scene\": 2, \"prompt\": \"...\" }\n  ]\n}"
  },
  "type": "@n8n/n8n-nodes-langchain.outputParserStructured",
  "typeVersion": 1.3,
  "position": [0, 0],
  "name": "Structured Output Parser"
}
```

## Bloc connections exact

Les trois nodes satellites pointent VERS l'agent avec leur type de connexion spécial (et non `main`). Le flux `main` classique entre (Set « Data » → AI Agent → Split Out) reste séparé.

```json
{
  "OpenRouter Chat Model": {
    "ai_languageModel": [
      [
        {
          "node": "AI Agent",
          "type": "ai_languageModel",
          "index": 0
        }
      ]
    ]
  },
  "Think": {
    "ai_tool": [
      [
        {
          "node": "AI Agent",
          "type": "ai_tool",
          "index": 0
        }
      ]
    ]
  },
  "Structured Output Parser": {
    "ai_outputParser": [
      [
        {
          "node": "AI Agent",
          "type": "ai_outputParser",
          "index": 0
        }
      ]
    ]
  }
}
```
