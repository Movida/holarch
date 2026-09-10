# Module : git-branches
> Catégorie : extensions
> Version : 1.0.0
> Requiert : —
> Incompatible avec : —
> Complète bien : direct-spawn, dependency-graph, fork-join, sharded-files, graveyard-handover

## Constat

Sans ce module, toute instance commit dans `mission/` sur la branche courante à chaque fin de session (KERNEL §2, phase 9) : avec `direct-spawn` strictement séquentiel, tout le monde commit en pratique sur la même branche, l'une après l'autre. C'est déjà un historique complet et audité, mais plat — un `DELIVERABLE` accepté et un `DELIVERABLE` finalement rejeté après plusieurs corrections se mêlent dans la même suite de commits, sans marqueur visible de la décision de revue elle-même.

Le principe de ce module tient en une phrase : **une branche ne fusionne dans sa branche parente que sur le verdict du propriétaire de celle-ci.** Le parent est propriétaire de la branche de chacun de ses enfants directs ; l'utilisateur humain est propriétaire de la branche racine (celle déjà extraite au moment du `--bootstrap`, typiquement `main`). Partout dans la hiérarchie, ce propriétaire est le parent : le devoir de supervision qu'il porte déjà (KERNEL §5.2 — vérifier un livrable avant de l'intégrer) se matérialise simplement par le commit de fusion lui-même, sans rien bloquer de nouveau. Ce module ne prescrit rien au-delà de la mission : ce qui se passe quand la branche de l'instance racine doit à son tour rejoindre `main` — revue humaine, pull request ou autre — reste un geste du mainteneur, hors périmètre de toute instance et de ce module (voir « Ce que ce module ne fait pas »).

Ce module ne s'occupe que de la politique de branches : le format des fiches registre, lui, reste entièrement celui du module `registre` actif (`sharded-files` ou équivalent) — les deux préoccupations sont orthogonales, d'où son rattachement à la catégorie `extensions` plutôt que `registre`.

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|
| prefixe_branche | holarch/ | Préfixe des branches d'instance. Nom complet d'une branche : `<prefixe_branche><chemin-avec-tirets>` — même convention de nommage que la fiche registre (spec §11). |
| supprimer_apres_fusion | oui | Si oui, supprime (`git branch -d`, jamais `-D`) la branche d'un enfant immédiatement après sa fusion réussie. Sans risque de perte : `-d` refuse mécaniquement toute branche pas entièrement fusionnée dans celle sur laquelle tu te trouves. |

## Règles injectées

### ⚓ ON_WAKE
Si tu n'es pas l'instance racine, ta propre branche est `<prefixe_branche><ton-chemin-avec-tirets>`. Vérifie `git branch --show-current` : le résultat doit être soit ta propre branche, soit la branche d'un enfant dont tu n'as pas encore conclu la revue (`ON_CHILD_DONE` non résolu à ta session précédente — cas normal si ta session a hiberné en cours de supervision). Toute autre valeur signale un enchaînement anormal (bascule oubliée, intervention manuelle) : traite-le comme une anomalie du registre, envoie une `ALERT` à ton parent avant de continuer, ne fusionne ni ne commite rien tant que ce n'est pas résolu.

### ⚓ ON_SPAWN
Avant de créer la première branche d'enfant de cette session, assure-toi que ta propre branche est propre (`git status --porcelain` vide) : si elle ne l'est pas, commit d'abord ton propre travail en attente (jamais de bascule de branche avec des modifications non commitées — elles suivraient sur la branche de l'enfant et la pollueraient).

Pour chaque enfant que tu crées, une fois ta branche propre : `git switch -c <prefixe_branche><chemin-enfant-avec-tirets>` à partir de ta branche courante (ta propre branche — jamais celle d'un autre enfant), puis applique sur cette nouvelle branche la mécanique structurelle invariante du spawn (KERNEL §9, y compris son commit `[<chemin-parent>] spawn <nom-role>`, qui devient ainsi le premier commit de la branche de l'enfant). Reviens ensuite sur ta propre branche (`git switch <ta-branche>`) avant de créer, le cas échéant, la branche de l'enfant suivant — chaque branche d'enfant part ainsi du même point, ta propre branche au moment du spawn, jamais d'une branche sœur.

### ⚓ ON_SUPERVISE
Avant d'incarner un enfant donné (lancement du module d'orchestration actif), vérifie que tu es bien positionné sur sa branche (créée à `ON_SPAWN`) — bascule si besoin. Reste sur cette branche pour toute la durée de sa supervision, y compris à travers plusieurs relances (`TASK` correctif, nouvelle session de l'enfant) : ne reviens sur ta propre branche qu'une fois sa revue conclue par une fusion (voir `ON_CHILD_DONE`). Si le module de synchronisation actif te fait superviser plusieurs enfants en parallèle logique (ex. lots de `dependency-graph`), traite-les un par un du point de vue des branches : jamais deux enfants incarnés avec la même branche courante en même temps.

### ⚓ ON_CHILD_DONE
Conclus d'abord la vérification du livrable comme le prescrit le KERNEL (§5.3.2) et le reste de ta configuration active, puis :
- **Livrable accepté** : reviens sur ta propre branche (`git switch <ta-branche>`), puis `git merge --no-ff <prefixe_branche><chemin-enfant-avec-tirets> -m "review(accept): <chemin-enfant> — <résumé du livrable en une ligne>"`. Ce commit de fusion explicite EST l'artefact de revue — ta branche restant immobile pendant tout le travail de l'enfant (orchestration séquentielle), une fusion en avance rapide (fast-forward) redonnerait l'historique plat qu'on cherche justement à dépasser : `--no-ff` n'est pas optionnel. En cas de conflit de fusion (improbable : chaque enfant ne touche que son propre sous-arbre et sa propre fiche registre — KERNEL §4) que tu ne peux résoudre seul avec certitude, `git merge --abort` et envoie une `ALERT` à ton propre parent plutôt que de trancher au hasard. Si `supprimer_apres_fusion` vaut oui, supprime ensuite la branche de l'enfant (`git branch -d`).
- **Livrable renvoyé avec `TASK` correctif** : ne fusionne rien. Reste sur la branche de l'enfant (elle continuera de recevoir ses commits à sa prochaine session) et poursuis la supervision normalement.
- **Instance abandonnée (`FAILED`, archivée sans intégration — état `ARCHIVED`, KERNEL §3, module `graveyard-handover`)** : reviens sur ta propre branche sans fusionner. La branche de l'enfant n'est ni fusionnée ni supprimée, quel que soit `supprimer_apres_fusion` (qui ne s'applique qu'après une fusion réussie) : elle reste, comme la fiche registre archivée, une trace consultable plutôt qu'effacée (devoir de traçabilité, KERNEL §5.6). Un recadrage (KERNEL §10) qui respawn une instance corrigée reparts normalement d'`ON_SPAWN` : la nouvelle branche part de ta branche courante, qui ne contient pas le travail abandonné.

## Ce que ce module ne fait pas

Il ne pousse jamais rien vers un remote (`origin` ou autre) et n'utilise ni `git push` ni aucun outil de pull request : chaque branche et chaque fusion restent locales au dépôt de la mission. Une synchronisation distante, si un jour désirée, est une préoccupation séparée (sauvegarde/visibilité), pas une condition de fusion — un module dédié à ce sujet ne devrait pas supposer qu'un remote existe. Il ne modifie ni ne remplace le format de fiche du module `registre` actif : seule la politique de branches change. Il ne fusionne jamais automatiquement la branche de l'instance racine dans `main` (ou toute branche préexistante au `--bootstrap`) : aucune instance n'est propriétaire de cette branche, ce geste appartient entièrement au mainteneur humain, en dehors de toute mission — c'est là, et seulement là, que « fusion = revue » se lit au sens littéral d'une revue humaine, sans qu'aucune session ne reste bloquée en attente : le geste intervient une fois la mission déjà terminée, jamais au milieu d'une supervision en cours. Il ne renomme ni ne réécrit aucune branche existante (pas de `git branch -m`, pas de `--force` sur quoi que ce soit).
