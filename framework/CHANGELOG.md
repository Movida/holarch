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

## 1.15.0 — 2026-09-11

Mineure (contrat : module `direct-spawn` 1.6.0 ; lanceur) — réveil par livraison et causes de refus :
- `direct-spawn` 1.6.0 : en mode `detache`, la condition de réveil recommandée devient **une par enfant**
  (`lun(enfant:a:DELIVERED, enfant:b:DELIVERED, …, message:BLOCKER, message:ALERT)`) : le parent vérifie chaque
  livrable dès qu'il tombe pendant que les autres enfants continuent ; `enfants:DELIVERED` reste possible quand les
  livrables se vérifient ensemble. À `ON_WAKE`, le parent réécrit sa ligne `Réveil` avec les seuls enfants restants
  avant de ré-hiberner (un terme déjà vrai le réveillerait aussitôt). Constaté sur `holarch-fournisseurs` : le volet
  4 livré à 21:02 attendait la fin du volet 1-3 pour être vérifié.
- Texte injecté par le lanceur (bloc harnais) : les deux causes de refus d'allowlist mesurées par
  `tools/holarch-session/refus.js` (75 refus sur 701 tours, 10,7 %) sont nommées à l'instance — écriture par
  redirection Bash (utiliser Write/Edit) et chemins absolus hors de son arbre de travail. Aucune règle d'allowlist
  n'est changée : mesure avant réglage.

## 1.14.0 — 2026-09-11

Mineure (contrat : gabarits, module `git-branches` 1.2.0 ; lanceur, tests) — plomberie des messages sous worktree :
- **Relais parent → enfant** (`relayInboxFromParent`, appelé par `prepareLaunch` à chaque incarnation d'un enfant qui a un
  worktree) : le parent écrit à son enfant dans `mission/<enfant>/INBOX.md` de son propre arbre et committe ; le lanceur
  copie dans le worktree de l'enfant chaque message committé absent (bloc identique pour une fusion `merge=union` propre),
  un commit par message dont le sujet reproduit la classe de provenance déduite par `message-lint --blame` sur la source
  (`[<from>]` vérifié, sans préfixe pour un commit humain, `[harnais]` sinon). Non committé = non relayé (typed-escalation).
  Constaté sur `holarch-fournisseurs` : l'INBOX d'un enfant vit dans son worktree, où le parent ne peut pas écrire.
  Limite connue : après la fusion de la branche de l'enfant, `merge=union` peut dupliquer un bloc relayé dans
  `mission/<enfant>/INBOX.md` (les lecteurs du lanceur dédoublonnent par `id`).
- Gabarits `INBOX.template.md` et `OUTBOX.template.md` ajoutés à `framework/templates/` (KERNEL §9.3 les supposait ;
  les spawns reconstruisaient les en-têtes par analogie).
- Trois tests (`relais-inbox-worktree.test.js`) ; `IMPLEMENTATION.md` §4.2 ; `MANIFEST.md`.

## 1.13.2 — 2026-09-11

Patch (lanceur, tests) — arrêt propre perdu pendant l'ON_SLEEP :
- Un `--arret <chemin>` posé pendant que la session finissait déjà (hibernation sur budget ou contexte, note sans
  « arrêt demandé ») était perdu : `prepareLaunch` effaçait le fichier stop au début de la ré-incarnation suivante.
  Trois arrêts de suite perdus le 2026-09-11 sur `concepteur/implementeur-executeurs` (sessions de douze minutes,
  ON_SLEEP en fin de chacune). Désormais `launchWithRelaunches` lit et consomme le fichier stop avant de décider
  d'une ré-incarnation (pas de relance, résumé « arrêt propre demandé », code 0), et seul un lancement neuf efface un
  fichier stop périmé (`opts.relance` posé par la boucle ; un `--dry-run` ne le touche pas non plus). Trois tests (`arret-pendant-sleep.test.js`) ;
  `IMPLEMENTATION.md` §3.5 et tableau des fichiers `.holarch/` mis à jour.

## 1.13.1 — 2026-09-11

Patch (lanceur, tests) — arrêt d'une instance :
- `--arret <chemin>` constate d'abord si une session vit (verrou `live/` au pid vivant, verrou périmé nettoyé) et répond
  « rien à arrêter » sinon, sans écrire de fichier stop : un arrêt a attendu un quart d'heure une session morte avec le
  terminal qui l'avait lancée (compteur de contexte figé à 18 tours, verrou au pid mort).
- `--arret <chemin> --immediat` tue l'arbre de processus du lanceur (SIGTERM feuilles d'abord, SIGKILL après 5 s), retire
  le verrou, laisse l'état committé et ce qui traîne à la session suivante : l'arrêt pour repartir tout de suite avec un
  `CONFIG.md` ou un `OBJECTIVE.md` changés. Trois tests (`arret-immediat.test.js`) ; skill `holarch-pause` et
  `IMPLEMENTATION.md` §3.5 mis à jour.

## 1.13.0 — 2026-09-11

Mineure (preset et allowlist des instances) — deux décisions du mainteneur après la mission `holarch-outillage` :
- **`seuil_contexte_tokens` 180 000 → 240 000** (lanceur, preset `solo-light`, `CONFIG.md` de `holarch-fournisseurs`) : mesure
  `docs/diagnostics/2026-09-11-seuil-contexte-240k.md` (p90 du contexte max instantané 198 602, autocompact jamais approché,
  budget jamais atteint). `autocompact_tokens` 400 000 et `budget_usd_par_session` 8 inchangés.
- **Allowlist des instances** (`framework/claude/instance-settings.json`) : `git clone *`, `git -C <dir> checkout *`,
  `git -C <dir> config *` — une instance peut rejouer des outils de maintenance dans un clone sous son espace de travail
  (mission `holarch-outillage` : critère de rejeu hors de portée de toute instance). `git checkout` / `switch` sans `-C`
  restent hors allowlist : une instance ne change jamais de branche dans son worktree (`git-branches`). Forme vérifiée par une
  session minimale (`claude -p --model haiku`, joker au milieu du motif accepté, `checkout` sans `-C` refusé).

## 1.12.0 — 2026-09-11

Mineure (gabarit ajouté, outils de maintenance, scripts npm) — promotion du chantier 8 (mission `holarch-outillage`,
11 sessions, 22,26 USD, première mission sous le module `delegation-intra-session` promu et les défauts 180 000 / 400 000 /
8 USD ; rapport `mission/shared/concepteur/RAPPORT.md`, archivage à suivre) :
- **`tools/holarch-maintenance/`** : `promote.js` (copie fraîche, `npm ci` ou repli `npm install` sans lockfile, tests
  avant / après, `--appliquer` sur le dépôt réel propre hors `mission/`, incrément de `framework/VERSION`, squelette de
  CHANGELOG, jamais de commit), `archive.js` (préconditions refusantes, tag `mission-<nom>-final`, résidus, `git mv`,
  squelettes transverses, commit sauf `--sans-commit`, jamais de push), `open.js` (CONFIG remise aux défauts du preset,
  `mission/OBJECTIVE.md` depuis le gabarit, lignes « en cours », commit sauf `--sans-commit`), `lib/commun.js` ; 26 tests
  (`test-*.js`, dépôts Git jetables) ; scripts npm `promote`, `archive`, `open`. Cette promotion a été faite avec
  `promote.js` lui-même (`--appliquer --version mineure`) : 395 → 421 tests verts.
- **`framework/templates/OBJECTIVE.template.md`** : gabarit d'objectif de mission.
- Mesure de la mission (rapport §« Mesure de la délégation ») : délégation à des sous-agents dans 7/7 sessions de
  l'implémenteur, contexte max instantané p90 198 602 tokens (seuil 180 000 dépassé par la queue d'hibernation, recommandation
  de relever à ~240 000 — décision du mainteneur, mesure avant réglage), budget 8 USD jamais atteint (médiane 1,97).
- Rejeu du cycle (critère §10.5) fait par la session de maintenance sur clones jetables, pas par une instance (`git clone`
  refusé aux instances). **Correctifs de maintenance issus du rejeu**, dans cette même version (28 tests, dont 2 ajoutés) :
  `archive.js` lit le nom de mission dans la ligne de titre `# Configuration — mission : <nom>` (seule forme des CONFIG
  réels ; `nom_mission` en repli) ; ancres des fichiers transverses **structurelles** (fin de `docs/archive/README.md`,
  dernière puce résidus d'`ENVIRONNEMENT.md` §10, ligne de tableau de la mission en `ROADMAP.md` §5, ligne `**État :` citant
  la mission en `IMPLEMENTATION.md`, puce `**Missions**` du README, puce `docs/archive/` de `CLAUDE.md` ; `open.js` insère une
  ligne de tableau avant `| Programme DEMIURGE`) au lieu de lignes littérales d'une mission précise ; `archive.js` et
  `open.js` **transactionnels** (ancres et tag existant vérifiés avant la première écriture) ; `processusMissionVivant`
  restreint au dépôt courant (verrous `mission/.holarch/live/` au pid vivant) au lieu d'un `ps` global qui refusait
  l'archivage dès qu'une mission tournait dans un autre clone ; `promote.js` compte les tests au format spec de Node 24
  (`ℹ pass N`) comme en TAP, et mesure la taille du prompt système (`prompt système: N`) au lieu de la longueur de la
  sortie ; `insererSquelette` idempotent **localement** (le marqueur cité dans la prose d'un document empêchait l'insertion,
  vu à l'archivage réel de `holarch-outillage`) ; copie fraîche de `promote.js` sous `/home/vscode` seulement s'il existe, sinon
  `os.tmpdir()` (`HOLARCH_PROMOTE_BASE` pour forcer — la CI GitHub n'a pas `/home/vscode`, run rouge du 2026-09-11). Reste connu : `promote.js` clone à HEAD (rejouer un paquet déjà promu demande un worktree à `shaBase`, ce que
  la session de maintenance a fait le 2026-09-11 : paquet chantier 7 → 382 verts + 4 MCP d'environnement).

## 1.11.2 — 2026-09-11

Patch (tests seuls) :
- **T-C4.2 (`reveil-par-condition.test.js`) instable** : la CI du modèle `Movida/holarch` 1.11.1 a rougi sur `main` et passé sur
  le tag avec le même contenu. Le test échantillonnait « tâche de l'enfant `running` → parent vivant ? », or le lanceur retire
  le verrou de l'enfant, pose celui du parent (`wakeWaiters` après chaque session, 1.9.0) puis seulement clôt la tâche : la
  fenêtre était légitime. L'échantillon ne compte plus que tant que le verrou de l'enfant existe, parent lu avant l'enfant.
- Le test de taille du contrat, relâché par erreur à 60 000 dans d8898ce (édition à l'aveugle sur la version découplée de
  c620554), est revenu à 55 000 sur les 12 modules figés (79d1257) ; l'entrée 1.11.1 ci-dessous le décrit tel qu'il est.

## 1.11.1 — 2026-09-11

Patch (harnais seul) — premier lancement réel sous `--agents` (bootstrap de la mission `holarch-outillage`) :
- **Lanceur** : `buildAgentsOption` passait `tools` comme une chaîne (`'Read,Write,Edit,Bash,Glob,Grep'`) ; le CLI attend un
  tableau et refusait la session en 1 s (« Invalid --agents configuration: holarch-unite.tools: Invalid input »), avant tout
  résultat JSON. La mission `holarch-delegation` n'a jamais exercé ce chemin : son instance tournait sur une racine dont le
  CONFIG n'activait pas le module en `--agents` au moment des lancements. Le test U4 fige désormais la forme tableau.
- Leçon : `--dry-run` affiche la commande mais ne la valide pas contre le schéma du CLI ; une option nouvelle se vérifie par
  une session minimale (`claude -p --model haiku --max-turns 1`) avant d'être promue.
- **Test de taille du contrat** : découplé du `CONFIG.md` vivant (le 13e module de `holarch-outillage` le faisait rougir,
  56 731 caractères) ; la cible de 55 000 (IMPLEMENTATION §9) reste vérifiée sur la liste figée des 12 modules mesurés à la
  livraison du chantier 7, les modules eux-mêmes étant lus sur disque.

## 1.11.0 — 2026-09-11

Mineure (preset enrichi, défauts du harnais réglés sur mesure, lanceur et hooks corrigés) — promotion du chantier 7
(1.10.0 ci-dessous, jamais publiée seule) avec les correctifs de maintenance de la même journée :
- **Défauts** : `budget_usd_par_session` 5 → 8, `seuil_contexte_tokens` 120 000 → 180 000, `autocompact_tokens` 180 000 →
  400 000 (lanceur et preset `solo-light`) ; le preset active `extensions/delegation-intra-session`. Base : trois missions
  mesurées (départ ~69k, clôture vers seuil + 25k) et la mission `holarch-delegation` sous 250k, où le fusible n'a
  jamais sonné et où le budget de 5 USD arbitrait les fins de session (`holarch.md` §15, décision 35).
- **Lanceur** : verrou de vivacité posé dès le réveil (deux sessions concurrentes du concepteur lancées à 10 ms
  d'écart, course `wakeWaiters`/`finishLaunch`) ; `--reprendre` (tâche « running » au pid mort : fiche close, instance
  en hibernation propre relancée — après un redémarrage du conteneur) ; horloge UTC, nombre de sessions jouées et
  coût cumulé dans le prompt de réveil ; journal du lanceur (`SESSIONS.md`, `REVEILS.md`) committé par le lanceur pour
  une racine (`[harnais] …`) ; fichier de contexte lu dans le worktree de l'instance (colonne `Contexte` vide pour
  6 sessions sur 7 sous isolation) ; table `## Paramètres` conservée dans le prompt réduit.
- **Hooks** : `context-watch` signale le courrier arrivé dans `INBOX.md` en cours de session et injecte un fait de
  contexte par palier de 50k sous le seuil (« n'hiberne pas tant que ce hook ne te le demande pas ») ; `sleep-guard`
  bloque un constat « impossible / bloqué / refusé » sans BLOCKER, CLARIFICATION ni PROPOSAL du jour, sauf mention
  « constat non bloquant ».
- **Outils** : `etat.js` dit « aucune mission ouverte » quand `mission/` est absent ; `holarch-publish` supprime son
  clone temporaire même en cas de refus (893 dossiers accumulés par les tests) ; `bench.js --transcriptions` nomme
  l'instance d'après le slug du dossier et ajoute une colonne Session. `.gitignore` : `mission/**/workspace/repo/`.
- Tests : `framework/tests/maintenance-1-10-1.test.js` (7) ; 387 → 394 tests.

## 1.10.0 — 2026-09-11

Mineure (un module nouveau, lanceur et hooks étendus, outil de banc étendu) : chantier 7 « délégation
intra-session, contrat réduit, fusible mesuré » (`docs/IMPLEMENTATION.md` §9), livré par la mission
`holarch-delegation`, instance `concepteur/implementeur-delegation` (6 sessions d.implémentation, 21,41 USD au tarif liste ; mission holarch-delegation : 8 sessions, environ 29 USD avec la conception et la revue). Quatre volets : (§9.1) nouveau module
`extensions/delegation-intra-session` 1.0.0 et gabarit `SOUS-AGENT.template.md` — option `--agents`
du lanceur qui construit un sous-agent `holarch-unite` (outils sans `Agent`, pas de cascade) quand le
module est actif ; `context-watch` ignore les transcriptions sous `<sid>/subagents/*.jsonl` ;
`tools/holarch-bench/bench.js --transcriptions` accepte un dossier `<sid>/` avec sous-dossier
`subagents/` et publie une section séparée « tokens et coût des sous-agents » (jamais mélangée au
contexte de l'instance). (§9.2) prompt système réduit : `buildSystemPrompt` n'injecte plus que l'en-tête
et les « Règles injectées » de chaque module actif (plus `## Constat`/`## Ce que ce module ne fait pas`),
KERNEL/CONFIG.md inchangés en entier ; rappels d'orientation et de clôture injectés par
`SessionStart`/`context-watch`. (§9.3) `autocompact_tokens` vérifié par `config-lint` (entier positif,
strictement supérieur à `seuil_contexte_tokens`), aucun défaut du framework changé. (§9.4) nouveau
garde-fou `framework-guard` (`PreToolUse` Write/Edit) refusant toute écriture sous `framework/`,
`docs/`, `tools/` ou `mission/OBJECTIVE.md`, distinct de `wake-guard` (portée différente), doublé par
`permissions.deny` d'`instance-settings.json`. Constat de conception, vérifié en cours de mission :
l'écriture par un sous-agent sous `mission/` (bloquée dans une session antérieure de dogfooding,
attribuée à tort à `HOLARCH_INSTANCE` non transmise) fonctionne en réalité dans cet environnement — la
délégation réelle a repris à partir de la moitié de la mission, voir `RAPPORT.md` du paquet.

## 1.9.0 — 2026-09-11

Mineure (trois modules enrichis, lanceur et hooks étendus, outil de banc étendu) : chantier 6 « contexte instantané,
régime par phase, discipline d'orientation » (`docs/IMPLEMENTATION.md` §8), livré par la mission `holarch-contexte`
(17 sessions, 28,64 USD au tarif liste, aucune exécution payante ; archivée sous `docs/archive/mission-holarch-contexte/`,
paquet `shared/concepteur/chantier-6-contexte-instantane/`) et promu par son `appliquer.js` (14 cibles, sha de base
contrôlé, vérifié sur copie fraîche puis sur `main` : 359 → 367 tests, 0 régression ; prompt système 79 256 → 84 531
caractères). Mesure : `context-watch` persiste `{session_id, depart, max, dernier, tours}` dans
`mission/.holarch/live/<chemin-tirets>.contexte.json` ; le lanceur ajoute la colonne `Contexte (départ / max)` à
`SESSIONS.md` (douze colonnes) et rappelle à l'instance le contexte de départ de sa session précédente ;
`tools/holarch-bench/bench.js --calibrer` fonde `seuil_contexte_tokens` sur le p90 du maximum instantané, publie la part
du contexte fixe et sait relire les transcriptions Claude Code (`--transcriptions <dossier>`) ; huitième scénario à sec
`contexte-instantane`. Modules : `self-assessment` 1.1.0 (question « combien de sessions ? », paramètre
`sessions_attendues_max`), `direct-spawn` 1.5.0 (régime par phase, changement d'effort posé par le mainteneur non
décompté), `unites-indexees` 1.1.0 (ne relire que ce que la fiche cite, écrire avant de re-vérifier, ligne `contexte:`
dans l'entrée de `JOURNAL.md`). Geste de maintenance ajouté à la promotion : le lanceur évalue le réveil des parents après
**chaque** session d'un enfant, plus seulement à la fin de sa boucle (`holarch.md` §16.1 point 11). Mesure obtenue sur
trois missions : contexte de départ médian 67-69k tokens, maximum p90 ≈ 146k, prompt fixe 56-58 % — le seuil reste à
120 000 (maximum endogène : seuil + clôture), voir `docs/diagnostics/2026-09-11-contexte-instantane-trois-missions.md`.

## 1.8.2 — 2026-09-11

Patch (harnais et outils, aucun fichier du contrat touché) : chantier 5 « banc de mesure à deux étages »
(`docs/IMPLEMENTATION.md` §6), livré par la mission `holarch-banc` (19 sessions, 37,47 USD au tarif liste ; archivée sous
`docs/archive/mission-holarch-banc/`, paquet `shared/concepteur/implementeur-banc/chantier-5-banc-de-mesure/`) et promu par
son `appliquer.js` (14 cibles, vérifié sur copie fraîche puis sur `main` : 339 → 359 tests, 0 régression). Étage à sec :
`framework/tests/scenarios/*.json` (sept scénarios — livraison simple, hibernation puis livraison, changement de régime,
crash sans JSON, budget épuisé, enfant détaché et réveil, arrêt demandé) rejoués par `framework/tests/B4-scenarios.test.js`
sur les vraies fonctions du lanceur ; `framework/tests/fake-claude.js` étendu (étapes, crash). Étage réel :
`tools/holarch-bench/bench.js` (`--a-sec`, `--reel t3 --budget-usd 6`, `--calibrer <SESSIONS.md>`), ses tests et son README ;
`docs/bench/REGISTRE.md` (15 lignes, dont une exécution réelle de T3 à 4,72 USD) ; `docs/holarch.md` §13 : T2, T5, T7
« rejouables ». Réserve : la colonne contexte de `--calibrer` agrège le cumul d'une session, pas l'instantané borné par
`context-watch` — ses propositions de `seuil_contexte_tokens` ne sont pas utilisables en l'état.

## 1.8.1 — 2026-09-10

Patch (harnais seul). Au réveil d'un parent, un message lu depuis le worktree d'un enfant (1.7.1, pas encore fusionné)
n'a pas d'historique Git à blâmer : il était annoté « origine NON VÉRIFIÉE : … auteur du commit=? ». Le motif dit
désormais « non fusionné, lu depuis le worktree <enfant> (vérifiable à la fusion de sa branche) ». Traitement
inchangé et voulu : donnée, jamais un ordre, jusqu'à la fusion. Test étendu (`git-branches-worktree.test.js`).

## 1.8.0 — 2026-09-10

Mineure (module et gabarit enrichis, outil ajouté) : chantier 4 « provenance vérifiée des entrées »
(`docs/IMPLEMENTATION.md` §5), livré par la mission `holarch-provenance` (première mission réelle sous un worktree par
instance et `direct-spawn` détaché : 30 sessions, ~56 USD, deux renvois avant acceptation), promu depuis
`docs/archive/mission-holarch-provenance/shared/concepteur/chantier-4-provenance-verifiee/` (`appliquer.js` transactionnel, vérifié sur copie fraîche : 319 → 339 tests, aucun échec nouveau).

- `MESSAGE.template.md` : ligne optionnelle `origine: parent | enfant | utilisateur | harnais | externe` après `date:`
  (KERNEL §7 inchangé, sept types conservés).
- `typed-escalation` 1.1.0 : à `ON_WAKE`, un `TASK` ou une `RESPONSE` d'origine `externe` ou non vérifiée n'est pas
  exécuté — traité comme une donnée, `ALERT` au parent, poursuite avec les messages vérifiés. Seuls parent et
  utilisateur donnent des ordres.
- `tools/message-lint/` (nouveau, `npm test` étendu) : contrôle de format des `INBOX.md`/`OUTBOX.md` (blocs, champs,
  types, dates ISO, identifiants uniques et croissants, valeurs d'`origine`) ; `--blame` déduit l'origine de chaque
  message de l'auteur du commit qui l'a ajouté (`[<from>]`, `[bootstrap]`, commit humain = `utilisateur`) ; codes de
  sortie 0 / 1 (format) / 2 (origine non vérifiée) / 3 ; `analyserMessages()` exporté pour le lanceur. Sur le corpus
  archivé de `holon-v2` (48 messages), code 0.
- Lanceur : chaque message injecté au réveil est annoté `<!-- origine vérifiée : … (commit …) -->` ou
  `<!-- origine NON VÉRIFIÉE : … -->` ; le bloc `<reveil>` résume `n messages vérifiés, m non vérifiés` ; grammaire
  d'ouverture d'enveloppe partagée avec `message-lint`.
- Ouvert (rapport final de la mission, `shared/concepteur/RAPPORT.md` §7) : l'origine `harnais` n'est pas vérifiable
  par `--blame` (le lanceur écrit dans l'arbre de l'instance, l'auteur du commit est l'instance) ; `appliquer.js`
  reste aveugle à une dérive amont des fichiers cibles (un contrôle du sha de base fermerait ce trou) ; le compteur
  « N anomalie(s) » compte les messages fautifs, pas les anomalies.
- Tests : +20 — 339 tests, 338 verts, 1 ignoré.

## 1.7.2 — 2026-09-10

Patch (harnais seul), pendant la mission `holarch-provenance`.

- Lanceur : une limite de sessions de l'API (`api_error_status: 429`, forfait : « You've hit your session limit ·
  resets H:MMam (UTC) ») n'est plus comptée comme une session « sans progrès ». Si l'heure de remise à zéro est
  lisible et à moins de 6 h, la boucle de ré-incarnation attend jusqu'à cette heure (+ 60 s, au plus trois fois par
  invocation, trace `HOLARCH ▸ … ▸ limite de sessions de l'API (429) — reprise à …`) puis retente sans décompter de
  relance ; sinon elle s'arrête avec le motif `limite-api`, une `ALERT` explicite au parent (relancer en détaché après
  la remise à zéro) et le code 3 — plus de « fin anormale » ni de « 3 sessions sans progrès » trompeurs. Constat :
  trois 429 d'affilée (23 s, 1 s, 1 s) avaient fait arrêter l'implémenteur en plein correctif, avec une `ALERT`
  « sans progrès » à la racine. `HOLARCH_ATTENTE_429_MS` force la durée d'attente (tests).
- Tests : +1 (`relances-progres.test.js`) — 319 tests, 318 verts, 1 ignoré.

## 1.7.1 — 2026-09-10

Patch (harnais seul), pendant la mission `holarch-provenance` — deux défauts remontés par l'`ALERT`
`MSG-implementeur-002` de l'implémenteur et par la supervision du mainteneur (première mission réelle sous un
worktree par instance).

- Lanceur : l'`INBOX.md` d'une instance est lue **en union** (`readInboxOf`) — son fichier (worktree → disque) plus
  les messages que ses descendants lui ont écrits dans leur worktree (copie de `mission/<chemin>/INBOX.md` sur leur
  branche, pas encore fusionnée), dédoublonnés par id, chaque bloc ajouté marqué `<!-- non fusionné : lu depuis le
  worktree … -->`. Utilisée par les termes `message:` des conditions de réveil (`wakeWaiters`, `--reveil`), le bloc
  `<reveil>` et la sélection d'INBOX injectée au réveil. Avant : un `ALERT`, `BLOCKER` ou `CLARIFICATION` d'un enfant
  n'atteignait le parent qu'à la fusion, après `DELIVERED` — la condition `lun(enfants:DELIVERED, message:ALERT, …)`
  recommandée par `direct-spawn` ne voyait jamais ces messages, et un enfant en attente d'une réponse aurait figé la
  mission. Lecture seule : rien n'est écrit dans l'INBOX du parent avant la fusion.
- Lanceur : `--dry-run` n'écrit plus `memoire/INDEX.md` (`buildMemoryIndex` calcule sans écrire, le prompt reflète
  l'index calculé). Avant : un `--dry-run` lancé depuis le worktree d'un enfant pour un autre chemin régénérait un
  fichier de la racine dans l'arbre de l'enfant, qui n'avait aucune commande autorisée pour le retirer de l'index.
- Limite connue, non traitée : un message daté au jour seul (`date: 2026-09-10`, alors que le gabarit prescrit un
  ISO 8601 complet) est antérieur à tout commit de `STATUS.md` du même jour, donc jamais « récent » pour un terme
  `message:` — les instances doivent dater leurs messages à la seconde (`date -u +%FT%TZ`).
- Tests : +2 (`git-branches-worktree.test.js`, `unites-indexees-build-user-prompt-detail.test.js`) — 318 tests,
  317 verts, 1 ignoré.

## 1.7.0 — 2026-09-10

Mineure (un module touché, texte seul) : dogfooding réel du chantier 3
(`docs/diagnostics/2026-09-10-dogfooding-worktree-par-instance.md`, `holarch.md` §15 décision 25) — deux enfants
détachés en parallèle, fusion par le parent. Verdict : `git-branches` prêt sous `isolation = worktree`, une fois
corrigés quatre endroits qui supposaient encore que les fichiers d'un enfant vivent dans l'arbre du parent.

- Hook `spawn-guard` : sous `git-branches` en `isolation ≠ aucune`, les fichiers d'un enfant (`ROLE.md`,
  `STATUS.md`, `MEMORY.md`, fiche registre) sont résolus disque → worktree de l'enfant → branche de l'enfant
  (`git cat-file -e`), et le budget d'instances recompte les enfants par union du disque et des branches
  `<prefixe><parent-tirets>-*`. Avant : le fusible ne regardait que l'arbre du parent, où `ON_SPAWN` ne laisse
  rien — tout lancement d'enfant était refusé « ROLE.md absent ». Le refus nomme désormais les trois lieux.
- Module de réveil (`reveil.js`) : `listChildren` énumère les enfants par union de l'arbre du parent, des
  worktrees `mission/.holarch/worktrees/*` et des branches d'enfants (un enfant spawné mais jamais incarné
  retient `enfants:ETAT`) ; `listWaiters` lit aussi une instance en attente dont le `STATUS.md` ne vit que dans
  son worktree (chaque worktree n'est lu que pour sa propre instance, jamais pour les copies périmées du parent
  ou des frères) ; `readStatusOf` du lanceur retombe sur la branche (`git show`). Avant : `enfants:DELIVERED`
  restait « faux (aucun enfant incarné) » après la livraison des deux enfants — parent jamais réveillé.
- Lanceur, bloc `<reveil>` : liste les enfants directs (même énumération) avec leur état courant, au lieu d'un
  « aucun enfant dont le statut a changé » calculé sur l'arbre du parent seul.
- Lanceur : une ré-incarnation après `--bootstrap` (hibernation volontaire de la racine dès sa première session)
  repart comme instance racine ordinaire, sans `BOOTSTRAP.md`. Avant : chaque session ré-incarnée rejouait le
  bootstrap et refusait « mission déjà en cours » jusqu'à l'arrêt « sans progrès » (trois sessions, ~1,3 USD).
- `git-branches` 1.1.1 : `ON_CHILD_DONE` ordonne le nettoyage sous `worktree` — worktree retiré par le lanceur,
  **puis** `git branch -d` si `supprimer_apres_fusion` (`git branch -d` refuse une branche encore extraite).
- Tests : +3 (`git-branches-worktree.test.js` ×2, `relances-progres.test.js`) — 316 tests, 315 verts, 1 ignoré.

## 1.6.0 — 2026-09-10

Mineure (paramètre de module ajouté) : chantier 3 « un worktree par instance » (`docs/IMPLEMENTATION.md`
§4), livré par la mission `holarch-isolation`, promu depuis
`docs/archive/mission-holarch-isolation/shared/concepteur/chantier-3-worktree-par-instance/` (`ACCEPTATION.md`).

- `git-branches` 1.1.0 : paramètre `isolation` ∈ {`worktree` (défaut), `branche`, `aucune`} ; sous
  `worktree`, le parent ne bascule plus de branche pour incarner un enfant et ne crée pas le worktree
  (c'est le lanceur) ; `ON_CHILD_DONE` et graveyard adaptés.
- `sharded-files` 1.3.0 : `ORG.md` n'est pas en `merge=union` — seul le parent direct l'édite, sur sa
  branche, après fusion, jamais dans le worktree d'un enfant.
- Lanceur : `resolveWorkspace` (crée `mission/.holarch/worktrees/<chemin-tirets>` à la première
  incarnation, erreur explicite si la branche manque), `instancePath`/`instanceRoot`, `--nettoyer-worktree
  <chemin>` ; `claude` lancé avec `cwd` = worktree et `HOLARCH_ROOT` = `cwd` ; tous les accès aux fichiers
  d'instance (STATUS, INBOX, mémoire, compteur de progrès, `ALERT` au parent) passent par le worktree.
  `SESSIONS.md` et `REVEILS.md` restent à la racine (journal du lanceur).
- `.gitattributes` à la racine du dépôt : `merge=union` sur `INBOX.md`, `OUTBOX.md`, `PROGRESS.md`,
  `SESSIONS.md`, `REVEILS.md`, `DECISIONS.md` ; embarqué dans le modèle et dans le périmètre de
  `holarch-upgrade`.
- Tests : `tests/git-branches-worktree.test.js` (4 tests du §4.4 + 3 de non-régression, dont le compteur
  de progrès sous worktree). Limite documentée : `wakeGuard` ne retient pas une écriture par chemin absolu
  hors de la racine (voulu pour `--add-dir`) — c'est le bac à sable du CLI qui la retient.
- `SESSIONS.md` : le coût par modèle n'est accolé au nom du modèle que si la session en a utilisé
  plusieurs (avant : dupliqué sur chaque ligne avec la colonne « Coût USD »).
- Dogfooding réel du chantier (deux enfants détachés en parallèle) **pas encore fait** — geste du
  mainteneur, procédure dans le `RAPPORT.md` de l'implémenteur.

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
