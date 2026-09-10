---
name: holarch-pause
description: Met en pause / arrête proprement une ou plusieurs instances HOLARCH en cours d'exécution en arrière-plan. Utiliser quand l'utilisateur dit "mets en pause", "stoppe l'instance", "arrête la session en cours", ou équivalent, à propos d'une mission HOLARCH lancée via holarch-spawn.js.
---

# Mettre en pause une ou des instances HOLARCH

HOLARCH n'a pas de mécanisme de pause « propre » (checkpoint/reprise à la demande) : une session
`claude -p` tourne jusqu'à un état terminal, une hibernation volontaire, ou une interruption
externe. « Mettre en pause » signifie donc concrètement : **arrêter le(s) processus en cours**,
sans corrompre l'état de la mission — le framework est conçu pour supporter cette interruption
brutale (cf. tests de reprise après incident du harnais), donc c'est une opération sûre, pas un
dernier recours.

## 1. Repérer ce qui tourne

Une instance HOLARCH peut elle-même en incarner d'autres depuis sa propre session (récursion
normale du KERNEL) : tout un sous-arbre peut donc être **un seul** processus de fond de haut
niveau, avec des enfants `node framework/bin/holarch-spawn.js <chemin-enfant>` imbriqués dessous.
Retrouver l'arbre complet :

```
ps -ef --forest | grep -E "holarch-spawn|native-binary/claude" | grep -v grep
```

**Piège à éviter absolument** : le process du harnais Claude Code qui exécute *cette session
interactive elle-même* (celle qui répond à l'utilisateur en ce moment) apparaît aussi dans cette
liste — le binaire `.../native-binary/claude` avec des arguments du type
`--output-format stream-json --input-format stream-json --permission-prompt-tool stdio
--replay-user-messages`. **Ne jamais le tuer.** Une instance HOLARCH lancée par le lanceur a une
signature différente : `claude -p "<prompt>" ... --output-format json --max-turns <n>
--max-budget-usd <n> ...` (visible dans les enfants du process `node framework/bin/
holarch-spawn.js`, ou absente ponctuellement si la session est entre deux appels). Ne cibler que
les processus `node framework/bin/holarch-spawn.js <chemin>` (et leurs enfants), jamais le
processus racine de la session interactive.

## 2. Arrêter proprement

Si la tâche de fond a été lancée par cette session (elle a un `task_id` connu, retourné au
lancement ou listable), utiliser le mécanisme du harnais plutôt qu'un `kill` brut :

```
TaskStop(task_id: "<id>")
```

Cela arrête tout l'arbre de processus descendant de cette tâche de fond en une fois. Si aucun
`task_id` n'est disponible (tâche lancée hors de cette session), cibler directement les PID
identifiés à l'étape 1 avec un signal progressif (`SIGTERM` puis, seulement si nécessaire après
quelques secondes, `SIGKILL`), en remontant depuis les processus les plus profonds de l'arbre —
jamais le PID de la session interactive elle-même.

## 3. Vérifier et rendre compte

```
ps -ef | grep -E "holarch-spawn|claude -p" | grep -v grep   # doit être vide
git status --short mission/
```

- Confirmer qu'aucun processus `holarch-spawn.js` ne survit (orphelin).
- Lire les `STATUS.md` des instances concernées pour rapporter leur état réel (probablement
  encore `WORKING`, la session n'ayant pas pu passer par son `ON_SLEEP`).
- S'il y a des fichiers modifiés/non committés sous `mission/<instance>/`, **ne pas les committer
  soi-même** : ce n'est pas au mainteneur d'écrire dans les fichiers d'une instance (KERNEL,
  cloisonnement) — l'instance le fera à sa prochaine incarnation, via son propre `ON_SLEEP`. Se
  contenter de signaler ce qui est là, sans le perdre ni le figer.
- Indiquer à l'utilisateur la commande de reprise (`node framework/bin/holarch-spawn.js <chemin>`,
  potentiellement depuis la racine de l'arbre arrêté plutôt que la feuille, selon ce qui a été
  coupé) — voir le skill `holarch-iterate`.
