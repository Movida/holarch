# holarch-session — état au démarrage et garde-fous d'une session de maintenance

> Ajouté le 2026-09-09 (`docs/holarch.md` §15, revue du 2026-09-09). Les deux scripts sont branchés
> par `.claude/settings.json` sur les sessions Claude Code **interactives** de ce dépôt ; ils sont
> inertes dans une session d'instance HOLARCH (variable `HOLARCH_INSTANCE` posée par le lanceur),
> qui a ses propres garde-fous dans `framework/hooks/`.

## `etat.js` — le dépôt en une commande

```bash
npm run etat                          # texte complet
node tools/holarch-session/etat.js --bref
```

Branche et fichiers non committés (en distinguant les fichiers d'instance, à laisser à l'instance), ligne « suivi »
(commits non poussés vers `holon-v2`, âge de la dernière passation en mémoire, idées ouvertes de `docs/IDEES.md`),
mission et état de la racine et de ses enfants, (réinjecté par `--hook-prompt`, hook `UserPromptSubmit`, seulement quand la clé stable de l'état change) **fournisseurs à variables** du catalogue avec la présence de leurs variables dans le shell (noms seulement), **paramètres clés de `CONFIG.md`** (`mode_attente`, `isolation`, budget et
tours par session, seuil de contexte, relances — un défaut non écrit est marqué « (défaut) » : le 2026-09-11, `mode_attente =
synchrone` implicite a laissé un parent vivant 3 h 54), processus de mission en cours, derniers commits,
dernières sessions de `SESSIONS.md`,
versions, remotes — et, mission ouverte, l'**état effectif** de chaque instance (STATUS du worktree ⊕ verrou ⊕
processus), le coût cumulé, les messages pour le mainteneur et les alertes, obtenus de `tools/holarch-observe/collecte.js`
(chantier 10, 2026-09-11 ; fail-open : si la collecte échoue, la ligne manque, rien d'autre). Le hook `SessionStart`
injecte la version brève dans le contexte de chaque session interactive : elle démarre en sachant où elle est et ce qui
l'attend (`docs/ENVIRONNEMENT.md` §11).

## `passation.js` — hook `PreCompact`

Avant qu'une compaction ne résume le contexte d'une session de maintenance, injecte au résumeur ce qu'il doit
conserver (état de la mission, gestes du mainteneur en attente avec leurs commandes, commits non poussés, fichiers
modifiés, moniteurs armés, dernières décisions de l'utilisateur) et la consigne de reprise (`npm run etat`, mémoire
« current state », skill `holarch-session`). Inerte dans une session d'instance. Entrée `settings.json` (geste du
mainteneur) :

```json
"PreCompact": [{ "hooks": [{ "type": "command", "command": "node tools/holarch-session/passation.js --hook-precompact" }] }]
```

## `refus.js` — mesurer les refus avant de régler

```bash
npm run refus                                              # refus d'allowlist (mission/.holarch/sessions/*.result.json)
node tools/holarch-session/refus.js --json --top 30
node tools/holarch-session/refus.js --transcriptions <dossier-de-*.jsonl>              # refus de garde-fou (hooks) seuls
node tools/holarch-session/refus.js --transcriptions <dossier> --dir <sessions>        # les deux blocs, sources dites
```

Deux sources, jamais mélangées dans un même total :

1. **Refus d'allowlist** (chantier 13) : agrège `permission_denials` des `mission/.holarch/sessions/*.result.json`
   par outil et forme de commande (écriture par redirection, `git -C`, chemin absolu hors arbre…), avec un exemple.
   Première mesure (holarch-fournisseurs, 2026-09-11) : 75 refus sur 701 tours (10,7 %), dominés par l'écriture par
   redirection Bash et les lectures par chemin absolu dans l'arbre principal depuis un worktree — deux causes
   nommées à l'instance dans le bloc harnais depuis framework 1.15.0, aucune règle d'allowlist changée. Archive du
   chantier 13 (permis 1.1) : 58 refus d'allowlist pour un enfant sur deux sessions.
2. **Refus de garde-fou** (chantier 14, `docs/IMPLEMENTATION.md` §15.5, option `--transcriptions`) : un hook
   `PreToolUse` (`framework/hooks/holarch-hooks.js`) peut refuser un appel sans passer par l'allowlist — ce refus
   n'apparaît pas dans `permission_denials`, seulement dans la transcription `.jsonl` de la session
   (`~/.claude/projects/<slug>/<session-id>.jsonl`, colonne Session de `mission/registry/SESSIONS.md` ; même
   convention de dossier que `tools/holarch-bench/bench.js --calibrer --transcriptions`, y compris les
   sous-dossiers `subagents/`). `refus.js` reconnaît un message `permissionDecisionReason` commençant par
   `[HOLARCH · garde-fou <nom>]` et le ventile par garde-fou (nom lu dans le message, jamais une liste codée en
   dur — un garde-fou qui n'existe pas encore, ex. `path-guard`, sera compté dès qu'il s'exprimera dans cette
   forme) et par cause (texte du message normalisé : chemins/commandes entre apostrophes inverses neutralisés,
   coupe au premier « : » isolé — `git-guard` et `framework-guard` retombent ainsi dans la même cause d'un appel à
   l'autre malgré un chemin différent).
   `releverHooks()` reste délibérément tolérant à l'emplacement du message dans la ligne JSON (parcours générique
   de toutes les chaînes de la ligne) plutôt que de supposer un seul chemin de champ ; son test
   (`test-refus-hooks.js`) porte sur une fixture `.jsonl` synthétique, pas une transcription réelle.
   **Validation réelle (2026-09-13)** : mesure faite par le mainteneur — `~/.claude/projects` est hors du projet,
   donc illisible depuis une session d'instance ou de sous-agent, c'est un geste de maintenance. Format validé,
   aucune correction nécessaire. Recette : `node tools/holarch-session/refus.js --transcriptions ~/.claude/projects/<slug>`,
   où `<slug>` est le `cwd` de la session avec chaque `/` remplacé par `-`. Chiffres : 16 refus de hooks sur les 8
   transcriptions de l'enfant `qwen-coder-flash` du chantier 13 (9 `git-guard`, 6 `ON_SLEEP`, 1 `ON_ORIENT`) ;
   53 refus de hooks sur les 274 transcriptions de toutes les missions de la racine (31 `ON_ORIENT`, 21 `ON_SLEEP`,
   1 `git-guard`). À rapprocher des 58 refus d'**allowlist** du même enfant : un refus de hook est lisible et
   compté, un refus d'allowlist est muet et perdu avec `mission/.holarch/` à l'archivage — c'est le trou que
   `path-guard` (§15.1) comble.
   **Ergonomie** : `--transcriptions` seul n'imprime que le bloc hooks. Le bloc allowlist porte sur la mission
   *courante*, donc en général sur une autre mission que les transcriptions demandées : il faut le demander
   explicitement par `--dir <sessions>` (ou `--root <dir>`) pour obtenir les deux blocs dans la même sortie.

## `garde.js` — trois règles rendues mécaniques

Hook `PreToolUse` sur `Bash`, `Write` et `Edit` :

| Action | Décision | Règle |
|---|---|---|
| `git push origin …`, `git push --force`, `git push` sans remote | refus | `origin` est en lecture seule, le push forcé est réservé au mainteneur, l'amont implicite peut pointer `origin` (`docs/ENVIRONNEMENT.md` §3, §7) |
| `git switch`, `checkout <réf>`, `reset --hard`, `clean`, `stash`, `worktree remove` **pendant qu'une mission tourne** | refus | une instance écrit dans l'arbre de travail ; arrêter d'abord avec le skill `holarch-pause` (§8) |
| `Write` ou `Edit` sous `mission/` (sauf `mission/OBJECTIVE.md`) | demande de confirmation | le mainteneur n'écrit ni ne committe les fichiers d'une instance (KERNEL §4, §7) ; confirmer seulement si c'est délibéré |
| HEAD a bougé depuis le dernier appel d'outil de cette session (commit d'une autre session ou d'une instance) | contexte injecté, jamais bloquant | avant tout `Bash`, `Write` ou `Edit` : la liste des commits étrangers et des fichiers qu'ils touchent, avec la consigne de relire avant d'éditer (§8, ajouté le 2026-09-11 après une édition à l'aveugle par `sed` sur une version périmée) |

La quatrième règle repose sur un hook `PostToolUse` sur `Bash` (même commande `garde.js`, qui reconnaît
`hook_event_name`) : après chaque commande, HEAD est noté dans `os.tmpdir()/holarch-garde-<session_id>.json` ;
un commit fait par la session elle-même est donc déjà noté quand l'outil suivant démarre, seul un commit
extérieur est signalé, une seule fois. Limite constatée le 2026-09-11 : quand la commande Bash échoue (code non nul),
Claude Code émet `PostToolUseFailure` et non `PostToolUse` — un commit fait dans une commande qui échoue ensuite est
signalé au tour suivant comme « étranger » ; câbler aussi `PostToolUseFailure` sur `Bash` dans `.claude/settings.json`
(geste du mainteneur) supprime ce faux positif, `garde.js` traite les deux événements de la même façon. Les modifications non committées d'une autre session restent
invisibles : là, seule la relecture protège.

Fail-open : toute erreur interne laisse l'action se faire. Pour tester une règle sans processus
réel, `HOLARCH_GARDE_PS` remplace la sortie de `ps -eo pid,args`.

## Limites assumées

- `garde.js` ne voit que les commandes passées à l'outil Bash de Claude Code : un script qui pousse
  depuis un fichier n'est pas intercepté, comme pour les garde-fous des instances.
- Les deux scripts s'appuient sur `ps` : hors Linux, la détection de mission en cours est vide.
- `refus.js --transcriptions` ne peut pas être exercé depuis une session d'instance ou de sous-agent :
  `~/.claude/projects` est hors du projet, donc refusé. La mesure de référence du chantier 14 a été faite par le
  mainteneur le 2026-09-13 (chiffres et recette dans la section `refus.js` ci-dessus) ; toute mesure ultérieure
  relève du même geste de maintenance.

## Tests

`node --test tools/holarch-session/test-session.js` (six tests, racine jetable, `ps` simulé) et
`node --test tools/holarch-session/test-refus-hooks.js` (fixture `.jsonl` synthétique sous `fixtures/`),
branchés sur `npm test`.
