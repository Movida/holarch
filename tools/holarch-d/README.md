# holarch-d — HOLARCH à la demande depuis le bureau

> Spec reçue du mainteneur le 2026-09-04 (conservée intégralement dans `SPEC.md`), scaffoldée par
> Claude Code le jour même. **Remplace `tools/holon-oracle/`** (première itération, MCP stdio
> direct sans démon — historique dans les commits `5db38a1`/`0038c3c`/`618e5f6`) : le besoin a été
> recadré pour lever les contraintes de cette première version (timeout côté client MCP, aucun
> environnement d'exécution durable pour des tâches longues).
>
> ⚠️ **Cette copie n'est pas `tools/holarch-d/`.** C'est la copie de travail de l'Étape 2, produite
> par l'instance HOLARCH `concepteur/holon-d2` sous `docs/archive/mission-holon-v2/shared/concepteur/holon-d2/holon-d/`.
> Elle n'a **pas encore été promue** dans `tools/holarch-d/` : la promotion est une décision du
> mainteneur, prise séparément, en comparant les deux arbres fichier à fichier. Les chemins
> `tools/holarch-d/…` cités plus bas décrivent l'emplacement *après* promotion.
>
> **État actuel : Étapes 1 et 2 de la feuille de route (`SPEC.md` §14) construites et validées par
> de vrais appels** (Étape 1 : 2026-09-04, ~0,04 USD ; Étape 2 : 2026-09-04, 0,4669 USD — détail
> plus bas). Niveau 1 uniquement — niveaux 2 (panel) et 3 (mission) explicitement refusés par
> `submit_task`, pas encore implémentés.

## Ce que c'est

Un **démon** (`holarch-d`) : processus utilisateur durable, seul détenteur de l'état, qui incarne
les appels `claude -p`. Une **porte MCP** (`holarch-mcp`) : serveur MCP stdio lancé par Claude
Desktop, client mince du démon, sans état propre. Une **CLI** (`holarch`) : même client HTTP que la
porte, pour tout tester sans Desktop. Depuis Desktop (ou un terminal) : raffiner une demande en
une phrase (`refine_prompt`, gratuit, synchrone, quelques secondes), obtenir un devis, puis
soumettre une tâche (`submit_task`, asynchrone) qui tourne en tâche de fond pendant que la
conversation continue — sans le problème de timeout qui limitait `holon-oracle` (voir
`SPEC.md` §0, §3 pour le raisonnement complet).

`SPEC.md` est la référence de conception (vocabulaire, architecture, dix-sept décisions D1-D17,
niveaux 0-3, format des spécialistes, feuille de route et critères d'abandon). Ce fichier
documente **l'état réel d'implémentation** — ce qui est construit, ce qui diverge de la spec et
pourquoi, ce qui reste à faire.

## Ce qui est construit (Étape 1)

| Pièce | Fichier | Rôle |
|---|---|---|
| Démon | `daemon.js` | Serveur HTTP `node:http` sur 127.0.0.1, port aléatoire, jeton dans `~/.holarch/daemon.json` (mode 0600, D2). Verrou + pidfile (D3, un second démon est refusé). |
| Cœur | `daemon-core.js` | Logique indépendante du transport (`refinePrompt`, `submitTask`, `getTask`, `listTasks`, `cancelTask`) — `launch` injecté, testable sans sous-processus réel. |
| Politique | `policy.js` + `POLICY.md` | Résolution modèle/effort par profil (`triage`/`conception`/`execution`/`relecture`), en réutilisant `resolveProfile`/`parseConfig` de `framework/bin/holarch-spawn.js` (D5). |
| Routage | `router.js` | Schéma JSON du triage, validation/repli, calcul du devis à partir du ledger (médiane/p90) ou des défauts de `POLICY.md` (D5, §8). |
| Lancement | `launch.js` | Assemblage + exécution de `claude -p` : triage (`--output-format json`, `--json-schema`) et avis niveau 1 (`--output-format stream-json --include-partial-messages`, brouillon partiel pour `get_task`). |
| Tâches | `tasks.js` | État sur disque, `~/.holarch/tasks/<id>/{TASK.json,RESULT.md,transcripts/}` (§5, §12). |
| Ledger | `ledger.js` | `~/.holarch/ledger.jsonl`, append-only, champs de §12 (space, task, level, specialist, modèle, effort, coût, tokens, tours, durée, exit, commit du framework). |
| Charte | `charte.md` | Persona « généraliste » (le catalogue de spécialistes n'existe pas encore) + format `RESULT.md` imposé (§13.3). |
| Porte MCP | `mcp-door.js` | SDK officiel (`McpServer`/`StdioServerTransport`, D1) — cinq outils : `refine_prompt`, `submit_task`, `get_task`, `list_tasks`, `cancel_task`. |
| Client | `client.js` | HTTP partagé par la porte et la CLI ; démarre le démon s'il ne répond pas (D3). |
| CLI | `cli.js` | `refine`, `ask`, `status`, `cancel`, `stop`. |

## Où ça diverge de `SPEC.md` (Étape 1 seulement, honnêteté d'abord)

- **`submit_task` refuse explicitement `level: 2`, `level: 3`, `review: true` et `parent_task`**
  plutôt que d'y répondre par une erreur générique — pas implémentés à cette étape, conformément à
  `SPEC.md` §14 (« niveau 1 uniquement »).
- **Pas de catalogue de spécialistes.** `charte.md` encode directement le persona
  « généraliste » ; `specialists/*.md`, `list_specialists`, `panel_affinity` : étape 2.
  `submit_task` accepte quand même un champ `specialists`, mais un seul nom existe : `generaliste`.
- **Pas d'espaces.** Un seul espace `default`, sans racines déclarées ; `SPACE.md`, `DIGEST.md`,
  `holarch space add/list/digest` : étape 2. `--tools` reste `""` en permanence (D17 prévoit
  `Read,Glob,Grep` si l'espace a des racines — sans racines, rien à lire).
- **Pas de mémoire.** Ni `MEMORY.md` par spécialiste (D8), ni passe d'écriture (D9), ni
  `DECISIONS.md` : étape 2. La charte demande quand même une section « Décisions proposées » dans
  `RESULT.md`, pour que le format soit stable avant que quelque chose ne les capture.
- **Pas de quotas ni de `get_usage`.** Le ledger existe et enregistre déjà tout ; rien ne l'exploite
  encore pour refuser un appel. `concurrence_max` (§11), lui, est appliqué (`daemon-core.js`).
- **Pas de fils (`--resume`).** Chaque tâche est indépendante ; `parent_task` est refusé
  explicitement plutôt qu'ignoré silencieusement.
- **Taxonomie d'erreurs partielle.** `invalid_input` et `claude_failed` sont produits ;
  `quota_exceeded`, `concurrency_limit`, `timeout`, `router_failed`, `mission_failed` n'ont pas
  encore de cas d'usage réel à cette étape (pas de quotas, pas de mission, et un dépassement de
  `timeout_s` se traduit aujourd'hui en `claude_failed` générique — affiné si besoin à l'usage).
- **`--json-schema` plutôt qu'un parsing de texte libre pour le triage** — non prévu explicitement
  par `SPEC.md` (qui décrit juste une « sortie JSON stricte », §8), mais mesuré comme le mécanisme
  le plus fiable disponible sur le CLI installé (voir « Résultats mesurés »). `structured_output`
  revient déjà parsé — aucune extraction de JSON depuis un texte n'est nécessaire.
- **`refine_prompt` en `--output-format json`, pas `stream-json`** — l'architecture de `SPEC.md`
  §3 dit `launch.js: claude -p discipliné (niveaux 0-2)`, laissant entendre un mécanisme uniforme.
  Écart assumé : `refine_prompt` est synchrone et personne n'interroge son état pendant qu'il
  tourne (contrairement à `submit_task`), donc le streaming n'apporte rien et complique le parsing
  pour rien.

## Ce qui est construit (Étape 2)

L'Étape 1 n'a pas été réécrite : elle a été **étendue**. Aucun de ses 67 tests n'a été supprimé.

| Brique | Où | Ce qui marche |
|---|---|---|
| **Espaces** | `spaces.js`, `cli.js` | `SPACE.md` par espace (racines lisibles, dépôt Git de référence, description). `holarch space add/list/digest` en CLI. Un espace `default` sans racine est créé à la volée. Le refus de lecture hors racines (`SPEC.md` §11) est tenu par le bornage d'outils du CLI, **pas** par `normaliserChemin` — voir la divergence n° 7 ci-dessous. |
| **Espaces jamais en MCP** | `mcp-door.js` | La porte MCP expose 7 outils, **aucun** ne touche aux espaces (`SPEC.md` §9 : déclarer ce qu'un LLM a le droit de lire est un acte de l'utilisateur). Un test le vérifie nommément. |
| **`DIGEST.md`** | `spaces.js` | Session cartographe (profil `execution`, `Read,Glob,Grep`, 2 USD max) qui parcourt les racines et écrit une carte d'environ 2000 tokens, en-tête `commit`/`date`/`cost_usd`. Régénérée sur `--force`, quand aucun digest n'existe, ou quand HEAD a trop avancé depuis le commit cartographié. |
| **Catalogue de spécialistes** | `specialists/*.md`, `validate-specialists.js`, `specialists.js` | Six fiches (`architecte-logiciel`, `relecteur-code`, `analyste-securite`, `redacteur-technique`, `strategiste-produit`, `generaliste`), format `SPEC.md` §7 vérifié mécaniquement. Un nom hors catalogue retombe sur `generaliste` en le signalant (`specialist_fallback`), il n'échoue pas (§8). |
| **`list_specialists`** | `daemon-core.js`, `mcp-door.js`, `cli.js` | Sert les fiches résumées (`when_to_use`, `specialty`, `profile_default`, `tools`, `panel_affinity`) **et** `tasks_done`, le nombre de tâches **distinctes** déjà traitées par ce spécialiste dans l'espace. |
| **Mémoire par spécialiste et par espace** (D8/D9) | `spaces.js`, `daemon-core.js` | `spaces/<espace>/specialists/<nom>/MEMORY.md`, gabarit imposé à quatre sections (`SPEC.md` §7), plafonné à 6000 caractères. **Réécrite intégralement** après chaque tâche réussie (jamais d'append), **sautée** dès que la tâche n'est pas `done` — ce qui couvre l'échec comme le plafond de tours ou de dépense atteint (le CLI répond alors `is_error`, la tâche passe `failed`), un test par cas. |
| **`DECISIONS.md` + `rate_result`** | `daemon-core.js` | Un `DECISIONS.md` daté et **append-only** par espace, alimenté par l'outil `rate_result` (`task_id`, `verdict`, `note?`, `decisions?`, `supersedes?`). Exposé en MCP et en CLI (`holarch rate`). |
| **Injection de contexte au niveau 1** | `daemon-core.js` | Le prompt système d'une tâche assemble désormais fiche du spécialiste + `MEMORY.md` + `DIGEST.md` + `DECISIONS.md` de l'espace (`SPEC.md` §6), par une fonction pure testable. |
| **Outils accordés (D17)** | `launch.js` | `Read,Glob,Grep` **seulement si** la fiche dit `tools: read` **et** que l'espace a des racines déclarées ; sinon `--tools ""`. Jamais d'écriture, jamais de Bash, jamais d'accès au démon. cwd sur la première racine. |

## Où ça diverge de `SPEC.md` (Étape 2, honnêteté d'abord)

1. **Pas de `digest.js` séparé.** La spec parle du digest comme d'une brique ; il vit dans
   `spaces.js`, parce qu'il n'a de sens que rapporté à un espace et à ses racines. Un fichier de
   plus n'aurait ajouté qu'une indirection.
2. **Mode de la passe mémoire surchargeable par `HOLARCH_MEMOIRE_MODE`.** La spec ne prévoit qu'un
   mode. Deux sont implémentés (`resume`, et le repli `neuf` qui repart du `RESULT.md`) derrière
   une variable d'environnement, pour pouvoir re-mesurer sans retoucher le code si le
   comportement de `--resume` change dans une version future du CLI. Défaut : `resume`, tranché
   par la mesure (voir plus bas).
3. **`--specialist` au singulier en CLI, `specialists` au pluriel côté démon.** Le contrat MCP
   prend un tableau (il servira au panel de niveau 2) ; la CLI n'expose qu'un nom, parce qu'un
   panel n'existe pas à cette étape. La traduction est faite par `chargeAsk` (`cli.js`).
4. **Gouvernance de `DECISIONS.md` tranchée en faveur de `supersedes`** (`SPEC.md` §16 la laissait
   ouverte entre suppression et `superseded`) : append-only strict, une décision se corrige en en
   ajoutant une qui la remplace. Même raison que pour les `OUTBOX.md` du KERNEL — un journal de
   décisions qu'on peut réécrire ne prouve plus rien.
5. **Deux règles de validation de fiche vivent dans `validerFiche`, non dans `validerCatalogue`**
   (`panel_affinity` ne cite que des noms du catalogue ; une fiche ne se cite pas elle-même).
   Elles ne dépendent que de la constante `NOMS_CATALOGUE` et du nom de la fiche, jamais du
   catalogue chargé. Le comportement observable de `validerCatalogue` est inchangé. Écart proposé
   et argumenté par l'instance qui a produit le catalogue, accepté après relecture.
6. **`tasks_done` compte des tâches distinctes, pas des lignes de ledger.** Ce n'est pas une
   divergence de spec mais un correctif : depuis l'Étape 2, une même tâche produit deux à trois
   lignes de ledger (l'avis, la passe mémoire, la notation), et `list_specialists` annonçait donc
   une expérience gonflée d'un facteur 2 à 3 — exactement l'information qu'il est censé fournir
   pour choisir un spécialiste.
7. **Le refus §11 n'est pas tenu par `normaliserChemin`, mais par le bornage d'outils du CLI.**
   `spaces.js` expose `normaliserChemin` (résolution, refus de `..`, des chemins absolus hors
   racine et des liens symboliques qui sortent ; 8 tests dans `test-spaces.js`), mais **aucun
   chemin d'exécution ne l'appelle aujourd'hui** — c'est une primitive prête, pas une porte en
   service. La raison est qu'à cette étape aucune entrée ne porte de chemin : `submit_task` prend
   un prompt et un nom d'espace, les racines n'arrivent que par `space add` (qui fait sa propre
   résolution dans `creerEspace`), et le digest est produit par une session `claude`, pas par un
   parcours de fichiers en Node. Ce qui empêche réellement une lecture hors racines, c'est le bac
   à sable du sous-processus : `--tools` accordé sous double condition (D17), `cwd` sur la première
   racine, `--add-dir` pour les suivantes, jamais d'écriture ni de Bash. `normaliserChemin`
   deviendra la porte le jour où une entrée utilisateur portera un chemin (Étape 3 : lecture de
   fichier ciblée, pièces jointes) ; elle est testée d'avance pour ça.
   *Correctif de session 5 : les deux affirmations précédentes du `README.md` et du commentaire de
   `spaces.js` présentaient cette fonction comme « la seule porte » du refus §11, ce qui était faux
   — écart relevé en revue par `concepteur`.*

## Invariants non négociables

- `framework/` jamais écrit — `policy.js`/`launch.js` lisent `holarch-spawn.js` (`require`), jamais
  d'écriture (conforme à `CONTRIBUTING.md`, qui n'interdit aux outils que d'écrire sous
  `framework/`, pas de le lire).
- Aucun `claude -p` nu : toujours `--model`, `--effort`, `--strict-mcp-config`,
  `--output-format` explicite, `--max-turns`, `--max-budget-usd`, stdin fermé.
- Outils du sous-processus niveau 1 bornés à une liste close : `--tools ""` par défaut, et au plus
  `Read,Glob,Grep` sous la double condition D17 (fiche `tools: read` **et** espace avec racines),
  `cwd` sur la première racine. Jamais d'écriture, jamais de Bash, jamais de serveur MCP — donc
  aucun risque qu'un spécialiste écrive ou exécute quoi que ce soit, et *a fortiori* aucun risque
  qu'il rappelle `holarch-d` lui-même (le sens de l'intégration MCP reste celui tranché pour `holon-oracle` : le démon est
  exposé comme serveur, jamais l'inverse — une holarchie ne se lance jamais depuis une holarchie).
- Démon HTTP **loopback uniquement** (127.0.0.1), jamais d'écoute externe ; jeton exigé sur
  **toutes** les routes, y compris `/ping` et `/stop` (durci par rapport à une première version
  qui envisageait `/ping` public — pas de raison de l'exempter).
- `~/.holarch/` (ou `HOLARCH_HOME`) — jamais dans le dépôt, jamais committé (D7).

## Utilisation

### Démon + CLI (sans Desktop)

```bash
node tools/holarch-d/cli.js refine "Explique en une phrase ce qu'est un worktree Git."
node tools/holarch-d/cli.js ask "…" --profile execution
node tools/holarch-d/cli.js status <task_id>     # ou sans id : liste
node tools/holarch-d/cli.js cancel <task_id>
node tools/holarch-d/cli.js stop
```

Étape 2 — espaces, catalogue, notation (les espaces se déclarent **ici et nulle part ailleurs**) :

```bash
node tools/holarch-d/cli.js space add mon-projet --root ~/code/mon-projet --repo ~/code/mon-projet \
                                               --description "…"
node tools/holarch-d/cli.js space list                  # + fraîcheur du digest de chaque espace
node tools/holarch-d/cli.js space digest mon-projet     # régénère la carte (--force pour forcer)
node tools/holarch-d/cli.js specialists --space mon-projet
node tools/holarch-d/cli.js ask "…" --profile execution --space mon-projet \
                                  --specialist architecte-logiciel
node tools/holarch-d/cli.js rate <task_id> good --note "…" --decision "…"
```

Le démon démarre automatiquement au premier appel (D3, `client.js`) — pas de commande `start`
séparée. `refine`/`ask` marchent identiquement en CLI et via MCP : même client HTTP (§10).

### Claude Desktop

```json
{
  "mcpServers": {
    "holarch-mcp": {
      "command": "node",
      "args": ["<chemin absolu>/tools/holarch-d/mcp-door.js"]
    }
  }
}
```

Redémarrer Desktop après édition. La leçon de `holon-oracle` s'applique encore si ce dépôt tourne
dans un devcontainer/WSL : la commande doit passer par `wsl.exe -d Ubuntu -- docker exec -i
<conteneur> node <chemin>/tools/holarch-d/mcp-door.js` plutôt que `node` directement — voir
l'historique de `tools/holon-oracle/` pour le diagnostic complet si `holarch-mcp` échoue en
« Server disconnected ».

## Résultats mesurés (Étape 1, 2026-09-04, appels réels, ~0,04 USD au total)

Un cycle complet en ligne de commande, puis un second cycle depuis Claude Desktop lui-même :

1. `holarch refine "Explique en une phrase ce qu'est un worktree Git."` — démon auto-démarré,
   triage réel (`haiku`/`low`, `--json-schema`) : 0,0213 USD, 8,6 s, 2 tours. `structured_output`
   est revenu déjà parsé, exploitable sans aucune extraction de texte — confirme que
   `--json-schema` est le bon mécanisme pour le triage (voir « Où ça diverge »). Devis retombé
   sur les défauts de `POLICY.md` (ledger vide) comme prévu par la logique de repli.
2. `holarch ask "…" --profile execution` — retour immédiat (`task_id`, `state: queued`), tâche
   passée à `running` puis `done` en 3,4 s (0,0201 USD, 1 tour). `RESULT.md` produit dans le
   format imposé par la charte (Verdict/Raisons/Non vérifié/Décisions proposées/Suite
   suggérée/Coût réel) ; `transcripts/<id>.jsonl` contient les 18 lignes `stream-json` brutes.
3. `holarch stop` — démon arrêté proprement, `daemon.json` supprimé, processus disparu.

### Depuis Claude Desktop (2026-09-04, `holarch-mcp` réel)

Cycle complet rejoué en conditions réelles — `refine_prompt` → `submit_task` → polling
`get_task` → `list_tasks` → `submit_task` + `cancel_task` :

- **`submit_task` répond quasi instantanément**, sans bloquer la conversation — le problème
  structurel d'`oracle_probe` (un seul appel d'outil qui monopolise tout le temps d'exécution) est
  bien éliminé par le pivot asynchrone, confirmé pour la première fois depuis un vrai client MCP.
- **Brouillon partiel confirmé en conditions réelles** : 4 appels à `get_task` avant `done`,
  `partial` non vide dès le premier poll et grossissant de façon cohérente — le streaming
  `stream_event`/`content_block_delta` traverse bien tout le circuit (sous-processus → `launch.js`
  → `daemon-core.js` → HTTP → porte MCP → Desktop).
- **`cancel_task` sur une tâche en cours confirmé** : `cancelRequested: true` immédiatement, puis
  `state: cancelled` ~5,5 s plus tard avec `error` mentionnant le code 143 (SIGTERM) — cohérent
  avec le délai de grâce SIGTERM→SIGKILL documenté (`daemon-core.js`, 5 s).
- **Un vrai timeout de triage observé, corrigé.** Le tout premier `refine_prompt` a échoué en
  interne : `chosen_by: "fallback"`, `optimized_prompt` identique au prompt d'origine,
  `repli_specialistes: true` — le signal de repli a fonctionné exactement comme conçu (aucune
  donnée inventée, juste des défauts sûrs). Le ledger réel (`~/.holarch/ledger.jsonl`) a permis de
  diagnostiquer la cause : `"exit":"sans_resultat","duree_ms":15551` — le sous-processus de
  triage a été tué par le timeout, à quelques millisecondes près de `timeout_s_niveau0` (15 s à
  l'époque). Un appel `--json-schema` peut visiblement demander plus de tours internes que le cas
  testé en CLI (2 tours, 8,6 s) ne le laissait supposer. **Corrigé** : `timeout_s_niveau0` relevé
  à 30 s dans `POLICY.md`. Les appels suivants (niveau 1, annulation) n'ont montré aucun signe de
  pont externe (Cowork ou autre) — latences directes et cohérentes du début à la fin.

Le ledger porte tous ces appels avec les champs de §12, y compris `repo_commit`. **Ce qui reste à
faire** : accumuler jusqu'à trente appels réels niveau 1 pour juger honnêtement le critère
d'abandon de l'étape 1 (« aucun cas où le résultat a été préféré à Desktop seul ») — les quelques
appels faits jusqu'ici valident le mécanisme, pas encore l'utilité perçue dans la durée.

## Résultats mesurés (Étape 2, 2026-09-04, appels réels, 0,4669 USD au total)

### Le point non résolu `--resume` : **tranché par la mesure, il fonctionne**

`SPEC.md` §16 laissait ouvert le fait que `claude -p --resume <session>` fonctionne avec le format
de sortie utilisé. Mesuré directement contre le CLI installé, deux appels enchaînés en
`--output-format json --tools "" --max-turns 1` :

| Appel | Résultat | Coût |
|---|---|---|
| A — « Retiens ce mot : GRENADINE. » | `session_id` rendu dans le JSON, `result` = `"OK"` | 0,0105 USD |
| B — « Quel mot devais-tu retenir ? » avec `--resume <id> --fork-session` | `result` = **`"GRENADINE"`** | 0,0015 USD |

**Verdict : `--resume` restitue bien le contexte de la session avec `--output-format json`.** La
passe mémoire D9 est donc implémentée par `--resume` (mode par défaut `resume`), et non par le
repli. Le repli (`neuf` : appel neuf avec le `RESULT.md` en entrée) reste implémenté et testé,
accessible par `HOLARCH_MEMOIRE_MODE=neuf` — le point de la spec porte sur `--resume` **et
`stream-json`** ensemble ; seule la combinaison avec `json` a été mesurée, `stream-json` reste non
vérifié et n'est utilisé nulle part dans le code actuel.

Coût observé de la passe mémoire par `--resume` sur une vraie tâche : **0,1086 USD**, soit environ
70 % du coût de la tâche elle-même. Ce n'est pas négligeable et c'est un candidat naturel à
l'optimisation (la reprise reforke tout le contexte de la tâche).

### Bout en bout, avec `HOLARCH_HOME` isolé dans `/tmp` (D7)

`space add` → `space digest` → `specialists` → `ask` → `status` → `rate`, sur un espace dont la
racine était cette copie de travail elle-même :

| Étape | Résultat vérifié | Coût |
|---|---|---|
| `space add` + `space list` | `SPACE.md` écrit, HEAD du dépôt détecté, digest signalé périmé (« aucun digest ») | 0 |
| `space digest` | `DIGEST.md` de 4034 o écrit, structure conforme, contenu exact sur le dépôt réel, 6 tours | 0,1481 USD |
| `specialists` | 6 fiches servies avec `tasks_done` | 0 |
| `ask --specialist architecte-logiciel --space e2e` | routé vers le bon spécialiste, 4 tours, a réellement lu les fichiers via `Read/Glob/Grep` | 0,1573 USD |
| passe mémoire (automatique) | `spaces/e2e/specialists/architecte-logiciel/MEMORY.md` écrit, 2474 o, quatre sections du gabarit respectées | 0,1086 USD |
| `rate … good --decision …` | `DECISIONS.md` créé, daté, 2 décisions enregistrées | 0 |
| `tasks_done` après coup | **1** pour 3 lignes de ledger — le correctif tient sur données réelles | — |

**Un vrai défaut trouvé par cet appel, et par lui seul** : `cli.js ask` n'a jamais transmis
`--space` ni `--specialist` au démon, alors que `usage()` documentait les deux. La première tâche
soumise est partie dans l'espace `default` (donc sans aucune racine, donc sans outils de lecture)
avec le spécialiste `generaliste`. Aucun des 136 tests d'alors ne pouvait l'attraper :
`test-cli.js` ne couvrait que `parseFlags`, et les tests du démon partent d'une charge utile déjà
assemblée — le trou était exactement entre les deux. Corrigé en extrayant l'assemblage dans une
fonction pure `chargeAsk`, couverte par 7 tests neufs, dont un qui compare les drapeaux annoncés
par `usage()` à ceux réellement portés, pour empêcher la récidive.

## Vérification

```bash
cd tools/holarch-d && npm install   # une fois — seule dépendance externe du dépôt (D1)
npm test                          # depuis la racine, branché sur CI
```

**144 tests** à travers 10 fichiers (67 à l'Étape 1, +76 à l'Étape 2, +1 au tour de correctif après
revue : la garde de la passe mémoire sur un plafond atteint), tous purs ou en boucle
fermée — **aucun n'invoque `claude -p`
réel** (même limite assumée que `framework/tests/holarch.test.js`, `CONTRIBUTING.md` : « aucun appel
réseau ») :

- `test-router.js`, `test-launch.js` : assemblage pur (`preparerTriage`, `preparerTacheNiveau1`,
  résolution modèle/effort de `policy.js`, validation du triage, devis).
- `test-ledger.js`, `test-tasks.js` : état sur disque, isolé via `HOLARCH_HOME`.
- `test-daemon-core.js` : orchestration (file, concurrence, annulation, RESULT.md) avec un faux
  `launch` (`fixtures.js`).
- `test-daemon-http.js` : la vraie couche HTTP (`node:http` réel, auth, routage, codes d'erreur)
  avec le même faux `launch`.
- `test-mcp-door.js` : le vrai SDK MCP de bout en bout (poignée de main, `tools/list`, et un
  `tools/call refine_prompt` qui traverse porte → client HTTP → démon réel → cœur, démon démarré
  dans le process de test avec un faux `launch`).
- `test-cli.js` : `parseFlags` **et** `chargeAsk` (les deux morceaux purs de la CLI ; `chargeAsk`
  a été extrait à l'Étape 2 précisément parce que l'assemblage de la charge utile n'était couvert
  par rien — voir « Résultats mesurés (Étape 2) »).
- `test-spaces.js` (Étape 2) : espaces, normalisation de chemins et refus hors racines, mémoire
  par spécialiste, `DECISIONS.md`, fraîcheur et régénération du `DIGEST.md`.
- `test-specialists.js` (Étape 2) : le validateur de fiches et le chargement du catalogue, y
  compris une fiche cassée qui doit être exclue sans faire tomber le reste.

`fixtures.js` (le faux `launch` partagé) est délibérément nommé sans le préfixe `test-` pour ne
pas être ramassé par `node --test tools/holarch-d/test-*.js`.

## Prochaines étapes

Détail complet dans `SPEC.md` §14. Résumé :

- ~~**Étape 2**~~ — **construite** (voir « Ce qui est construit (Étape 2) »). Son critère
  d'abandon reste à juger par l'usage, pas par ce README : après deux semaines, si
  `DIGEST.md`/`DECISIONS.md` ne sont jamais cités utilement dans un résultat, revoir
  l'architecture de mémoire avant d'aller plus loin. Un seul bout-en-bout réel a été fait ici —
  il ne remplace pas ces deux semaines d'usage.
- **Étape 3** — niveau 3 (worktree Git, `holarch-spawn.js --bootstrap`, relances du `concepteur`,
  `answer_task`), ressources MCP, essai d'elicitation.
- **Étape 4** — niveau 2 (panel), `review: true`, fils (`--resume`), hook `on_task_done`.
- **Étape 5** — veilles récurrentes, routage informé par le ledger. Décision séparée, pas un
  prolongement automatique.

**Avant l'étape 3** : atteindre trente appels réels niveau 1 (idéalement depuis Desktop) et juger
honnêtement les critères d'abandon des étapes 1 et 2 — ce README ne le fait pas à la place de
l'usage réel. Le compteur d'appels réels reste très en deçà de trente : l'Étape 2 a été construite
sans que cette condition de l'Étape 1 soit remplie, ce qui est un écart assumé au plan, pas un
oubli.

## Limites assumées

Reprises de `SPEC.md` §15, plus celles spécifiques à cet état d'implémentation :

- Un seul utilisateur, une seule machine ; le démon n'écoute que sur loopback.
- Aucune mémoire d'aucune sorte pour l'instant (pas seulement « inter-espaces » — il n'y a pas
  encore de mémoire du tout, D8/D9 sont étape 2).
- Le routeur est probabiliste ; le niveau et le profil restent toujours à la main de l'appelant
  (`submit_task` exige `profile` explicitement, jamais déduit automatiquement du triage).
- Le devis est statistique et vaut ce que vaut le ledger (encore quasi vide) ; les premières
  estimations sont celles de `POLICY.md`.
- Facturation sur le compte Claude Code local ; la sémantique de `--effort`, `--json-schema` et
  `--output-format stream-json` peut évoluer avec le CLI — vérifiée sur la version installée au
  moment du scaffold (2026-09-04), pas verrouillée.
- Desktop ne reçoit aucune notification push ; il faut revenir voir (`on_task_done` : étape 4).
- Dépendance externe unique (`@modelcontextprotocol/sdk`), `npm install` requis dans
  `tools/holarch-d/` ; le reste du dépôt n'en dépend pas (`.gitignore` exclut `node_modules/`).
- Aucun mécanisme de purge des transcripts/tâches anciennes (§12 : 30 jours pour les transcripts,
  paramètre non encore branché).
- **Testé contre un vrai Claude Desktop** (voir « Résultats mesurés » — cycle complet, annulation
  incluse) mais sur un volume encore trop faible pour juger le critère d'abandon de l'étape 1
  (trente appels réels).

## Points non résolus

Repris de `SPEC.md` §16. **Deux ont été tranchés à l'Étape 2** (barrés ci-dessous) ; les autres
n'ont toujours pas été mesurés, faute de test contre Desktop :

- Support par Claude Desktop des notifications de ressources et de l'elicitation — sans objet tant
  que les ressources MCP (étape 3) n'existent pas, mais le repli `waiting_user` reste la voie par
  défaut quoi qu'il arrive.
- ~~`--resume` et `--output-format json` ensemble~~ — **mesuré à l'Étape 2 : fonctionne** (voir
  « Résultats mesurés (Étape 2) »). La passe mémoire D9 utilise `--resume`. **Reste ouvert** : la
  combinaison `--resume` + `--output-format stream-json`, non mesurée, sans usage actuel dans le
  code — à vérifier avant l'étape 4 (fils de discussion) si `stream-json` devient nécessaire.
- ~~Gouvernance de `DECISIONS.md` (suppression vs. `superseded`)~~ — **tranché à l'Étape 2** :
  append-only strict avec `supersedes`, jamais de suppression.
- **Nouveau (Étape 2)** : le coût de la passe mémoire par `--resume` (0,1086 USD mesuré, ~70 % du
  coût de la tâche) est plus élevé qu'anticipé. Faut-il la conditionner (seulement si la tâche a
  produit quelque chose de nouveau), la grouper, ou la basculer sur le mode `neuf` ? Pas assez de
  mesures pour trancher — un seul point.
- **Nouveau (Étape 2)** : une mémoire de spécialiste devient orpheline si la fiche correspondante
  est retirée du catalogue, sans aucun signal. Repéré pendant la validation de bout en bout (par
  le spécialiste lui-même, d'ailleurs), non traité.
- Espace sans dépôt Git et niveau 3 — question d'étape 3.
- Rétention des branches `holon/task-*` — question d'étape 3, jamais mesurée.
- Cowork et lecture directe de `~/.holarch/tasks/<id>/RESULT.md` — à observer une fois qu'un usage
  réel existe.
