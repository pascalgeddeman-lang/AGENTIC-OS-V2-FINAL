# Niche true crime francophone — mesure du 2 septembre 2026

Contexte : chaîne existante **Au creux de la nuit** (251 abonnés, 62 vidéos, 43 072 vues,
**> 9 000 h de visionnage** — il ne manque que les 1 000 abonnés pour la monétisation).
Question posée : la chaîne vaut-elle la peine d'être poussée, et faut-il une machine ?

## Étape 0 — la porte existe, elle est étroite

Recherche `affaire criminelle française enquête documentaire`, ≥ 20k vues, ≤ 25k abonnés, ≥ 15 min.

| Entonnoir | 300 → 163 → 135 → **10** |
|---|---|
| **Taux de percée** | **7,4 %** |

Repère du skill : sous 5 % la niche est fermée, au-dessus de 15 % elle est confortable. 7,4 % =
porte étroite mais réelle. Deux chaînes plus petites que la nôtre la franchissent :

| Chaîne | Abonnés | Vues | Outlier | Durée |
|---|---|---|---|---|
| **Axel** | 5 120 | 116 565 | 24,1 | 17 min |
| **Nuits de Crime** | **1 350** | 49 575 | 8,9 | 38 min |
| Un Max de reportages | 7 150 | 87 918 | 8,6 | 48 min |
| Les Enquêtes Interdites | 8 060 | 229 058 | 16,6 | 175 min |

## Le mécanisme de la niche : l'amorce, pas le nom de l'affaire

**Correction d'une lecture initiale erronée.** À la vue des 3 succès de la chaîne
(Dupont de Ligonnès ×2, Affaire Grégory) j'avais conclu « la notoriété du dossier écrase tout ».
C'était vrai de CETTE chaîne, pas de la niche.

| | Titres |
|---|---|
| Chaîne actuelle | *Xavier Dupont de Ligonnès : Vivant ou Mort ?* · *Affaire Grégory* · *AFFAIRE FLACTIF* |
| Gagnants | *Son neveu ouvre 5 clés USB… et découvre 55 ans d'horreur* · *Toute la salle du tribunal pleurait d'horreur…* · *CETTE AFFAIRE A CHOQUÉ TOUTE L'ANGLETERRE !* |

Axel fait **116 565 vues avec 5 120 abonnés** sur une affaire dont personne ne connaît le nom.
Nommer l'affaire, c'est jouer sur la RECHERCHE — bataille perdue contre McSkyz (2,3 M) et
Silent Jill (1,15 M). Raconter une amorce, c'est jouer sur la RECOMMANDATION, où la taille de la
chaîne ne pénalise pas.

## L'Œil sur les deux plus petites (0,02 $)

### Axel — narrateur à l'image + illustrations IA
- **Plan fixe du narrateur face caméra**, alterné avec des illustrations sombres quasi
  photographiques, sépia / gris / noir, **probablement générées par IA**.
- Ouvre sur un **extrait de journal télévisé réel**, puis le narrateur reprend.
- **Timeline à l'écran**, incrustations de titres de presse et d'appels à témoins.
- Musique minimaliste atmosphérique, jamais dominante.
- **197 mots/min** — débit rapide.
- La vision relève la qualité d'écriture comme un facteur marquant.

**C'est exactement le format « avatar présentateur entre des plans d'images ».** Et c'est le
meilleur ratio du corpus.

### Nuits de Crime — voix off + archives réelles
- Pas de narrateur à l'image. Archives personnelles de la victime, **images de vidéosurveillance**,
  **croquis d'audience**, effet « vieille pellicule » à coins arrondis.
- Ouvre sur une accroche philosophique, pas sur un fait : *« Parfois, ce qui est le plus
  terrifiant n'est pas ce qui se cache dans l'obscurité, mais ce à quoi nous faisons confiance. »*
- **169 mots/min**.
- ⚠ **Affaire BRITANNIQUE (Sarah Everard) racontée en français.** Le vivier de dossiers n'est pas
  limité à la France : les affaires internationales élargissent massivement l'offre ET évitent la
  concurrence frontale des géants français, qui traitent surtout les affaires françaises.

## Ce que ça règle : le problème des visages

Le blocage annoncé — on ne peut pas fabriquer le portrait d'une personne réelle — **est résolu
par les deux gagnants, de deux façons différentes** :

- Axel : illustrations **stylisées** sépia/noir, pas des portraits photoréalistes.
- Nuits de Crime : **archives réelles** (photos publiques, vidéosurveillance, croquis d'audience),
  donc aucune génération de visage.

Aucun des deux ne génère de faux portrait réaliste d'une personne identifiable.

## Constantes mesurées

| | Axel | Nuits de Crime | Comparaison |
|---|---|---|---|
| Débit | **197 mots/min** | **169** | Bouddhisme 120-135 · drama africain 156-161 |
| Durée | 17 min | 38 min | la chaîne actuelle : médiane 26 min |
| Transcript | 19 855 car. | 38 735 car. | |

Le true crime est de la **narration dense** — le débit le plus rapide de toutes les niches
mesurées jusqu'ici.

## Verdict

La niche a une porte. Le problème de la chaîne **n'est pas la production mais le titrage et le
choix des angles** : une machine industrialiserait un format qui fait 90 vues de médiane.

Recommandation : tester à la main 3-4 vidéos avec des **titres d'amorce** et des **affaires
internationales**, avant de décider s'il faut construire une machine. Coût : du temps, zéro dollar.
Si la médiane décolle, la machine se justifie — et son format est déjà connu : narrateur à
l'image + illustrations IA stylisées, timeline, coupures de presse, ~190 mots/min.


---

## Machine construite (3 septembre 2026)

`lib/machines/crime.js` — décisions arrêtées avec l'utilisateur :

| Point | Choix |
|---|---|
| Voix | **Kael** uniquement (`yG4Uc56cLYQyZFnWaYv2`), 165 mots/min, écart 3 % |
| Avatar | HeyGen « Baldi », look *Content creator in black hoodie* |
| Intro | 60 s d'avatar, 3/mois, **bascule automatique** en intro illustrée |
| Architecture voix | Kael narre TOUT ; les 60 premières secondes vont à HeyGen en `audio_url` |
| Images | illustrations sépia/noir, **aucun visage réel** |
| Miniature | portrait illustré anonyme à droite + médaillon cerclé de rouge + 2 lignes |
| Titre | amorce narrative, jamais le nom de l'affaire |
| Affaires | internationales encouragées |

Coûts : 3,78 $ (15 min) · 4,57 $ (18 min) · 6,37 $ (25 min).

**Réserve maintenue** : le problème mesuré de la chaîne est l'angle, pas la production. La
machine ne vaut que parce qu'elle porte la recette — titres d'amorce, affaires internationales,
miniatures à deux blocs. Si la médiane reste à 90 vues après quelques publications, aucune
machine n'y changera rien.
