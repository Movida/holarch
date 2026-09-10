# Module : direct-spawn
> Catégorie : orchestration
> Version : 1.3.0
> Requiert : —
> Incompatible avec : —
> Complète bien : fork-join, dependency-graph, instance-budget, max-depth, context-budget

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|
| commande_cli | `node framework/bin/holarch-spawn.js <chemin>` | Commande d'incarnation d'un enfant. Le lanceur résout lui-même modèle, effort, plafonds et options du CLI Claude Code (`docs/holarch.md` §16) : ne jamais appeler `claude -p` directement. |
| modele_cli | *(politique par profil)* | Modèle imposé à tous les profils s'il est renseigné (alias `opus`, `sonnet`, `fable`, `haiku`, ou identifiant complet). Laisser absent pour appliquer la politique par profil ci-dessous. |
| effort_cli | *(politique par profil)* | Effort imposé à tous les profils s'il est renseigné (`low`, `medium`, `high`, `xhigh`, `max`). |
| modele_repli | *(aucun)* | Modèle de repli si le modèle principal est surchargé (`--fallback-model`). |
| budget_usd_par_session | 5 | Plafond de dépense d'une session, estimation au tarif liste (`--max-budget-usd`). |
| max_tours_par_session | 200 | Plafond de tours agentiques d'une session (`--max-turns`). |
| seuil_contexte_tokens | 120000 | Contexte réel (tokens) au-delà duquel le hook `context-watch` ordonne l'hibernation volontaire. |
| autocompact_tokens | 180000 | Dernier recours si l'instance ignore l'ordre d'hiberner : fenêtre de compaction automatique de Claude Code (`--autocompact`). |
| outils_cli | Read,Write,Edit,Bash,Glob,Grep,Agent,TodoWrite | Outils Claude Code disponibles (`--tools`) ; les autres n'entrent pas dans le contexte. |
| relances_max | 2 | Ré-incarnations automatiques par le lanceur après une hibernation volontaire de contexte. |
| changements_regime_max | 1 | Ré-incarnations automatiques par le lanceur après un changement de régime décidé par l'instance (ligne `Profil` ou `Effort` de sa fiche registre modifiée, puis hibernation volontaire — règle `ON_PLAN`), décomptées à part de `relances_max`. |
| mode_attente | synchrone | `synchrone` : `ON_SUPERVISE` attend la fin complète du processus de chaque enfant avant de passer au suivant (comportement historique de ce module, inchangé). `detache` : chaque enfant `READY` est lancé avec `--detach` (§ « Réveil par condition » ci-dessous) — aucune session parent ne reste vivante à l'attendre. |

## Politique de modèle par profil
Chaque instance porte un **profil** : champ `Profil` de sa fiche registre, posé par son parent à `ON_SPAWN` (`conception` pour la racine, posé au bootstrap). Le lanceur en déduit le modèle et l'effort par défaut d'après la table `## Politique de modèle` de `CONFIG.md` ; à défaut, ces valeurs par défaut :

| Profil | Modèle | Effort par défaut | Quand l'attribuer |
|---|---|---|---|
| conception | opus | high | Racine, parents, rôles de décomposition, d'arbitrage ou de synthèse multi-sources, critères d'acceptation encore flous |
| execution | sonnet | medium | Livrable précis, critères d'acceptation vérifiables (rédaction cadrée, code spécifié, conversion, extraction) |
| relecture | opus | medium | Revue, audit ou vérification indépendante d'un livrable |
| exploration | fable | xhigh | Chemin de solution inconnu au moment du spawn : problème ouvert, forte incertitude, plusieurs sessions attendues, raisonnement long ou de haut niveau (recherche, conception sous contrainte, diagnostic difficile). Le modèle le plus capable et le plus coûteux : pour ce qui dépasse ce que `conception` sait faire, jamais pour compenser un `ROLE.md` flou |

Règles : (a) en cas de doute, `execution` avec des critères d'acceptation plus précis dans le `ROLE.md`, plutôt qu'un modèle plus fort avec un `ROLE.md` flou — un modèle fort ne compense pas une mission mal cadrée ; (b) jamais `haiku` pour une instance (boucle agentique longue) — il reste réservé aux sous-agents de lecture internes à une session ; (c) la précédence est : option de ligne de commande > ligne `Effort` de la fiche registre (effort seulement) > table `## Politique de modèle` > `modele_cli`/`effort_cli` explicites > défauts ci-dessus ; (d) pour une question de raisonnement bornée en cours de session (un arbitrage difficile, une preuve, la critique d'un design), un sous-agent `Agent` avec `model: fable` coûte moins qu'un changement de régime — il ne le remplace pas quand c'est toute la suite du travail qui dépasse le régime courant.

**Effort par instance.** L'effort n'est pas une propriété du profil mais de la tâche. À `ON_SPAWN`, juge-le pour chaque enfant d'après trois questions — la nature de la tâche (routinière et bien spécifiée, ou ouverte), la difficulté du projet (inconnues, dépendances, taille), la rigueur attendue du résultat (brouillon, livrable revu par toi, livrable promu tel quel ou irréversible) — et pose-le dans sa fiche registre par la ligne `| Effort | <valeur> |`, optionnelle : absente, l'effort par défaut du profil s'applique. Repères :

| Effort | Quand |
|---|---|
| low, medium | Travail routinier ou bien spécifié où une erreur se voit et se corrige à peu de frais ; sous-tâches courtes |
| high | Défaut raisonnable de tout travail intellectuel ; la plupart des instances `conception` et `relecture` |
| xhigh | Tâche longue ou agentique dont la qualité dépend de la capacité du modèle (code non trivial, conception, diagnostic) ; défaut d'`exploration` |
| max | L'exactitude prime sur le coût : livrable irréversible, promu sans relecture, ou dont l'erreur coûterait plus qu'une session entière |

Un effort plus élevé allonge chaque tour et consomme davantage de budget de session pour le même nombre de tours ; au tarif liste, `fable` coûte deux fois `opus`, donc `budget_usd_par_session` tombe deux fois plus vite sur une instance `exploration` — sous forfait, ce montant mesure l'usage, pas une facture (`docs/holarch.md` §16.4).

**Changement de régime.** Le modèle et l'effort d'une session sont fixés à son lancement ; une instance ne peut en changer qu'**entre deux sessions**, en modifiant sa propre fiche registre — le lanceur la relit à chaque ré-incarnation. Un changement est légitime quand la session constate que la tâche excède son régime : critères d'acceptation atteignables mais chemin inconnu, deux sessions sans progrès mesurable sur la même unité de travail, incertitude que le parent n'avait pas au moment du spawn. Il est illégitime pour compenser un `ROLE.md` flou (règle (a) : `QUESTION` ou `BLOCKER` au parent) ou un contexte mal géré (hiberne, ne monte pas). Le mouvement inverse — revenir à un régime plus économique une fois la partie difficile derrière soi — suit la même procédure : c'est le devoir d'économie (KERNEL §5.8). Ce terme est distinct de l'« escalade » du KERNEL §8, qui désigne la remontée d'un conflit vers un ancêtre.

## Réveil par condition

Une instance qui attend (`WAITING_CHILDREN` ou `BLOCKED`) peut hiberner au lieu de laisser une session
vivante attendre : elle écrit une **condition de réveil** dans la ligne `| Réveil | <condition ou —> |`
de son `STATUS.md` (gabarit `STATUS.template.md`), puis termine sa session normalement (`ON_SLEEP`).
Grammaire, portée par `framework/bin/reveil.js` (`parseReveil`/`formatReveil`/`evalReveil`) :

```
condition  := terme | "tous(" liste ")" | "lun(" liste ")"
liste      := terme { "," terme }
terme      := "message:" TYPE
            | "enfant:" NOM ":" ETAT
            | "enfants:" ETAT
            | "fichier:" CHEMIN
            | "date:" ISO8601
TYPE       := TASK | DELIVERABLE | BLOCKER | CLARIFICATION | PROPOSAL | ALERT | RESPONSE
ETAT       := INIT | READY | WORKING | WAITING_CHILDREN | BLOCKED | DELIVERED | FAILED | ARCHIVED
NOM        := nom de rôle d'un enfant direct (kebab-case), ou chemin depuis mission/ s'il contient "/"
CHEMIN     := chemin relatif à la racine du dépôt, sans espace
```

Sémantique : `message:T` est vrai si `INBOX.md` contient un message de type `T` dont la `date:` est
postérieure au dernier commit touchant `STATUS.md` de l'instance ; `enfant:n:E` si `STATUS.md` de
l'enfant est à l'état `E` ; `enfants:E` si tous les enfants directs incarnés (sous-répertoires avec
`STATUS.md`, hors `workspace/`) sont à `E` et qu'il en existe au moins un ; `fichier:c` si le fichier
existe ; `date:d` si l'horloge est ≥ d. Les espaces sont ignorés. `—` (ou vide) = aucune condition,
aucune attente. Une condition invalide vaut « aucune condition » et produit un avertissement dans la
ligne de synthèse du lanceur ; le hook `sleep-guard` refuse l'hibernation d'une instance
`WAITING_CHILDREN`/`BLOCKED` dont la ligne `Réveil` est vide ou invalide (spec §3.3).

`wakeWaiters(root, declencheur)` (dans `holarch-spawn.js`) évalue, à chaque fin de lancement
(`finishLaunch`) et depuis `--reveil`/`tools/holarch-watch/watch.js`, toutes les instances dont
`STATUS.md` porte une condition ; pour chacune satisfaite, non `isLive` et à l'état `WAITING_CHILDREN`,
`BLOCKED` ou `READY`, elle relance l'instance (`detachLaunch`) et journalise dans
`mission/registry/REVEILS.md`. Elle ne réveille jamais l'instance qui vient elle-même de finir.

## Règles injectées

### ⚓ ON_SPAWN
Pour chaque enfant que tu décides de créer, applique d'abord la mécanique structurelle invariante (KERNEL §9 : création des répertoires et fichiers, fiche registre, `ORG.md`, commit). Ajoute dans sa fiche registre la ligne `| Profil | conception |`, `| Profil | execution |`, `| Profil | relecture |` ou `| Profil | exploration |` selon la politique ci-dessus et, si l'effort par défaut du profil ne convient pas à la tâche, la ligne `| Effort | low |` (ou `medium`, `high`, `xhigh`, `max`) ; justifie ces deux choix en une ligne dans ton `JOURNAL.md`. Ce module ne modifie pas la mécanique de spawn — il ne régit que ce qui se passe *après*, à `ON_SUPERVISE`.

### ⚓ ON_PLAN
Avant de décider entre faire seul et décomposer, demande-toi si ton régime (profil, modèle et effort de cette session, rappelés par le harnais dans ton prompt) suffit à la tâche. S'il ne suffit pas selon les critères de « Changement de régime » ci-dessus, et si ta fiche ne porte pas déjà un changement de ta main :
1. Mets à jour ta fiche registre : ligne `Profil` (vers `exploration`, ou `conception` depuis `execution`) et/ou ligne `Effort`. Un seul changement de régime par instance ; jamais vers `haiku`.
2. Justifie-le par une entrée de `JOURNAL.md` (ce qui a été tenté, pourquoi le régime courant ne suffit pas, ce que la session suivante devra faire en premier) et par une ligne de `PROGRESS.md` — `<ISO 8601> · <ton chemin> · ON_PLAN · changement de régime <ancien> → <nouveau> : <motif en cinq mots>` — pour que ton parent le voie pendant que tu travailles.
3. Termine la session par `ON_SLEEP`, `STATUS.md` laissé à `WORKING` avec la note « hibernation volontaire (changement de régime : <ancien> → <nouveau>) », `MEMORY.md` complet, commit. Le lanceur te ré-incarne sur le nouveau régime avec un contexte neuf (`changements_regime_max` fois au plus, décompté à part des ré-incarnations de contexte) ; la ligne de `registry/SESSIONS.md` de chaque session en porte la trace mécanique (colonne modèle/effort).

### ⚓ ON_SUPERVISE
Pour chaque enfant à l'état `READY`, dans l'ordre où tu les as créés :

**Si `mode_attente = synchrone`** (défaut, inchangé) :
1. Substitue `<chemin>` dans `commande_cli` et lance-la avec l'outil Bash. Le lanceur injecte lui-même le contrat (KERNEL, CONFIG, modules actifs) et les fichiers de l'enfant dans son prompt, applique la politique de modèle, les plafonds (tours, dépense, contexte) et les garde-fous (hooks), puis ajoute une ligne à `mission/registry/SESSIONS.md` (append-only : coût réel, tokens, tours, identifiant de session). Ne lance jamais `claude -p` à la main.
2. Attends la fin **complète** du processus avant de passer à la suite : ne lance jamais un second enfant avant que le processus du précédent ne soit terminé, et ne considère jamais un enfant comme traité tant que son processus tourne encore. Un enfant peut travailler longtemps : ne fixe aucun timeout court à l'outil Bash (le harnais autorise jusqu'à quatre heures).
3. À la fin du processus, lis **uniquement** la ligne de synthèse imprimée par le lanceur (`HOLARCH ▸ <chemin> ▸ STATUS=… · tours · coût · durée`), puis le `STATUS.md` et l'`INBOX.md` mis à jour de l'enfant, et traite l'événement au hook `ON_CHILD_DONE`. Ne lis pas les journaux bruts de `mission/.holarch/` sauf pour diagnostiquer une panne.
4. Si le lanceur signale que `STATUS.md` est resté à `WORKING` (code de sortie 2 : session plantée ou `ON_SLEEP` non exécuté), traite-le comme une session enfant plantée (spec §12) : relance `commande_cli` une fois (l'instance reprend via `MEMORY.md`) ; un deuxième échec consécutif fait passer l'enfant à `FAILED` et déclenche un recadrage (KERNEL §10). Une hibernation volontaire de contexte dont les ré-incarnations sont épuisées (code de sortie 3) n'est **pas** un échec : relance simplement `commande_cli`.

**Si `mode_attente = detache`** :
1. Lance chaque enfant `READY` avec `node framework/bin/holarch-spawn.js <chemin> --detach` ; le
   processus rend la main immédiatement, lis la ligne `HOLARCH ▸ <chemin> ▸ détaché · tâche <id>`
   (aucune attente : ne bloque jamais sur ce lancement).
2. Une fois **tous** les enfants du lot lancés, passe ton propre `STATUS.md` à `WAITING_CHILDREN` avec
   `Réveil` = `enfants:DELIVERED` (sous `fork-join`) ou `lun(enfant:a:DELIVERED, enfant:b:DELIVERED, …)`
   pour les enfants du lot courant (sous `dependency-graph`). Un enfant qui passe `BLOCKED` ou `FAILED`
   doit aussi réveiller le parent : préfère `lun(enfants:DELIVERED, message:BLOCKER, message:ALERT)`.
3. Hiberne (`ON_SLEEP`) : aucune session parent ne reste vivante à attendre — `wakeWaiters` te
   relancera (`detachLaunch`) dès que la condition sera satisfaite.

Ne lance jamais un enfant dont les dépendances déclarées (si un module de synchronisation à dépendances est actif) ne sont pas satisfaites — dans ce cas, laisse la décision d'ordre au module de synchronisation actif ; `direct-spawn` ne fournit que le mécanisme de lancement, pas l'ordonnancement.

### ⚓ ON_WAKE
Si `mode_attente = detache` et que ta session a été relancée par un réveil (`wakeWaiters`/`--reveil`,
visible dans la ligne de synthèse ou dans `mission/registry/REVEILS.md`) alors que ton `STATUS.md`
porte une condition désormais satisfaite : traite `ON_CHILD_DONE` pour chaque enfant listé par la
condition (`enfant:NOM:ETAT`, ou tous les enfants de la condition `enfants:ETAT`/`lun(...)`), puis
reprends le cycle normalement (§2 KERNEL) — ne considère pas ce réveil comme un événement à part,
seulement comme la suite de `ON_SUPERVISE` en mode détaché. En mode `synchrone`, cette règle est sans
objet (le parent reste vivant, `isLive` empêche tout réveil parasite).

### ⚓ ON_CHILD_DONE
Si la ligne de synthèse du lanceur (`opus/high → fable/xhigh`) ou `registry/SESSIONS.md` montre qu'un enfant a changé de régime, lis sa justification dans son `JOURNAL.md` avant de juger son livrable : un changement motivé par un `ROLE.md` flou est un défaut de cadrage qui t'appartient (KERNEL §10), pas une faute de l'enfant. Note ton verdict dans ton `JOURNAL.md` ; un enfant ne change de régime qu'une fois, et un enfant qui aurait besoin d'un second changement relève d'un recadrage, pas d'une relance.

## Ce que le lanceur garantit — et ce qu'il ne garantit pas
- Garantit : modèle par profil et effort par instance (ligne `Effort` de la fiche registre) ; ré-incarnation sur le nouveau régime après un changement de régime, signalée dans la ligne de synthèse et décomptée à part (`changements_regime_max`) ; contexte fixe réduit et identique pour toutes les instances de la mission (outils restreints, skills et serveurs MCP exclus, mémoire automatique de Claude Code désactivée — toute la mémoire d'une instance vit dans ses fichiers, KERNEL §1 ; prompt système partagé, donc cache de prompt partagé) ; plafonds de tours, de dépense et de contexte ; refus mécanique des écritures sous `framework/` et dans `mission/OBJECTIVE.md` (deux niveaux redondants — `--disallowedTools` et `permissions.deny`, en motifs relatifs à la racine du dépôt ; un défaut de l'un des deux, motifs absolus donc inertes, a laissé passer l'écriture en conditions réelles jusqu'au 2026-09-03, constat D2 — vérifié corrigé par un test d'intégration qui lance une vraie session, `framework/tests/B3-refus-ecriture.test.js`, opt-in `HOLARCH_E2E=1`) ; refus immédiat, sans blocage, des commandes non autorisées ; fin de session impossible sans `ON_SLEEP` (STATUS cohérent, changements committés) ; ré-incarnation après hibernation volontaire ; en mode `detache`, aucune session parent ne reste vivante entre le lancement d'un enfant et son réveil (`wakeWaiters`/`tools/holarch-watch/watch.js`).
- Ne garantit pas : la qualité du livrable (devoir de supervision, KERNEL §5.2), ni la répartition fine des budgets d'instances (le fusible ne vérifie que « alloué > 0 » et « consommé ≤ alloué » sur ta fiche — `instance-budget` reste la règle), ni la protection de `framework/` contre un script arbitraire lancé par Bash, ni le déclenchement du réveil lui-même en l'absence de tout événement (`date:`/`fichier:` : nécessitent `tools/holarch-watch/watch.js` en boucle, aucun lanceur d'enfant ne les évalue spontanément).

## Note de version
1.2.0 → 1.3.0 : le libellé « v1.2.0 » utilisé par `docs/IMPLEMENTATION.md` §3.4 pour ce module désignait
la version cible au moment de la rédaction de la spec ; le fichier réel avait entretemps déjà atteint
1.2.0 pour une raison indépendante (chantier 2 sans lien). Bump vers 1.3.0 pour rester monotone —
décision de rédaction autonome (`ROLE.md`, Autorité), signalée ici plutôt que par `PROPOSAL` séparée.
