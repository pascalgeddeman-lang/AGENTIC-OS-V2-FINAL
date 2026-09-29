# Niche micro-drama — mesure du 1er septembre 2026

Corpus : **395 vidéos uniques**, 7 recherches neuves (5 722 unités de quota) + la sonde du 31/08
réinjectée depuis le cache. Questions posées : quelle langue, quelle durée, unitaire ou épisodique.

## Correction préalable — ma mesure était contaminée

Le premier passage donnait des médianes anglaises flatteuses. En les lisant de près, le haut du
tableau « anglais » était en fait du contenu sud-asiatique ayant matché des mots anglais
(Shinchan en hindi, Veggie kahani tv, Toon Veggies, Chintu Ki Badmashi, Azmiya village Routine).
Reclassement par script d'écriture + marqueurs linguistiques, sans dépense de quota :

| Population | Vidéos | Vues médianes | Durée médiane |
|---|---|---|---|
| Anglais | 153 | 182 716 | 20 min |
| Français | 206 | 70 899 | 18 min |
| Sud-asiatique romanisé | 25 | **336 016** | 12 min |
| Autre script (hindi, arabe, tamoul…) | 11 | **823 236** | 15 min |

Les 36 vidéos écartées portaient les plus fortes médianes du corpus. **Toute comparaison de
langue faite sans ce nettoyage est fausse.** À ajouter à la méthode de l'étape 0.

## Q1 — Français ou anglais ?

Filtres strictement identiques (≥ 20k vues, ≤ 25k abonnés, ≥ 8 min), seule la langue de la
requête change :

| | Vidéos | Vues médianes | p75 | Max | Abonnés médians |
|---|---|---|---|---|---|
| **EN** | 153 | **182 716** | 341 934 | 10 776 441 | 11 900 |
| **FR** | 206 | 70 899 | 211 162 | 2 470 421 | 10 200 |

**L'anglais fait 2,6× le français en médiane** — et non 10 à 20× comme je l'avais annoncé le
31/08 à partir d'un échantillon GTA bien plus étroit. **Cette estimation initiale était fausse.**
Sur la bande cible 10-20 min l'écart est de 3,0× (149 827 contre 50 345).

Noter aussi que le **français produit PLUS de vidéos qualifiantes** (206 contre 153) : l'offre
francophone est plus abondante, mais chaque vidéo rapporte moins.

### Le fait décisif : le marché francophone de cette niche est AFRICAIN

Les gagnants francophones de la bande 10-20 min, sans exception :

| Chaîne | Abonnés | Vues | Titre |
|---|---|---|---|
| INSPIRADOR Afrique | 12 700 | 1 056 307 | Elle FILME SA VOISINE pour son contenu… |
| Échos d'Ancêtres | 41 800 | 999 834 | C'EST POURQUOI VOUS NE DEVRIEZ PAS MANGER DANS… |
| Temple des Récits | 10 000 | 826 383 | Elle s'est servie de sa voisine pour faire du buzz |
| SunuAnims TV | 29 100 | 722 234 | Histoire Familiale (titre en **wolof**) |
| **Vies D'Amour** | **3 900** | **415 544** | Elle Nettoyait les Bureaux… Aujourd'hui les Riches… |
| JUNA TV | 8 180 | 320 776 | La nouvelle reine 👑 Histoire Africaine complète |
| VOIX D'AFRIQUE | 9 750 | 277 061 | Elles Se Moquaient D'Elle Parce Qu'Elle Était Célib… |

Codes récurrents : trahison de la voisine, humiliation sociale suivie de revanche, femme de
ménage devenue riche, sagesse ancestrale. **Ce ne sont pas les codes du marché anglophone.**
Conséquence directe : deux chaînes miroir avec le même contenu doublé ne marcheraient pas —
les deux marchés veulent des histoires différentes.

Corroboration externe (recherche web du 31/08) : StoryTV, société française de microdrama,
réussit « dans tout l'espace francophone, **Afrique comprise** ».

## Q2 — Unitaire ou épisodique ?

| | Vidéos | Vues médianes | Durée médiane |
|---|---|---|---|
| Épisodique (EP1, Part 2, Épisode 3…) | 59 | 106 784 | 15 min |
| Unitaire | 355 | 113 097 | 20 min |

**Aucun avantage par vidéo.** Les médianes sont équivalentes. Le sérialisé ne rapporte pas plus.

Le vrai test est la **décroissance de série** — les vues tiennent-elles d'un épisode au suivant ?

| Chaîne | Abonnés | Suite | Dernier / premier |
|---|---|---|---|
| LOHA STORIES | 31 800 | 137k → 208k → 177k → 136k | **99 %** |
| OpenVerse Studio | 21 200 | EP8 106k → EP9 107k | **100 %** |
| vee | 21 500 | EP8 138k → EP14 183k → EP15 126k | **91 %** |
| JUNA TV | 8 180 | EP1 186k → EP3 87k | 47 % |
| Derrière le Pagne | 4 840 | 81k → 115k → 59k → 47k → 29k → 41k → 27k | 34 % |
| Dr.pierce | 31 700 | EP1 589k → EP3 213k → EP4 195k | 33 % |
| Faadeloo STORY | 49 400 | EP1 1 201k → EP2 606k → 203k | **17 %** |

**3 séries sur 8 tiennent, 5 perdent de la moitié aux cinq sixièmes.** L'effondrement se
concentre sur la transition EP1 → EP3 : un premier épisode fortement poussé par l'algorithme
n'est pas une base, c'est un pic de recrutement. Planifier dessus est une erreur.

## Q3 — 15 minutes, est-ce viable ?

Vues médianes par bande de durée (corpus complet) :

| Bande | Vidéos | Vues médianes | Outlier médian |
|---|---|---|---|
| 8-12 min | 96 | 107 448 | 4,4 |
| **12-18 min** | **111** | **82 370** | 5,8 |
| 18-25 min | 41 | 136 476 | 3,7 |
| 25-45 min | 57 | 176 760 | 5,4 |
| 45-80 min | 33 | **184 174** | 7,7 |
| 80 min et + | 73 | 135 373 | 7,2 |

La bande 12-18 min est **la plus peuplée et la moins rémunératrice**. 44 % du corpus tient
entre 10 et 20 minutes : c'est là que tout le monde se presse. Passer à **18-25 min multiplie
la médiane par 1,7**, et 25-45 min par 2,1.

Viable malgré tout — les preuves existent : **Karma ai films, 9 540 abonnés → 2 573 616 vues
pour « STRANDED: Survival Island | AI Short Film », 15 minutes**. C'est le meilleur précédent
du corpus pour le projet : format IA, durée cible, petite chaîne.

Le coût marginal d'une minute supplémentaire est quasi nul dans notre pipeline (script + voix
+ visuels ≈ 1-2 $ pour 20 min). Rester à 15 min par confort n'a donc pas de justification
économique.

## Recommandation

1. **Une seule chaîne d'abord, en français-africain.** Pas parce que le marché est plus gros —
   il l'est 2,6× moins — mais parce que l'entrée y est moins chère (Vies D'Amour : 3 900
   abonnés → 415k vues), que les codes narratifs y sont lisibles et répétables, et surtout que
   les premiers runs d'une machine neuve sont ratés : autant se tromper là où le script se juge
   dans sa langue maternelle.
2. **Porter le FORMAT vers l'anglais ensuite, pas la traduction.** Les deux marchés veulent des
   histoires différentes ; une chaîne anglophone devra réécrire, pas doubler.
3. **Unitaires d'abord.** Médiane identique à l'épisodique, aucun risque de décroissance, chaque
   vidéo recrute pour elle-même. Sérialiser seulement une fois qu'un thème a fait ses preuves.
4. **Viser 18-22 minutes plutôt que 15.** +70 % de médiane pour un surcoût de production
   négligeable.

## Réserve

Le pool anglophone de 153 vidéos contient des chaînes qui ne sont pas de la niche (recaps
Stranger Things, listes d'anime rétro, critiques de films) entrées par les mots-clés. La
médiane anglaise est donc probablement un peu surestimée, ce qui **renforce** la recommandation
de commencer en français. Un passage de ces chaînes à l'Œil du scrap (≈ 0,005 $/vidéo, aucun
quota) trancherait avant de lancer la construction.

---

## Contre-épreuve de redistribution (1er septembre, après-midi) — l'hypothèse est INFIRMÉE

Contexte : un cron posé la veille demandait de relancer une batterie pour séparer la voie
productible de « l'essaim de redistribution d'un catalogue chinois sous licence ». Ces
instructions étaient périmées (batterie déjà passée le matin, script réécrit, doc déjà rédigé)
et n'ont pas été exécutées. Mais la contre-épreuve elle-même manquait, et elle se fait
**gratuitement** sur le corpus en cache.

**Méthode** : normalisation agressive des titres (suppression des emoji, de la ponctuation
`【】|!?`, et des mots d'habillage `full / complete / episode / ep / part / hd / movie / drama /
eng / sub / premiere / global / new / official`), puis recherche des titres portés par au moins
deux `channelId` distincts.

**Résultat sur 742 vidéos / 498 chaînes :**

| | Valeur |
|---|---|
| Titres distincts | 739 |
| Programmes portés par 2 chaînes ou plus | **2** |
| Taux | **0,27 %** |

Les deux seuls cas :

- *Betray Me? Lose It All!【The Hidden Queen…* — Lucky Short Dramas (85k) et Lighthearted Short
  Skit (342k). C'est le cas repéré le 31/08.
- *Doraemon new episode in hindi - without zoom effect* — Wo G (1 156k) et Pigeon_Drama (39k).

**Correction à consigner.** Le 31/08 j'ai écrit que la niche était « dominée par un essaim qui
redistribue un catalogue chinois sous licence ». C'était une généralisation abusive à partir de
deux ou trois titres vus dans une sonde de 45 vidéos. Sur un corpus 16 fois plus grand, le motif
ne se retrouve pas. **La niche n'est pas disqualifiée par la redistribution.**

**Signal secondaire, plus faible** : 97 chaînes sur 498 (19 %) portent un nom générique de niche
(*Lucky Short Dramas*, *Lux Short Drama*, *Global Drama Spell*, *Mon Petit Drama*, *Drama
Suprême*, *L'Heure du Drama*, *Avant-Rapide Drama*, *Studio Kreyòl TV*…). Un nom au gabarit
indique une chaîne montée à la chaîne, pas nécessairement du contenu redistribué. À noter que
ce phénomène touche aussi le francophone — dont *Studio Kreyòl TV*, cohérent avec le constat
d'un marché francophone africain et caribéen.

**Limite de la méthode, à ne pas masquer** : l'appariement par titre ne détecte que la
redistribution *paresseuse*, qui conserve le titre d'origine. Un redistributeur qui **retitre**
son catalogue passe au travers. Le résultat se lit donc « la redistribution massive n'est pas
confirmée », et non « le contenu est prouvé original ».

**Ce qui trancherait définitivement** : passer 3 ou 4 gagnants francophones (INSPIRADOR Afrique,
Temple des Récits, Vies D'Amour) à l'Œil du scrap — ≈ 0,005 $ par vidéo en OpenRouter, aucun
quota YouTube. Une analyse du contenu dit en une requête si l'on a affaire à de la production
originale ou à un habillage de catalogue.

---

## L'Œil sur 3 gagnants francophones (1er septembre) — le dernier verrou saute

Trois vidéos passées au transcript (Apify) + vision (Gemini 3.1 Flash Lite via OpenRouter).
Coût total ≈ 0,03 $, aucun quota YouTube. Résultats persistés dans `data/scrap/videos/`.

### 1. Ce n'est PAS de la redistribution, même retitrée

Ma contre-épreuve par titre ne pouvait pas détecter un catalogue **retitré**. Deux titres du
corpus semblaient raconter la même chose :

- INSPIRADOR Afrique — *Elle FILME SA VOISINE pour son contenu pour être CÉLÈBRE*
- Temple des Récits — *Elle s'est servie de sa voisine pour faire du buzz…*

Les transcripts tranchent : **deux histoires entièrement différentes.**

| | INSPIRADOR Afrique | Temple des Récits |
|---|---|---|
| Protagoniste | Créatrice TikTok anonyme | Cynthia, influenceuse |
| Victime | Voisine au physique atypique, traitée comme une figure surnaturelle | Madame Olissa, 41 ans, veuve, 2 enfants, 11 ans dans la cour |
| Déclencheur | Filmage sans consentement | Une gifle un mardi matin, puis retour 3 mois en arrière |
| Registre | Fable à élément surnaturel, transformation physique finale | Conflit de voisinage réaliste, escalade sur 21 jours |

C'est le **même trope traité en parallèle**, comme « la revanche du PDG » côté anglophone — une
convention de genre, pas un catalogue partagé. **La niche est de la production originale.**
L'hypothèse de redistribution est définitivement écartée, par les deux tests disponibles.

### 2. La méthode de production est reproductible par notre moteur

Les trois vidéos partagent une esthétique **animation 3D façon Pixar/DreamWorks** : personnages
expressifs aux grands yeux, éclairages travaillés, décors détaillés, palette riche.

Pour *Vies D'Amour*, la vision est explicite : « manifestement réalisé à l'aide d'outils
d'**intelligence artificielle générative** (vidéo et audio) ».

Cette affirmation est un jugement de modèle, pas une preuve. **L'argument économique est plus
solide** : une chaîne de 3 900 abonnés ne finance pas de la 3D de qualité studio à raison d'un
film de 11 minutes par semaine. Le rendu est atteignable en génératif, il ne l'est pas autrement
à cette échelle et à ce rythme.

### 3. La recette narrative — invariants relevés sur les 3

1. **Ouverture sur le pic, puis rembobinage.** Temple des Récits le fait à voix haute : « pour
   comprendre comment elle en est arrivée là, une gifle un mardi matin devant tout le quartier,
   il faut revenir 3 mois en arrière ». INSPIRADOR ouvre sur des répliques de la fin.
2. **CTA parlé DANS l'histoire, vers la 30ᵉ seconde**, juste après le cold open : « Laissez un
   petit like pour propulser l'histoire et **dis-nous en commentaire depuis quel pays vous
   regardez**. On commence tout de suite. » L'appât à commentaire par pays est taillé pour une
   audience de diaspora — mécanique directement copiable.
3. **Voix off de conteur** (masculine posée chez Temple des Récits), qui porte les pensées
   intérieures et donne une portée universelle.
4. **Humiliation sociale → renversement complet.** *Vies D'Amour* en est la forme pure : Aminata,
   femme de ménage sénégalaise dans une maison de couture parisienne, moquée puis licenciée,
   devient virale ; la maison s'effondre ; à la fin **Sophie vient passer un entretien chez
   Aminata**. L'inversion des rôles est totale, pas partielle.
5. **Les réseaux sociaux comme moteur d'intrigue**, avec l'interface à l'écran (compteurs de
   vues, notifications) utilisée comme outil de narration.
6. **Personnages datés et chiffrés** : « Madame Olissa, 41 ans, veuve, deux enfants, 11 ans dans
   la même cour ». La précision fabrique la crédibilité.
7. **Morale explicite** en clôture, plus une liste de dédicaces (INSPIRADOR) qui fabrique la
   communauté.

### 4. Densité de parole — deux modèles de production

| Chaîne | Caractères | Durée | Car./min | Mots/min |
|---|---|---|---|---|
| INSPIRADOR Afrique | 12 573 | 13 min | 967 | ~161 |
| Temple des Récits | 15 915 | 17 min | 936 | ~156 |
| **Vies D'Amour** | **4 942** | 11 min | **449** | **~75** |

Deux régimes nets : **dialogué dense à ~950 car./min** (161 mots/min — cohérent avec le
`WPM=165` mesuré sur Stickman) et **porté par l'image à ~450 car./min**, où la musique et le
montage occupent la moitié du temps.

Conséquence directe sur le budget : la voix est facturée au caractère. Un 17 min dense coûte
~1,60 $ de TTS chez ElevenLabs, un 11 min visuel ~0,50 $. **Le régime visuel est deux fois moins
cher ET c'est celui de la chaîne au meilleur ratio du corpus** (Vies D'Amour, 3 900 abonnés →
415 544 vues, soit 106×).

### Verdict

Les trois verrous sont levés : la niche est de la production originale, sa méthode est
reproductible, et sa recette est lisible. **La machine peut être écrite.**

### Le risque technique restant, à ne pas sous-estimer

Tenir une identité de personnage en 3D façon Pixar sur ~60 plans d'un film de 11 minutes est
exactement le problème résolu à moitié sur Bouddhisme (#5) par la bibliothèque i2i. C'est LE
point dur de cette machine, et il doit être prototypé sur une séquence courte **avant** d'écrire
le pipeline complet — pas découvert au premier run réel.

---

## Prototype de cohérence de personnage (1er septembre) — CONCLUANT

Avant d'écrire la machine, un essai à deux phases pour répondre à UNE question : le personnage
tient-il d'un plan à l'autre ? Scripts conservés dans `agent-os/scripts/prototype-drama/`,
médias dans `agent-os/output/prototype-drama/` (gitignoré).

**Coût total : 0,36 $** — référence 0,03 · 5 plans i2i 0,15 · 2 clips Grok 0,18 · voix 0,001.

### Dispositif

`gpt-image-2-text-to-image` pour une référence 16:9, puis `gpt-image-2-image-to-image`
(`input_urls`, référence uploadée publique sur Drive) pour 5 plans, puis
`grok-imagine-video-1-5-preview` 6 s sur 2 d'entre eux, puis `fal-ai/inworld-tts` en voix off
française, montage FFmpeg sans sous-titres.

Les 5 plans ont été choisis pour être le cas DIFFICILE : nuit bleue / jour froid / contre-jour
doré / contre-plongée dure / heure dorée, et surtout un **changement de tenue complet** au plan 5
(uniforme de ménage → robe de soirée émeraude).

### Résultat : le personnage tient sur les 5 plans fixes ET sur les 2 clips animés

Même visage, même coiffure, même carnation, d'un bout à l'autre — y compris au plan 5. Grok
conserve l'identité pendant les 6 secondes d'animation, et le mouvement demandé (dolly avant
lent, léger orbit, menton qui se relève, sourire qui vient) est exécuté.

### Sept enseignements pour la machine

1. **Un accessoire distinctif dans la référence ancre l'identité mieux que le texte du prompt.**
   Le bandeau rouge, mentionné UNIQUEMENT dans la référence, est réapparu dans les 5 plans — y
   compris au plan 5 où le prompt décrivait une robe de soirée et des boucles d'oreilles sans un
   mot sur sa tête. **Corollaire** : il est aussi collant, on ne l'enlève pas quand on le veut.
2. **Le cadrage n'obéit pas au prompt.** Plan 2 : « plan moyen centré sur elle, les deux femmes
   légèrement floues au premier plan » a donné deux figurantes énormes occupant 60 % du cadre et
   l'héroïne minuscule au fond. Dramatiquement réussi, mais non demandé. Garde-fou en CODE
   nécessaire — même leçon que les plafonds de casting de Stickman (#4).
3. **Un logo Chanel est apparu seul** sur un sac à main. Marque déposée non sollicitée : un
   prompt négatif interdisant marques et logos est OBLIGATOIRE dans la machine.
4. **Du texte français s'invite** (« ATELIER HAUTE COUTURE », « Atelier Lumière PARIS »,
   « Collection Éclat »), bien orthographié. Cadeau pour une chaîne francophone, mais incontrôlé :
   prévoir l'interrupteur qui l'interdit.
5. **Les personnages secondaires dérivent** faute de référence propre. L'antagoniste doit avoir
   sa propre entrée de bibliothèque i2i — c'est `bouddhisme-library.js` (#5) à porter tel quel.
6. **⚠ Le nom de voix Inworld EXIGE le suffixe de langue** : `"Alain (fr)"`, pas `"Alain"`.
   Sans lui la réponse FAL ne contient aucun `audio.url` et l'étape échoue. La table est dans
   `bouddhisme.js` (`VOICE_SUFFIX`). Ça a coûté un run.
7. **Débit Inworld brut : ~178 mots/min.** La niche tourne à ~160 (régime dialogué) ou ~75
   (régime visuel). Il faudra l'`atempo` + respirations calculées de Bouddhisme, ce n'est pas
   optionnel.

### ⚠ Correction du budget annoncé plus haut

L'estimation « 1 à 2 $ pour 20 min » de la section Q3 supposait un format de narration sur images
fixes. **L'Œil a montré que ces vidéos sont des films d'animation 3D**, ce qui change l'ordre de
grandeur :

| Régime | 15 min | Calcul |
|---|---|---|
| Tout animé en clips Grok | **~13 $** | ~112 plans de 8 s → images 3,4 $ + clips 10 $ |
| Mixte 30 % de clips animés | **~6,5 $** | images 3,4 $ + 34 clips 3 $ |
| Images fixes animées (Ken Burns) | ~4 $ | images seules + voix |

Le **ratio de plans réellement animés est LE levier de coût** de cette machine et doit être un
réglage exposé dans l'input, pas une constante.

### À mesurer avant d'écrire le pipeline

Le nombre de plans par minute est ici une supposition (8 s/plan). Il doit être **mesuré** sur les
vidéos sources par planches contact FFmpeg — la méthode Bouddhisme, qui avait divisé par deux le
nombre d'images attendu. Sans cette mesure, l'estimation de coût ci-dessus reste une hypothèse.

---

## Phase 3 — séquence « tout animé » (1er septembre)

Les 5 plans passés en clips Grok 6 s, voix off **segmentée par plan**, montage FFmpeg.
Résultat : `agent-os/output/prototype-drama/tout-anime.mp4`, **33,97 s**, vidéo et audio calés
à 0,03 s près. Coût de la phase : 0,27 $. **Total du prototype : 0,63 $.**

### Principe de montage (à reprendre dans la machine)

1. La voix est synthétisée **par plan**, jamais d'un bloc.
2. Chaque plan dure exactement le temps de SA phrase, plus une respiration de 0,45 s.
3. On n'ajuste que la VIDÉO — coupe si la phrase est plus courte, ralenti jusqu'à ×1,35 si elle
   est plus longue, gel de la dernière image au-delà.

Les deux timelines coïncident **par construction**, pas par calcul d'offsets. C'est ce qui avait
causé la dérive des sous-titres sur Linguistique.

### Constante mesurée : ~13-14 mots par plan animé

C'est le résultat le plus utile de la phase. Les phrases écrites (15-17 mots) demandaient ~7 s
alors que Grok rend 6 s : **4 clips sur 5 ont dû être ralentis de ×1,22**, ce qui se voit — le
mouvement de caméra devient cotonneux.

| Plan | Mots | Voix | Ajustement vidéo |
|---|---|---|---|
| 1 | 17 | 6,97 s | ralenti ×1,23 |
| 2 | 15 | 6,92 s | ralenti ×1,22 |
| 3 | 15 | 6,90 s | ralenti ×1,22 |
| 4 | 13 | 5,28 s | coupe à 5,73 s ✅ |
| 5 | 12 | 5,65 s | ralenti ×1,01 ✅ |

Seuls les plans à **12-13 mots** tombent juste. C'est l'équivalent pour cette machine du
« 25 mots par image » de Bouddhisme : **le rédacteur de script doit être contraint à 13-14 mots
par plan animé**, sinon chaque plan est ralenti et la vidéo entière paraît molle.

Rallonger le clip n'est pas la solution : le journal note que Grok 1.5 bascule en **multishot**
(plusieurs axes de caméra) à 8-10 s, ce qui casse le plan continu. La fenêtre utilisable est
6-7 s. À noter que nos clips 6 s sont restés en plan unique, la consigne explicite
« very slow smooth dolly push-in » ayant suffi à écarter le multishot.

### ⚠ Correction : l'atempo de Bouddhisme ne se transpose pas tel quel

J'avais appliqué `atempo=0.88` en me fondant sur le débit brut Inworld de 178 mots/min mesuré
sur Bouddhisme. **Résultat obtenu : 127 à 148 mots/min**, alors que la niche tourne à 156-161
(INSPIRADOR 161, Temple des Récits 156). Trop lent.

Raison : en synthèse **par segment**, chaque segment porte son propre silence de tête et de
queue, ce qui gonfle la durée et écrase le débit apparent. Le 178 mots/min avait été mesuré sur
un bloc unique.

**Pour cette machine : atempo ≈ 1,0**, c'est-à-dire aucun ralentissement, quand on synthétise
par plan. Règle générale à retenir : *un débit de parole se mesure dans le régime de découpage
où il sera utilisé* — un chiffre relevé sur un bloc continu ne vaut pas pour des segments.

### Spécification retenue pour la machine (demande utilisateur)

Menu déroulant **Rythme visuel** dans l'input, qui pilote le levier de coût principal :

| Mode | Coût 15 min | Description |
|---|---|---|
| Tout animé | ~13 $ | chaque plan est un clip Grok |
| Mixte | ~6,5 $ | ~30 % de clips animés, le reste en images animées |
| Images fixes | ~4 $ | Ken Burns / parallaxe uniquement |

En mode mixte, **quels** plans sont animés reste à trancher. Hypothèse à vérifier sur les vidéos
sources plutôt qu'à décréter : animer ceux qui portent une action ou une bascule émotionnelle,
laisser les plans d'ambiance en fixe.

---

## Phases 4 et 5 — hyper-réalisme et personnages qui parlent (1er septembre)

Deux demandes utilisateur après visionnage de la séquence 3D : passer en **personnages réels
hyper-réalistes**, et faire **parler les personnages** au lieu d'une simple voix off.

**Coût cumulé réel du prototype (relevé dans `spend.json`, pas estimé) : 1,027 $**
— Kie.ai 0,900 $ · FAL.ai 0,127 $ sur 33 écritures.

### La voix : Inworld est une impasse en français

Le catalogue `fal-ai/inworld-tts` compte **113 voix, dont 4 seulement en français** (Alain,
Hélène, Mathieu, Étienne). Relevé sur le schéma OpenAPI de FAL, la table de `bouddhisme.js`
est donc exhaustive. Débits mesurés sur la même phrase :

| Moteur | Voix | Débit |
|---|---|---|
| Inworld | Hélène | 163 mots/min |
| Inworld | Mathieu | 201 — trop rapide |
| Inworld | Étienne | 190 — trop rapide |
| **ElevenLabs** | **Charlotte** | **159** ✅ |
| **ElevenLabs** | **George** | **167** ✅ |
| ElevenLabs | Daniel | 172 |
| ElevenLabs | Brian | 177 |

La niche tourne à 156-161 mots/min. **Charlotte et George tombent dedans sans aucun `atempo`**,
ce qui confirme la correction de la phase 3.

**Point décisif** : chez ElevenLabs (`fal-ai/elevenlabs/tts/eleven-v3`), le paramètre `voice`
est une **chaîne libre** — « The name or the ID of the voice ». Les 20 noms du schéma ne sont que
des exemples. N'importe quelle voix de la bibliothèque ElevenLabs est donc utilisable par son nom
ou son ID. Coût : 0,10 $/1000 car. contre 0,01 chez Inworld — soit 0,68 $ contre 0,07 $ sur un
film de 15 min. Négligeable des deux côtés.

### Faire parler : deux voies, une seule tient à l'échelle d'une série

**Voie A — Grok génère la parole** (dialogue écrit dans le prompt vidéo). Un appel, 0,09 $ le
plan de 6 s, parole incluse.

**Vérification importante : Grok prononce correctement le français.** Les deux vidéos ont été
transcrites par Whisper et rendent le MÊME texte (« ses bureaux » pour « ces bureaux », des
homophones). La voie B ayant reçu la phrase exacte en entrée sert de témoin : sa transcription
est la façon dont Whisper écrit la bonne phrase. A transcrit à l'identique, donc A a dit la bonne
phrase.

**Voie B — clip muet + voix ElevenLabs + `veed/lipsync`** (recette de Linguistique, +0,40 $/min).

| | Voie A | Voie B |
|---|---|---|
| Coût / plan parlé 6 s | 0,09 $ | 0,09 + 0,04 $ |
| Choix du timbre | aucun | libre |
| Même voix au plan 40 qu'au plan 3 | **non garanti** | garanti |
| Même voix d'un épisode à l'autre | non | garanti |

**La voie B est la seule défendable** pour une chaîne : un personnage récurrent doit avoir une
voix reconnaissable d'une vidéo à l'autre, c'est ce qui fait revenir un spectateur. Décrire le
timbre dans chaque prompt (parade Time Travel) reste une description, pas une empreinte.
Surcoût réel si un tiers des plans sont dialogués sur 15 min : **+2 $**.

### L'hyper-réalisme : concluant, avec deux réserves

Référence + 5 plans en `gpt-image-2` avec un style photographique (ARRI Alexa, 50 mm
anamorphique, pores et texture de peau, grain) et interdiction explicite de tout rendu 3D.

**Le personnage tient sur les 5 plans.** Et deux gains inattendus :

1. **Le photoréalisme respecte MIEUX les consignes de cadrage que la 3D stylisée.** Plan 2 : en
   3D les deux figurantes occupaient 60 % du cadre et l'héroïne était minuscule au fond ; en réel
   c'est le plan moyen demandé. Idem plan 4, dont la contre-plongée est exactement celle décrite.
2. **Aucun logo de marque** — le prompt négatif ajouté après l'incident Chanel a fonctionné.

Réserves :

- **Décalage d'âge systématique** : la référence demandait 26 ans, les rendus donnent 35-45 ans
  sur les 5 plans. Ce n'est pas une dérive entre plans mais un biais à la source, donc corrigeable
  en durcissant la référence.
- **La dérive se voit davantage**, comme prévu. L'écart de structure faciale entre le plan 5 et
  les plans 1-3 serait invisible en 3D stylisée ; sur du réel l'œil l'attrape. Sur 60 plans il
  faudra probablement **plusieurs références par personnage** (face, profil, plan large) plutôt
  qu'une seule.

⚠ **Rappel** : l'Œil avait mesuré de l'animation 3D sur les 3 chaînes gagnantes, sans exception.
Le photoréaliste s'écarte donc de la donnée mesurée. Ce n'est pas un veto — 3 chaînes ne font pas
un marché — mais c'est un choix pris contre la mesure.

### ⚠ Piège Kie : relancer, pas allonger le délai

Le plan 4 photoréaliste a échoué sur « délai dépassé » à 12 minutes de polling. Relancé à
l'identique, il a abouti en **167 secondes**. Le premier job n'était donc pas lent, il était
**perdu**. La correction n'est pas d'allonger le timeout mais de **rejouer** — c'est exactement
ce que fait `genWithRetry` dans le squelette, et il devra couvrir les images de cette machine.

---

## Décisions arrêtées pour la machine (1er septembre)

### Point 1 — Style visuel : menu déroulant, 3D stylisée par défaut

| Valeur | Défaut |
|---|---|
| **3D stylisée** (Pixar / DreamWorks) | ✅ oui |
| Photoréaliste (ARRI Alexa, 50 mm, grain) | non |

Le défaut suit la mesure : l'Œil a relevé de la 3D sur les 3 chaînes gagnantes. Le mode
photoréaliste reste disponible — il cadre même mieux (cf. phase 4) — mais il s'écarte de la
donnée, il ne doit donc pas être le choix par défaut.

### Point 2 — Parole : voie B d'office

Clip Grok muet → voix ElevenLabs de la fiche personnage → `veed/lipsync` → remux de l'audio
original intégral. La voie A (Grok génère la parole) est écartée malgré sa validité linguistique
prouvée : elle ne garantit pas la même voix d'un plan ni d'un épisode à l'autre.

### Point 3 — Voix par personnage (IDs ElevenLabs, tous vérifiés le 01/09)

| Rôle | ID | Débit mesuré | atempo pour viser 158 |
|---|---|---|---|
| **Aminata** (protagoniste) | `obmcfXCePmPgsNsLIWIj` | 175 mots/min | **0,90** |
| ~~Antagoniste~~ ⚠ | `nr2EGJNe96rzn9FRlTId` | 187 | — |
| **Conteur** (voix off) | `592QbnMQfByEAOJe8maw` | 191 | **0,83** |

⚠ **`nr2EGJNe96rzn9FRlTId` est une voix d'HOMME** (vérifié à l'écoute le 01/09). Je l'avais
classée « femme » par déduction depuis le rôle d'antagoniste — une supposition, et elle était
fausse. Elle est renommée « Voix grave » dans la bibliothèque et reste disponible pour un
personnage masculin. **Une voix féminine reste à choisir pour l'antagoniste.**

**Règle : ne jamais déduire le genre d'une voix de son rôle ni de son nom.** L'API ne l'expose
pas ; il se constate à l'écoute, et la fiche doit être corrigeable dans l'interface.

Voix proposées en complément, retenues sur le seul critère du débit (elles tombent dans la cible
156-161 **sans aucun atempo**, ce qui évite toute altération du timbre) :

| Voix | Débit | atempo |
|---|---|---|
| **Charlotte** (F) | 159 mots/min | aucun |
| **George** (H) | 167 | aucun (ou 0,95) |
| Daniel (H) | 172 | 0,92 |
| Brian (H) | 177 | 0,89 |

### ⚠ Correction de la phase 3 : l'atempo est une propriété de LA VOIX

En phase 3 j'avais conclu « atempo ≈ 1,0 ». C'était vrai pour Charlotte et George, faux pour les
voix retenues, qui tournent à 175-191 mots/min. **La fiche personnage doit donc porter son propre
atempo**, calculé une fois à l'ajout de la voix (`atempo = 158 / débit_mesuré`), pas un réglage
global de la machine. Mesurer le débit d'une voix à son enregistrement est une étape du wizard.

---

## ⚠ Le débit d'une voix n'est pas une constante (mesuré le 1er septembre)

En construisant la bibliothèque de voix, une mesure a invalidé une hypothèse posée plus haut
dans ce document.

**Trois synthèses de la MÊME phrase par la MÊME voix :**

| Voix | Mesures | Écart |
|---|---|---|
| Aminata (ElevenLabs) | 130 / 147 / 148 | **14 %** |
| Mila (ElevenLabs) | 162 / 160 / 145 | **12 %** |
| Conteur (ElevenLabs) | 162 / 163 / 140 | **16 %** |
| Hélène (**Inworld**) | 152 / 147 / 169 | **15 %** |

Le phénomène n'est donc pas propre à ElevenLabs v3 : **Inworld varie autant**. Un débit mesuré
une fois est du bruit — et les valeurs annoncées plus haut dans ce document (Aminata 175,
Antagoniste 188, Conteur 191) étaient des mesures uniques, donc peu fiables. Les valeurs
retenues sont désormais des **médianes de 3**, stockées avec leur écart.

### Trois conséquences pour toute machine

1. **Le débit sert à CHOISIR une voix, jamais à PRÉDIRE une durée.**
2. **Un atempo par voix reste utile** (rapprocher une voix trop rapide de la cible), mais il ne
   garantit aucune durée : c'est un réglage de confort d'écoute, pas de montage.
3. **Aucun montage ne doit être calculé depuis un débit attendu.** On synthétise, on sonde le
   fichier obtenu (`ffprobe`), on cale la vidéo dessus. C'est déjà la règle d'or du journal des
   machines ; ceci en donne enfin la raison chiffrée — et explique pourquoi la phase 3 avait dû
   ralentir 4 clips sur 5.

Cela corrige la section « Décisions arrêtées » : le tableau d'atempo par personnage y reste
valable comme ordre de grandeur, pas comme constante de production.

## Bibliothèque de voix partagée (`lib/voices.js`)

Nouvelle brique **générique**, hors machine : trois machines ont besoin d'une voix (Bouddhisme
une par run, Linguistique une par personnage, Drama une par personnage récurrent) — dupliquer la
table trois fois, c'est trois divergences.

- `data/voices.json` + échantillon audio par voix dans `output/voices/`
- API : `GET/POST /api/voices`, `GET /api/voices/:id/sample`, `POST /:id/refresh`, `PATCH`, `DELETE`
- Page **🎙 Voix** : écoute, renommage, genre, débit + atempo pour la cible choisie, ajout par ID
- `engineRef()` centralise LE piège : Inworld veut `"Alain (fr)"`, ElevenLabs veut un nom ou un ID
- 11 voix enregistrées (7 ElevenLabs, 4 Inworld)

Le sélecteur de voix par personnage de la future machine drama consommera `GET /api/voices` :
il aura le menu déroulant et l'écoute sans code supplémentaire.

---

## Phase 6 — deux personnages et dialogue (1er septembre) : dernier verrou levé

Le seul test restant qui pouvait encore changer l'architecture de la machine.
`agent-os/output/prototype-drama/dialogue/` — `dialogue.mp4`, 6,08 s.

### ✅ Deux identités tiennent dans la même image

Plan A : `gpt-image-2-image-to-image` avec **deux références** (`input_urls`) rend les deux
personnages sans aucune fusion — l'antagoniste garde son carré argenté, son visage anguleux et
son tailleur crème ; Aminata garde son afro, **son bandeau rouge** et son uniforme. La mise en
scène à deux personnages est donc possible : la machine n'a pas besoin de changer de structure.

À noter : le bandeau rouge est réapparu alors que le prompt du plan A ne disait pas un mot de sa
coiffure. L'ancrage par accessoire distinctif tient même quand deux références se disputent
l'image.

### ⚠ Le lipsync impose la grammaire du champ-contrechamp

| Plan | Cadrage | Lipsync |
|---|---|---|
| seg-A — plan à deux | antagoniste de **3/4 dos**, plan large | **NUL — la bouche ne bouge pas du tout** |
| seg-B — contrechamp | Aminata **quasi frontale**, plan rapproché | **net** — articulation visible et lisible |

**Correction (constatée par l'utilisateur à l'écoute).** J'avais d'abord écrit « faible,
variation à peine perceptible » sur seg-A d'après une bande d'images fixes. C'est faux : à la
lecture vidéo, la bouche de l'antagoniste **ne bouge pas du tout**. Troisième lecture erronée de
suite sur ce même point — deux mesures automatiques fausses, puis une lecture visuelle trop
indulgente. **Un lipsync se juge en lecture, pas sur des images fixes.**

**Règle de production, en conséquence : une réplique EXIGE un plan rapproché quasi frontal.**
Ce n'est pas une préférence esthétique mais une contrainte technique — hors de ce cadrage,
`veed/lipsync` ne produit rien. Le plan large à deux sert à établir la tension, jamais à porter
du dialogue. La contrainte technique rejoint ici la grammaire classique du champ-contrechamp,
qui est aussi celle des chaînes de la niche.

Conséquence pour la machine : le schéma de scène doit porter un champ `speaker`, et le générateur
de prompts doit imposer un cadrage rapproché frontal dès qu'un plan porte une réplique.

### Méthode : deux mesures automatiques fausses avant de trancher à l'œil

Tentative 1 (`signalstats` après `tblend`) : zéro partout, y compris sur un plan qui bouge
manifestement — extraction de métadonnées mal écrite. Tentative 2 (différence de pixels bruts) :
des chiffres plausibles… mais le rendu des zones de recadrage a montré qu'elles tombaient sur du
menton, du cou et du fond, pas sur les bouches. **Les deux séries de chiffres ont été jetées.**

La question a été tranchée par une bande de 5 images consécutives par visage, recadrées large.
**Leçon générale : rendre visible la zone qu'on mesure AVANT de croire la mesure.** Un chiffre
plausible issu d'une zone fausse est plus dangereux qu'une absence de mesure.

### Robustesse : trois échecs, trois durcissements

1. **`input_urls` invalide** (`[undefined, "..."]`) — `phase1.json` avait perdu `refUrl` lors de
   sa régénération en phase 3. → garde `mustBeUrls()` qui refuse AVANT de payer.
2. **Relance inutile sur erreur déterministe** — `kieRetry` a rejoué deux fois une requête
   malformée. → il ne relance plus si le message contient `must be / invalid / required /
   not found`. **À porter dans `genWithRetry` du squelette.**
3. **Drive renvoie du HTML quand il throttle** — `google.driveUpload` fait `.json()` dessus,
   d'où un « Unexpected token '<' » illisible. → `pub()` relance 3 fois avec palier croissant et
   rend un message explicite. **`lib/google.js` doit être durci de la même façon** : toutes les
   machines uploadent avant chaque appel Grok ; sur 60 plans, un throttle casserait un run entier
   avec un message incompréhensible.

À chaque échec, la relance n'a rien repayé : les fichiers déjà produits sont réutilisés depuis le
disque. C'est exactement la propriété de reprise attendue d'une machine.

### Verdict

**Plus aucun risque technique inconnu.** Les deux dernières inconnues — rythme de plan et
répartition animé/fixe du mode mixte — sont des mesures à faire sur les vidéos sources, réalisables
pendant la construction.
