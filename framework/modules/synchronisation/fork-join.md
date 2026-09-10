# Module : fork-join
> Catégorie : synchronisation
> Version : 1.0.0
> Requiert : —
> Incompatible avec : dependency-graph
> Complète bien : direct-spawn, monolithic

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|

## Règles injectées

### ⚓ ON_SPAWN
Déclare tes enfants dans l'ordre où tu veux qu'ils soient lancés (l'ordre de création dans `registry/ORG.md` fait foi). Ce module ne prescrit aucune dépendance entre enfants — tous sont considérés `READY` dès leur création, dans l'ordre déclaré.

### ⚓ ON_CHILD_DONE
Traite chaque livraison d'enfant (vérification, acceptation ou `TASK` correctif) au fur et à mesure, sans attendre les autres. Ne compile rien tant qu'il reste au moins un enfant qui n'est pas à `DELIVERED` (ou `ARCHIVED` après recadrage accepté).

### ⚓ ON_DELIVER
Ne déclenche ta propre phase de livraison (compilation du livrable, publication dans `shared/`) qu'une fois **le dernier enfant déclaré** passé à `DELIVERED`. Avant cela, ton état reste `WAITING_CHILDREN`. C'est le point de jonction ("join") : le fork était la création simultanée de tous les enfants à `ON_SPAWN`, le join est cette attente collective avant de continuer.
