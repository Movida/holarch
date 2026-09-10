# Module : unites-indexees
> Catégorie : memoire
> Version : 1.0.0
> Requiert : —
> Incompatible avec : monolithic, journal-synthesis
> Complète bien : heartbeat-log, context-budget, direct-spawn

## Constat

`monolithic` et `journal-synthesis` réécrivent `MEMORY.md` en bloc à `ON_SLEEP` : sans borne sur sa
taille, ni sur celle de `JOURNAL.md`, le réveil d'une instance longue finit par ré-injecter des
dizaines de milliers de caractères de contexte fixe avant toute écriture de livrable (diagnostic
`docs/diagnostics/2026-09-09-contexte-fixe-au-reveil.md`). Ce module remplace la mémoire monolithique
par des fiches d'unité de travail numérotées, immuables une fois écrites, indexées par le lanceur
dans `memoire/INDEX.md` — `MEMORY.md` ne porte plus que la synthèse courante, bornée.

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|
| memoire_max_lignes | 60 | Lignes maximales de `MEMORY.md` hors titres de section. |
| unite_max_lignes | 40 | Lignes maximales du corps d'une fiche d'unité. |
| journal_entree_max_lignes | 10 | Lignes maximales d'une entrée de `JOURNAL.md`. |
| ligne_max_chars | 200 | Longueur maximale d'une ligne dans `MEMORY.md`, `JOURNAL.md`, `PROGRESS.md` et les fiches d'unité (une ligne = une idée ; les paragraphes longs saturent le réveil, diagnostic 2026-09-09). |

## Règles injectées

### ⚓ ON_ORIENT
Le plan de session est une liste de 1 à 3 unités de travail, chacune avec un identifiant `U<n>`
(n = 1 + le plus grand n existant dans `memoire/`), un critère de fin vérifiable en une ligne et une
preuve attendue. Consigne ce plan dans `JOURNAL.md`, en une entrée ≤ `journal_entree_max_lignes`.

### ⚓ ON_SUPERVISE
À l'achèvement de chaque unité (réussie, échouée ou partielle), écris la fiche
`mission/<ton chemin>/memoire/U<n>-<slug>.md` depuis `framework/templates/UNITE.template.md`, corps
≤ `unite_max_lignes`, puis committe (`[<chemin>] U<n> : <résumé>`). Ne réécris jamais une fiche
existante : une reprise d'une unité déjà consignée produit `U<n>b`, `U<n>c`, jamais une modification
de la fiche `U<n>` d'origine — même garantie de traçabilité que le recadrage du KERNEL (§10).

### ⚓ ON_SLEEP
Réécris `MEMORY.md` intégralement (remplacement complet), sous ses quatre sections obligatoires, le
tout ≤ `memoire_max_lignes` :
- « État courant » (≤ 15 lignes) ;
- « Décisions prises » : une ligne par décision encore active, chacune avec un pointeur
  `→ memoire/U<n>-….md` vers la fiche qui la justifie ;
- « Prochaines actions » : liste ordonnée, chaque ligne commence par l'identifiant de la prochaine
  unité prévue (`U<n>`) ;
- « Points de vigilance ».

Ajoute une entrée de `JOURNAL.md` ≤ `journal_entree_max_lignes`. Le lanceur régénère
`memoire/INDEX.md` à partir des fiches présentes : ne l'écris jamais toi-même.

### ⚓ ON_WAKE
Le prompt injecté par le lanceur contient déjà `MEMORY.md`, `memoire/INDEX.md` et le bloc `<reveil>`.
Ne relis une fiche d'unité (`memoire/U<n>-….md`) que lorsqu'une décision ou une preuve précise et
non résumée dans `MEMORY.md`/`INDEX.md` t'est nécessaire — jamais par anticipation, jamais toutes.

## Ce que ce module ne fait pas

Il ne remplace pas `heartbeat-log` : les fiches d'unité sont des synthèses relisibles écrites au
terme d'une unité de travail, pas un flux d'événements mécaniques ligne par ligne — les deux modules
coexistent sans redondance, chacun sur son registre. Il n'impose rien au format des livrables publiés
dans `shared/` : la structure en fiches n'est qu'un mécanisme de mémoire interne à l'instance.
