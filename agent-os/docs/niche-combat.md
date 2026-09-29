# Niche « affrontement impossible » — Cage Fiction (mesurée le 8 septembre 2026)

Chaîne signalée : [@CageFiction](https://www.youtube.com/@CageFiction) — FR, 40 000 abonnés,
17,3 M de vues, 125 vidéos depuis juin 2023.

## Ce que la chaîne fait vraiment

Sa description est explicite : *« Testing the limits of current AI to make the coolest content
linked to combat sports »*. C'est donc **génératif**, pas un mirage de capture de jeu.

⚠ **Sur 125 vidéos, 26 seulement sont des formats longs.** Les 99 Shorts font 16 000 vues
médianes contre **237 000** pour les longues — un rapport de quinze. Ne pas se laisser tromper
par le nombre de publications.

| vues | durée | titre |
|---|---|---|
| 2 303 134 | 2 min | What If Rasputin Fought the UFC's Best Russians |
| 1 772 783 | 3 min | Brock Lesnar vs Gollum |
| 895 659 | 2 min | Michael Jackson vs Michael Chandler |
| 702 021 | 4 min | Justin Gaethje vs every evil of Middle Earth |
| 633 280 | 14 min | What If the World Cup was fought in the UFC |

## ⛔ Pourquoi la niche N'EST PAS qualifiée

**1. Le format repose sur des personnes réelles.** Les combattants sont des sportifs vivants et
identifiables (Jon Jones, McGregor, Ngannou, Lesnar), dans des scènes de violence fictives, sous
marque UFC. Exposition au droit à l'image, indépendante du droit d'auteur.

**2. 17 % des titres empruntent une IP tierce** — Gollum, Star Wars, The Boys, House of the
Dragon, la Communauté de l'Anneau — et ce sont ses plus gros succès après le premier. Même motif
que les fausses suites de films écartées dans la niche des contes : **ce qui fait le succès est
ce qu'une machine ne devrait pas industrialiser.**

**3. La variante SANS personne réelle ni IP n'est pas démontrée.** Mesurée sur deux recherches
(500 vidéos) : les seules chaînes au format sont des **captures de jeux de simulation**
(Ultimate Epic Battle Simulator, TABS, Animal Revolt, mods God of War) — irreproductibles par
une machine générative. Percée réelle 3,4 % puis 0,9 %.

⚠ **J'ai proposé cette variante AVANT de la mesurer**, en m'appuyant sur un seul point : le
succès de « Rasputin » (2,3 M, personnage historique, libre de droits). La mesure ne la valide
pas. Un seul exemple, à l'intérieur d'une chaîne dont l'audience est venue pour de vrais
combattants, n'est pas une niche — c'est le piège « aucun exemple = signal, pas terrain vierge »
que ce skill énonce déjà.

## ✅ Ce que le prototype a prouvé — et qui vaut pour D'AUTRES machines

Le point dur du format est de faire coexister **deux personnages en contact physique** dans un
même plan. L'Œil relève que Cage Fiction lui-même n'y arrive pas : impacts glissants, corps qui
se traversent, coupes de 2-4 s pour masquer.

**Notre chaîne y arrive.** Prototype à **0,18 $** (`scripts/prototype-combat/duel.js`), avec deux
archétypes inventés — aucune personne réelle, aucune marque :
- une fiche de référence par combattant (texte → image) ;
- les deux dans le MÊME plan par i2i à **deux références**, en prise réelle : corps qui se
  touchent, poids transféré, appuis au sol ;
- animation seedance 6 s : le contact TIENT — prise debout, passage au sol, contrôle maintenu,
  sans glissement ni interpénétration.

**Cette capacité est réutilisable telle quelle par la machine Drama**, où le champ-contrechamp
avait été choisi pour CONTOURNER ce problème plutôt que le résoudre.

## Verdict

**Niche : non.** Le format prouvé dépend de ce qu'on ne veut pas industrialiser ; sa variante
propre n'existe nulle part.
**Capacité technique : oui, et acquise.** Le duo en contact est résolu, et sert ailleurs.
