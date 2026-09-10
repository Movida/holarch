# CHANGELOG — framework HOLARCH

> Une entrée par version publiée du framework (`framework/VERSION`, semver). La version globale
> est celle que `tools/holarch-publish` dépose dans le modèle et que `tools/holarch-upgrade` compare
> avant de proposer une mise à jour à un projet. Les versions par module restent dans `MANIFEST.md`.
>
> Règle de numérotation : **patch** = harnais seul (`bin/`, `hooks/`, `claude/`, `tests/`), aucun
> fichier du contrat touché ; **mineure** = contrat étendu sans rien casser (module, paramètre,
> template, preset ajouté ou enrichi) ; **majeure** = un fichier d'instance ou un `CONFIG.md` écrit
> sous l'ancienne version peut ne plus être valide (section obligatoire ajoutée à un template,
> module retiré ou renommé, catégorie ou incompatibilité nouvelle).

## 1.5.0 — 2026-09-10

Mineure (paramètre de module ajouté) : « chantier coût », premier volet — plus d'humain dans la boucle
de continuation, moins de tours perdus.

- Continuation autonome (`direct-spawn` 1.4.0, lanceur) : `relances_max` ne compte plus les
  ré-incarnations mais les sessions consécutives **sans progrès** (aucune nouvelle fiche
  `memoire/U<n>-*.md`, aucun commit `[<chemin>]`) — une session qui progresse remet le compte à zéro ;
  nouveau plafond absolu `sessions_max_par_instance` (24, toutes invocations confondues, compté dans
  `SESSIONS.md`). Épuisé : le lanceur dépose un `ALERT` (provenance `harnais`) dans l'INBOX du
  parent, dont la condition `message:ALERT` le réveille — il décide (relance détachée, `TASK`,
  `FAILED`). Observé avant : un enfant détaché épuisait ses 2 relances au bout de 3 sessions et la
  mission s'arrêtait en silence, aucune condition du parent n'étant vraie (mission `holarch-isolation`,
  10:40 UTC). Test `tests/relances-progres.test.js` ; B2 adapté au nouveau libellé.
- Allowlist des instances (`claude/instance-settings.json`) : `ls`, `wc`, `head`, `tail`, `grep`,
  `find`, `diff`, `date`, `echo`, `printf`, `pwd`, `true` — 3 à 5 refus par session observés sur ces
  commandes et sur des commandes composées (`… ; echo …`), chacun un tour perdu ; la description du
  harnais injectée au réveil liste les commandes et rappelle « jamais `git -C` ».

## 1.4.1 — 2026-09-10

Patch (outils, aucun fichier du contrat ni du harnais touché) : la CI du dépôt canonique cassait par
intermittence sur `tools/holarch-publish` (`ENOTEMPTY: directory not empty, rmdir …/.git/objects` à
la suppression du clone temporaire de publication) et, de la même famille, sur le test « source Git :
clone par tag » de `tools/holarch-upgrade`. Cause : une maintenance Git détachée (`gc --auto`,
`maintenance run --auto`) écrivant encore dans `.git/objects` pendant `rmSync`. Correctif : `gc.auto=0`
et `maintenance.auto=false` dans les clones jetables (outil et tests), suppression avec reprises
(`maxRetries`/`retryDelay`) dans les deux outils. Republié dans le modèle pour que la CI d'un projet
issu du modèle ne le subisse pas (`holarch-upgrade` en fait partie).

## 1.4.0 — 2026-09-10

Mineure, après le dogfooding réel du §3.9 (`docs/diagnostics/2026-09-10-dogfooding-reveil-par-condition.md` :
détachement → hibernation → livraison → réveil automatique → clôture, trois sessions, 6,28 USD,
aucune intervention).

- Contrat : presets `solo-light` et `module-forge` passent de `monolithic` à `unites-indexees` —
  mesure réelle : prompt de réveil de la racine réveillée 11 160 caractères avec trois fiches
  d'unité, contre 41 492 en `monolithic` sur le corpus archivé ; `team-standard` garde
  `journal-synthesis`. Un `CONFIG.md` existant n'est pas touché (les presets sont des modèles).
- Harnais : `sleep-guard` ignore les fichiers en vol d'une autre instance vivante (sous-arbre, zone
  `shared/`, fiche registre — verrou de pid `mission/.holarch/live/`, le même que le lanceur).
  Observé : le parent, en clôturant sa session pendant que son enfant détaché écrivait, était forcé de
  committer les fichiers de l'enfant (« instantané de fin de session », deux fois). Test
  `tests/sleep-guard-instance-vivante.test.js`.
- Hors framework : `tools/holarch-init` proposait encore `monolithic` par défaut ; aligné le jour
  même (`unites-indexees` sauf audit fin demandé), sans effet sur cette version.

## 1.3.0 — 2026-09-10

Mineure (contrat étendu, rien cassé) : chantier 2 « réveil par condition, lanceur détachable, arrêt
propre » (`docs/IMPLEMENTATION.md` §3), livré par la mission `holarch-fondations` dans
`docs/archive/mission-holarch-fondations/shared/concepteur/chantier-2-reveil-par-condition/` et appliqué par son `appliquer.js`
(ancres du chantier 1 vérifiées : l'ordre des chantiers est garanti par construction).

- Contrat : `templates/STATUS.template.md` gagne le champ `Réveil` (grammaire fermée — `message:TYPE`,
  `enfant:NOM:ETAT`, `enfants:ETAT`, `fichier:CHEMIN`, `date:ISO8601`, combinés par `tous(…)` ou
  `lun(…)`) ; `orchestration/direct-spawn` passe en 1.3.0 (règle `ON_SUPERVISE` : un parent qui attend
  hiberne en `WAITING_CHILDREN` avec sa condition, il ne reste plus vivant sur un Bash).
- Harnais : `bin/reveil.js` (analyse et évaluation des conditions, `listWaiters`) ; `bin/holarch-spawn.js`
  gagne `--detach` (identifiant, `mission/.holarch/tasks/<id>.json`, verrou de pid `isLive`),
  `--reveil` (évaluation ponctuelle, réservée au harnais et à l'utilisateur), `--taches`, `--arret
  <chemin>` (demande d'arrêt propre, fichier `mission/.holarch/stop/<instance>`), `wakeWaiters` à la
  fin de chaque session (trace append-only `mission/registry/REVEILS.md`) et le seam de test
  `HOLARCH_FAKE_CLAUDE` (`tests/fake-claude.js`). Hooks : `sleep-guard` refuse `WAITING_CHILDREN` et
  `BLOCKED` sans `Réveil` valide ; `spawn-guard` soumet `--detach` aux mêmes règles et refuse `--reveil`
  et `--arret` à une instance ; `context-watch` relaie une demande d'arrêt une seule fois par session
  (note « hibernation volontaire (arrêt demandé) », jamais ré-incarnée).
- Ajouté à la promotion, d'après l'audit de `concepteur` (`PROMOTION.md` §3) : l'avertissement de
  synthèse du §3.1 (ligne `Réveil` invalide signalée par le lanceur, traitée comme « aucune
  condition ») et les deux assertions `SESSIONS.md` de T-C4.2 (§3.8 — une session du parent
  postérieure à celle de l'enfant, aucune autre ligne entre les deux ; option A de MSG-concepteur-007).
- Dépôt : `tools/holarch-watch/` (boucle sans LLM pour les termes `date:` et `fichier:`, geste du
  mainteneur). Tests : `tests/reveil-par-condition.test.js` (les dix points du §3.8 portés depuis le
  livrable, T-C4.2 sans LLM).
- Non fait : le dogfooding réel du §3.9 — procédure en cinq étapes dans le `RAPPORT.md` de
  `dev-reveil-par-condition`.

## 1.2.0 — 2026-09-10

Mineure (contrat étendu, rien cassé) : chantier 1 « mémoire adressée » (`docs/IMPLEMENTATION.md` §2),
livré par la mission `holarch-fondations` dans `docs/archive/mission-holarch-fondations/shared/concepteur/chantier-1-memoire-adressee/`
et appliqué tel quel par son `appliquer.js` (ancres vérifiées ; les six fichiers remplacés étaient
identiques à la base copiée par l'instance).

- Contrat : nouveau module `memoire/unites-indexees` (fiches d'unité `memoire/U<n>-*.md` immuables,
  `MEMORY.md` borné à 60 lignes de 200 caractères, `memoire/INDEX.md` régénéré par le lanceur à chaque
  réveil), nouveau gabarit `templates/UNITE.template.md` ; `monolithic` et `journal-synthesis` passent
  en 1.1.0 (incompatibilité réciproque déclarée). Le `CONFIG.md` de ce dépôt active `unites-indexees` ;
  les presets restent sur `monolithic` tant que le dogfooding réel (§3.9) n'a pas mesuré l'effet.
- Harnais : `bin/holarch-spawn.js` gagne `parseUniteHeader`, `buildMemoryIndex`,
  `lastHibernationCommit`, `selectInboxMessages`, `describeWakeReason` ; module actif, le prompt de
  réveil injecte ROLE, MEMORY borné, STATUS, la raison du réveil (`<reveil>`), les seuls messages
  d'INBOX non traités et `memoire/INDEX.md` — plus ni JOURNAL ni PROGRESS. `hooks/holarch-hooks.js`
  gagne `activeModules(root)` ; `sleep-guard` refuse en outre la fin de session si `MEMORY.md` dépasse
  60 lignes ou 200 caractères par ligne (module actif seulement).
- Tests : `tests/unites-indexees-*.test.js` — les sept points du §2.6 portés depuis le livrable, plus
  les mesures du §2.7 en non-régression (fixture < 40 000 caractères ; corpus archivé < 60 000 quand
  `docs/archive/` est présent).
- Mineure et non majeure malgré l'incompatibilité nouvelle : un `CONFIG.md` ou un fichier d'instance
  écrit en 1.1.x reste valide, l'incompatibilité ne concerne que le module ajouté.

## 1.1.1 — 2026-09-10

Patch (harnais seul) : la CI du modèle publié en 1.1.0 échouait sur deux tests qui supposaient le
dépôt canonique — `framework/tests/holarch.test.js` (corpus `docs/archive/`, désormais sauté quand
l'archive est absente) et `tools/holarch-upgrade/test-upgrade.js` (dépendait de `holarch-publish`,
exclu du modèle, et lisait la source du modèle depuis `package.json`, donc le réseau ; désormais
autonome, source construite dans un répertoire jetable). Aucun fichier du contrat touché.

## 1.1.0 — 2026-09-10

Première version numérotée ; elle fige l'état du contrat « v1.1 » déjà cité dans l'en-tête des
presets et de `CONFIG.md` (`Framework : v1.1`), tel qu'il est au commit qui introduit ce fichier.

- Contrat : KERNEL, COMMANDEMENTS, 20 modules (`MANIFEST.md`), 3 presets, 5 templates, catalogue de rôles.
- Harnais : lanceur `bin/holarch-spawn.js` (profils dont `exploration`, effort par instance, changement de régime, plafonds, coût par session), garde-fous `hooks/`, réglages `claude/instance-settings.json`.
- Nouveau : `VERSION` et ce fichier, lus par `tools/holarch-publish` (déploiement vers le modèle) et `tools/holarch-upgrade` (récupération dans un projet).
