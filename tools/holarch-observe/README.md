# holarch-observe — voir une mission avancer, sans LLM et sans rien écrire

> Phase 1 du chantier 10 (`docs/ROADMAP.md`), issu du diagnostic
> [`docs/diagnostics/2026-09-11-visualisation-temps-reel.md`](../../docs/diagnostics/2026-09-11-visualisation-temps-reel.md).
> Node pur, aucune dépendance, aucun réseau, **lecture seule** : l'outil n'écrit jamais sous `mission/` ni ailleurs,
> et le harnais ne le connaît pas — un afficheur en panne ne change rien à la mission.

## Ce que c'est

L'état d'une mission est réparti entre des fichiers écrits par quatre acteurs à des moments différents :
l'instance (`STATUS.md`, `INBOX.md`, fiches d'unité), son parent (`ORG.md`, fiche registre), le lanceur
(`live/`, `tasks/`, `SESSIONS.md`, `REVEILS.md`) et les hooks (`live/*.contexte.json`). Personne ne les
réconcilie : une instance `WORKING` peut n'avoir aucune session vivante, un enfant lancé en synchrone
n'a aucune fiche de tâche, une session tuée ne laisse aucune ligne de coût.

`collecte.js` lit toutes ces sources (arbre principal, worktree de chaque enfant, branche d'instance
sans worktree, processus, transcriptions Claude Code) et rend **un instantané JSON** : instances avec
leur **état effectif** (STATUS du worktree ⊕ verrou ⊕ processus ⊕ tâche), sessions vivantes et leur
contexte réel (lu dans la transcription), coût cumulé, unités closes et commits, messages qui attendent
le mainteneur, Git par instance, et une liste d'**anomalies nommées**.

`observe.js` l'affiche.

## Utilisation

```bash
npm run observe                                   # un instantané texte
node tools/holarch-observe/observe.js --json      # le même en JSON (skill holarch-supervise, scripts)
node tools/holarch-observe/observe.js --watch     # écran rafraîchi à chaque changement (inotify) et toutes les 5 s
node tools/holarch-observe/observe.js --evenements  # une ligne horodatée par changement d'état : pour un Monitor
# --root <dir>  --intervalle <s>  --sans-effacer (--watch sans effacer l'écran)  --aide
```

`--evenements` imprime l'état initial puis, à chaque changement, les lignes apparues (`+`) et disparues
(`-`) d'un résumé stable (états effectifs sans horloge, unités, commits, tâches, messages, anomalies) :
c'est le mode qu'un `Monitor` de session de maintenance consomme sans bruit.

## Anomalies

| Code | Niveau | Sens |
|---|---|---|
| `working-sans-session` | alerte | STATUS `WORKING`, ni verrou ni processus, pas de note d'hibernation : session tuée ou plantée |
| `verrou-perime` | alerte | `live/<chemin>.json` au pid mort (redémarrage, `kill -9`) |
| `tache-pid-mort` | alerte | tâche détachée `running` au pid mort : `node framework/bin/holarch-spawn.js --reprendre` |
| `reincarnations-arretees` | alerte | le lanceur a cessé de ré-incarner (plafond, absence de progrès, 429) |
| `reveil-attendu` | alerte | condition `Réveil` satisfaite et aucune session vivante |
| `attend-mainteneur` | alerte | message `to: utilisateur` (PROPOSAL, CLARIFICATION, BLOCKER, DELIVERABLE, ALERT) sans `RESPONSE` |
| `session-sans-journal` | alerte | transcription d'une instance sans ligne dans `SESSIONS.md` : coût invisible (tours et pic de contexte lus dans la transcription) |
| `branche-principale` | alerte | l'arbre principal n'est pas sur `main` |
| `sans-progres` | alerte | ≥ 4 sessions et aucune unité close : l'instance tourne sans livrer — `--arret` puis recadrage ou verdict par le parent (2026-09-12) |
| `session-longue` | alerte | session vivante depuis ≥ 45 min : lire la transcription avant qu'un fusible ne parle |
| `org-en-retard`, `fiche-en-retard` | info | `ORG.md` ou la fiche registre ne disent pas ce que dit `STATUS.md` |
| `contexte-orphelin` | info | `.contexte.json` d'une session ni vivante ni journalisée |
| `contexte-au-seuil` | info | contexte de la session vivante ≥ `seuil_contexte_tokens` |
| `journal-lanceur-non-committe` | info | `SESSIONS.md` / `REVEILS.md` non committés : normal, la racine les committe |
| `worktree-non-committe` | info | fichiers non committés dans le worktree d'une instance sans session |
| `attente-sans-condition` | info | `WAITING_CHILDREN` / `BLOCKED` sans ligne `Réveil` |
| `processus-sans-verrou`, `processus-inconnu` | info | un `claude -p` de mission que le lanceur ne connaît pas |

## Sources et règles de lecture

- Enfant : son worktree `mission/.holarch/worktrees/<chemin-tirets>/` fait foi ; sans worktree, sa branche
  `holarch/<chemin-tirets>` (`git show`) ; l'arbre principal ne donne que la photo `INIT` du spawn.
- Transcriptions : `~/.claude/projects/<slug du cwd>/<session-id>.jsonl` — le cwd d'un enfant est son
  worktree, donc un dossier par worktree. Le lien instance → session vient de `live/*.contexte.json`
  (pendant) et de `SESSIONS.md` (après). Une transcription dont le premier message utilisateur est le
  prompt du lanceur et qui n'est ni vivante ni journalisée est une session tuée.
- Processus : `ps -eo pid,ppid,etimes,args`, lanceurs `holarch-spawn.js <chemin>` et `claude -p … -n
  holarch:<chemin>` ; jamais une session interactive (`--replay-user-messages`).
- Une collecte coûte ≈ 0,2 s (mesuré) ; `--watch` observe par `fs.watch` les dossiers vivants (liste
  refaite à chaque collecte) avec un débounce de 400 ms et une scrutation de repli (5 s).

Variables pour les tests et les rejeux : `HOLARCH_OBSERVE_PS` (sortie de `ps` injectée),
`HOLARCH_OBSERVE_TRANSCRIPTS` (dossier des transcriptions).

## Ce que l'outil ne fait pas

Il ne lance, n'arrête ni ne réveille rien (skills `holarch-iterate`, `holarch-pause`, `--reveil`). Il ne
calcule pas le coût d'une session en cours (le CLI ne le donne qu'à la fin). Il ne remplace pas
`tools/holarch-transcript` pour l'analyse tour par tour. Phases suivantes du chantier 10 : page locale
servie en SSE sur le même collecteur, puis journal d'événements du lanceur (`mission/.holarch/events.jsonl`).

## Tests

```bash
node --test tools/holarch-observe/test-*.js
```

Mission fabriquée dans un dossier temporaire (git et worktree réels, `ps` et transcriptions injectés),
dont un test qui vérifie qu'une collecte ne modifie rien sous `mission/`.
