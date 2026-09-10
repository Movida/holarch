# Module : heartbeat-log
> Catégorie : observabilite
> Version : 1.0.0
> Requiert : —
> Incompatible avec : —
> Complète bien : sharded-files, monolithic, journal-synthesis, instance-budget

## Constat

`MEMORY.md` (sous `monolithic`) et `JOURNAL.md` (sous `journal-synthesis`) sont tous deux écrits **en bloc, uniquement à `ON_SLEEP`** (KERNEL §2). Une session tuée avant d'y arriver — crash, timeout, arrêt manuel, panne de l'hôte — ne laisse donc aucune trace exploitable de ce qu'elle a fait : ni pour un observateur externe qui voudrait suivre l'avancement en direct, ni pour la session de reprise, qui ne trouve que l'état d'avant le début de la session tuée. C'est précisément le mode de défaillance que le test d'acceptation T4 (reprise après crash, spec §13) est censé vérifier.

Ce module n'existe que pour combler cet intervalle : entre le réveil et l'hibernation, pas seulement à ses deux bouts.

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|
| commit_par_checkpoint | oui | Si "oui", chaque checkpoint ci-dessous déclenche un commit Git immédiat, en plus du commit de fin de session déjà imposé par KERNEL §5.6. Si "non", les lignes sont écrites sur disque mais laissées non committées jusqu'à `ON_SLEEP` (rétrogradation partielle : survit à un crash de la session mais pas à une perte du répertoire de travail). |
| granularite | evenements-cles | `evenements-cles` : un checkpoint par hook listé ci-dessous. `supervise-fine` : ajoute aussi un checkpoint avant/après chaque unité de travail significative que tu t'es fixée pendant `ON_SUPERVISE` (à ton appréciation — ne pas fragmenter à l'excès). |

## Règles injectées

Chaque checkpoint ajoute **une ligne** à `mission/registry/PROGRESS.md` (append-only ; créer le fichier avec l'en-tête `# Avancement — mission <nom>` s'il n'existe pas encore), au format :

```
<ISO 8601> · <chemin instance> · <hook> · <résumé en une ligne>
```

Écriture en append pour toute instance sur ce fichier (extension du principe d'écriture exclusive-par-fiche de `sharded-files` à un flux partagé : chacun n'ajoute que ses propres lignes, ne modifie ni ne supprime jamais celles d'une autre instance).

### ⚓ ON_ORIENT
Checkpoint `ON_ORIENT` : une ligne résumant le plan de la session (en plus, pas à la place, de l'entrée `JOURNAL.md` déjà requise par le module mémoire actif si applicable).

### ⚓ ON_SPAWN
Un checkpoint `ON_SPAWN` par enfant créé : `spawn <nom-enfant> (budget <n>)`.

### ⚓ ON_CHILD_DONE
Un checkpoint `ON_CHILD_DONE` par livrable enfant traité : `<enfant> : accepté` ou `<enfant> : renvoyé (<motif court>)`.

### ⚓ ON_DELIVER
Checkpoint `ON_DELIVER` au moment de la publication du livrable : pointeur court vers `shared/<chemin>/`.

### ⚓ ON_SLEEP
Checkpoint `ON_SLEEP` de clôture : statut final (`DELIVERED`, `BLOCKED`, `FAILED`, …). Si `commit_par_checkpoint=oui`, ce n'est **pas** le premier commit du module pour cette session — chaque checkpoint précédent a déjà déclenché le sien. Committer uniquement à ce stade, comme si le module n'existait pas, annule son intérêt.

## Ce que ce module ne fait pas

Il ne remplace ni `MEMORY.md` ni `JOURNAL.md` : c'est un flux d'événements courts et mécaniques (une ligne, pas de raisonnement), pas une synthèse relisible pour reprendre le fil d'une décision — ce rôle reste celui du module mémoire actif. Il ne garantit pas non plus la reprise elle-même (quoi refaire, où en était-on précisément) : il garantit seulement qu'un observateur — humain ou instance de reprise — puisse **constater** qu'une session a existé, jusqu'où elle est allée, et à quel moment elle s'est tue, même quand `MEMORY.md` n'a pas pu être mis à jour.
