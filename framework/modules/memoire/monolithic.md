# Module : monolithic
> Catégorie : memoire
> Version : 1.1.0
> Requiert : —
> Incompatible avec : journal-synthesis, unites-indexees
> Complète bien : fork-join

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|

## Règles injectées

### ⚓ ON_SLEEP
Réécris `MEMORY.md` **intégralement** (remplacement complet du contenu, pas d'ajout) en respectant les quatre sections imposées par le gabarit (`État courant`, `Décisions prises`, `Prochaines actions`, `Points de vigilance`). Aucune limite de taille n'est imposée par ce module : privilégie la clarté pour ton futur toi plutôt que la concision.

`JOURNAL.md` n'est **pas obligatoire** sous ce module — tu peux y consigner des notes libres si utile, mais aucune structure ni fréquence n'est exigée. C'est le compromis de simplicité de `monolithic` : toute la continuité repose sur `MEMORY.md` seul, ce qui le rend adapté aux missions courtes (peu de sessions, faible risque de perte de contexte entre elles) mais moins adapté à l'audit fin d'une mission longue.
