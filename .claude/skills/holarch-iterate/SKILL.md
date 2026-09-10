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

## 2. Vérifier l'état du dépôt avant de (re)lancer

Depuis le 2026-09-09, la lignée canonique est **ce dépôt** (`main`) ; `origin` (`Movida/holon.git`)
est l'ancien dépôt public, à l'ancien nom, avec un historique divergent — il n'y a plus de
rattrapage à faire depuis lui (`docs/ROADMAP.md` §6). Avant de lancer :

```
git status --short          # aucun fichier de mission/ non committé d'une session précédente
npm run lint                # framework/CONFIG.md cohérent avec MANIFEST.md et les modules
ps -ef | grep -E "holarch-spawn|native-binary/claude" | grep -v grep   # aucune instance déjà en cours
node framework/bin/holarch-spawn.js --taches                            # aucune tâche détachée `running` (chantier 2)
npm run upgrade -- --bref   # dans un projet issu du modèle : une version plus récente du framework est-elle publiée ?
```

Si `npm run upgrade -- --bref` annonce une mise à jour disponible, **le dire à l'utilisateur et
lancer quand même** : la récupération (`npm run upgrade -- --apply`) est un geste du mainteneur,
entre deux itérations, jamais pendant qu'une instance tourne, et jamais sans avoir lu le niveau du
changement (une version majeure peut invalider des fichiers d'instance —
`tools/holarch-upgrade/README.md`). Dans le dépôt canonique, la commande répond « aucune source de
modèle » : rien à faire.

Un `git log --oneline main..origin/main -- framework/` peut encore servir à vérifier que rien de
neuf n'est apparu côté public (au 2026-09-09 : seulement le module `activity-log`, écarté) —
**jamais `git merge origin/main` direct** (conflits add/add sur `mission/` et `docs/examples/`).

## 3. Si le harnais lui-même a été modifié dans cette session

```
node --test framework/tests/*.test.js
node framework/bin/holarch-spawn.js <chemin> --dry-run
```
Le `--dry-run` affiche modèle/effort/fusibles/taille des prompts sans rien exécuter — un bon
sanity check même hors changement du harnais, pour confirmer que le `chemin` existe et que la
résolution de profil est celle attendue.

## 4. Lancer pour de vrai

```
node framework/bin/holarch-spawn.js <chemin>
```

Une session réelle dépasse presque toujours le timeout par défaut de l'outil Bash (elle tourne
jusqu'à ~200 tours / 5 USD / hibernation volontaire) : elle passe automatiquement en tâche de
fond, ce qui est le comportement attendu — ne pas essayer de forcer un mode bloquant. Une
instance peut elle-même, depuis sa propre session, incarner ses enfants par le même mécanisme
(récursion normale du KERNEL) : ne pas s'inquiéter de voir apparaître des processus
`node framework/bin/holarch-spawn.js <chemin-enfant>` descendants du même arbre.

Ne pas attendre activement le résultat (pas de sleep/poll) : une notification arrive à la fin.
Si l'utilisateur demande un statut entre-temps, répondre par l'état constaté (`STATUS.md`,
`git log`), jamais en devinant un résultat.

## 5. Après la fin (notification de tâche)

Lire `STATUS.md` de l'instance lancée pour l'état réel et la prochaine action éventuelle
(souvent une nouvelle ligne « Action unique au réveil »). Ne jamais résumer un résultat sans
avoir relu ces fichiers.
