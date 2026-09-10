# Module : graveyard-handover
> Catégorie : conflits
> Version : 1.0.0
> Requiert : —
> Incompatible avec : —
> Complète bien : typed-escalation

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|

## Règles injectées

### ⚓ ON_CHILD_DONE
Quand un enfant atteint `DELIVERED` et que son livrable est accepté, ou qu'il est déclaré `FAILED` et abandonné, archive-le :

1. Avant de déplacer quoi que ce soit, rédige toi-même (le parent, jamais l'enfant) un `HANDOVER.md` dans le répertoire de l'enfant : ce qui a été livré ou non, ce qui est réutilisable dans son `workspace/` pour une éventuelle instance de remplacement, et pourquoi l'archivage a lieu maintenant.
2. Déplace l'intégralité du répertoire de l'enfant vers `mission/graveyard/<chemin>/` — ne supprime jamais son contenu, y compris en cas d'échec.
3. Fais passer sa fiche `registry/instances/<chemin>.md` à l'état `ARCHIVED` (elle n'est **jamais** supprimée du registre, seule l'instance elle-même déménage).
4. Mets à jour `registry/ORG.md` pour refléter l'archivage.
5. Si l'archivage fait suite à un recadrage (KERNEL §10b), la nouvelle instance de remplacement doit lire le `HANDOVER.md` de l'archivée lors de son propre `ON_WAKE` pour hériter du contexte réutilisable — référence-le explicitement dans le `ROLE.md` de la nouvelle instance, section Contexte hérité.
