# Module : delegation-intra-session
> Catégorie : extensions
> Version : 1.0.0
> Requiert : unites-indexees
> Incompatible avec : —
> Complète bien : direct-spawn, context-budget, self-assessment

## Constat

Une instance travaille seule, à l'intérieur d'une même session : chaque lecture large, chaque
écriture de fichier, chaque exécution de tests s'accumule dans son propre contexte, alors que rien
de ce travail mécanique n'a besoin d'être vu par l'instance elle-même — seul le résultat vérifié
compte. `context-budget` mesure cette accumulation et déclenche l'hibernation quand elle dépasse un
seuil ; ce module attaque la cause plutôt que le symptôme, en déportant l'exécution des unités les
plus coûteuses en contexte vers un sous-agent jetable (outil `Agent`), pendant que l'instance ne garde
que ce que le KERNEL lui interdit de déléguer : ses décisions, ses messages, sa mémoire et ses
commits (KERNEL §1, §5.3).

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|
| sous_agent_modele | sonnet | Modèle du sous-agent `holarch-unite` lancé par l'instance pour une unité déléguée (outil `Agent`). |
| sous_agent_effort | medium | Effort du sous-agent `holarch-unite`. |
| delegation_seuil_lignes | 60 | Une unité qui écrit ou lit plus de N lignes est déléguée par défaut plutôt que traitée directement. |
| resume_max_lignes | 20 | Longueur maximale, en lignes, du rapport que le sous-agent doit rendre à l'instance. |

## Règles injectées

### ⚓ ON_PLAN
Quand tu découpes ton plan de session en unités de travail (module mémoire actif, `ON_ORIENT`),
attribue à chaque unité un mode explicite, `mode: directe` ou `mode: déléguée`, consigné dans sa fiche
`memoire/U<n>-….md` :

- **Déléguée par défaut** : écriture ou modification de fichier, lecture large (plus de
  `delegation_seuil_lignes` lignes), exécution de tests, toute unité mécanique et vérifiable après
  coup sans que l'instance ait besoin d'en suivre le détail en direct.
- **Toujours directe, sans exception** : les décisions (quoi faire, comment trancher un point
  ouvert), les messages (`TASK`, `DELIVERABLE`, `BLOCKER`, `CLARIFICATION`, `PROPOSAL`, `ALERT`,
  `RESPONSE`), l'écriture de `MEMORY.md`/`JOURNAL.md`/`STATUS.md`, et les commits Git. Une unité
  directe n'est jamais reléguée à un sous-agent, même courte à déléguer serait moins coûteuse en
  tours.

En cas de doute sur le mode d'une unité, penche vers `déléguée` si elle dépasse
`delegation_seuil_lignes` de travail attendu ; sinon vers `directe`, par économie (un sous-agent a un
coût de tours et de lancement qui ne se justifie pas pour une modification triviale).

### ⚓ ON_SUPERVISE
Pour chaque unité `mode: déléguée` de ton plan courant, lance un sous-agent `holarch-unite` (outil
`Agent`, `model` = `sous_agent_modele`, effort = `sous_agent_effort`) dont le prompt est construit
depuis `framework/templates/SOUS-AGENT.template.md` et contient :

1. le critère de fin de l'unité et la preuve attendue, tels qu'écrits dans ta fiche de plan ;
2. les chemins exacts autorisés en lecture et en écriture — jamais un répertoire entier, jamais « tout
   ce qui te semble utile » ;
3. les lignes ou fichiers déjà cités par ton plan, sans lecture large supplémentaire à sa charge ;
4. les interdits, recopiés tels quels : pas de commit, pas d'écriture dans un fichier d'instance
   (`ROLE.md`, `MEMORY.md`, `STATUS.md`, `JOURNAL.md`, `INBOX.md`, `OUTBOX.md`), pas de sous-agent en
   cascade (le sous-agent n'a pas l'outil `Agent`), pas d'écriture hors des chemins listés au point 2 ;
5. le format du rapport attendu, borné à `resume_max_lignes` lignes : fichiers effectivement écrits,
   commandes lancées et leur résultat résumé, écarts constatés par rapport à la demande.

À son retour, **vérifie avant de faire confiance** (KERNEL §5.4) : `git diff --stat` sur les chemins
concernés, tests ciblés si l'unité en prévoyait. Si le résultat ne satisfait pas le critère, corrige
toi-même ou relance le sous-agent une seule fois avec un prompt précisant l'écart constaté — au-delà
d'une relance, traite l'unité toi-même en direct plutôt que de t'obstiner. Une fois le résultat
accepté, committe toi-même (jamais le sous-agent) et complète la fiche `memoire/U<n>-….md` de l'unité
avec la ligne `delegation: <identifiant du sous-agent>` et, si le fichier live du hook
`context-watch` est accessible, le contexte de ta propre session avant et après cette unité.

## Ce que ce module ne fait pas

Il ne délègue jamais `ON_ORIENT` ni `ON_SLEEP` : le plan de session et la clôture (mémoire, statut,
commit) restent des actes de l'instance elle-même, sous peine de vider de sens le devoir de mémoire du
KERNEL (§5.3 — une session neuve doit pouvoir reprendre le travail à partir des seuls fichiers de
l'instance, jamais à partir d'un sous-agent disparu). Il n'autorise aucune cascade : un sous-agent
`holarch-unite` ne reçoit jamais l'outil `Agent`, il ne peut donc pas déléguer à son tour. Il ne
garantit pas la justesse du travail délégué — un rapport de sous-agent n'est jamais une preuve en
lui-même, seule la vérification de l'instance à `ON_SUPERVISE` l'atteste (devoir d'honnêteté, KERNEL
§5.4). Il ne modifie ni le format de `MEMORY.md`/`JOURNAL.md` (module mémoire actif) ni la mécanique
de spawn d'enfants (KERNEL §9) : un sous-agent n'est pas une instance, il ne consomme aucun budget
d'instances ni de profondeur.
