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