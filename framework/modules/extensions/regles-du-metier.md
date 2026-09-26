# Module : regles-du-metier
> Catégorie : extensions
> Version : 1.0.0
> Requiert : —
> Incompatible avec : —
> Complète bien : milestone-reviews, typed-escalation, direct-spawn, unites-indexees

## Constat

Une instance qui produit un artefact (film, document, code, données livrés à un tiers) connaît le
contrat HOLARCH, pas le métier de son commanditaire. Dans la mission de montage vidéo qui a fait
naître ce module (`docs/diagnostics/2026-09-20-retex-montage-video-pacs.md`), les règles du métier —
trente règles et un contrôle qualité mécanique — sont apparues 3 h 18 après le lancement, sur
demande du mainteneur ; une seule règle de savoir public (l'image clé est le premier photogramme
d'un clip, pas son résumé) a coûté environ 15 USD de clips régénérés. Rien dans le catalogue ne
demandait à une instance de se spécialiser **avant** de produire, ni à son parent de relire cette
spécialisation. Ce module l'exige : un fichier de règles écrit à `ON_ORIENT`, relu comme un jalon
(J0) avant la première unité de production, cité par numéro à la livraison, enrichi à chaque
session. Sa maxime vient du fichier de la mission pacs : une règle qu'on ne peut pas vérifier n'est
pas une règle, c'est un vœu.

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|
| fichier_regles | REGLES-OR.md | Nom du fichier de règles, écrit à la racine de l'instance (`mission/<chemin>/`) et publié sous `shared/<chemin>/`. |
| jalon_regles | J0 | Identifiant du jalon porté par le `DELIVERABLE` du fichier de règles (champ `ref`). |
| rep_verificateurs | verificateurs | Sous-répertoire de `shared/<chemin>/` où l'instance livre ses vérificateurs mécaniques (chacun avec `--help`). |

## Règles injectées

### ⚓ ON_ORIENT
Si ton `ROLE.md` (`OBJECTIVE.md` pour la racine) déclare au moins un livrable **artefact** — fichier
produit pour un tiers (film, document, code, données), pas un message ni un fichier d'instance —,
écris avant ta première unité de production `mission/<ton chemin>/<fichier_regles>` : règles
numérotées, chacune vérifiable (une règle invérifiable va au point 4, c'est un vœu) :
1. **Le bon livrable vu du commanditaire** : ses mots et ses références, cités depuis le brief, pas
   reformulés en tes critères.
2. **Contrôles mesurables** : commande, seuil, code attendu ; quand c'est possible, un vérificateur
   mécanique livré sous `shared/<ton chemin>/<rep_verificateurs>/`, avec `--help`.
3. **Pièges connus** des outils et services que tu vas employer (limites, coûts, modération,
   formats), tirés des kits attachés et de ta veille, chacun avec sa source.
4. **Ce que tu ne sais pas encore**, et l'échantillon sur lequel tu le vérifieras avant de produire
   en série.

Kits : l'`INDEX.md` de chaque kit nommé par la ligne « Kits » de ton Contexte hérité est déjà dans
ton prompt (bloc `<kits>`) ; lis les pièces que ton plan cite, une à une, jamais tout le kit. Veille :
si ta fiche registre porte une ligne `Veille`, écris d'abord la fiche d'unité **U0 « état de
l'art »** (sources lues, ce qu'elles changent au plan, ce qui entre au point 3), dans la limite de
lectures déclarée ; au-delà, arrête-toi et dis-le.

Publie le fichier sous `shared/<ton chemin>/` et adresse à ton parent un `DELIVERABLE` de
`ref: <jalon_regles>` (section « Contrôles » : les commandes du point 2 déjà exécutables, avec leur
code). La préparation (lectures, échantillon) continue sans attendre ; la production ne commence
qu'après sa `RESPONSE` ou, sans réponse sous `delai_reponse` (`typed-escalation`), en le consignant
dans `JOURNAL.md`.

### ⚓ ON_CHILD_DONE
Un `DELIVERABLE` de `ref: <jalon_regles>` se relit sur pièces avant toute autre revue de l'enfant :
règle contradictoire avec le brief ou son `ROLE.md`, contrôle non exécutable (rejoue-le), mot du
commanditaire absent. Réponds dans la session, par `RESPONSE` (accepté) ou `TASK` correctif : sans
réponse sous `delai_reponse`, l'enfant produit sans toi.

### ⚓ ON_DELIVER
Chaque `DELIVERABLE` d'artefact cite, dans sa section « Contrôles », les numéros des règles vérifiées
à côté de la commande qui les vérifie, et liste à part les règles non vérifiées avec leur motif. Une
règle violée sciemment est déclarée, jamais tue. `deliver-guard` n'en lit rien de plus : la colonne
« Contrôle » de ton `ROLE.md` reste ce que ton parent rejoue.

### ⚓ ON_SLEEP
Toute règle découverte pendant la session (échec mesuré, coût imprévu, piège d'un service) s'ajoute
en fin de `<fichier_regles>`, datée (`date -u`) et sourcée — append-only : une règle devenue fausse
est révoquée par une nouvelle entrée qui la cite, jamais réécrite. Republie la copie sous
`shared/<ton chemin>/`. Ton rapport final propose ces règles au kit du domaine, sans écrire sous
`framework/kits/` (geste du mainteneur).

## Ce que ce module ne fait pas

Il ne modifie ni `deliver-guard` ni la forme d'un `DELIVERABLE` : les numéros de règles vivent dans la
section « Contrôles » existante, et c'est toujours la colonne « Contrôle » du `ROLE.md`, posée par le
parent, qui décide de ce qui est rejoué à `--controle`. Il ne bloque pas la production faute de
réponse au jalon J0 : l'attente est bornée par `delai_reponse`, comme toute `CLARIFICATION`. Il ne
s'applique pas à une instance dont les livrables ne sont que des messages ou des fichiers d'instance
(un coordinateur pur n'a pas de métier à écrire). Il ne fournit pas les règles lui-même : les kits de
domaine (`framework/kits/<domaine>/`) et la veille bornée (`direct-spawn`, ligne `Veille`) en sont les
sources, et il ne garantit pas qu'une règle soit juste — seulement qu'elle soit écrite, vérifiable,
relue et citée. Il n'écrit jamais dans un kit : verser des règles au kit reste une proposition.
