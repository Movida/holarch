---
name: holarch-supervise
description: Supervise l'avancement d'une mission HOLARCH qui tourne en arrière-plan (instances détachées, hibernations, réveils par condition) et réagit aux événements qui demandent le mainteneur. Utiliser quand l'utilisateur dit "supervise", "surveille l'avancement", "ça avance ?", "tiens-moi au courant", "suis la mission", ou quand une mission lancée via holarch-spawn.js doit être suivie jusqu'à sa livraison.
---

# Superviser une mission HOLARCH en cours

Une mission HOLARCH avance sans personne dans la boucle : la racine hiberne en `WAITING_CHILDREN`
avec une ligne `Réveil`, les enfants tournent en tâches détachées (`--detach`), le lanceur les
ré-incarne après chaque hibernation volontaire et réveille le parent quand la condition est
satisfaite (`wakeWaiters`, chantier 2). Superviser, c'est **observer sans polluer** (jamais
d'écriture dans les fichiers d'une instance, jamais de `claude -p` à la main) et **n'intervenir que
sur les événements qui reviennent au mainteneur**. Le lancement et l'arrêt sont d'autres skills
(`holarch-iterate`, `holarch-pause`).

## 1. Lire l'état : une commande, pas dix fichiers

```bash
npm run observe                                        # instantané : état effectif par instance, sessions vivantes, coût, messages, anomalies
node tools/holarch-observe/observe.js --json           # le même en JSON (pour compter, filtrer, citer)
node tools/holarch-observe/observe.js --watch          # écran rafraîchi à chaque changement (à ne pas lancer depuis Bash : voir §2)
```

`tools/holarch-observe/` (chantier 10) réconcilie ce que le lanceur, les hooks, l'instance et son parent écrivent
chacun de leur côté : l'**état effectif** d'une instance est STATUS du worktree ⊕ verrou `live/` ⊕ processus ⊕ tâche
(« WORKING · session vivante (pid, min, contexte réel) », « WORKING · aucune session vivante (tuée ?) »,
« WAITING_CHILDREN · attend enfants:DELIVERED — condition satisfaite, réveil attendu »…), les enfants synchrones
sont vus par leur processus, les sessions tuées par leur transcription, les messages `to: utilisateur` sans
`RESPONSE` sont listés, et chaque anomalie porte un code (`tools/holarch-observe/README.md`). `npm run etat` ne voit
que l'arbre principal.

Où sont les fichiers quand il faut lire un détail (worktree par instance, framework ≥ 1.6.0 — règle « worktree →
disque → branche ») :

```
R=mission                                                   # racine (ex. concepteur) : sur main
W=mission/.holarch/worktrees/<chemin-tirets>                # enfant : son worktree
$W/mission/<chemin>/STATUS.md  MEMORY.md  memoire/INDEX.md  # état, mémoire, unités de l'enfant
$W/mission/registry/PROGRESS.md                             # ses lignes de progrès (fusionnées plus tard)
$W/mission/<parent>/INBOX.md                                # ses messages au parent (arrivent au parent à la fusion)
git log --oneline holarch/<chemin-tirets>                   # ses commits ; git show <branche>:<fichier> sans worktree
mission/.holarch/tasks/<chemin-tirets>-<ts>.json|.log       # tâche détachée : state running|done|failed, synthèse du lanceur
mission/registry/SESSIONS.md  REVEILS.md                    # journal du lanceur, écrit à la racine (non suivi tant que le parent n'a pas committé : normal)
node framework/bin/holarch-spawn.js --taches                # tâches détachées ; --reveil --dry-run : qui attend quoi, condition satisfaite ou non
node framework/bin/holarch-spawn.js --reprendre             # lanceur mort (redémarrage du conteneur) : fiches closes, instances en hibernation propre relancées (1.11.0)
node tools/holarch-transcript/analyse.js <session-id>       # une session tour par tour (identifiant : colonne Session de SESSIONS.md, ou `--json` de observe)
```

## 2. Armer la surveillance (pas de polling à la main)

Un `Monitor` **persistant** sur le mode événements de l'outil : il imprime l'état initial puis, à chaque changement,
les lignes apparues (`+`) et disparues (`-`) d'un résumé stable — états effectifs, unités closes, commits, tâches,
messages pour le mainteneur, réveils, anomalies. Rien entre deux événements.

```bash
node tools/holarch-observe/observe.js --evenements --mainteneur --intervalle 5   # seulement ce qui appelle un geste du mainteneur
node tools/holarch-observe/observe.js --evenements --intervalle 5                # tout changement d'état (mise au point, mission courte)
```

`--mainteneur` ne laisse passer que les lignes de la table du §3 : messages pour le mainteneur, anomalies de niveau
alerte, tâches échouées ou arrêtées par le lanceur, racine `DELIVERED`, instance `FAILED`/`BLOCKED`. Une soirée de
supervision sans ce filtre a réveillé la session une trentaine de fois pour des hibernations de routine.

Ne pas doubler d'une boucle `sleep` en premier plan, ni d'un `--watch` dans un Bash (il efface l'écran en continu),
ni d'une relecture des fichiers à chaque message de l'utilisateur : le moniteur suffit ; entre deux événements, dire
en une ligne où on en est (unités closes, session en cours, coût) et rendre la main. Pour le détail d'un événement,
`--json` une fois.

## 3. Réagir — seulement à ce qui revient au mainteneur

| Événement observé | Ce que fait le harnais tout seul | Geste du mainteneur |
|---|---|---|
| Enfant `WORKING` avec note « hibernation volontaire (contexte) » puis nouvelle session | ré-incarnation tant qu'il y a progrès (fiche d'unité ou commit `[chemin]`) | rien |
| Enfant `DELIVERED` (tâche `done`) | son lanceur évalue la condition du parent et le réveille (`REVEILS.md`, nouvelle tâche `<parent>-<ts>`) | attendre ~1 min ; si aucun réveil : `--reveil --dry-run` (montre la condition et pourquoi elle est fausse), puis `--reveil` si elle est satisfaite ; sinon diagnostiquer, c'est un défaut du harnais |
| Ligne `ré-incarnations arrêtées` (sans progrès, plafond) dans le `.log` de la tâche | `ALERT` du lanceur dans l'INBOX du parent ; le parent, s'il est réveillé, décide (relance détachée, `TASK`, `FAILED`) | si le parent ne se réveille pas : lire `MEMORY.md` de l'enfant (worktree), puis `node framework/bin/holarch-spawn.js <chemin> --detach` ou `TASK` de recadrage |
| `BLOCKER`, `CLARIFICATION`, `PROPOSAL` adressés à `utilisateur` | rien | décider (si le mainteneur n'a pas de préférence : trancher soi-même), écrire une `RESPONSE` dans l'`INBOX.md` du destinataire (racine : `mission/<racine>/INBOX.md` sur `main` ; enfant : dans son worktree, jamais dans l'arbre principal), committer si racine, relancer par `holarch-iterate` |
| Enfant `FAILED` ou `BLOCKED` sans réveil du parent | — | comme « arrêt du lanceur » |
| Racine `DELIVERED` | fin de mission | lire `shared/<racine>/RAPPORT.md`, vérifier de première main (tests sur copie, `appliquer.js`), proposer la promotion (`npm run promote -- <paquet> --appliquer`, `CHANGELOG`, `VERSION`) et l'archivage (`npm run archive`) |
| `sans-progres` (≥ 4 sessions, aucune unité close) ou `session-longue` (≥ 45 min) dans `observe` | rien : le lanceur ré-incarne tant qu'il voit un commit | lire la transcription et l'INDEX de l'enfant ; s'il tourne à vide (WIP sans unité, hibernations précoces, refus répétés) : `--arret <chemin>` puis ALERT au parent « échec mesuré, pose FAILED et termine » — chaque ALERT réveille le parent (≈ 5 USD la session de racine) : grouper les constats dans une seule |
| `exit=2` d'une tâche (STATUS resté `WORKING` sans note d'hibernation) | rien : session plantée | relancer une fois (`--detach`) ; un second échec ⇒ `FAILED` et recadrage |

Un message de réveil pour l'utilisateur (`PushNotification`) seulement pour les lignes « geste du
mainteneur » et la fin de mission — pas pour une hibernation ou une ré-incarnation.

## 4. Rendre compte

Format court, sans tableau de plus de cinq lignes :

- unités closes / en cours (lire `memoire/INDEX.md` de l'enfant dans son worktree, ou ses commits) ;
- sessions et coût cumulés (ligne « Coût » de `npm run observe`, `sessions.parInstance` en `--json`), avec la part de la racine et de chaque enfant ; les sessions « sans journal » (tuées avant leur résultat) comptées à part ;
- ce que le harnais doit faire ensuite tout seul (réveil, ré-incarnation), et ce qui attendra le
  mainteneur.

## 5. Pièges

- Ne jamais écrire dans `mission/<instance>/` ni committer les fichiers d'une instance vivante : ce
  qui traîne non committé appartient à sa prochaine session (`ON_SLEEP`). Exception : `SESSIONS.md`
  et `REVEILS.md`, journal du lanceur à la racine — le parent les committe à sa session suivante.
- `pgrep -fc 'claude -p'` compte aussi des processus étrangers à la mission : se fier à `npm run observe` (qui ne
  retient que les `claude -p … -n holarch:<chemin>` et leurs lanceurs) ; un enfant lancé en `mode_attente = synchrone`
  n'a **aucune fiche de tâche** (`--taches` ne le liste pas) et son `.contexte.json` vit sous son worktree.
- Les horodatages des lignes `PROGRESS.md` écrites par une instance peuvent être faux (l'instance
  estime l'heure) : la vérité est dans `SESSIONS.md` et les `.json` des tâches.
- Un `git switch`, `reset`, `stash` ou `worktree remove` pendant que la mission tourne est refusé
  par les garde-fous de maintenance : ne pas contourner.
- Ne pas confondre le processus de la session interactive avec une instance (voir `holarch-pause`).
