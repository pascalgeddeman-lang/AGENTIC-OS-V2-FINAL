# Nodes utilitaires & structure de workflow — snippets JSON canoniques

Snippets extraits des workflows de référence (`n8n/Workflows n8n/2-6`, `2-8`, `2-10`, `2-11`). JSON exact des exports n8n ; `position` normalisée à `[0,0]`, IDs de credentials supprimés (référencer uniquement par `name`), IDs Google remplacés par `<SHEET_ID>` / `<FOLDER_ID>`.

## Table des matières

1. [Aggregate (N items → 1 liste d'URLs)](#1-aggregate)
2. [Merge combineByPosition (2 branches parallèles)](#2-merge-combinebyposition)
3. [Split Out (1 item par scène)](#3-split-out)
4. [Téléchargement binaire + Upload Google Drive](#4-téléchargement-binaire--upload-google-drive)
5. [Google Sheets : lecture filtrée (filtersUI lookup status)](#5-google-sheets--lecture-filtrée)
6. [Google Sheets : appendOrUpdate (machine à états)](#6-google-sheets--appendorupdate)
7. [Structure "connections" (linéaire + branches parallèles)](#7-structure-connections)
8. [Bloc "settings" du workflow](#8-bloc-settings)

---

## 1. Aggregate

**Usage** : passer de N items → 1 item contenant la liste des valeurs d'un champ (avant un merge-videos / merge-audios FAL). Le champ agrégé peut être un chemin (`video.url`, `audio.url`) ; le résultat aval est alors dans `$json.url`.

```json
{
  "parameters": {
    "fieldsToAggregate": {
      "fieldToAggregate": [
        {
          "fieldToAggregate": "video.url"
        }
      ]
    },
    "options": {}
  },
  "type": "n8n-nodes-base.aggregate",
  "typeVersion": 1,
  "position": [0, 0],
  "name": "Aggregate"
}
```

Autres champs vus dans les références : `"lien_video"` (2-8), `"audio.url"` (2-11).

## 2. Merge combineByPosition

**Usage** : synchroniser 2 branches parallèles lancées depuis la même source (ex. vidéo Kie + TTS FAL par scène), réunies item par item pour alimenter merge-audio-video. Branche vidéo → entrée `index: 0`, branche audio → entrée `index: 1` (voir §7).

```json
{
  "parameters": {
    "mode": "combine",
    "combineBy": "combineByPosition",
    "options": {}
  },
  "type": "n8n-nodes-base.merge",
  "typeVersion": 3.2,
  "position": [0, 0],
  "name": "Merge"
}
```

## 3. Split Out

**Usage** : juste après l'AI Agent, transforme la sortie structurée en 1 item par scène. Le champ est `output.scenes` (ou `output.songs` pour la musique).

```json
{
  "parameters": {
    "fieldToSplitOut": "output.scenes",
    "options": {}
  },
  "type": "n8n-nodes-base.splitOut",
  "typeVersion": 1,
  "position": [0, 0],
  "name": "Split Out"
}
```

## 4. Téléchargement binaire + Upload Google Drive

**Usage** : un simple HTTP Request GET avec l'URL du média en expression suffit à récupérer le binaire ; il s'enchaîne directement sur Upload file (Drive). Le lien direct réutilisable par les APIs est `https://drive.google.com/uc?export=download&id={{ $json.id }}`.

### 4.1 HTTP Request de téléchargement (aucune credential)

```json
{
  "parameters": {
    "url": "={{ JSON.parse($json.data.resultJson).resultUrls[0] }}",
    "options": {}
  },
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.4,
  "position": [0, 0],
  "name": "Téléchargement"
}
```

(Pour un résultat FAL, l'URL est `={{ $json.video.url }}`.)

### 4.2 Upload file (Google Drive)

```json
{
  "parameters": {
    "name": "=2-6 Image-{{ $('Get row(s) in sheet').item.json.id }}",
    "driveId": {
      "__rl": true,
      "mode": "list",
      "value": "My Drive"
    },
    "folderId": {
      "__rl": true,
      "value": "<FOLDER_ID>",
      "mode": "list",
      "cachedResultName": "Formation v2",
      "cachedResultUrl": "https://drive.google.com/drive/folders/<FOLDER_ID>"
    },
    "options": {}
  },
  "type": "n8n-nodes-base.googleDrive",
  "typeVersion": 3,
  "position": [0, 0],
  "name": "Upload file",
  "credentials": {
    "googleDriveOAuth2Api": {
      "name": "Google Drive account"
    }
  }
}
```

## 5. Google Sheets : lecture filtrée

**Usage** : chaque workflow de la machine à états lit les lignes à son statut (`PROMPT` → `IMAGE` → `VIDEO`). Peut porter `"executeOnce": true` quand il ne doit tourner qu'une fois malgré N items entrants (cas 2-10).

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

Variante 2-10 : `"options": { "returnFirstMatch": false }` et `"executeOnce": true` au niveau du node.

## 6. Google Sheets : appendOrUpdate

**Usage** : écrire/mettre à jour l'état d'une ligne, `matchingColumns: ["id"]`. Création d'id à l'insertion initiale : `"id": "==ROW()-1"`. Recorrélation après une chaîne de nodes : `{{ $('Get row(s) in sheet').item.json.id }}`. Le `schema` reflète les colonnes du sheet (`removed: true` = colonne non écrite par ce node).

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
        "id": "={{ $('Get row(s) in sheet').item.json.id }}",
        "status": "IMAGE",
        "lien_images": "=https://drive.google.com/uc?export=download&id={{ $json.id }}"
      },
      "matchingColumns": [
        "id"
      ],
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
          "canBeUsedToMatch": true,
          "removed": true
        },
        {
          "id": "status",
          "displayName": "status",
          "required": false,
          "defaultMatch": false,
          "display": true,
          "type": "string",
          "canBeUsedToMatch": true
        },
        {
          "id": "lien_images",
          "displayName": "lien_images",
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

Variante insertion initiale (2-10, après Split Out) — champ `value` :

```json
{
  "id": "==ROW()-1",
  "prompt_image": "={{ $json.prompt }}",
  "status": "PROMPT",
  "voix_off": "={{ $json.voice_over }}"
}
```

## 7. Structure "connections"

La clé est le **nom** du node source ; `main` est un tableau de sorties, chaque sortie étant un tableau de cibles `{ node, type, index }`.

### 7.1 Enchaînement linéaire (extrait de 2-6)

```json
{
  "START": {
    "main": [
      [
        {
          "node": "Get row(s) in sheet",
          "type": "main",
          "index": 0
        }
      ]
    ]
  },
  "Get row(s) in sheet": {
    "main": [
      [
        {
          "node": "IMAGE NANO BANANA 2 LITE",
          "type": "main",
          "index": 0
        }
      ]
    ]
  },
  "IMAGE NANO BANANA 2 LITE": {
    "main": [
      [
        {
          "node": "3min",
          "type": "main",
          "index": 0
        }
      ]
    ]
  },
  "3min": {
    "main": [
      [
        {
          "node": "GET IMAGE",
          "type": "main",
          "index": 0
        }
      ]
    ]
  }
}
```

### 7.2 Branches parallèles + réunion par Merge (extrait de 2-10)

Un node avec 2 cibles dans la MÊME sortie = fan-out parallèle (ici : image Kie ET TTS lancées par scène). Les deux branches se réunissent sur le node Merge : la vidéo entre en `index: 0`, l'audio en `index: 1`.

```json
{
  "Get row(s) in sheet": {
    "main": [
      [
        {
          "node": "HTTP Request",
          "type": "main",
          "index": 0
        },
        {
          "node": "HTTP Request4",
          "type": "main",
          "index": 0
        }
      ]
    ]
  },
  "HTTP Request2": {
    "main": [
      [
        {
          "node": "Merge",
          "type": "main",
          "index": 0
        }
      ]
    ]
  },
  "HTTP Request5": {
    "main": [
      [
        {
          "node": "Merge",
          "type": "main",
          "index": 1
        }
      ]
    ]
  },
  "Merge": {
    "main": [
      [
        {
          "node": "HTTP Request6",
          "type": "main",
          "index": 0
        }
      ]
    ]
  }
}
```

### 7.3 Connexions AI (quatuor agent — types non-main, extrait de 2-10)

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

## 8. Bloc "settings"

Systématique dans tous les workflows de référence (`availableInMCP: false` apparaît en plus dans 2-10 et 2-11).

```json
{
  "executionOrder": "v1",
  "binaryMode": "separate"
}
```
