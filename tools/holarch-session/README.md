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
dernières sessions de `SESSIONS.md`, authentification `gh` (lue dans `hosts.yml`, sans réseau),
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

## `refus.js` — mesurer les refus d'allowlist avant de régler

```bash
npm run refus                         # top des formes refusées, sessions et tours concernés
node tools/holarch-session/refus.js --json --top 30
```

Agrège `permission_denials` des `mission/.holarch/sessions/*.result.json` par outil et forme de commande (écriture par
redirection, `git -C`, chemin absolu hors arbre…), avec un exemple. Première mesure (holarch-fournisseurs, 2026-09-11) :
75 refus sur 701 tours (10,7 %), dominés par l'écriture par redirection Bash et les lectures par chemin absolu dans
l'arbre principal depuis un worktree — deux causes nommées à l'instance dans le bloc harnais depuis framework 1.15.0,
aucune règle d'allowlist changée.

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

- `etat.js` lit `hosts.yml` pour dire si `gh` est authentifié : il ne vérifie pas que le jeton est
  encore valide (`gh auth status` le fait, avec réseau).
- `garde.js` ne voit que les commandes passées à l'outil Bash de Claude Code : un script qui pousse
  depuis un fichier n'est pas intercepté, comme pour les garde-fous des instances.
- Les deux scripts s'appuient sur `ps` : hors Linux, la détection de mission en cours est vide.

## Tests

`node --test tools/holarch-session/test-session.js` (six tests, racine jetable, `ps` simulé), branché sur `npm test`.
