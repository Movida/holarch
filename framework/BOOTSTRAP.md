# BOOTSTRAP — procédure de démarrage d'une mission HOLARCH

> Exécuté par la toute première session d'une mission, avant toute autre lecture (y compris avant `KERNEL.md` — cette procédure se suffit à elle-même pour ses deux premières étapes). Ne saute aucune étape, ne les réordonne pas.

## Étape 0 — Prérequis d'environnement (une fois, avant le premier lancement)

À la charge de l'**utilisateur**, avant la commande de lancement ci-dessous — une session ne peut pas les régler elle-même depuis une invocation `-p` non interactive.

1. **Node.js et Claude Code** : le lanceur `framework/bin/holarch-spawn.js` et les garde-fous `framework/hooks/holarch-hooks.js` tournent sur Node.js (≥ 18), déjà requis pour installer le CLI (`npm install -g @anthropic-ai/claude-code`) — aucune autre dépendance. Vérifier `node --version`, `claude --version` et une authentification active (`claude auth status`).
2. **Règles d'autorisation** : elles sont portées par le lanceur (`framework/claude/instance-settings.json`, passé à chaque session via `--settings`). Mesuré (Claude Code 2.1.257) : ces règles s'appliquent en mode `-p` même dans un dossier jamais approuvé, et une commande qu'elles n'autorisent pas est **refusée immédiatement** — pas de blocage ; le lanceur ferme stdin et prévient l'instance que tout refus est immédiat. Ni confiance préalable du dossier ni `.claude/settings.json` ne sont donc nécessaires pour une mission (ce dernier ne sert qu'aux sessions interactives de maintenance du framework). Le blocage silencieux observé pendant les tests v2 (`docs/examples/external-orchestrator-demo/`, `docs/holarch.md` §12) s'est produit avec un `claude -p` nu, sans `--settings`, dans un environnement dont les réglages globaux étaient alors invalides ; il n'a pas été reproduit avec le lanceur. Si vos missions exécutent d'autres langages ou outils que ceux autorisés (git, mkdir, python3, pytest, node, npm test/run), élargissez l'allowlist de ce fichier **avant** le lancement, de façon proactive.
3. **Identité Git** : les commits de mission sont attribués à `HOLARCH <holarch@localhost>`. Le lanceur pose cette identité dans l'environnement de chaque session qu'il lance (`GIT_AUTHOR_*`, `GIT_COMMITTER_*`), héritée par toutes les incarnations enfants, **sans toucher à la configuration Git du dépôt** : les commits humains restent attribués à l'humain. Rien à exporter ; une valeur déjà exportée est respectée (utile pour distinguer plusieurs missions ou machines).
4. **Modèle et effort** : un `claude -p` nu hérite du modèle et de l'effort des réglages utilisateur (`~/.claude/settings.json`) — c'est ce qui se produisait en v1, où `modele_cli` n'était jamais transmis. Le lanceur applique la politique de `CONFIG.md` (`## Politique de modèle`, profils `conception`/`execution`/`relecture`/`exploration`, module `direct-spawn`). Vérifiez-la avec `node framework/bin/holarch-spawn.js --bootstrap --dry-run` avant le premier lancement : la commande résolue s'affiche, aucune session n'est créée.

## Étape 1 — Validation

Avant de créer quoi que ce soit :

1. Vérifie l'existence de `framework/CONFIG.md` et de `mission/OBJECTIVE.md`. L'un des deux manque → échec, va directement au rapport d'erreur ci-dessous.
2. Vérifie qu'**aucune mission n'est déjà en cours ou terminée** dans ce dépôt : si `mission/registry/`, `mission/concepteur/`, `mission/shared/` ou `mission/graveyard/` existe déjà, → échec. Un dépôt HOLARCH porte une seule mission (`docs/holarch.md`, glossaire) ; ne devine jamais s'il faut reprendre l'existant ou l'écraser. Pour démarrer une nouvelle mission, instancier une nouvelle copie du dépôt (ex. bouton « Use this template » sur GitHub) plutôt que de réutiliser celui-ci.
3. Valide `CONFIG.md` contre `framework/MANIFEST.md` :
   - Chaque module listé dans "Modules actifs" existe dans le MANIFEST.
   - Exactement un module actif par catégorie obligatoire : `orchestration`, `synchronisation`, `memoire`, `registre`.
   - Aucune paire de modules actifs n'est mutuellement incompatible (colonne "Incompatible avec" du MANIFEST).
   - Tous les paramètres requis par les modules actifs sont présents dans la table "Paramètres" de `CONFIG.md` (ou ont une valeur par défaut explicite dans le module).
   - Les paramètres transverses obligatoires `permission_mode` et `format_rapport_final` sont présents et ont une valeur reconnue (`permission_mode` ∈ {`acceptEdits`, `default`, `manual`, `plan`, `auto`, `dontAsk`, `bypassPermissions`} ; `format_rapport_final` ∈ {`simple`, `executive-summary`}).
   - Si une table `## Politique de modèle` est présente, chaque ligne a un profil (`conception`, `execution`, `relecture`, `exploration`), un modèle et un effort ∈ {`low`, `medium`, `high`, `xhigh`, `max`} ; les paramètres du harnais (`budget_usd_par_session`, `max_tours_par_session`, `seuil_contexte_tokens`), s'ils sont présents, sont des entiers positifs. Leur absence n'est pas une erreur (défauts dans `direct-spawn`).

   Ces six contrôles sont mécanisés par `tools/config-lint/config-lint.js` (`node tools/config-lint/config-lint.js framework/CONFIG.md`, exit 0 = conforme) — la liste ci-dessus reste la spécification, l'outil n'en est que l'exécutant ; ne t'y fie pas à l'aveugle sur un point qu'il ne couvre pas (voir `tools/config-lint/README.md` § Limites assumées).

**Échec** : produis un rapport d'erreurs détaillé (liste précise de chaque violation trouvée) directement en réponse à l'utilisateur. **Arrête-toi sans rien créer** dans `mission/` — aucun répertoire, aucun fichier, aucun commit. C'est le test d'acceptation T1.

**Succès** : passe à l'étape 2.

## Étape 2 — Initialisation

1. Crée `mission/registry/ORG.md`, `mission/registry/DECISIONS.md`, `mission/registry/instances/`, `mission/registry/contracts/`, `mission/shared/`, `mission/graveyard/`.
2. `git init` si le dépôt n'existe pas déjà.
3. Commit initial : `[bootstrap] mission initialisée`.

## Étape 3 — Création de la racine

Instancie `mission/concepteur/` en suivant la mécanique structurelle du spawn (`KERNEL.md` §9), avec ces particularités :
- Parent déclaré : `"utilisateur"` (il n'existe pas d'instance parente réelle pour la racine).
- `ROLE.md` : la Mission est l'analyse de `mission/OBJECTIVE.md` et sa décomposition ; la Redevabilité est envers l'utilisateur directement ; le budget d'instances alloué = `budget_instances_total` (paramètre de `CONFIG.md`) ; la profondeur = 1.
- Crée sa fiche registre — avec la ligne `| Profil | conception |` (politique de modèle, module `direct-spawn`) — et initialise `registry/ORG.md` avec `concepteur` comme unique racine de l'arbre.
- Commit : `[bootstrap] spawn concepteur`.

## Étape 4 — Incarnation

La session de bootstrap **devient** immédiatement la session du concepteur : pas de nouveau processus, pas de nouvelle invocation CLI. Elle démarre son propre cycle de vie au hook `ON_WAKE` (`KERNEL.md` §2), en lisant `KERNEL.md` → `CONFIG.md` → modules actifs → son propre `ROLE.md` → `MEMORY.md` → `STATUS.md` → `INBOX.md`, exactement comme n'importe quelle session incarnant une instance. Lancée par `holarch-spawn.js --bootstrap`, elle a déjà `KERNEL.md`, `CONFIG.md`, `MANIFEST.md` et les modules actifs dans son prompt système (KERNEL §2) : elle ne les relit pas, et ne lit que les fichiers qu'elle vient de créer.

## Étape 5 — Fin de mission

Quand la racine (`concepteur`) atteint l'état `DELIVERED`, elle produit un **rapport final** à l'utilisateur, dans le format prescrit par le paramètre `format_rapport_final` de `CONFIG.md` :

- **`simple`** : un unique markdown affiché à l'utilisateur (et déposé dans `shared/concepteur/RAPPORT.md`) contenant : synthèse du livrable, pointeurs vers `shared/`, organigramme final (dérivé de `registry/ORG.md`), bilan budget (alloué vs. consommé, à tous les niveaux), propositions d'amélioration (le droit de proposition du KERNEL, §6.2, s'exerce jusqu'au sommet).
- **`executive-summary`** : un `shared/concepteur/RAPPORT.md` de synthèse tenant en une page (objectif, résultat, décision requise s'il y en a une), pointant vers des annexes séparées dans `shared/concepteur/RAPPORT-annexes/` : organigramme détaillé, bilan budget détaillé, journal des décisions clés (extrait de `registry/DECISIONS.md`), propositions.

Dans les deux cas, le rapport est aussi affiché intégralement à l'utilisateur en fin de session (pas seulement écrit en fichier) — c'est la session racine qui rend compte, pas un fichier qu'il faudrait aller chercher.

---

## Commande de lancement (rappel — exécutée par l'utilisateur, pas par une session)

Après avoir réglé les prérequis de l'Étape 0 :

```bash
GIT_AUTHOR_NAME="HOLARCH" GIT_AUTHOR_EMAIL="holarch@localhost" \
GIT_COMMITTER_NAME="HOLARCH" GIT_COMMITTER_EMAIL="holarch@localhost" \
node framework/bin/holarch-spawn.js --bootstrap
```

Le lanceur lit `permission_mode` dans `framework/CONFIG.md` (déjà copié depuis le preset choisi) et l'applique à cette session comme à chaque incarnation d'enfant (`direct-spawn`, §`ON_SUPERVISE`) ; `--permission-mode <mode>` le force pour cette seule session. Les variables `GIT_*` sont optionnelles — sans elles, les commits de la mission utilisent l'identité Git déjà configurée sur le dépôt (celle de l'utilisateur, le cas échéant). Pour ré-incarner une instance existante (reprise après incident, nouveau mandat) : `node framework/bin/holarch-spawn.js <chemin>`.
