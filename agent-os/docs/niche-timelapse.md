# Niche « Evolution of [ville] — Fixed-Camera Timelapse » (mesurée le 4 septembre 2026)

Point de départ : [@TimelapseStudioChannel](https://www.youtube.com/@TimelapseStudioChannel),
signalé par l'utilisateur — 83 600 abonnés, 5,26 M de vues, chaîne créée le 20 janvier 2026.

## Étape 0 — comment est-ce fabriqué ?

**Génératif, et la chaîne le dit elle-même.** Sa description : *« The most realistic time machine
is here. Curated by humans, powered by AI. Watch cities transform across centuries from a single
continuous fixed-camera perspective. »*

Ce n'est donc **pas un mirage** : ni tournage réel, ni catalogue redistribué, ni capture de jeu.
La technique — caméra fixe, morphing d'époque en époque — correspond exactement à
`bytedance/seedance-1.5-pro` (first frame → last frame, 6 s, `input_urls = [frameN, frameN+1]`),
déjà documenté dans notre CLAUDE.md mais implémenté dans aucune machine.

## Le format, rigoureusement stable

`Evolution of [VILLE] | Fixed-Camera Timelapse: [N] Years of [QUARTIER]`, 15 à 22 minutes.

| vues | durée | publiée | titre |
|---|---|---|---|
| 2 411 215 | 15 min | 2026-04-12 | Evolution of Paris — 2200 Years |
| 1 457 496 | 22 min | 2026-06-24 | Evolution of Rome — Colosseum Valley |
| 520 146 | 16 min | 2026-04-29 | Evolution of London — 2000 Years |
| 448 537 | 17 min | 2026-08-10 | Evolution of New York — Midtown |
| 417 390 | 20 min | 2026-05-23 | Evolution of Tokyo — 3000 Years |

## Le marché : 25 chaînes, 15 nées en 2026

Corpus décontaminé (52 % du brut : la requête ramène aussi des fonds d'écran 4K et du LEGO).
**Taux de percée : 13,3 %** (`afterMaxSubs/afterDuration`, seuils ≥ 20 k vues, ≤ 25 k abonnés,
≥ 8 min) — porte étroite mais ouverte. Repères : < 5 % fermé, > 15 % sain.

## ⚠ Deux corrections d'analyse, à ne pas refaire

**1. La cohorte de création est biaisée par l'âge.** Comparer les vues/vidéo par date de création
donnait un effondrement de 7× pour les arrivants d'avril+. Faux : une chaîne de janvier a eu
7,5 mois pour accumuler, une de juin 2,8. **Ramené aux vues/MOIS, l'écart tombe à 2,2×** — et
Epoch Timeline, née le 10 juin 2026, fait déjà 167 000 vues/mois. La porte n'est pas fermée.

**2. Les « vues/vidéo » favorisent mécaniquement qui publie peu** (les vidéos sont au
dénominateur). Le constat ne tient que parce qu'il survit aussi en vues/mois :

| chaîne | vidéos/mois | vues/mois | vues/vidéo |
|---|---|---|---|
| Timelapse Studio | **2,3** | **704 647** | 309 510 |
| Humanity Timeline | 5,4 | 257 652 | 47 284 |
| Epoch Timelapse | 13,0 | 173 153 | 13 324 |
| Epoch Timeline | 11,3 | 167 193 | 14 781 |
| TimeLapse Lords | **19,9** | **60 379** | 3 030 |
| EvolveInTime | 7,5 | 24 642 | 3 302 |

Le leader publie **2,3 vidéos/mois** et fait **704 k vues/mois**. Epoch Timelapse en publie
**13** et fait **4 fois moins**. TimeLapse Lords en publie **20** pour **12 fois moins**.
Publier davantage ne rapporte pas : ça coûte.

C'est cohérent avec la politique YouTube « Generic or Repetitive Content » (2026), qui vise
exactement les chaînes produisant en masse sur gabarit.

## Verdict

**Vraie opportunité, mais pas celle qu'on croit.** La niche est génératif-compatible et encore
pénétrable (13,3 %, entrants de juin qui percent). Elle n'est PAS une niche à volume : le modèle
économique qui gagne est **peu de vidéos, très soignées** — 2 à 3 par mois.

Coût estimé (à vérifier avant d'engager) : une vidéo de 15 min ≈ 150 morphings de 6 s
+ ~151 images clés ≈ **18 $**, soit 3× une vidéo de la machine Crime.

Le point dur n'est pas le prix mais la **cohérence du point de vue** : garder le même cadrage
crédible sur 2000 ans. C'est ce qui sépare les chaînes à 300 k vues/vidéo de celles à 3 k.
C'est le même problème que l'ancrage i2i d'un personnage, appliqué à un lieu.

## Prototypes (4 septembre 2026) — ~1,10 $ au total

### Ce qui est prouvé

**Le point de vue tient sur 2000 ans.** Quatre époques de Rome gardent le même point de fuite,
la même ligne d'horizon, le même cadrage.

**Trois règles d'ancrage** (test A → B, déclenché par une observation de l'utilisateur : le
Colisée était devenu un château à tours et à croix) :
1. **ancre UNIQUE** — toutes les époques descendent de la MÊME image, jamais de la précédente.
   En chaîne, les écarts s'additionnent : trois étapes suffisent à transformer le monument ;
2. **décrire la GÉOMÉTRIE, pas le nom** — « ellipse basse, arcades superposées, plus large que
   haut » + interdictions nommées (jamais château, clocher, dôme, croix) ;
3. **nommer ce qui DISPARAÎT** — corollaire découvert en corrigeant : l'ancre verrouille aussi
   ce qui devait s'effacer (le Colosse de Néron survivait jusqu'en 2026).

**Les pas courts suppriment les hallucinations du morphing** (test C). Sur un saut de 500 ans,
seedance inventait un dôme sur le Colisée et projetait des débris. Sur des pas de 50 ans
(1780 → 1830 → 1880 → 1930) : plus aucune invention, progression cohérente (attelages →
tramway → automobiles). **Conséquence de dimensionnement : une vidéo de 15 min doit être
découpée en pas de quelques décennies, pas en grandes époques.**

### Ce qui reste incertain

Un nuage de poussière résiduel dans un morphing. Et surtout : **je n'ai pas su mesurer
automatiquement la stabilité de la caméra** — deux détecteurs d'horizon successifs ont accroché
un nuage puis un arbre et annoncé une dérive que l'image dément. Le contrôle visuel avec une
ligne de repère tracée est concluant ; le chiffre, non. (Cf. la règle : rendre la région que
l'on mesure.)

## Comparaison des deux pistes explorées (coûts ESTIMÉS sur nos tarifs)

| chaîne | format | vidéos | vues/vidéo | coût/vidéo | $ / 1000 vues |
|---|---|---|---|---|---|
| Timelapse Studio | 17 min | 17 | 309 510 | 19,68 $ | **0,064 $** |
| Filofilm (mythologie) | 17 min | 2 | 284 749 | 19,68 $ | **0,069 $** |
| Fantasy Allure AI (conte) | 8 min | 31 | 73 284 | 9,27 $ | 0,126 $ |
| Iron Movies HD (film 1 h) | 59 min | 19 | 38 065 | 68,28 $ | 1,794 $ |

Les deux pistes sont **à égalité** au coût par millier de vues. Iron Movies HD est le
contre-exemple : la durée n'achète pas l'audience (28× plus cher au millier de vues, un seul
succès sur dix-neuf films). Fantasy Allure AI est le modèle le plus régulier et le seul à avoir
duré (depuis juillet 2025).

## Comparaison finale timelapse / contes de fées (5 septembre 2026, normalisée)

⚠ Mesures en **vues par jour depuis publication**. Les vues brutes mentent : elles mesurent
l'ancienneté (voir [[Comparer des vues brutes entre vidéos d'âges différents ment]]).

| chaîne | famille | vues/jour début → fin | verdict |
|---|---|---|---|
| Timelapse Studio | timelapse | 16 586 → **18 043** | stable |
| X Frames | conte adulte | 316 → 2 678 | ×8,5 hausse |
| Ever After Film Studios | conte enfants 3D | 165 → 2 148 | ×13 hausse |
| Fantasy Allure AI | conte adulte | 156 → 562 | ×3,6 hausse |
| Cinema Fictions | conte adulte | 1 042 → 463 | ×0,44 baisse |
| Dreamia Studio | conte adulte | 1 008 → **78** | ×0,08 effondrée |

**Le timelapse fait ~7× le volume par vidéo de la meilleure chaîne de contes, et il est stable.**
Les contes montent (3 chaînes sur 5) mais partent de bien plus bas et sont volatils.

Taux de percée décontaminés, seuils identiques : conte 23,5 % · timelapse 17,2 % · mythologie 12,5 %.
La percée du conte est la meilleure, mais son plafond de trafic est nettement plus bas.

**Dreamia Studio (le cas qui a motivé la piste conte) est un contre-exemple, pas un modèle :**
5,24 M de vues concentrées sur six vidéos publiées en dix semaines (sept.-nov. 2025), puis
effondrement à 78 vues/jour. Un succès de dix semaines n'est pas une niche.

## Étape 0 sur les contes de fées (5 septembre 2026) — l'Œil, 0,015 $

Trois vidéos analysées : Ever After Film Studios (2,18 M), Dreamia Studio (1,46 M), X Frames (203 k).

**Les trois sont de la VIDÉO GÉNÉRÉE PAR IA, toutes reproductibles par une chaîne automatisée.**
Aucun mirage ici — contrairement à GTA.

⚠ **Le label « 4K 3D Animation » d'Ever After est du marketing, pas une technique.** L'Œil relève
morphing des visages, doigts mal formés, textures incohérentes entre plans. Corroboration
indépendante par la **cadence** : 58 vidéos de ~28 min en 6 mois, soit 27 heures de film — 9,2
vidéos par mois. Impossible à animer à la main. *Ne jamais prendre le titre d'une chaîne pour
une description de sa méthode.*

**Structure commune aux trois, identique à nos machines Crime et Bouddhisme :**
voix off narrative UNIQUE, pas de vrai lip-sync, plans de 2 à 5 s, sous-titres, musique de fond.

**LE POINT DÉCISIF : les trois souffrent d'une forte DÉRIVE DES PERSONNAGES.** Visages, coiffures,
costumes changent d'un plan à l'autre ; chez X Frames, un prince a les oreilles tantôt humaines,
tantôt pointues, tantôt couvertes de fourrure. Ces chaînes font des millions de vues *malgré*
ce défaut.

Or l'ancrage i2i d'un personnage est exactement ce que nos machines savent déjà faire (cast
Drama, référence Time Travel), et ce que le prototype timelapse vient d'affiner (ancre unique,
géométrie décrite, disparitions nommées). **Sur l'axe où les leaders échouent, nous avons déjà
l'avantage.**
