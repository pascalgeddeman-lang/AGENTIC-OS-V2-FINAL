# Chaînes API asynchrones (polling) — snippets JSON canoniques

Snippets extraits des workflows de référence (`n8n/Workflows n8n/2-6`, `2-8`, `2-10`, `2-11`, `3-9`). JSON exact des exports n8n ; `position` normalisée à `[0,0]`, IDs de credentials supprimés (référencer uniquement par `name`), IDs Google remplacés par `<SHEET_ID>` / `<FOLDER_ID>`, `webhookId` des nodes Wait remplacé par `<UUID>` (n8n en régénère un à l'import).

## Table des matières

1. [Chaîne Kie.ai (createTask → Wait → recordInfo → Filter)](#1-chaîne-kieai)
   - 1.1 POST createTask (t2i simple)
   - 1.2 POST createTask (i2i avec image de référence)
   - 1.3 Wait
   - 1.4 GET recordInfo
   - 1.5 Filter anti-échec
2. [Chaîne Suno (generate → Wait → record-info → Code flatten/chunk)](#2-chaîne-suno-musique)
3. [Chaîne FAL (POST queue.fal.run → Wait → GET response_url)](#3-chaîne-falai)
   - 3.1 images-to-video
   - 3.2 merge-videos
   - 3.3 merge-audio-video
   - 3.4 merge-audios
   - 3.5 metadata (durée d'un média)
   - 3.6 inworld-tts (TTS français)
   - 3.7 Wait FAL
   - 3.8 GET response_url (même credential que le POST)

---

## 1. Chaîne Kie.ai

**Quand l'utiliser** : toute génération média via api.kie.ai (image, vidéo). Jamais de callback réel — `callBackUrl` est un placeholder ; la récupération se fait par Wait fixe + GET. **Durées de Wait** : image ≈ 2-3 min, vidéo ≈ 10 min. L'URL du résultat s'extrait avec `{{ JSON.parse($json.data.resultJson).resultUrls[0] }}`. Toujours faire suivre le GET d'un **Filter anti-échec** (1.5) pour écarter les générations échouées.

### 1.1 POST createTask (texte → image, nano-banana)

```json
{
  "parameters": {
    "method": "POST",
    "url": "https://api.kie.ai/api/v1/jobs/createTask",
    "authentication": "genericCredentialType",
    "genericAuthType": "httpHeaderAuth",
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={\n  \"model\": \"nano-banana-2-lite\",\n  \"input\": {\n    \"prompt\": {{ JSON.stringify($json.prompt_image) }},\n    \"aspect_ratio\": \"16:9\"\n  }\n}",
    "options": {}
  },
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.4,
  "position": [0, 0],
  "name": "IMAGE NANO BANANA 2 LITE",
  "credentials": {
    "httpHeaderAuth": {
      "name": "Kie FORMATION V2"
    }
  }
}
```

### 1.2 POST createTask (image → image avec personnage de référence, gpt-image-2)

Variante avec `callBackUrl` placeholder, `input_urls` (image de référence tirée du node « Data ») et `resolution`.

```json
{
  "parameters": {
    "method": "POST",
    "url": "https://api.kie.ai/api/v1/jobs/createTask",
    "authentication": "genericCredentialType",
    "genericAuthType": "httpHeaderAuth",
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={\n  \"model\": \"gpt-image-2-image-to-image\",\n  \"callBackUrl\": \"https://your-domain.com/api/callback\",\n  \"input\": {\n    \"prompt\": {{ JSON.stringify($json.prompt_image) }},\n    \"input_urls\": [\n      \"{{ $('Data').item.json['personnage principal'] }}\"\n    ],\n    \"aspect_ratio\": \"16:9\",\n    \"resolution\": \"4K\"\n  }\n}",
    "options": {
      "redirect": {
        "redirect": {}
      }
    }
  },
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.4,
  "position": [0, 0],
  "name": "HTTP Request",
  "credentials": {
    "httpHeaderAuth": {
      "name": "Kie FORMATION V2"
    }
  }
}
```

### 1.3 Wait (3 min pour une image ; mettre 10 min pour une vidéo)

```json
{
  "parameters": {
    "amount": 3,
    "unit": "minutes"
  },
  "type": "n8n-nodes-base.wait",
  "typeVersion": 1.1,
  "position": [0, 0],
  "name": "3min",
  "webhookId": "<UUID>"
}
```

### 1.4 GET recordInfo

```json
{
  "parameters": {
    "url": "https://api.kie.ai/api/v1/jobs/recordInfo",
    "authentication": "genericCredentialType",
    "genericAuthType": "httpHeaderAuth",
    "sendQuery": true,
    "queryParameters": {
      "parameters": [
        {
          "name": "taskId",
          "value": "={{ $json.data.taskId }}"
        }
      ]
    },
    "options": {
      "redirect": {
        "redirect": {}
      }
    }
  },
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.4,
  "position": [0, 0],
  "name": "GET IMAGE",
  "credentials": {
    "httpHeaderAuth": {
      "name": "Kie FORMATION V2"
    }
  }
}
```

URL du résultat en aval : `={{ JSON.parse($json.data.resultJson).resultUrls[0] }}`.

### 1.5 Filter anti-échec (après CHAQUE GET recordInfo)

Écarte les items dont la génération a échoué (`resultJson` vide) pour ne pas casser la suite du pipeline. Extrait de « 3-9 Histoire Chats IA ».

```json
{
  "parameters": {
    "conditions": {
      "options": {
        "caseSensitive": true,
        "leftValue": "",
        "typeValidation": "strict",
        "version": 3
      },
      "conditions": [
        {
          "id": "a233baf7-4515-4d42-bcbb-9365c8c08f1e",
          "leftValue": "={{ $json.data.resultJson }}",
          "rightValue": "",
          "operator": {
            "type": "string",
            "operation": "notEmpty",
            "singleValue": true
          }
        }
      ],
      "combinator": "and"
    },
    "options": {}
  },
  "type": "n8n-nodes-base.filter",
  "typeVersion": 2.3,
  "position": [0, 0],
  "name": "Filter"
}
```

---

## 2. Chaîne Suno (musique)

**Quand l'utiliser** : génération musicale via Kie/Suno. Endpoint différent du reste de Kie : `POST /api/v1/generate` en `bodyParameters` (pas jsonBody), modèle `V5_5`. **Wait ≈ 8 min.** Chaque génération produit **2 titres** (`title1`/`title2`), les audios sont dans `data.response.sunoData[].audioUrl` → Code node de flatten + chunking par 5 (limite merge-audios). Note le batching anti rate-limit sur le POST (`batchSize` 5, `batchInterval` 15000).

### 2.1 POST /api/v1/generate

```json
{
  "parameters": {
    "method": "POST",
    "url": "https://api.kie.ai/api/v1/generate",
    "authentication": "genericCredentialType",
    "genericAuthType": "httpHeaderAuth",
    "sendBody": true,
    "bodyParameters": {
      "parameters": [
        {
          "name": "prompt",
          "value": "={{ $json.prompt }}"
        },
        {
          "name": "customMode",
          "value": "true"
        },
        {
          "name": "instrumental",
          "value": "={{ $('On form submission').first().json['Instrumental ?'] }}"
        },
        {
          "name": "model",
          "value": "V5_5"
        },
        {
          "name": "callBackUrl",
          "value": "https://api.example.com/callback"
        },
        {
          "name": "style",
          "value": "={{ $json.style }}"
        },
        {
          "name": "title",
          "value": "={{ $json.title1 }}"
        },
        {
          "name": "styleWeight",
          "value": "0.65"
        },
        {
          "name": "weirdnessConstraint",
          "value": "0.65"
        },
        {
          "name": "audioWeight",
          "value": "0.65"
        }
      ]
    },
    "options": {
      "batching": {
        "batch": {
          "batchSize": 5,
          "batchInterval": 15000
        }
      }
    }
  },
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.3,
  "position": [0, 0],
  "name": "HTTP Request26",
  "credentials": {
    "httpHeaderAuth": {
      "name": "Kie FORMATION V2"
    }
  }
}
```

### 2.2 Wait (8 min)

```json
{
  "parameters": {
    "amount": 8,
    "unit": "minutes"
  },
  "type": "n8n-nodes-base.wait",
  "typeVersion": 1.1,
  "position": [0, 0],
  "name": "Wait",
  "webhookId": "<UUID>"
}
```

### 2.3 GET /api/v1/generate/record-info

```json
{
  "parameters": {
    "url": "https://api.kie.ai/api/v1/generate/record-info",
    "authentication": "genericCredentialType",
    "genericAuthType": "httpHeaderAuth",
    "sendQuery": true,
    "queryParameters": {
      "parameters": [
        {
          "name": "taskId",
          "value": "={{ $json.data.taskId }}"
        }
      ]
    },
    "options": {}
  },
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.3,
  "position": [0, 0],
  "name": "HTTP Request",
  "credentials": {
    "httpHeaderAuth": {
      "name": "Kie FORMATION V2"
    }
  }
}
```

### 2.4 Code node : flatten sunoData + chunking par 5 (pour merge-audios)

```json
{
  "parameters": {
    "jsCode": "const items = $input.all();\n\n// Récupère tous les objets JSON entrants\nconst input = items.flatMap(item => {\n  if (Array.isArray(item.json)) return item.json;\n  return item.json;\n});\n\n// Récupère tous les audioUrl\nconst audioUrls = [];\n\nfor (const entry of input) {\n  const sunoData = entry?.data?.response?.sunoData || [];\n\n  for (const audio of sunoData) {\n    if (audio.audioUrl) {\n      audioUrls.push(audio.audioUrl);\n    }\n  }\n}\n\n// Découpe en groupes de 5\nconst chunks = [];\n\nfor (let i = 0; i < audioUrls.length; i += 5) {\n  chunks.push(audioUrls.slice(i, i + 5));\n}\n\n// Retourne 1 item n8n par liste de 5 liens\nreturn chunks.map((chunk, index) => ({\n  json: {\n    listNumber: index + 1,\n    audioUrls: chunk\n  }\n}));"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [0, 0],
  "name": "Code in JavaScript"
}
```

---

## 3. Chaîne FAL.ai

**Quand l'utiliser** : assemblage FFmpeg (images→vidéo, merge vidéos/audios, mux audio+vidéo, métadonnées) et TTS. Pattern : `POST https://queue.fal.run/<endpoint>` → **Wait 60 s à 2 min** (90 s pour merge-audio-video) → `GET {{ $json.response_url }}` **avec la même credential FAL** (obligatoire, sinon 401). Résultat dans `$json.video.url`, `$json.audio.url` ou `$json.media.*`.

### 3.1 POST images-to-video

```json
{
  "parameters": {
    "method": "POST",
    "url": "https://queue.fal.run/fal-ai/ffmpeg-api/images-to-video",
    "authentication": "genericCredentialType",
    "genericAuthType": "httpHeaderAuth",
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={\n  \"images\": [\n    {\n      \"url\": \"{{ $json.lien_images }}\",\n      \"frames\": 120\n    }\n  ],\n  \"fps\": 24\n}",
    "options": {}
  },
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.4,
  "position": [0, 0],
  "name": "HTTP Request",
  "credentials": {
    "httpHeaderAuth": {
      "name": "FAL FORMATION V2"
    }
  }
}
```

Variante body entièrement construit par un Code node amont : `"jsonBody": "={{ JSON.stringify({ images: $json.images, fps: $json.fps }, null, 2) }}"`.

### 3.2 POST merge-videos (après un Aggregate)

```json
{
  "parameters": {
    "method": "POST",
    "url": "https://queue.fal.run/fal-ai/ffmpeg-api/merge-videos",
    "authentication": "genericCredentialType",
    "genericAuthType": "httpHeaderAuth",
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={\n  \"video_urls\": {{ JSON.stringify($json.url) }}\n}",
    "options": {}
  },
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.4,
  "position": [0, 0],
  "name": "HTTP Request9",
  "credentials": {
    "httpHeaderAuth": {
      "name": "FAL FORMATION V2"
    }
  }
}
```

(Le champ injecté — `$json.url`, `$json.lien_video`… — dépend du champ agrégé par l'Aggregate amont.)

### 3.3 POST merge-audio-video (après un Merge combineByPosition)

```json
{
  "parameters": {
    "method": "POST",
    "url": "https://queue.fal.run/fal-ai/ffmpeg-api/merge-audio-video",
    "authentication": "genericCredentialType",
    "genericAuthType": "httpHeaderAuth",
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={\n  \"video_url\": \"{{ $json.video.url }}\",\n  \"audio_url\": \"{{ $json.audio.url }}\"\n}",
    "options": {}
  },
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.4,
  "position": [0, 0],
  "name": "HTTP Request6",
  "credentials": {
    "httpHeaderAuth": {
      "name": "FAL FORMATION V2"
    }
  }
}
```

Variante avec référence croisée vers un autre node : `"audio_url": "{{ $('HTTP Request6').item.json.media.url }}"`.

### 3.4 POST merge-audios (max ~5 URLs par appel → chunker en amont)

```json
{
  "parameters": {
    "method": "POST",
    "url": "https://queue.fal.run/fal-ai/ffmpeg-api/merge-audios",
    "authentication": "genericCredentialType",
    "genericAuthType": "httpHeaderAuth",
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={\n  \"audio_urls\": {{ JSON.stringify($json.audioUrls) }}\n}",
    "options": {}
  },
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.4,
  "position": [0, 0],
  "name": "HTTP Request1",
  "credentials": {
    "httpHeaderAuth": {
      "name": "FAL FORMATION V2"
    }
  }
}
```

### 3.5 POST metadata (obtenir la durée d'un média → `$json.media.duration`)

```json
{
  "parameters": {
    "method": "POST",
    "url": "https://queue.fal.run/fal-ai/ffmpeg-api/metadata",
    "authentication": "genericCredentialType",
    "genericAuthType": "httpHeaderAuth",
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={\n  \"media_url\": \"{{ $json.audio.url }}\",\n  \"extract_frames\": false\n}",
    "options": {}
  },
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.4,
  "position": [0, 0],
  "name": "HTTP Request5",
  "credentials": {
    "httpHeaderAuth": {
      "name": "FAL FORMATION V2"
    }
  }
}
```

### 3.6 POST inworld-tts (TTS français — résultat dans `$json.audio.url`)

```json
{
  "parameters": {
    "method": "POST",
    "url": "https://queue.fal.run/fal-ai/inworld-tts",
    "authentication": "genericCredentialType",
    "genericAuthType": "httpHeaderAuth",
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={\n  \"text\": {{ JSON.stringify($json.voix_off) }},\n  \"voice\": \"Hélène (fr)\",\n  \"sample_rate_hertz\": 48000\n}",
    "options": {}
  },
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.4,
  "position": [0, 0],
  "name": "HTTP Request4",
  "credentials": {
    "httpHeaderAuth": {
      "name": "FAL FORMATION V2"
    }
  }
}
```

### 3.7 Wait FAL (60 s par défaut ; sans `unit` = secondes. 90 s pour merge-audio-video, 2 min pour merge-videos/merge-audios)

```json
{
  "parameters": {
    "amount": 60
  },
  "type": "n8n-nodes-base.wait",
  "typeVersion": 1.1,
  "position": [0, 0],
  "name": "Wait",
  "webhookId": "<UUID>"
}
```

### 3.8 GET response_url (TOUJOURS avec la credential FAL)

```json
{
  "parameters": {
    "url": "={{ $json.response_url }}",
    "authentication": "genericCredentialType",
    "genericAuthType": "httpHeaderAuth",
    "options": {}
  },
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.4,
  "position": [0, 0],
  "name": "HTTP Request1",
  "credentials": {
    "httpHeaderAuth": {
      "name": "FAL FORMATION V2"
    }
  }
}
```
