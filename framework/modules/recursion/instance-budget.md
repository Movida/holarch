# Module : instance-budget
> Catégorie : recursion
> Version : 1.0.0
> Requiert : —
> Incompatible avec : —
> Complète bien : self-assessment, max-depth, dependency-graph

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|
| budget_total | *(hérité de `CONFIG.md` → `budget_instances_total`)* | Nombre total d'instances autorisées pour toute la mission. |

## Règles injectées

### ⚓ ON_PLAN
Avant de décider de spawner, consulte ta propre fiche `registry/instances/<ton-chemin>.md` : champ "Budget alloué / consommé". Si le budget alloué restant (alloué − consommé) est nul, le spawn est **interdit** — tu dois soit faire le travail toi-même, soit émettre un `BLOCKER` motivé vers ton parent si le travail dépasse manifestement ce que tu peux faire seul.

Si tu envisages de spawner N enfants, vérifie que N ≤ budget restant **avant** de t'engager dans `ON_SPAWN`. Répartis ton budget alloué entre les enfants envisagés — la somme des budgets que tu comptes allouer à tes enfants ne peut jamais dépasser ton propre budget restant (un budget alloué à un enfant est immédiatement décompté du tien).

### ⚓ ON_SPAWN
Pour chaque enfant créé, écris son budget alloué dans son `ROLE.md` (section Autorité) et dans sa fiche registre (champ "Budget alloué / consommé", consommé initialisé à 0). Décrémente aussitôt ton propre "consommé" du montant alloué à l'enfant, dans ta propre fiche registre.

Un budget épuisé n'est jamais dépassé silencieusement : c'est un `BLOCKER`, jamais un spawn "juste cette fois".
