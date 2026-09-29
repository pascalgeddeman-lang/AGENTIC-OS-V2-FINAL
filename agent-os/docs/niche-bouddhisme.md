# Niche « Bouddhisme / Sagesse & Méditation » — mesures terrain

Analyse conduite le 24 août 2026 sur **5 vidéos de 3 chaînes** de la banque de niche
Bouddhisme, téléchargées avec yt-dlp puis décortiquées avec FFmpeg (détection de plans,
extraction de frames, mesures audio) et OpenRouter / `qwen/qwen3.7-flash` (direction
artistique). Tous les chiffres ci-dessous sont **mesurés**, pas estimés.

Sources brutes : `scratchpad/niche-bouddhisme/` (vidéos, planches contact, `analyse/mesures.json`,
`analyse/da.json`). Outils : `cuts.py` (détection de plans), `srt.py` (transcripts), `batch.py`, `da.py`.

## Méthode de mesure des plans (et pourquoi elle a dû être corrigée deux fois)

FFmpeg réduit chaque image à une vignette **32×18 RGB** échantillonnée à 2 Hz ; on mesure
`d1(t)`, la différence moyenne entre deux vignettes consécutives.

| Tentative | Résultat | Pourquoi c'était faux |
|---|---|---|
| `scdet` de FFmpeg | ~0 coupe détectée | scores écrasés par les fondus, jamais au-dessus du seuil |
| Vignette **grise**, fenêtre 1 s, seuil 6 | 61 plans, médiane 19,5 s | confond deux plans de même dominante (jardin vert → jardin vert) : un plan « de 77 s » en contenait 8 |
| Vignette **RGB**, `d1`, seuil fixe 30 | 25 plans, médiane 25,5 s | un seuil fixe ne marche pas : une vidéo sombre coupe à `d1≈15`, une vidéo colorée à `d1≈90` |
| Vignette **RGB**, `d1`, seuil **médiane + 10×MAD** | **validé** | 5/5 et 8/8 des coupes comptées à l'œil sur deux fenêtres, zéro faux positif |

Ce que dit le signal : une coupe est un **pic isolé** (d1 de 35 à 95 sur un échantillon —
ce sont des coupes franches, pas des fondus d'une seconde) ; le Ken Burns sur une image
texturée produit un **plancher continu** de 10 à 25. Un seuil sous ~30×MAD prend le
mouvement pour une coupe.

## Les chiffres

| Vidéo | Chaîne | Vues | Durée | Plans | Plan médian | Images/10 min | Mots/min | **Mots/plan** |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| `Q8rP7iqiAJk` | Le Silence du Bouddha | 70 072 | 18,7 min | 65 | 19,5 s | 35 | 120 | 34 |
| `xkncIok6wL8` | Esprit du Moine | 22 395 | 12,5 min | 64 | 12,5 s | 51 | 163 | 32 |
| `q9YZHtdVR7Q` | L'Âme Du Lotus | 21 830 | 19,8 min | 92 | 11,0 s | 46 | 135 | 29 |
| `Au4MEjmq3S8` | Esprit du Moine | 19 143 | 18,1 min | 76 | 14,5 s | 42 | 149 | 35 |
| `itaBcuuDvSU` | L'Âme Du Lotus | 15 796 | 20,0 min | 58 | 25,0 s | 29 | 130 | 44 |

### L'invariant de la niche : ~34 mots par image

Les durées de plan varient du simple au double (11 s à 25 s) et le débit de parole aussi
(120 à 163 mots/min) — mais **le nombre de mots prononcés par image reste dans une bande
étroite : 29 à 44, médiane 34**. C'est la vraie règle de montage de la niche : l'image ne
change pas au bout de N secondes, elle change **tous les ~30-35 mots, c'est-à-dire à chaque
unité de sens**. C'est cette constante qu'il faut encoder dans la machine, pas une durée.

Corollaire : le nombre d'images se déduit du texte, pas de l'horloge.
**images ≈ nombre de mots ÷ 34.**

### Rythme de parole

120 à 163 mots/min, médiane **135**. La vidéo la plus vue est aussi **la plus lente à parler**
(120 mots/min). Attention toutefois : avec n=5, la relation rythme/performance n'est pas
monotone — la vidéo au montage le plus lent (25 s/plan) est la moins vue. Ce qui se tient :
un débit calme (120-135) est compatible avec la meilleure performance de l'échantillon.

### Audio (mesuré sur `Q8rP7iqiAJk`)

- Loudness intégré **-19,7 LUFS**, plage dynamique **LRA 4,6 LU** — mix très nivelé.
- Plancher entre deux phrases (= lit musical seul) : **-53 dB RMS** ; niveau voix : **-24 dB**.
- Écart voix / musique ≈ **29 dB**, soit un lit musical plus discret que les -20/-24 dB
  habituellement recommandés.
- Aucun silence réel : la musique est **continue** du début à la fin.

### Direction artistique — 5/5 vidéos convergent

- **Style** : photoréaliste cinématographique, visiblement généré par IA (type Midjourney).
  Aucune des 5 n'utilise l'illustration, la peinture ou l'encre.
- **Palette** : orange safran (robes) · vert forêt profond · brun terre/bois · or ·
  gris pierre/brume. Identique sur les 3 chaînes.
- **Lumière** : golden hour, contre-jour, rayons volumétriques (god rays), brume.
- **Cadrages** : portrait/plan moyen du moine, plan large de paysage, gros plan sur mains
  et objets rituels.
- **Sous-titres** : blancs, sans-serif, **bas de l'image**, petite à moyenne taille,
  affichés par **fragments de quelques mots** (pas la phrase entière).
- **Filigrane** : logo ou avatar de chaîne en **haut à gauche de chaque image**, 5/5.
  Deux chaînes utilisent un filigrane en caractères chinois (`莲花的灵魂` = « l'âme du lotus »),
  indice que ces chaînes sont des adaptations françaises d'un pipeline sinophone.

### Deux points où la niche contredit le brief

1. **Le CTA animé est l'exception, pas la règle.** Sur les 5 vidéos, une seule montre un
   overlay d'abonnement. Les quatre autres n'ont aucun appel à l'action visuel : seulement
   le filigrane de chaîne permanent.
2. **Les concurrents RÉPÈTENT leurs visuels.** Même moine, mêmes décors d'une image à
   l'autre : l'analyse relève « personnages et lieux hautement répétitifs » sur 4 vidéos / 5.
   Le personnage récurrent y fait fonction d'identité de chaîne.

## Traduction en paramètres de machine

| Paramètre | Valeur mesurée | Commentaire |
|---|---|---|
| Débit voix off | **135 mots/min** (bande 120-165) | défaut « lent » = 120 |
| Mots par image | **34** (bande 29-44) | règle de découpe primaire |
| Durée de plan résultante | 12 à 17 s | conséquence, pas consigne |
| Images pour 8 min | **~32** (bande 23-41) | |
| Images pour 12 min | **~48** (bande 35-62) | |
| Images pour 20 min | **~80** (bande 58-103) | |
| Musique | continue, -29 dB sous la voix | jamais de silence |
| Loudness cible | -19,7 LUFS | |
| Sous-titres | bas, petits, par groupes de mots | |

---

# Pilote « Poser ce que tu portes » — 8 min, réalisé le 24 août 2026

Livrables : `agent-os/output/machines/bouddhisme-pilote/` (vidéo, miniature, script,
sous-titres, 35 images, musique, packaging). Pipeline : `scratchpad/pilote/*.js`.

## Chaîne de production réellement exécutée

| Étape | Outil | Résultat mesuré |
|---|---|---|
| Script | rédigé main, parabole zen traditionnelle | 973 mots, 61 paragraphes |
| Voix off | FAL `inworld-tts`, voix « Alain (fr) » | 480,0 s — **122 mots/min** |
| Transcript | FAL `whisper` (`chunk_level: word`) | 1 046 mots horodatés |
| Découpage | règle 25 mots/image sur frontières de sens | **35 images**, médiane 14,1 s, 4,4 img/min |
| Images | Kie `nano-banana-2-lite`, 16:9, 5 en parallèle | 35/35, 1376×768 (2 relances) |
| Musique | Kie Suno `V5_5` instrumental | 2 variantes (174 s / 163 s) |
| Montage | FFmpeg | 1920×1080 30 fps H.264, AAC 48 kHz stéréo, -17,4 LUFS |

**Coût réel : 1,27 $** (Kie images 0,74 $ · Suno 0,06 $ · FAL TTS 0,08 $ · Whisper 0,38 $).
Whisper est le deuxième poste : à 0,0008 $/s il coûte 5× le TTS.

## Le point dur : Inworld n'a pas de réglage de vitesse

Le schéma FAL de `fal-ai/inworld-tts` n'expose que `text`, `voice`, `sample_rate_hertz`.
La voix sort à **173 mots/min**, la niche en demande 120-135. Solution retenue, à reprendre
dans la machine :

1. synthèse **paragraphe par paragraphe** (61 appels, même coût — facturé au caractère) ;
2. `atempo=0.85` sur chaque morceau → parole à ~147 mots/min, timbre intact ;
3. **respiration de silence entre paragraphes, calculée pour atteindre la durée cible** :
   `pause = (cible − parole) / (n − 1)`, bornée à [0,8 s ; 3,2 s].

Ici : 399 s de parole + 60 × 1,35 s = 480,0 s pile. Ce mécanisme sert deux besoins d'un coup —
il cale la durée demandée ET produit les silences que la niche exige. C'est le réglage
« Vitesse de narration » de l'interface (lente = 0,85 / très lente = 0,78).

## Défauts constatés sur le pilote (à corriger dans la machine)

1. **Cohérence des personnages non tenue.** En text-to-image pur, le vieux moine de l'image 4
   n'est pas celui de la 7 ni de la 11. Sur une parabole avec des personnages récurrents,
   c'est visible. → c'est la raison d'être de l'onglet **Bibliothèque visuelle** : ancrer les
   personnages récurrents en i2i, comme la troupe neutre de la machine Stickman.
2. **CTA en anglais.** Les sous-textes de la composition `StickmanCta` (« New video every week »,
   « Thanks — see you next week ») sont codés en dur. La spec veut le CTA dans la langue de la
   vidéo → à passer en props.
3. **Définition des images.** `nano-banana-2-lite` rend en 1376×768, upscalé à 1920×1080 par le
   Ken Burns (×1,4). Une image sur 35 est même sortie en 1024×572 malgré deux tentatives.
   Pour une chaîne qui vend le visuel, prévoir `gpt-image-2` (1K/4K) en option de qualité.
4. **CTA et sous-titres se chevauchent** en bas de cadre.

## Pièges FFmpeg rencontrés

- **Kie renvoie du JPEG**, pas du PNG : nommer les fichiers d'après les octets réels
  (signature `FFD8FF`), sinon le décodeur refuse tout.
- `fps=1/N` échantillonne au **milieu** de l'intervalle : une planche contact étiquetée
  « 0 s, 20 s… » montre en réalité 10 s, 30 s… (m'a fait croire à tort à un décalage des
  sous-titres, puis rater la fenêtre du CTA).
- Une **virgule dans un `drawtext`** casse le filtergraph → toujours `textfile=`.
- La chaîne `loudnorm`+`amix` impose son format : forcer `-ar 48000 -ac 2` en sortie,
  sinon on obtient du mono 96 kHz.

## Révision v2 (retours Claudio, 24 août 2026)

| Point | v1 | v2 | Pourquoi |
|---|---|---|---|
| Sous-titres | `FontSize=30` | **`FontSize=21`** | trop gros à l'écran (capture utilisateur) ; MarginV reste à 18 |
| Musique | `volume=0.10` | **`0.035`** | demandé « très légèrement plus haut ». Le chiffre surprend : voir ci-dessous |
| CTA | `StickmanCta` | **`BouddhismeCta`** (nouvelle compo) | textes anglais codés en dur + avatar smiley |
| Nom de chaîne | « L'Instant Juste » | **« Zen Harmonie »** | |
| Accroche CTA | « New video every week » | **« Nouvelle vidéo chaque semaine »** | |
| Après le clic | « Thanks — see you next week » | **« Merci — on se voit semaine prochaine »** | |
| Avatar | smiley SVG | **logo de la chaîne** (`remotion/public/zen-harmonie-logo.png`) | |
| Fin de vidéo | — | **outro parlé de 42 s** + 3 visuels | |
| Durée | 480 s | **524 s** (8 min 44) | |

### La composition `BouddhismeCta`

Clonée de `StickmanCta` plutôt que modifiée — toucher l'originale aurait cassé le CTA de la
machine Stickman. Différences : l'avatar est une vraie image (`<Img src={staticFile(logo)}>`)
et **tous les textes sont des props** (`channel`, `tagline`, `taglineDone`, `label`, `labelDone`,
`logo`). La leçon vaut pour toute machine multilingue : un texte de CTA codé en dur est une
dette qui se paie dès la deuxième langue.

### L'outro

Texte fourni par Claudio, découpé en 7 paragraphes pour que les respirations tombent sur ses
retours à la ligne. Synthétisé avec la même voix, le même `atempo` et la même respiration que
le corps du récit : il doit s'entendre comme la suite naturelle, pas comme une bande-annonce.

Gabarit de variation dans `scratchpad/pilote/OUTRO-VARIANTES.md` — trois briques
(reconnaissance / promesse + abonnement / au revoir) recombinées par la machine, le bloc central
reprenant le **verbe-clé du thème du jour** pour éviter l'effet copier-coller.

**Whisper n'a été relancé que sur l'outro** (42 s), puis les timings décalés de `bodyDur + gap` :
transcrire à nouveau les 8 minutes aurait coûté 0,38 $ pour rien. À reprendre dans la machine
dès qu'on ajoute un bloc audio à une voix off déjà transcrite.

### Un CTA calé sur la voix

Le montage cherche le mot « abonne » dans le transcript et place une apparition du bouton
0,6 s avant. Ici : 504,5 s. **Attention** : cela tombe 19,5 s avant la fin, donc dans les
20 dernières secondes que la spec voulait laisser libres — les deux règles se contredisent,
arbitrage à confirmer.

### Régler le niveau musical : mesurer le FICHIER FINI, jamais un maillon

Passer `volume` de 0,10 à 0,13 a fait bondir la musique de **13,7 dB** dans le fichier fini,
pas de 2,3 dB : l'écart voix/musique tombait de 29 dB à 17 dB. En cherchant la cause j'ai
mesuré tour à tour un extrait, puis le WAV du mixage — et obtenu trois chiffres différents
pour les mêmes réglages (29 / 21 / 17 dB). Aucun n'était comparable : `loudnorm`, `amix` et
l'encodage AAC déplacent tous le niveau.

**La seule mesure qui vaut est celle du .mp4 final**, avec la même méthode que celle appliquée
aux vidéos concurrentes (RMS par fenêtre de 0,5 s ; plancher = p05 = lit musical seul entre
deux phrases ; voix = p50). Calibrage obtenu ainsi, en remuxant l'audio sur la vidéo déjà
encodée (`-c:v copy`, ~30 s au lieu de 5 min) :

| `volume` | écart voix/musique |
|---|---|
| 0,035 | **26,6 dB** ← retenu (2,5 dB de plus qu'en v1) |
| 0,04 | 25,8 dB |
| 0,06 | 22,9 dB |
| 0,13 | 17,1 dB |

Référence : niche mesurée à 29 dB, pilote v1 à 29,1 dB. Le ducking sidechain écrase les
variations de `volume` — 2,3 dB de gain n'en donnent que ~1,4 dB à l'arrivée — d'où
l'obligation de calibrer empiriquement plutôt que de calculer.

### Sous-titres : recoller la typographie française

Whisper rend les mots isolément : « n 'est », « t 'a », « Abonne -toi ». Visible sur chaque
ligne. Nettoyage appliqué avant écriture du SRT : espace avant apostrophe supprimée, espace
avant trait d'union supprimée, espace avant ponctuation supprimée.

### Révision v3 — composition des lignes de sous-titres

Retour Claudio : à la taille validée (21), les lignes portaient trop peu de mots.

**Un bug bien plus grave se cachait derrière.** Whisper découpe les élisions françaises en
DEUX tokens — `t` + `'a`, `d` + `'elle` — et sort la ponctuation isolée (`»`). Le regroupement
pouvait donc couper AU MILIEU d'un mot : à l'écran, « Le vieux moine s'approcha **d** » puis
« **'elle**, sans un mot ». Une ligne n'affichait qu'un guillemet.

Correctif en deux temps :
1. **`weld()`** recolle, AVANT toute composition, tout token commençant par `'`, `’` ou `-`,
   ainsi que les tokens de ponctuation pure, au mot précédent.
2. Les lignes se remplissent **au caractère** (`MAX_CHARS`), plus au nombre de mots, et une fin
   de phrase ne déclenche un saut que si la ligne dépasse déjà 22 caractères — sinon on
   fabriquait des lignes d'un seul mot.

**Largeur maximale : 46 caractères.** Mesuré à l'écran : 52 caractères occupent 1900 px sur
1920, le texte touche les bords et serait rogné par les lecteurs ; 46 laissent ~120 px de marge
de chaque côté. C'est la limite dure à cette taille de police — pour aller au-delà il faudrait
réduire la police, ce que le rendu ne supporte pas.

Résultat : **152 lignes au lieu de 232**, moyenne 37 caractères, zéro ligne orpheline.

**Piège de vérification** : `ffmpeg -ss <t> -i` AVANT l'entrée remet les timestamps à zéro et
le filtre `subtitles` n'affiche alors rien. Utiliser `-copyts -ss` pour contrôler une frame.

### Miniature — règle de composition (v3)

Le sujet ne doit **jamais** passer sous le texte. Trois réglages à respecter, dans cet ordre :

1. **Miroir si nécessaire** (`hflip`) pour amener le sujet du côté opposé au texte.
2. **Recadrage** : pour pousser le sujet vers la DROITE, il faut prendre la partie **GAUCHE**
   de la source (petit offset de `crop`). Contre-intuitif — un offset vers la droite ramène au
   contraire le sujet vers le centre-gauche. Réglage retenu ici : source agrandie ×1,5,
   `crop=1280:720:64:162`.
3. **Vérification** : superposer un rectangle rouge à l'emplacement exact du texte
   (`drawbox=x=0:y=45:w=300:h=290:color=red@0.35`) sur des vignettes candidates, et ne garder
   que celles où le sujet n'y entre pas du tout. C'est ce contrôle qui a révélé que la bordure
   du bol mordait encore la zone dans deux candidats sur trois.

Texte : deux lignes blanches (136 px) puis le mot-clé en jaune-vert `#D7E64B` (154 px),
`Arial Black`, contour noir 9-10 px, dégradé sombre linéaire sur les 760 px de gauche.

### Musique : couverture jusqu'à la fin — vérifié

Le lit est construit à la durée EXACTE de la voix off (`atrim=0:voDur`) avec `afade` de sortie
sur les 5 dernières secondes : il couvre donc l'outro. Contrôle sur le fichier fini, RMS par
seconde sur les 20 dernières : aucune seconde à -inf, les creux à -45/-48 dB étant les
respirations où seul le lit musical subsiste. À conserver tel quel dans la machine.
