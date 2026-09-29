# Triggers & intégrations — snippets JSON canoniques (n8n)

Extraits exacts des workflows « 2-4 Agent IA », « 2-5 Google Sheet », « 2-6 Créer des Images », « 3-1 Le Scraping », « 3-2 Bot Telegram ». Positions normalisées `[0,0]`, IDs de credentials supprimés (référencer par nom), IDs Google remplacés par `<SHEET_ID>` / `<DOC_ID>` / `<FOLDER_ID>`. Les `webhookId` (formTrigger, telegramTrigger, wait, telegram) sont omis : n8n les régénère à l'import.

## Table des matières

1. [Triggers : manualTrigger / formTrigger / telegramTrigger](#1-triggers)
2. [Set « Data » (paramètres d'entrée)](#2-set--data-)
3. [Switch (routage)](#3-switch-routage)
4. [Google Sheets : appendOrUpdate + lecture filtrée](#4-google-sheets)
5. [Google Docs : create + update](#5-google-docs)
6. [OpenRouter direct : transcription Whisper](#6-openrouter-direct--transcription-whisper)
7. [Telegram : telegramTool avec $fromAI + Get a file](#7-telegram--telegramtool-en-ai_tool)
8. [Sticky Note](#8-sticky-note)

## 1. Triggers

### manualTrigger « START » (2-4)

```json
{
  "parameters": {},
  "type": "n8n-nodes-base.manualTrigger",
  "typeVersion": 1,
  "position": [0, 0],
  "name": "START"
}
```

### formTrigger avec formFields (3-1) — `typeVersion: 2.6`

Champ radio pour le routage Switch + champs texte libres (un champ sans `fieldType` = texte simple).

```json
{
  "parameters": {
    "formTitle": "Scraping",
    "formFields": {
      "values": [
        {
          "fieldLabel": "Chaine ou Video",
          "fieldType": "radio",
          "fieldOptions": {
            "values": [
              { "option": "Chaine" },
              { "option": "Video" }
            ]
          }
        },
        { "fieldLabel": "URL" },
        { "fieldLabel": "Nom du dossier ou du fichier" }
      ]
    },
    "options": {}
  },
  "type": "n8n-nodes-base.formTrigger",
  "typeVersion": 2.6,
  "position": [0, 0],
  "name": "On form submission"
}
```

### telegramTrigger (3-2) — `typeVersion: 1.3`

```json
{
  "parameters": {
    "updates": ["message"],
    "additionalFields": {}
  },
  "type": "n8n-nodes-base.telegramTrigger",
  "typeVersion": 1.3,
  "position": [0, 0],
  "name": "Telegram Trigger",
  "credentials": {
    "telegramApi": {
      "name": "V2 bot"
    }
  }
}
```

## 2. Set « Data »

`n8n-nodes-base.set` `typeVersion: 3.4`. Paramètres d'entrée du workflow, référencés ensuite dans le prompt agent via `{{ $json['Thème'] }}`. Les `id` d'assignments sont des UUID arbitraires (n'importe quel UUID valide convient).

```json
{
  "parameters": {
    "assignments": {
      "assignments": [
        {
          "id": "523d73e2-55a9-4c12-a4b6-69e09cce3006",
          "name": "Thème",
          "value": "Vidéo de chats mignons",
          "type": "string"
        },
        {
          "id": "8822953d-05d9-4b7b-a6a6-68a7c9d7fba3",
          "name": "Nombre scène",
          "value": "12",
          "type": "string"
        }
      ]
    },
    "options": {}
  },
  "type": "n8n-nodes-base.set",
  "typeVersion": 3.4,
  "position": [0, 0],
  "name": "Data"
}
```

## 3. Switch (routage)

`n8n-nodes-base.switch` `typeVersion: 3.4`. Options des conditions toujours : `caseSensitive: true`, `typeValidation: "strict"`, `version: 3`. Chaque règle a `renameOutput: true` + `outputKey`.

### Variante A — type de formulaire (3-1) : opérateur string `equals`

```json
{
  "parameters": {
    "rules": {
      "values": [
        {
          "conditions": {
            "options": {
              "caseSensitive": true,
              "leftValue": "",
              "typeValidation": "strict",
              "version": 3
            },
            "conditions": [
              {
                "leftValue": "={{ $json['Chaine ou Video'] }}",
                "rightValue": "Chaine",
                "operator": {
                  "type": "string",
                  "operation": "equals"
                },
                "id": "c3207e92-4696-4b68-aa69-a93bfa684a94"
              }
            ],
            "combinator": "and"
          },
          "renameOutput": true,
          "outputKey": "Chaine"
        },
        {
          "conditions": {
            "options": {
              "caseSensitive": true,
              "leftValue": "",
              "typeValidation": "strict",
              "version": 3
            },
            "conditions": [
              {
                "id": "e799b125-0bc6-4dc9-b77b-a8350bf18504",
                "leftValue": "={{ $json['Chaine ou Video'] }}",
                "rightValue": "Video",
                "operator": {
                  "type": "string",
                  "operation": "equals"
                }
              }
            ],
            "combinator": "and"
          },
          "renameOutput": true,
          "outputKey": "Video"
        }
      ]
    },
    "options": {}
  },
  "type": "n8n-nodes-base.switch",
  "typeVersion": 3.4,
  "position": [0, 0],
  "name": "Switch"
}
```

### Variante B — texte vs vocal Telegram (3-2) : opérateur `exists` (string puis object)

```json
{
  "parameters": {
    "rules": {
      "values": [
        {
          "conditions": {
            "options": {
              "caseSensitive": true,
              "leftValue": "",
              "typeValidation": "strict",
              "version": 3
            },
            "conditions": [
              {
                "leftValue": "={{ $json.message.text }}",
                "rightValue": "",
                "operator": {
                  "type": "string",
                  "operation": "exists",
                  "singleValue": true
                },
                "id": "483510f8-d616-4095-a011-85cae8314c74"
              }
            ],
            "combinator": "and"
          },
          "renameOutput": true,
          "outputKey": "Texte"
        },
        {
          "conditions": {
            "options": {
              "caseSensitive": true,
              "leftValue": "",
              "typeValidation": "strict",
              "version": 3
            },
            "conditions": [
              {
                "id": "6e714169-6aa5-4818-8015-60e378cc67c8",
                "leftValue": "={{ $json.message.voice }}",
                "rightValue": "",
                "operator": {
                  "type": "object",
                  "operation": "exists",
                  "singleValue": true
                }
              }
            ],
            "combinator": "and"
          },
          "renameOutput": true,
          "outputKey": "Vocal"
        }
      ]
    },
    "options": {}
  },
  "type": "n8n-nodes-base.switch",
  "typeVersion": 3.4,
  "position": [0, 0],
  "name": "Switch"
}
```

## 4. Google Sheets

`n8n-nodes-base.googleSheets` `typeVersion: 4.7`, credential « Google Sheets account » (googleSheetsOAuth2Api).

### appendOrUpdate avec matchingColumns ["id"] et création d'id `==ROW()-1` (2-5)

Attention au double `=` de `"id": "==ROW()-1"` : le premier `=` marque l'expression n8n, le second fait écrire la formule `=ROW()-1` dans la cellule.

```json
{
  "parameters": {
    "operation": "appendOrUpdate",
    "documentId": {
      "__rl": true,
      "value": "<SHEET_ID>",
      "mode": "list",
      "cachedResultName": "2-5",
      "cachedResultUrl": "https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit?usp=drivesdk"
    },
    "sheetName": {
      "__rl": true,
      "value": "gid=0",
      "mode": "list",
      "cachedResultName": "Feuille 1",
      "cachedResultUrl": "https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit#gid=0"
    },
    "columns": {
      "mappingMode": "defineBelow",
      "value": {
        "id": "==ROW()-1",
        "prompt_image": "={{ $json.prompt }}",
        "status": "PROMPT"
      },
      "matchingColumns": ["id"],
      "schema": [
        {
          "id": "id",
          "displayName": "id",
          "required": false,
          "defaultMatch": true,
          "display": true,
          "type": "string",
          "canBeUsedToMatch": true,
          "removed": false
        },
        {
          "id": "prompt_image",
          "displayName": "prompt_image",
          "required": false,
          "defaultMatch": false,
          "display": true,
          "type": "string",
          "canBeUsedToMatch": true
        },
        {
          "id": "status",
          "displayName": "status",
          "required": false,
          "defaultMatch": false,
          "display": true,
          "type": "string",
          "canBeUsedToMatch": true
        }
      ],
      "attemptToConvertTypes": false,
      "convertFieldsToString": false
    },
    "options": {}
  },
  "type": "n8n-nodes-base.googleSheets",
  "typeVersion": 4.7,
  "position": [0, 0],
  "name": "Append or update row in sheet",
  "credentials": {
    "googleSheetsOAuth2Api": {
      "name": "Google Sheets account"
    }
  }
}
```

Note : le `schema` s'étend avec une entrée par colonne (même forme). Pour recorréler après une chaîne de nodes : `{{ $('Get row(s) in sheet').item.json.id }}`.

### Lecture filtrée avec filtersUI lookup sur status (extrait de 2-6, pattern machine à états)

Opération par défaut (read rows). Chaque workflow lit les lignes à SON statut, puis écrit le statut suivant (`PROMPT` → `IMAGE` → `VIDEO`).

```json
{
  "parameters": {
    "documentId": {
      "__rl": true,
      "value": "<SHEET_ID>",
      "mode": "list",
      "cachedResultName": "2-5",
      "cachedResultUrl": "https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit?usp=drivesdk"
    },
    "sheetName": {
      "__rl": true,
      "value": "gid=0",
      "mode": "list",
      "cachedResultName": "Feuille 1",
      "cachedResultUrl": "https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit#gid=0"
    },
    "filtersUI": {
      "values": [
        {
          "lookupColumn": "status",
          "lookupValue": "PROMPT"
        }
      ]
    },
    "options": {}
  },
  "type": "n8n-nodes-base.googleSheets",
  "typeVersion": 4.7,
  "position": [0, 0],
  "name": "Get row(s) in sheet",
  "credentials": {
    "googleSheetsOAuth2Api": {
      "name": "Google Sheets account"
    }
  }
}
```

## 5. Google Docs

`n8n-nodes-base.googleDocs` `typeVersion: 2`, credential « Google Docs account » (googleDocsOAuth2Api). Pattern 3-1 : Create puis Update (insert du transcript) — le doc fraîchement créé sort son id dans `$json.id`.

### Create a document

```json
{
  "parameters": {
    "folderId": "<FOLDER_ID>",
    "title": "={{ $json.title }}"
  },
  "type": "n8n-nodes-base.googleDocs",
  "typeVersion": 2,
  "position": [0, 0],
  "name": "Create a document",
  "credentials": {
    "googleDocsOAuth2Api": {
      "name": "Google Docs account"
    }
  }
}
```

### Update a document (insert texte)

```json
{
  "parameters": {
    "operation": "update",
    "documentURL": "={{ $json.id }}",
    "actionsUi": {
      "actionFields": [
        {
          "action": "insert",
          "text": "={{ $('HTTP Request4').item.json.transcript_text }}"
        }
      ]
    }
  },
  "type": "n8n-nodes-base.googleDocs",
  "typeVersion": 2,
  "position": [0, 0],
  "name": "Update a document",
  "credentials": {
    "googleDocsOAuth2Api": {
      "name": "Google Docs account"
    }
  }
}
```

## 6. OpenRouter direct : transcription Whisper

Appel HTTP direct avec `authentication: "predefinedCredentialType"` + `nodeCredentialType: "openRouterApi"` (jamais de clé en dur). L'audio est passé en base64 (préparé par un Code node en amont). NB : l'appel multimodal `POST /api/v1/chat/completions` (analyse vidéo par URL) n'est pas dans 3-2 — il suit exactement la même structure d'authentification, seul le `jsonBody` change (content `[{type:"text"},{type:"video_url"}]`).

### Code node amont : binaire → base64 (3-2)

```json
{
  "parameters": {
    "jsCode": "const item = $input.first();\n\nconst buffer = await this.helpers.getBinaryDataBuffer(0, 'data');\n\nreturn [\n  {\n    json: {\n      audio_base64: buffer.toString('base64'),\n      audio_format: 'ogg'\n    },\n    binary: item.binary\n  }\n];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [0, 0],
  "name": "Code in JavaScript"
}
```

### HTTP Request — whisper-1 (3-2)

```json
{
  "parameters": {
    "method": "POST",
    "url": "https://openrouter.ai/api/v1/audio/transcriptions",
    "authentication": "predefinedCredentialType",
    "nodeCredentialType": "openRouterApi",
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={\n    \"model\": \"openai/whisper-1\",\n    \"input_audio\": {\n      \"data\": \"{{ $json.audio_base64 }}\",\n      \"format\": \"{{ $json.audio_format }}\"\n    }\n  }",
    "options": {}
  },
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.4,
  "position": [0, 0],
  "name": "HTTP Request",
  "credentials": {
    "openRouterApi": {
      "name": "COMPTE FORMATION V2"
    }
  }
}
```

## 7. Telegram : telegramTool en ai_tool

### Get a file (téléchargement du vocal, node telegram classique) — `typeVersion: 1.2`

```json
{
  "parameters": {
    "resource": "file",
    "fileId": "={{ $json.message.voice.file_id }}",
    "additionalFields": {}
  },
  "type": "n8n-nodes-base.telegram",
  "typeVersion": 1.2,
  "position": [0, 0],
  "name": "Get a file",
  "credentials": {
    "telegramApi": {
      "name": "V2 bot"
    }
  }
}
```

### telegramTool — envoi de message piloté par l'agent via $fromAI — `typeVersion: 1.2`

Le `chatId` remonte au trigger (pas de chat_id en dur) ; le texte est rempli par l'agent via `$fromAI`. `appendAttribution: false` pour supprimer la signature n8n.

```json
{
  "parameters": {
    "chatId": "={{ $('Telegram Trigger').item.json.message.from.id }}",
    "text": "={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('Text', ``, 'string') }}",
    "additionalFields": {
      "appendAttribution": false
    }
  },
  "type": "n8n-nodes-base.telegramTool",
  "typeVersion": 1.2,
  "position": [0, 0],
  "name": "Send a text message in Telegram",
  "credentials": {
    "telegramApi": {
      "name": "V2 bot"
    }
  }
}
```

### Connexion : le tool pointe vers l'agent en `ai_tool` (comme le Think)

```json
{
  "Send a text message in Telegram": {
    "ai_tool": [
      [
        {
          "node": "AI Agent",
          "type": "ai_tool",
          "index": 0
        }
      ]
    ]
  }
}
```

## 8. Sticky Note

`n8n-nodes-base.stickyNote` `typeVersion: 1` (extrait de « 2-6 Créer des Images »). Sert à documenter les blocs ; `content` en Markdown, `height`/`width` en pixels.

```json
{
  "parameters": {
    "content": "## Image\n",
    "height": 192,
    "width": 464
  },
  "type": "n8n-nodes-base.stickyNote",
  "typeVersion": 1,
  "position": [0, 0],
  "name": "Sticky Note"
}
```
