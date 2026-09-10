# Module : max-depth
> Catégorie : recursion
> Version : 1.0.0
> Requiert : —
> Incompatible avec : —
> Complète bien : self-assessment, instance-budget

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|
| profondeur_max | 3 | Profondeur maximale autorisée pour une instance (concepteur = 1). |

## Règles injectées

### ⚓ ON_PLAN
Calcule ta profondeur (nombre de segments de ton chemin depuis `mission/`). Si ta profondeur est déjà ≥ `profondeur_max`, le spawn est **interdit**, sans exception : tu dois faire le travail toi-même, ou émettre un `BLOCKER` motivé vers ton parent si tu ne peux manifestement pas l'accomplir seul dans le temps d'une session.

Ce plafond est un fusible contre l'explosion incontrôlée de la holarchie (spec §12) — ne le contourne jamais, même si la décomposition te semble par ailleurs justifiée par les autres modules de récursion actifs.
