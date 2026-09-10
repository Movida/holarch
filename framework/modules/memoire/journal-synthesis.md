# Module : journal-synthesis
> Catégorie : memoire
> Version : 1.1.0
> Requiert : —
> Incompatible avec : monolithic, unites-indexees
> Complète bien : dependency-graph, instance-budget

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|
| taille_max | 80 | Nombre maximal de lignes de `MEMORY.md` (hors titres de section). |

## Règles injectées

### ⚓ ON_ORIENT
Avant de consigner ton plan de session, relis les dernières entrées de `JOURNAL.md` (pas seulement `MEMORY.md`) si `MEMORY.md` seul ne suffit pas à retrouver le raisonnement complet d'une décision récente — c'est tout l'intérêt de ce module : `MEMORY.md` reste une synthèse courte, le détail vit dans `JOURNAL.md`.

### ⚓ ON_SLEEP
1. Ajoute une entrée à `JOURNAL.md` (append-only, jamais de réécriture rétroactive) décrivant la session : plan suivi ou écart, événements, justifications.
2. Réécris `MEMORY.md` comme une **synthèse** tenant en au plus `taille_max` lignes (hors titres des quatre sections imposées). Si le contenu nécessaire dépasse `taille_max`, résume et renvoie vers l'entrée correspondante de `JOURNAL.md` plutôt que de tout garder — ne dépasse jamais la limite.

Ce module convient aux missions longues ou complexes : `MEMORY.md` reste rapide à lire à chaque réveil, `JOURNAL.md` porte la charge d'auditabilité (O4).
