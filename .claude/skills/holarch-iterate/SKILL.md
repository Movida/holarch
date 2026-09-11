---
name: holarch-iterate
description: Lance ou relance une instance HOLARCH (prochaine itération, reprise après hibernation/pause). Utiliser quand l'utilisateur dit "lance la prochaine itération", "relance <instance>", "reprends <instance>", ou plus généralement quand une instance HOLARCH doit être incarnée pour continuer la mission.
---

# Lancer / relancer une instance HOLARCH

Rappel non négociable (`CLAUDE.md` du dépôt) : une instance HOLARCH se lance **uniquement** avec
`node framework/bin/holarch-spawn.js <chemin>` (ou `--bootstrap` pour la toute première session).
Jamais `claude -p` à la main : le lanceur fixe modèle/effort par profil, pose les fusibles
(tours/budget/contexte), et journalise le coût dans `mission/registry/SESSIONS.md`.

## 1. Identifier quoi lancer

- Pas de chemin donné explicitement par l'utilisateur → chercher l'action attendue :
  - `STATUS.md` de l'instance racine (souvent `concepteur`) porte parfois une ligne explicite
    « Action unique au réveil : `node framework/bin/holarch-spawn.js <chemin>` » — la suivre.
  - Sinon, regarder si un nouveau mandat est arrivé dans `INBOX.md` de l'instance concernée
    (dernier message `TASK` non encore traité) — c'est le signe qu'une itération est prête.
  - `STATUS.md` à `DELIVERED` sans mandat neuf dans `INBOX.md` → rien à lancer, le dire à
    l'utilisateur plutôt que de relancer pour rien.
  - `STATUS.md` à `WAITING_CHILDREN` ou `BLOCKED` avec une ligne `Réveil` (chantier 2, framework
    1.3.0) → ne pas relancer à la main : le harnais réveille l'instance quand sa condition est
    satisfaite (à la fin de la session de l'enfant, ou `tools/holarch-watch/` pour `date:`/`fichier:`).
    `node framework/bin/holarch-spawn.js --reveil --dry-run` montre qui attend quoi et si la condition
    est satisfaite ; `--reveil` sans `--dry-run` déclenche le réveil à la main (geste du mainteneur).
- Racine `DELIVERED` et paquet accepté, nouvelle mission à ouvrir → `npm run open -- <nom> --chantier <n>
  [--param cle=valeur…]` (jamais de `mission/OBJECTIVE.md` écrit à la main), puis relancer normalement par `--bootstrap`.

## 2. Vérifier l'état du dépôt avant de (re)lancer

Une commande, `npm run etat` (la ligne injectée au démarrage suffit si rien n'a bougé depuis), et quatre contrôles :

1. **Arbre** : propre, ou seulement des fichiers d'instance non committés (« à laisser à l'instance ») et le journal du
   lanceur (`SESSIONS.md`, `REVEILS.md`). Ne rien committer à la place d'une instance.
2. **Aucune session vivante pour cette instance** : « aucune session de mission en cours », et
   `node framework/bin/holarch-spawn.js --taches` sans tâche `running` au pid vivant pour ce chemin. Sinon c'est
   `holarch-pause` d'abord, jamais un second lancement (le lanceur refuserait sur le verrou `live/`, mais un verrou
   au pid mort — session fantôme, conteneur redémarré — se traite par `--reprendre`, pas par une relance à la main).
3. **Paramètres** : la ligne « paramètres : mode_attente=… · isolation=… · budget … » de `npm run etat`. `mode_attente`
   `synchrone` (défaut) garde une session parent vivante pendant toute la vie de l'enfant ; `detache` la fait hiberner
   et permet le parallélisme. Un `CONFIG.md` modifié se relit à chaque incarnation : `npm run lint` puis
   `node framework/bin/holarch-spawn.js <chemin> --dry-run` avant de lancer.
4. **Mandat en place** : un `TASK` ou une `RESPONSE` que l'instance doit exécuter est **committé** avant le lancement
   (`typed-escalation` ne fait exécuter que les ordres committés) et passe `node tools/message-lint/message-lint.js
   <INBOX.md> --blame`. Racine : `mission/<racine>/INBOX.md` sur `main`, commit humain sans préfixe. Enfant sous
   worktree : dans `mission/<enfant>/INBOX.md` de l'arbre du parent, jamais dans `mission/.holarch/worktrees/` —
   le lanceur relaie à l'incarnation (framework 1.14.0).

Un fichier `mission/.holarch/stop/<chemin-tirets>` restant d'un arrêt précédent est effacé par le lancement neuf
(1.13.2) : normal, rien à nettoyer.

## 3. Lancer

```bash
node framework/bin/holarch-spawn.js <chemin> --detach        # instance ordinaire : tâche détachée, survit à cette session
node framework/bin/holarch-spawn.js --bootstrap               # toute première session d'une mission (crée la racine)
```

`--detach` rend la main sur une ligne `HOLARCH ▸ <chemin> ▸ détaché · tâche <id> (pid <n>)`. Le préférer à un Bash
en arrière-plan : la tâche ne meurt pas avec la session interactive, et `--taches` la suit. Dans la minute, vérifier
que la tâche est `running`, que `mission/.holarch/live/<chemin-tirets>.json` existe et qu'un `claude -p` tourne
(`npm run observe`) ; puis passer au skill `holarch-supervise`.

## 4. Après le lancement

- Le lanceur ré-incarne l'instance tant qu'elle hiberne avec progrès ; il s'arrête sur un `--arret`, un plafond ou
  des sessions sans progrès (`ALERT` au parent pour un enfant ; pour la racine, relance à la main après lecture de
  sa mémoire).
- Codes de sortie : `0` fin normale ; `2` session plantée (STATUS `WORKING` sans note d'hibernation) — relancer une
  fois, un second échec vaut `FAILED` et recadrage ; `3` ré-incarnations épuisées — normal après du vrai travail, la
  racine se relance à la main.
- Un lancement qui échoue en une seconde est une limite de session de l'API (429) ou une option CLI invalide : lire
  `mission/.holarch/sessions/<instance>-<date>-N.result.json` avant de conclure (le lanceur attend lui-même le
  reset annoncé d'un 429).
