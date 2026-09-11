# Module : sharded-files
> Catégorie : registre
> Version : 1.3.0
> Requiert : —
> Incompatible avec : —
> Complète bien : instance-budget, dependency-graph, direct-spawn, git-branches

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|

## Règles injectées

### ⚓ ON_WAKE
Le registre (`mission/registry/`) est en **lecture libre** pour toute instance : consulte `registry/ORG.md` et n'importe quelle fiche de `registry/instances/` si utile à ton orientation. Tu n'as cependant le droit d'**écrire** que sur ta propre fiche `registry/instances/<ton-chemin-avec-tirets>.md` — jamais sur celle d'une autre instance, y compris un enfant ou un frère.

### ⚓ ON_SPAWN
Pour chaque enfant créé, crée sa fiche `registry/instances/<chemin-avec-tirets>.md` avec la structure suivante, et remplis tous les champs connus à cet instant :

```markdown
# <chemin>
| Champ | Valeur |
|---|---|
| Rôle | <intitulé> |
| Parent | <ton chemin> |
| Statut | INIT |
| Budget alloué / consommé | <n> / 0 |
| Dépend de | <chemins déclarés, ou "—"> |
| Profil | <conception, execution, relecture ou exploration — politique de modèle du module d'orchestration> |
| Effort | <optionnel : low, medium, high, xhigh ou max, jugé pour la tâche (module d'orchestration) ; absent = effort par défaut du profil> |
| Livrables | <vide au départ> |
| Créée / Archivée | <ISO 8601> / — |
```

`registry/SESSIONS.md` est un flux append-only écrit par le lanceur (`framework/bin/holarch-spawn.js`) après chaque session : coût, tokens, tours, identifiant de session, état final. Lecture libre pour toute instance (bilan budget d'un rapport final, par exemple) ; **aucune instance n'y écrit**.

Mets ensuite à jour `registry/ORG.md` : c'est un arbre indenté de toutes les instances avec leur statut courant. Il est régénérable en parcourant `registry/instances/`, mais chaque parent le met à jour directement à chaque spawn ou archivage plutôt que de le régénérer entièrement, pour préserver la mise en forme.

`ORG.md` n'est **pas** un fichier `merge=union` (`.gitattributes`, `docs/IMPLEMENTATION.md` §4.3) : contrairement à `INBOX.md`/`OUTBOX.md`/`PROGRESS.md`/`SESSIONS.md`/`REVEILS.md`/`DECISIONS.md`, il est édité en place, pas en append. Si le module `git-branches` est actif avec `isolation = worktree`, seul le parent direct édite `ORG.md` pour ses propres enfants, et uniquement sur sa propre branche, après que la fusion de l'enfant a eu lieu — jamais dans le worktree d'un enfant, qui n'a d'ailleurs aucune raison d'y toucher (il ne connaît que sa propre fiche `registry/instances/`). Une modification concurrente d'`ORG.md` par deux parents distincts reste possible en théorie (deux branches parentes différentes) mais chacune ne touche que la portion de l'arbre relative à ses propres enfants : en cas de conflit malgré tout à la fusion, traite-le comme tout autre conflit non-`union` (`git-branches`, `ON_CHILD_DONE`) — jamais une résolution automatique.

### ⚓ ON_SLEEP
Avant de mourir, si ton statut, ton budget consommé, tes livrables ou ton régime (`Profil`/`Effort` — changement de régime décidé à `ON_PLAN`, module d'orchestration) ont changé pendant la session, mets à jour ta propre fiche registre en conséquence — c'est une conséquence directe du devoir de traçabilité (KERNEL §5.6), pas une étape optionnelle.

L'écriture exclusive par fiche (chacun n'écrit que la sienne) élimine par construction les conflits d'écriture concurrente sur le registre — combinée à Git, elle permet aussi la restauration en cas de corruption constatée (spec §12).
