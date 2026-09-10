# Module : reserve-hibernation
> Catégorie : recursion
> Version : 1.0.0
> Requiert : —
> Incompatible avec : —
> Complète bien : context-budget, direct-spawn, monolithic, heartbeat-log, instance-budget

## Constat

Le KERNEL impose (§2 phase 9 ; §5.3) qu'aucune session ne meure sans passer par `ON_SLEEP`, et que
`MEMORY.md` permette à une session neuve de reprendre le travail sans autre information que les
fichiers de l'instance. Mais `MEMORY.md` (sous `monolithic`) est réécrit **en bloc, uniquement à
`ON_SLEEP`** : une session interrompue à mi-parcours par l'épuisement de son plafond de dépense
(`budget_usd_par_session`, `direct-spawn`) n'a rien écrit avant d'être coupée, et la session suivante
repart de l'état d'avant. Ce n'est pas hypothétique : c'est arrivé à la session 11 de `concepteur`
(perte de mémoire réelle) — après quoi il s'est imposé lui-même, sur quatre sessions consécutives, la
discipline que ce module met en règle injectée : réserver une part du budget de dépense pour
l'hibernation, et déclencher `ON_SLEEP` dès que le restant passe sous cette réserve, **travail fini
ou non**. `heartbeat-log` atténue le symptôme (on constate jusqu'où une session est allée) mais ne
rend pas la reprise possible, seulement visible ; `context-budget` borne un axe voisin — le contexte
en tokens d'une session — mais pas la dépense en USD.

**Constat de première main, vérifié pendant la conception de ce module plutôt que supposé** (KERNEL
§5.4) : contrairement au compteur d'unités de `context-budget`, qui reconnaît lui-même reposer sur
une heuristique auto-rapportée faute de pouvoir lire un compteur réel depuis l'intérieur d'une
session, **le budget de dépense en USD est réellement observable**. À chaque appel d'outil de cette
session de conception, le harnais a injecté après le résultat une ligne au format exact :

```
USD budget: $0.1651764/$5; $4.8348236 remaining
```

— cité mot pour mot, sans arrondi de ma part, tel qu'observé pendant cette session. Cette ligne
n'est produite par aucune règle HOLARCH : elle vient du harnais sous-jacent (le CLI lancé par
`direct-spawn` avec `--max-budget-usd`, `framework/bin/holarch-spawn.js:274`), indépendamment de tout
hook `framework/hooks/holarch-hooks.js` — qui ne contient aujourd'hui **aucun** hook de surveillance du
budget en USD (seul `context-watch` existe, pour les tokens). Ce module ne réclame donc pas un
nouveau mécanisme d'instrumentation : il documente en règle un signal déjà exposé, mais jamais encore
exploité par aucune règle du catalogue.

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|
| reserve_usd | 1.2 | Montant de dépense (USD) sous lequel une hibernation volontaire est déclenchée immédiatement, quel que soit l'avancement du travail. Valeur empirique : c'est ce que `concepteur` a observé nécessaire, sur quatre sessions, pour écrire `MEMORY.md`, `STATUS.md`, sa fiche registre, une ligne `PROGRESS.md` et committer — pas une valeur mesurée ni consacrée par la spec. À garder comme défaut documenté par son origine, ou à remplacer par une fraction du plafond de session si celui-ci varie fortement d'une instance à l'autre (ce module n'impose que la variante en montant absolu ; une variante en fraction resterait conforme à son esprit mais suppose une nouvelle règle). |
| seuil_alerte_usd | 2.4 | Montant restant sous lequel une note de vigilance est consignée dans `JOURNAL.md` (si le module mémoire actif le permet) sans encore déclencher l'hibernation — un palier d'anticipation avant la réserve dure. Fixé par défaut au double de `reserve_usd` ; les deux paramètres varient indépendamment si l'un est recalibré sans l'autre. |

## Règles injectées

### ⚓ ON_ORIENT
Consigne dans ton plan de session, avant de commencer à travailler, le montant de `reserve_usd` que
tu t'imposes et le budget total de la session (`budget_usd_par_session`, `direct-spawn`) : par
exemple « réserve 1,2 USD sur 5, j'hiberne dès que le restant observé passe sous ce seuil ». Si le
system-reminder de budget (voir Constat) n'apparaît jamais après un appel d'outil dans cette session,
note-le explicitement ici : ce module n'a alors aucun signal fiable à surveiller (voir « Ce que ce
module ne fait pas ») et le reste de ses règles reste sans objet pour la session courante.

### ⚓ ON_SUPERVISE
Après chaque appel d'outil, lis le montant « remaining » du dernier system-reminder de budget reçu
(voir Constat pour le format exact) — ne le devine ni ne l'extrapole à partir du nombre de tours ou
de l'ampleur du travail effectué, lis la valeur telle qu'exposée.

- Si ce montant passe sous `seuil_alerte_usd` mais reste au-dessus de `reserve_usd` : consigne une
  ligne de vigilance (montant restant observé, unité de travail en cours) dans `JOURNAL.md` ou, à
  défaut, dans ta prochaine ligne `PROGRESS.md` si `heartbeat-log` est actif — sans interrompre le
  travail.
- Si ce montant passe sous `reserve_usd` : traite-toi immédiatement comme si tu atteignais
  `ON_SLEEP`, **sans terminer l'unité de travail en cours** si elle n'est pas déjà achevée — c'est le
  point qui distingue cette règle d'un simple garde-fou de fin de tâche : la réserve existe justement
  pour le cas où le travail n'est pas fini. Mets à jour `MEMORY.md` intégralement (module mémoire
  actif), `STATUS.md` à son état réel (jamais `DELIVERED` si le travail n'est pas fini), consigne dans
  `JOURNAL.md` le montant exact observé au déclenchement et la mention explicite « hibernation
  volontaire (budget) », committe, puis termine la session. Le lanceur (`direct-spawn` v1.1) ou ton
  parent te ré-incarne — voir « Recouvrement » ci-dessous pour ce que cette règle attend précisément
  de la ré-incarnation.

### ⚓ ON_SLEEP
Si l'hibernation en cours a été déclenchée par ce module (et non par une fin de mission normale ni
par `context-budget`), vérifie que la Note de `STATUS.md` porte bien « hibernation volontaire
(budget) » — pas « (contexte) », qui reste réservée au module `context-budget` — pour qu'un
observateur externe (`heartbeat-log`, ou une relecture humaine de `registry/SESSIONS.md`) distingue
sans ambiguïté quel garde-fou a déclenché l'arrêt.

## Recouvrement avec `context-budget` — assumé, pas nié

Les deux modules partagent le même mécanisme d'hibernation volontaire (KERNEL §5.8) et la même
alternative de reprise, mais mesurent deux grandeurs indépendantes : `context-budget` borne
l'accumulation de contexte (tokens) à l'intérieur d'une session, `reserve-hibernation` borne
l'épuisement de sa dépense (USD). Une même session peut déclencher l'un, l'autre, ou aucun des deux
selon ce qui s'épuise en premier — ce n'est pas une redondance, c'est une couverture de deux axes de
croissance différents, exactement comme `context-budget` le formule lui-même pour sa propre relation
à `instance-budget`/`max-depth` (« un autre axe »). Contrairement à `context-budget` avant
`direct-spawn` v1.1, ce module ne dispose d'aucune heuristique de repli auto-rapportée : soit le
system-reminder de budget est observé (cas constaté dans cette session de conception, voir Constat),
soit il ne l'est pas et ce module est inerte pour la session — il n'y a pas de compteur approximatif
équivalent à `seuil_unites` que je puisse proposer de bonne foi pour les dollars, faute d'un proxy
fiable et auditable.

Sur la ré-incarnation : cette règle **ne l'exige pas** et **ne la demande pas** explicitement — elle
se contente, comme `context-budget`, de terminer proprement la session (`MEMORY.md` complet,
`STATUS.md` réel, commit) et laisse la reprise à qui incarne l'instance ensuite. Si la session a été
lancée par `holarch-spawn.js` (`direct-spawn` v1.1), le lanceur ré-incarne automatiquement dans la
limite de `relances_max`, exactement comme il le fait pour une hibernation de contexte — ce module ne
duplique pas ce mécanisme, il ne fait que produire la même condition de sortie (processus terminé,
`STATUS.md` cohérent) qui le déclenche côté lanceur. Si la session n'a pas été lancée par
`holarch-spawn.js`, aucune ré-incarnation automatique n'a lieu : c'est au parent de relancer
`commande_cli`, comme documenté pour une session enfant plantée (`direct-spawn`, `ON_SUPERVISE` point
4).

## Ce que ce module ne fait pas

- Il ne mesure rien lui-même : il lit un signal déjà exposé par le harnais sous-jacent
  (`--max-budget-usd`), il ne l'instrumente pas. Si une session n'est jamais lancée avec ce drapeau —
  hors du chemin `direct-spawn` documenté dans ce dépôt — aucun system-reminder de budget n'apparaît,
  et ce module n'a alors ni signal à lire ni heuristique de repli à proposer : il devient
  silencieusement sans objet plutôt que de deviner un montant (devoir d'honnêteté, KERNEL §5.4).
- Il ne fixe pas de plafond de dépense : `budget_usd_par_session` (`direct-spawn`) et
  `--max-budget-usd` restent les seuls fusibles durs. Ce module ne fait que déclencher une sortie
  volontaire et propre *avant* que le fusible dur ne coupe la session sans laisser de trace
  exploitable.
- Il ne modifie ni ne remplace `context-budget` : les deux coexistent, chacun sur son axe, sans
  qu'aucun ne rende l'autre superflu.
- Il ne garantit pas que `reserve_usd` (1,2 USD par défaut) suffise dans tous les cas : c'est une
  valeur observée sur quatre sessions d'une seule instance (`concepteur`), pas une mesure calibrée sur
  un échantillon large — une mission dont l'écriture de `MEMORY.md`/commit coûte structurellement plus
  cher (fichiers plus volumineux, sous-agents de relecture plus fréquents) devrait recalibrer ce
  paramètre plutôt que le garder par défaut sans vérification.
