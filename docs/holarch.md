# Spécification — **HOLARCH**
### Framework d'organisations hiérarchiques récursives d'agents IA
> Version : 0.2 · Statut : validée pour implémentation · Auteur : session de conception (Claude Opus) · Destinataire : vous + sessions d'implémentation

---

## 0. Le nom : HOLARCH (ex-HOLON)

Un **holon** (concept d'Arthur Koestler) est une entité qui est *simultanément un tout et une partie d'un tout plus grand*. C'est exactement la nature de nos instances : chacune est une organisation complète (elle a une mission, une mémoire, peut avoir des subordonnés) tout en étant un composant de l'organisation de son parent. Une hiérarchie de holons s'appelle une **holarchie** — le terme désigne l'arborescence d'instances d'une mission, et il donne son nom au projet.

Le projet s'est appelé HOLON de sa conception (2026-09-01) au 2026-09-09. Il a été renommé HOLARCH parce que le nom était déjà pris sur GitHub par [holon-run/holon](https://github.com/holon-run/holon), un établi local pour agents (démon Rust, TUI et interface web, neuf fournisseurs) créé en décembre 2025, qui possède aussi le domaine holon.run. Les deux projets ne sont pas le même objet : holon-run est un runtime, HOLARCH un contrat d'organisation. Les concepts de holon-run jugés utiles sont repris dans [`ROADMAP.md`](ROADMAP.md), en cherchant à chaque fois un mécanisme fondé sur le dépôt plutôt que sur un démon. Le renommage a suivi dans les identifiants (`framework/bin/holarch-spawn.js`, `framework/hooks/holarch-hooks.js`, variables `HOLARCH_*`, `mission/.holarch/`, `tools/holarch-d`, `tools/holarch-init`). Les archives (`archive/`) et les traces figées (`examples/`) gardent l'ancien nom et les anciens chemins.

---

## 1. Vision, objectifs, non-objectifs

### 1.1 Vision
Permettre à un utilisateur de fournir **un objectif en langage naturel** à une session IA racine, laquelle décompose récursivement le travail en créant une organisation d'instances spécialisées (façon entreprise), chacune persistée sous forme de fichiers markdown, jusqu'à livraison d'un résultat compilé et auditable.

### 1.2 Objectifs
| ID | Objectif | Critère de succès |
|---|---|---|
| O1 | Généricité | Le framework fonctionne pour tout type d'objectif (dev, rédaction, analyse...) sans modification |
| O2 | Modularité | Ajouter un mode de fonctionnement = ajouter un fichier module, zéro modification du noyau |
| O3 | Persistance | Toute instance peut être reprise après mort de sa session, uniquement via ses fichiers |
| O4 | Auditabilité | Un humain peut reconstituer toute décision via les fichiers + historique Git |
| O5 | Économie | Garde-fous empêchant l'explosion du nombre de sessions/tokens |
| O6 | Accessibilité | Un utilisateur non-expert démarre via un preset en < 5 minutes |

### 1.3 Non-objectifs (v1)
- Overrides hiérarchiques de configuration (→ v2)
- Orchestrateur externe, branches Git par instance, jalons de revue (→ v2)
- Communication temps réel entre sessions vivantes simultanément
- Interface graphique
- Multi-modèles / multi-fournisseurs (v1 = Claude CLI uniquement, mais rien dans les fichiers ne doit l'empêcher plus tard) — non-objectif **levé** le 2026-09-11 : les limites d'Anthropic ne doivent pas borner la solution, OpenRouter ou une plateforme comparable sera utilisable (chantier 9, `ROADMAP.md` §3)

---

## 2. Glossaire

| Terme | Définition |
|---|---|
| **Instance** | Entité organisationnelle persistante : un répertoire + ses fichiers (le "poste") |
| **Session** | Exécution éphémère d'un LLM incarnant une instance (l'"employé au travail") |
| **Holarchie** | L'arborescence complète des instances d'une mission |
| **KERNEL** | Ensemble des règles invariantes s'appliquant à toute instance |
| **Module** | Fichier de règles optionnel modifiant un aspect du fonctionnement |
| **Hook** | Point d'ancrage du cycle de vie où les modules injectent des comportements |
| **Spawn** | Création d'une instance enfant par une instance parente |
| **Racine** | L'instance de niveau 0, rôle "concepteur", redevable envers l'utilisateur |
| **Registre** | Espace de données collectives en lecture pour tous |
| **Mission** | Une exécution complète du framework sur un objectif donné |
| **Livrable** | Artefact attendu d'une instance, défini dans son ROLE.md |

---

## 3. Architecture générale

### 3.1 Les deux espaces

```
<racine-repo>/
├── framework/        ← LE PRODUIT : immuable pendant une mission
└── mission/          ← L'ESPACE DE TRAVAIL : généré et vivant
```

**Règle fondamentale** : aucune instance n'écrit jamais dans `framework/`. Toute écriture a lieu dans `mission/`.

### 3.2 Arborescence complète de référence

```
framework/
├── KERNEL.md                        # §5 — invariants universels
├── CONFIG.md                        # §9 — configuration de la mission (copié depuis un preset)
├── MANIFEST.md                      # §8.4 — catalogue des modules
├── BOOTSTRAP.md                     # §10 — procédure de démarrage
├── modules/
│   ├── orchestration/direct-spawn.md
│   ├── synchronisation/fork-join.md
│   ├── synchronisation/dependency-graph.md
│   ├── memoire/monolithic.md
│   ├── memoire/journal-synthesis.md
│   ├── recursion/self-assessment.md
│   ├── recursion/instance-budget.md
│   ├── recursion/max-depth.md
│   ├── conflits/typed-escalation.md
│   ├── conflits/graveyard-handover.md
│   ├── registre/sharded-files.md
│   └── extensions/                  # vide en v1
├── templates/
│   ├── ROLE.template.md
│   ├── MEMORY.template.md
│   ├── STATUS.template.md
│   ├── JOURNAL.template.md
│   └── MESSAGE.template.md
└── presets/
    ├── solo-light.md
    └── team-standard.md

mission/
├── OBJECTIVE.md                     # écrit par l'utilisateur, lecture seule ensuite
├── registry/
│   ├── ORG.md                       # organigramme (maintenu par les parents)
│   ├── DECISIONS.md                 # journal append-only des arbitrages
│   ├── instances/                   # une fiche par instance (§11)
│   └── contracts/                   # contrats d'interface entre sœurs
├── shared/                          # livrables publiés (§6.4)
├── graveyard/                       # instances archivées (§7.4)
└── concepteur/                      # instance racine, puis récursion
    ├── ROLE.md
    ├── MEMORY.md
    ├── JOURNAL.md
    ├── STATUS.md
    ├── INBOX.md
    ├── OUTBOX.md
    ├── workspace/
    └── <enfant-1>/ ...              # instances enfants imbriquées
```

---

## 4. Concepts structurants

### 4.1 Instance ≠ Session
- L'**instance** est définie par ses fichiers. Elle survit à toute session.
- La **session** est un processus Claude CLI qui : se réveille, lit les fichiers de l'instance, travaille, met à jour les fichiers, meurt.
- Corollaire : **toute connaissance devant survivre à la session DOIT être écrite dans les fichiers avant sa mort.** C'est le devoir de mémoire (§5.3).

### 4.2 Identité d'une instance
- **Identifiant** = chemin relatif depuis `mission/` : `concepteur/architecte/dev-backend`.
- **Nom de rôle** : kebab-case, choisi par le parent, unique parmi ses frères.
- La **profondeur** = nombre de segments du chemin (concepteur = 1).

### 4.3 Cloisonnement — droits d'écriture

| Zone | Lecture | Écriture |
|---|---|---|
| Ses propres fichiers + `workspace/` | soi | soi |
| Fichiers d'un enfant | parent : tout | parent : uniquement `ROLE.md` (création) et `INBOX.md` |
| Fichiers du parent | enfant : uniquement `INBOX.md` du parent (dépôt de message) | idem |
| `shared/` | tous | chacun dans `shared/<son-chemin>/` uniquement |
| `registry/instances/` | tous | chacun sa propre fiche uniquement |
| `registry/DECISIONS.md`, `ORG.md` | tous | parents uniquement, en append |
| `registry/contracts/` | tous | les deux parties du contrat, arbitré par leur parent commun |
| `framework/`, `OBJECTIVE.md` | tous | **personne** |

Toute violation constatée doit être signalée par message `ALERT` au parent.

---

## 5. Spécification du KERNEL

Le KERNEL est le contrat social non-négociable. Il contient exclusivement ce qui suit — tout le reste appartient aux modules.

### 5.1 Cycle de vie d'une session et hooks

Toute session exécute strictement cette séquence. Les hooks (`⚓`) sont les points où les modules actifs injectent leurs règles.

| Phase | Actions obligatoires | Hook |
|---|---|---|
| **1. Réveil** | Lire dans l'ordre : `framework/KERNEL.md` → `framework/CONFIG.md` → modules actifs → `ROLE.md` → `MEMORY.md` → `STATUS.md` → `INBOX.md`. Si le lanceur (§16) a déjà placé ces fichiers dans le prompt, en prendre connaissance dans cet ordre sans les relire (§5.3.8) | `ON_WAKE` |
| **2. Orientation** | Déterminer : où en suis-je ? que dois-je accomplir dans CETTE session ? Consigner le plan de session dans `JOURNAL.md` | `ON_ORIENT` |
| **3. Planification** | Décider : faire seul ou décomposer ? (soumis aux modules de récursion) | `ON_PLAN` |
| **4. Spawn** *(si décomposition)* | Créer les instances enfants (§7) | `ON_SPAWN` |
| **5. Travail / Supervision** | Produire, ou lancer/superviser les enfants | `ON_SUPERVISE` |
| **6. Réception enfant** | À chaque livrable d'enfant : vérifier conformité aux critères d'acceptation de son ROLE.md ; accepter ou renvoyer avec message `TASK` correctif | `ON_CHILD_DONE` |
| **7. Conflit** *(si survient)* | Traiter selon module de conflits ; si hors périmètre d'autorité → escalader | `ON_CONFLICT` |
| **8. Livraison** | Compiler, publier le livrable dans `shared/<chemin>/`, écrire message `DELIVERABLE` dans l'INBOX du parent | `ON_DELIVER` |
| **9. Hibernation** | Mettre à jour `MEMORY.md` (à destination de "mon futur moi"), `STATUS.md`, `JOURNAL.md` ; commit Git ; mourir | `ON_SLEEP` |

Une session peut ne parcourir qu'une partie du cycle (ex: session de réponse à une `CLARIFICATION` : phases 1-2 puis réponse puis 9). Les phases 1, 2 et 9 sont **inconditionnelles**.

### 5.2 Machine à états (`STATUS.md`)

```
INIT → READY → WORKING → { WAITING_CHILDREN | BLOCKED } → WORKING → DELIVERED → ARCHIVED
                                                        ↘ FAILED
```

| État | Signification | Posé par |
|---|---|---|
| `INIT` | Instance créée, jamais incarnée | le parent au spawn |
| `READY` | Prête à travailler (dépendances satisfaites) | le parent ou soi |
| `WORKING` | Session en cours | soi |
| `WAITING_CHILDREN` | Attend des livrables d'enfants | soi |
| `BLOCKED` | Bloquée, `BLOCKER` émis vers le parent | soi |
| `DELIVERED` | Livrable publié et transmis | soi |
| `FAILED` | Échec constaté, motivé dans OUTBOX | soi ou le parent |
| `ARCHIVED` | Déplacée au graveyard | le parent |

### 5.3 Devoirs universels

1. **Redevabilité** : livrer ce qui est défini dans `ROLE.md`, au format et à l'emplacement prescrits ; rendre compte à son parent et à lui seul.
2. **Supervision** : un parent est responsable des livrables de ses enfants ; il DOIT les vérifier avant intégration.
3. **Mémoire** : avant hibernation, `MEMORY.md` doit permettre à une session neuve de reprendre sans autre information.
4. **Honnêteté** : déclarer ses limites, incertitudes et échecs plutôt que de produire du plausible ; ne jamais inventer un résultat d'enfant.
5. **Fidélité à la mission racine** : toute décision se juge d'abord à l'aune de la section "Contexte hérité" du ROLE.md.
6. **Traçabilité** : toute décision significative → `JOURNAL.md` ; toute décision impactant d'autres instances → `registry/DECISIONS.md` (si parent) ; un commit Git par fin de session, message : `[<chemin-instance>] <résumé>`.
7. **Cloisonnement** : respecter strictement la matrice §4.3.
8. **Économie** : ne pas spawner ce qu'on peut faire soi-même correctement (renforcé par les modules de récursion) ; ne lire que ce qui sert la session, déléguer les lectures volumineuses à un sous-agent en lecture seule, et hiberner volontairement (`MEMORY.md` complet, `STATUS.md` à l'état réel avec la note « hibernation volontaire (contexte) », commit, fin de session) dès que le harnais (§16, `context-watch`) ou un module actif signale que le budget de contexte est atteint — la session suivante reprend via `MEMORY.md`.

### 5.4 Droits universels

1. **Clarification** : demander des précisions au parent avant d'exécuter une mission ambiguë (message `CLARIFICATION`).
2. **Proposition** : suggérer une amélioration à tout niveau de son périmètre (message `PROPOSAL`) ; le parent doit répondre de façon motivée.
3. **Refus motivé** : refuser une mission incohérente avec le KERNEL, la mission racine, ou manifestement irréalisable (message `BLOCKER` motivé) — jamais de refus silencieux.
4. **Autorité déléguée** : dans le périmètre défini par son ROLE.md, l'instance décide seule, sans demander de permission.

### 5.5 Protocole de messages

Tous les échanges passent par les fichiers `INBOX.md` / `OUTBOX.md`, en **append uniquement**. Format normalisé (voir `MESSAGE.template.md`) :

```markdown
---
id: MSG-<chemin-abrégé>-<numéro-séquentiel>
from: concepteur/architecte
to: concepteur
type: TASK | DELIVERABLE | BLOCKER | CLARIFICATION | PROPOSAL | ALERT | RESPONSE
ref: <id du message auquel on répond, ou "—">
date: <ISO 8601>
---
<corps en markdown libre ; pour DELIVERABLE : pointeur vers shared/...>
```

| Type | Émetteur → Destinataire | Sémantique | Réponse attendue |
|---|---|---|---|
| `TASK` | parent → enfant | Ordre de travail / correctif | exécution |
| `DELIVERABLE` | enfant → parent | Livrable disponible | acceptation ou `TASK` correctif |
| `BLOCKER` | enfant → parent | Impossible de continuer | recadrage / réattribution |
| `CLARIFICATION` | enfant → parent | Question bloquante | `RESPONSE` |
| `PROPOSAL` | enfant → parent | Suggestion | `RESPONSE` motivée |
| `ALERT` | tout → parent | Risque hors périmètre | arbitrage ou escalade |
| `RESPONSE` | parent → enfant | Réponse référencée | — |

L'écriture d'un message se fait **en double** : dans son propre `OUTBOX.md` (trace) et dans l'`INBOX.md` du destinataire (notification). L'instance racine adresse ses messages à l'utilisateur via son `OUTBOX.md` et l'affichage final de session.

### 5.6 Escalade

- Une instance n'arbitre que dans son périmètre d'autorité (défini dans ROLE.md).
- Conflit entre deux enfants → leur parent arbitre.
- Conflit entre deux branches sans parent commun proche → remonter jusqu'au premier ancêtre commun.
- La racine escalade à l'utilisateur (fin de session avec question explicite).

---

## 6. Spécification des fichiers d'instance

### 6.1 `ROLE.md` — écrit par le parent au spawn, **immuable ensuite** (sauf recadrage formel §7.5)

```markdown
# Rôle : <intitulé>
> Instance : <chemin> · Créée par : <chemin parent> · Date : <ISO> · Profondeur : <n>

## Mission
<Quoi et pourquoi. 3-10 lignes. Doit être auto-suffisant.>

## Contexte hérité   ← OBLIGATOIRE, anti-dérive
- Objectif racine de la mission : <copie/synthèse fidèle de OBJECTIVE.md>
- Contraintes transverses : <héritées de CONFIG + décisions amont>
- Décisions déjà actées en amont : <liste ou réf. registry/DECISIONS.md>

## Livrables
| Livrable | Format | Emplacement | Critères d'acceptation |
|---|---|---|---|

## Autorité
- Décisions autonomes : <périmètre>
- Budget d'instances alloué : <n>
- Hors périmètre (escalader) : <liste>

## Redevabilité
- Rend compte à : <chemin parent>
- Rythme/conditions de reporting : <ex: à la livraison ; en cas de blocage sous 1 session>

## Interfaces
- Dépend des livrables de : <instances sœurs + réf. contracts/>
- Fournit à : <instances sœurs>
```

### 6.2 `MEMORY.md` — réécrit à chaque hibernation
Sections imposées : `## État courant` / `## Décisions prises` / `## Prochaines actions` / `## Points de vigilance`. Rédigé pour un lecteur qui n'a **aucun autre contexte**.

### 6.3 `JOURNAL.md` — append-only
Une entrée horodatée par session : plan de session, événements notables, justification des décisions. Jamais modifié rétroactivement.

### 6.4 Publication dans `shared/`
Chaque instance publie sous `shared/<son-chemin>/`. Un livrable publié est immuable ; une correction = nouvelle version suffixée (`-v2`), l'ancienne reste. Le message `DELIVERABLE` pointe la version courante.

---

## 7. Protocole de spawn

### 7.1 Conditions préalables (phase `ON_PLAN`)
Le spawn n'est autorisé qu'après passage des modules de récursion actifs (§8.5). Le raisonnement de décomposition (rôles envisagés, justification) est consigné dans `JOURNAL.md`.

### 7.2 Procédure (phase `ON_SPAWN`)
Pour chaque enfant :
1. Créer le répertoire `<soi>/<nom-role>/` et `workspace/`.
2. Instancier `ROLE.md` depuis le template — **remplir toutes les sections**, dont Contexte hérité et budget alloué (⊂ budget propre).
3. Instancier `MEMORY.md`, `STATUS.md` (= `INIT`), `JOURNAL.md`, `INBOX.md`, `OUTBOX.md` depuis les templates.
4. Créer la fiche `registry/instances/<chemin>.md` (§11).
5. Mettre à jour `registry/ORG.md`.
6. Déclarer les dépendances entre enfants (si module `dependency-graph`).
7. Commit Git : `[<chemin-parent>] spawn <nom-role>`.

### 7.3 Incarnation (module d'orchestration)
Depuis v1.1 (`direct-spawn`), le parent lance le **lanceur** du framework, jamais `claude -p` directement :
```bash
node framework/bin/holarch-spawn.js <chemin>
```
Le lanceur (§16) résout modèle et effort d'après le profil de l'instance (fiche registre) et la politique de `CONFIG.md` (§9.1), injecte KERNEL + CONFIG + modules actifs dans le prompt système et les fichiers de l'instance dans le prompt utilisateur, applique `permission_mode` (§9.1 — identique pour toute la mission, afin qu'aucun enfant ne dispose d'un niveau d'autonomie différent de celui choisi par l'utilisateur), les plafonds (tours, dépense, contexte) et les garde-fous (hooks), puis consigne la session (coût, tokens, tours, identifiant) dans `registry/SESSIONS.md`. Le parent attend la fin du processus, lit la ligne de synthèse du lanceur puis le `STATUS.md` et l'`INBOX.md` mis à jour, et traite (`ON_CHILD_DONE`).

### 7.4 Archivage
Instance `DELIVERED` acceptée ou `FAILED` abandonnée → le parent déplace son répertoire vers `mission/graveyard/<chemin>/` (module `graveyard-handover`) après en avoir extrait ce qui est réutilisable. La fiche registre passe à `ARCHIVED` (elle n'est pas supprimée).

### 7.5 Recadrage
Si un `BLOCKER`/`CLARIFICATION` révèle un ROLE.md inadapté, le parent peut : (a) répondre par `RESPONSE`, ou (b) archiver l'instance et en spawner une nouvelle avec un ROLE.md corrigé, héritant du workspace via le graveyard. Le ROLE.md n'est **jamais modifié en place** (traçabilité).

---

## 8. Système de modules

### 8.1 Contrat de module (format obligatoire)

```markdown
# Module : <nom>
> Catégorie : <orchestration|synchronisation|memoire|recursion|conflits|registre|observabilite|extensions>
> Version : <semver>
> Requiert : <modules ou "—">
> Incompatible avec : <modules ou "—">
> Complète bien : <modules ou "—">        ← indicatif, non contraignant

## Paramètres
| Paramètre | Défaut | Description |

## Règles injectées
### ⚓ <NOM_DU_HOOK>
<Instructions impératives à la 2e personne, autonomes et sans ambiguïté.>
### ⚓ <AUTRE_HOOK>
...
```

**Règles de conception d'un module** : (a) ne jamais contredire le KERNEL ; (b) ne s'accrocher qu'aux hooks existants ; (c) être lisible isolément ; (d) déclarer toutes ses incompatibilités.

### 8.2 Chargement
Au `ON_WAKE`, la session lit uniquement les modules listés actifs dans CONFIG.md. À chaque hook du cycle, elle applique les règles injectées de **tous** les modules actifs pour ce hook, dans l'ordre de déclaration de CONFIG.md.

### 8.3 Résolution de conflit entre modules
Si deux règles injectées se contredisent en pratique : priorité à l'ordre de CONFIG.md (premier déclaré gagne), et émission d'une `ALERT` vers le parent (ou l'utilisateur si racine) pour signaler le défaut de configuration.

### 8.4 `MANIFEST.md`
Table de tous les modules : nom, catégorie, version, requiert, incompatibilités, description d'une ligne. Sert à la validation de CONFIG au bootstrap. Un module absent du MANIFEST est inutilisable.

### 8.5 Modules v1 — spécifications résumées

| Module | Hooks | Comportement essentiel | Paramètres |
|---|---|---|---|
| `direct-spawn` | ON_SPAWN, ON_SUPERVISE | Le parent lance les sessions enfants via CLI et attend leur fin (§7.3) | `commande_cli` |
| `fork-join` | ON_SPAWN, ON_CHILD_DONE, ON_DELIVER | Lance tous les enfants séquentiellement dans l'ordre déclaré ; ne compile qu'après le dernier | — |
| `dependency-graph` | ON_SPAWN, ON_CHILD_DONE | Dépendances déclarées dans les fiches registre ; lancement en ordre topologique ; détection de cycle = erreur de conception à corriger avant spawn | `max_parallel` (v1 : 1) |
| `monolithic` | ON_SLEEP | MEMORY.md réécrit intégralement, pas de JOURNAL obligatoire | — |
| `journal-synthesis` | ON_ORIENT, ON_SLEEP | JOURNAL append-only + MEMORY = synthèse ≤ `taille_max` lignes | `taille_max` (80) |
| `self-assessment` | ON_PLAN | Questionnaire obligatoire avant spawn (tient dans une session ? expertises distinctes ? coordination < gain ?) ; réponses au JOURNAL | — |
| `instance-budget` | ON_PLAN, ON_SPAWN | Budget hérité, réparti, décompté dans les fiches registre ; spawn interdit à budget nul → `BLOCKER` | `budget_total` |
| `max-depth` | ON_PLAN | Profondeur ≥ max ⇒ spawn interdit, faire soi-même ou `BLOCKER` | `profondeur_max` (3) |
| `typed-escalation` | ON_CONFLICT | Applique la table des types §5.5 + règles d'escalade §5.6 | `delai_reponse` |
| `graveyard-handover` | ON_CHILD_DONE | Archivage avec note de passation `HANDOVER.md` rédigée par le parent | — |
| `sharded-files` | ON_WAKE, ON_SPAWN, ON_SLEEP | Registre éclaté §11 ; écriture exclusive sur sa fiche | — |

---

## 9. Configuration et presets

### 9.1 Format de `CONFIG.md`
Markdown à tableaux stricts (parsables) :

```markdown
# Configuration — mission : <nom>
> Preset de base : <nom ou "aucun"> · Framework : v<version>

## Modules actifs
| # | Catégorie | Module |
|---|---|---|
| 1 | orchestration | direct-spawn |
...

## Paramètres
| Paramètre | Valeur |
|---|---|
| budget_instances_total | 15 |
| profondeur_max | 3 |
| langue_de_travail | fr |
| commit_par_session | oui |
| permission_mode | acceptEdits |
| format_rapport_final | simple |
| budget_usd_par_session | 5 |
| max_tours_par_session | 200 |
| seuil_contexte_tokens | 120000 |

## Politique de modèle
| Profil | Modèle | Effort |
|---|---|---|
| conception | opus | high |
| execution | sonnet | medium |
| relecture | opus | medium |
| exploration | fable | xhigh |

## Valeurs organisationnelles
- <injectées textuellement dans le "Contexte hérité" de chaque ROLE.md>
```

Paramètres transverses (issus des décisions §15) :
- `permission_mode` : valeur passée à `--permission-mode` pour **toute** invocation `claude -p` de la mission — le lancement racine (§10) et l'incarnation de chaque enfant (§7.3) utilisent la même valeur. Valeurs acceptées : celles du CLI Claude Code (`acceptEdits`, `default` ou son alias `manual`, `plan`, `auto`, `dontAsk`, `bypassPermissions`). Un changement de ce paramètre ne s'applique qu'aux sessions lancées après modification (pas de rétroaction sur les sessions déjà closes).
- `format_rapport_final` : détermine la structure du rapport produit par la racine à `DELIVERED` (§10, étape 5). Valeurs v1 : `simple` ou `executive-summary`.
- `budget_usd_par_session`, `max_tours_par_session`, `seuil_contexte_tokens` et la table `## Politique de modèle` (profils `conception`, `execution`, `relecture`, `exploration` → modèle et effort par défaut ; l'effort effectif d'une instance peut être posé dans sa fiche registre, ligne `Effort`, et son régime changé par elle-même entre deux sessions — module `direct-spawn`) : paramètres du harnais (§16), déclarés avec leurs valeurs par défaut par `direct-spawn` v1.1 — un `CONFIG.md` qui les omet reste valide. `modele_cli`/`effort_cli`, s'ils sont renseignés, s'imposent à tous les profils.

Contraintes : exactement **un** module par catégorie obligatoire (orchestration, synchronisation, memoire, registre) ; zéro à N pour les catégories cumulables (recursion, conflits, extensions, observabilite) ; `permission_mode` et `format_rapport_final` sont **obligatoires** dans tout `CONFIG.md` valide (validation bootstrap, §10 étape 1).

### 9.2 Presets v1

| | `solo-light` | `team-standard` |
|---|---|---|
| Usage | test, petite tâche | projet moyen |
| orchestration | direct-spawn | direct-spawn |
| synchronisation | fork-join | dependency-graph |
| memoire | unites-indexees (depuis 1.4.0 ; `monolithic` avant) | journal-synthesis |
| recursion | max-depth(2) + self-assessment | les 3, budget 15, profondeur 3 |
| conflits | typed-escalation | typed-escalation + graveyard-handover |
| registre | sharded-files | sharded-files |
| budget | 5 | 15 |
| permission_mode | acceptEdits | acceptEdits |
| format_rapport_final | simple | executive-summary |

---

## 10. BOOTSTRAP — procédure de démarrage

Contenu normatif de `BOOTSTRAP.md`, exécuté par la toute première session :

1. **Validation** : vérifier l'existence de `CONFIG.md` et `mission/OBJECTIVE.md` ; vérifier CONFIG contre MANIFEST (modules existants, versions, incompatibilités, un module par catégorie obligatoire, paramètres requis présents). Échec ⇒ rapport d'erreurs détaillé à l'utilisateur, **arrêt sans rien créer**.
2. **Initialisation** : créer `mission/registry/{ORG.md, DECISIONS.md, instances/, contracts/}`, `shared/`, `graveyard/` ; `git init` si absent ; commit initial `[bootstrap] mission initialisée`.
3. **Création de la racine** : instancier `mission/concepteur/` (procédure §7.2, parent = "utilisateur"), avec un ROLE.md dont la Mission = analyse de OBJECTIVE.md, la Redevabilité = envers l'utilisateur, le budget = `budget_instances_total`.
4. **Incarnation** : la même session incarne immédiatement le concepteur et démarre son cycle de vie au `ON_WAKE`.
5. **Fin de mission** : quand la racine atteint `DELIVERED`, elle produit un **rapport final** à l'utilisateur, dans le format prescrit par le paramètre `format_rapport_final` de `CONFIG.md` (§9.1) :
   - `simple` : un seul markdown avec synthèse du livrable, pointeurs `shared/`, organigramme final, bilan budget, propositions d'amélioration (droit de proposition exercé jusqu'au sommet).
   - `executive-summary` : un `RAPPORT.md` de synthèse (≤ 1 page : objectif, résultat, décision requise s'il y en a une) pointant vers des annexes détaillées (`RAPPORT-annexes/` : organigramme, bilan budget, journal des décisions clés, propositions).

Commande utilisateur unique (v1.1) — le lanceur (§16) lit `permission_mode` dans `CONFIG.md` et l'applique à la racine comme à chacun de ses enfants (§7.3) :
```bash
node framework/bin/holarch-spawn.js --bootstrap
```

---

## 11. Registre — fiche d'instance

`registry/instances/<chemin-avec-tirets>.md` :

```markdown
# <chemin>
| Champ | Valeur |
|---|---|
| Rôle | <intitulé> |
| Parent | <chemin> |
| Statut | <état §5.2, tenu à jour par l'instance> |
| Budget alloué / consommé | n / m |
| Dépend de | <chemins ou —> |
| Livrables | <pointeurs shared/> |
| Créée / Archivée | <dates> |
```

`ORG.md` : arbre indenté des instances avec statuts — régénérable depuis `instances/`, maintenu par les parents à chaque spawn/archivage.

---

## 12. Modes de défaillance et parades

| Défaillance | Détection | Parade v1 |
|---|---|---|
| Session enfant plantée (processus interrompu) | STATUS resté `WORKING` après fin du processus | Le parent relance l'incarnation (l'instance reprend via ses fichiers **committés** — JOURNAL.md/PROGRESS.md/livrables partiels, pas seulement MEMORY.md, souvent le plus périmé lors d'un crash) ; 2 échecs ⇒ `FAILED` + recadrage |
| Boucle de spawn / explosion | budget & profondeur | modules `instance-budget` + `max-depth` (fusibles) |
| Livrable non conforme | vérification `ON_CHILD_DONE` | `TASK` correctif ; 2 rejets ⇒ recadrage §7.5 |
| Dérive de mission | Contexte hérité obligatoire | + devoir de fidélité §5.3.5 |
| Corruption du registre | écriture exclusive par fiche | + Git pour restauration |
| CONFIG incohérente | validation bootstrap | arrêt avant toute création |
| Enfant qui n'écrit pas sa mémoire | parent lit MEMORY à `ON_CHILD_DONE` | `TASK` correctif "complète ta mémoire" |
| Deadlock de dépendances | tri topologique au spawn | cycle ⇒ interdiction de spawner en l'état |
| Commande Bash non pré-autorisée en session `-p` non interactive | Mesuré v1.1 (§16.3, stdin fermé) : refus **immédiat**, consigné dans `permission_denials` du résultat JSON — pas de blocage. Le blocage silencieux observé en v2 (`docs/examples/external-orchestrator-demo/`, `claude -p` nu, réglages globaux alors invalides) n'a pas été reproduit avec le lanceur | Le lanceur ferme stdin, porte l'allowlist via `--settings` (honorée sans confiance préalable du dossier) et annonce à l'instance que tout refus est immédiat ; élargir l'allowlist de `framework/claude/instance-settings.json` de façon proactive selon les langages des missions (`BOOTSTRAP.md` §0, point 2) |

---

## 13. Plan de tests d'acceptation

| # | Test | Critère de succès | Statut | Rejoue via |
|---|---|---|---|---|
| T1 | Bootstrap avec CONFIG invalide (2 modules incompatibles) | Arrêt propre, rapport d'erreur, zéro fichier créé dans mission/ | ✅ exécuté (v1) | `npm run lint` (`config-lint`) sur un `CONFIG.md` à modules incompatibles — hors périmètre du banc de mesure (chantier 5), qui ne rejoue pas T1 |
| T2 | Mission triviale, preset solo-light (*"rédige un README pour X"*) | La racine fait seule (aucun spawn), livre, rapport final | rejouable à sec (banc chantier 5, depuis « à faire ») | `node tools/holarch-bench/bench.js --a-sec` — scénario `livraison-simple` (`framework/tests/scenarios/livraison-simple.json`) : une session unique, code 0, `DELIVERED`, ligne `SESSIONS.md`, zéro enfant. 0 USD |
| T3 | Mission moyenne, solo-light (*"conçois et documente un petit outil CLI"*) | 2-4 instances, profondeur ≤ 2, livrable compilé conforme | ✅ exécuté (v1) — [`docs/examples/t3-csvjson-mission/`](examples/t3-csvjson-mission/) | Archive ci-contre ; rejouable réel à nouveau via `node tools/holarch-bench/bench.js --reel t3 --budget-usd 6` (copie `docs/examples/t3-csvjson-mission` dans une racine jetable, lance `--bootstrap` pour de vrai — coût réel, plafonné à 6 USD) |
| T4 | Reprise après interruption : tuer une session enfant en plein travail | Relance ⇒ l'instance reprend via ses fichiers **committés** sans perte majeure | ✅ **exécuté pour de vrai** (v2, itération 3, vrai `SIGKILL` de groupe sur une instance réelle de la holarchie) — [`docs/examples/t4-real-crash-recovery/`](examples/t4-real-crash-recovery/), rapport [`docs/archive/mission-holon-v2/shared/concepteur/v2/tests/T4-reel-rapport.md`](archive/mission-holon-v2/shared/concepteur/v2/tests/T4-reel-rapport.md) ; réserve du premier rejeu manuel (`docs/examples/t4-crash-recovery/`) levée. Réserves d'échantillon assumées : une seule occurrence, un seul modèle, kill de groupe seulement (pas « le lanceur survit à la mort du CLI ») | Archive ci-contre (occurrence réelle) ; le mécanisme de reprise (relance après coupure, prompt reconstruit depuis les fichiers committés) est en outre rejouable à sec, à 0 USD, via `node tools/holarch-bench/bench.js --a-sec` — scénario `hibernation-puis-livraison` (ré-incarnation jusqu'à `relances_max`) et scénario `crash-sans-json` (code 2, `.stderr.log` présent, aucune ligne perdue) |
| T5 | Conflit provoqué : ROLE volontairement ambigu | L'enfant émet `CLARIFICATION`/`BLOCKER`, le parent recadre | rejouable réel, **non exécuté** (banc chantier 5, depuis « à faire ») | Aucun scénario à sec ne le rejoue : `HOLARCH_FAKE_CLAUDE` ne simule qu'un CLI aux réponses préécrites, pas le raisonnement d'un vrai modèle face à une ambiguïté — ce test exige un vrai appel LLM. Procédure documentée pour un rejeu réel : instancier une mission avec un `ROLE.md` d'enfant volontairement ambigu, puis `node framework/bin/holarch-spawn.js --bootstrap` (coût réel, non plafonné par le banc). **Non exécuté par ce chantier** : le plafond d'une seule exécution réelle alloué à `concepteur/implementeur-banc` a déjà été consommé par T3 (`--reel t3`, 4,72 USD) — cf. `RAPPORT.md` |
| T6 | Budget épuisé | Spawn refusé, `BLOCKER` remonté, pas de dépassement | ⚠️ exécuté avec réserve (v2) — [`docs/examples/t6-budget-exhausted/`](examples/t6-budget-exhausted/) ; méthode manuelle, pas de vrai processus. **Depuis le lanceur v1.1**, le refus est en outre garanti mécaniquement par le hook `spawn-guard` (§16.2, budget nul ou dépassé ⇒ `deny` immédiat) — plus solide qu'un rejeu ponctuel, mais toujours pas le même objet qu'un vrai processus observé en train de refuser | Archive et hook ci-contre ; en complément, à 0 USD, `node tools/holarch-bench/bench.js --a-sec` — scénario `budget-epuise` (`subtype: error_max_budget_usd` renvoyé par le CLI ⇒ code 2, note lisible dans `STATUS.md`) |
| T7 | Audit : reconstituer une décision depuis Git + JOURNAL | Un humain y parvient sans aide | rejouable à sec (banc chantier 5, depuis « à faire ») | `node tools/holarch-bench/bench.js --a-sec` (n'importe quel scénario, p. ex. `livraison-simple` ou `hibernation-puis-livraison`) construit une racine jetable avec un **vrai** dépôt Git (`git init`, commits réels) et un `JOURNAL.md` réel ; un humain y reconstitue la décision (pourquoi la session a fini dans tel état) depuis `git log` et `JOURNAL.md` seuls, sans aide — chaque exemple archivé sous `docs/examples/` en constituait déjà un exercice informel, ceci en fait un exercice reproductible à volonté et à coût nul |

T4 et T6 (v2) devaient initialement s'exécuter via de vrais sous-processus `claude -p` tués/observés automatiquement ; les deux ont buté sur des lacunes d'environnement documentées en `BOOTSTRAP.md` §0 (points 2 et 4) et ont été rejoués manuellement à la place — voir les rapports respectifs pointés depuis chaque dossier d'exemple pour le détail et les réserves assumées (devoir d'honnêteté, §5.3.4).

Le banc de mesure à deux étages (chantier 5, `docs/IMPLEMENTATION.md` §6) rend T2, T5 et T7 **rejouables** — au sens où le tableau ci-dessus donne désormais un scénario ou une commande précise pour chacun, alors qu'ils ne portaient auparavant que la mention « à faire » sans procédure associée. « Rejouable » ne veut pas dire « exécuté » : le scénario `livraison-simple` qui rejoue T2 a été vérifié empiriquement (7/7 scénarios PASS, y compris celui-ci, voir `RAPPORT.md` du chantier) ; les briques qui rendent T7 possible (vrai dépôt Git, vrai `JOURNAL.md` dans la racine jetable) sont vérifiées de première main par lecture du code de `bench.js` et par l'exécution de `--a-sec`, mais l'exercice d'audit humain lui-même n'a pas été rejoué en conditions dans cette session. T5 ne l'a délibérément pas été : la procédure est documentée et prête, mais son exécution coûterait un appel LLM réel, hors du plafond d'une seule exécution déjà consommé par ce chantier sur T3.

---

## 14. Feuille de route

> **Feuille de route vivante : [`ROADMAP.md`](ROADMAP.md) (2026-09-09).** Ce qui suit est l'état des lieux v1/v2 tel qu'il a été tenu jusqu'au 2026-09-09, conservé comme journal ; les liens vers la mission `holon-v2` pointent désormais vers `archive/mission-holon-v2/`.

**v1 (cette spec)** : KERNEL, 11 modules, 2 presets, bootstrap, tests T1-T7 (T1, T3 exécutés — voir §13).

**v2, avancement réel** (synthèse complète : [`docs/archive/mission-holon-v2/shared/concepteur/SYNTHESE-HOLON-V2.md`](archive/mission-holon-v2/shared/concepteur/SYNTHESE-HOLON-V2.md), bilan de session : [`docs/archive/mission-holon-v2/shared/concepteur/v2/RAPPORT-session-2.md`](archive/mission-holon-v2/shared/concepteur/v2/RAPPORT-session-2.md)) :
- T4, T6 exécutés (avec réserve) — §13.
- **Parallélisme réel + `external-orchestrator`** : prototype livré et démontré en conditions réelles (~33% de gain mesuré sur un graphe à 3 nœuds) — outil [`tools/external-orchestrator/`](../tools/external-orchestrator/), trace [`docs/examples/external-orchestrator-demo/`](examples/external-orchestrator-demo/), rapport complet [`docs/archive/mission-holon-v2/shared/concepteur/v2/orchestrator/RAPPORT.md`](archive/mission-holon-v2/shared/concepteur/v2/orchestrator/RAPPORT.md). Reste hors périmètre : `dependency-graph` lui-même (dans `framework/`) n'est pas modifié — c'est un outil externe, pas une intégration du noyau.
- **Garde-fou de budget de contexte** : module `context-budget` intégré au catalogue (`framework/modules/recursion/context-budget.md`, `MANIFEST.md`), actif par défaut dans les deux presets depuis v1.1. Depuis le harnais (§16), il est **mesuré** (contexte réel lu par le hook `context-watch`) quand l'instance est lancée par `holarch-spawn.js` ; l'heuristique auto-rapportée d'origine ne sert plus qu'aux sessions lancées hors lanceur.
- **Politique de sélection de modèle par rôle + harnais d'exécution (v1.1, 2026-09-02)** : lanceur `framework/bin/holarch-spawn.js`, garde-fous `framework/hooks/holarch-hooks.js`, profils `conception`/`execution`/`relecture` dans `CONFIG.md`, coût réel par session dans `registry/SESSIONS.md` — §16, décisions 7-8 (§15).
- **Overrides hiérarchiques de `CONFIG.md`** : intégré en décision 11 (§15), puis **retiré** le 2026-09-04 lors de la synchronisation du harnais depuis le framework public — jamais dogfoodable par la holarchie elle-même (son activation passait par `framework/CONFIG.md`, interdit en écriture à toute instance, cf. décision 12 ci-dessous) et déjà signalé comme risqué par sa propre proposition d'origine ([`docs/archive/mission-holon-v2/shared/concepteur/v2/framework-proposals/config-override.md`](archive/mission-holon-v2/shared/concepteur/v2/framework-proposals/config-override.md)). Section `## Overrides hiérarchiques` retirée de `CONFIG.md` (§9.1), `resolveOverrides` retiré de `framework/bin/holarch-spawn.js`.
- **T4 rejoué pour de vrai (`SIGKILL` réel), réserve levée** — §13 ; trois défauts de harnais trouvés à cette occasion (`STATUS.md` d'un enfant tué reste `READY`, aucune ligne `SESSIONS.md` pour une session tuée, critère T4 à reformuler en « reprend via ses fichiers committés ») : détail et rapport complet [`docs/archive/mission-holon-v2/shared/concepteur/v2/RAPPORT-session-3.md`](archive/mission-holon-v2/shared/concepteur/v2/RAPPORT-session-3.md), pas encore corrigés dans le harnais.
- **`module-forge`** : validateur mécanique de modules et de compositions (= T1 rejouable à la demande), conçu par `concepteur` et démontré par un vrai enfant HOLARCH (`concepteur/forgeron`, module `milestone-reviews`) — outil [`tools/module-forge/`](../tools/module-forge/) (10 tests, branchés `npm test`/CI).
- **`milestone-reviews`** : premier module de la catégorie `extensions`, conçu par l'enfant `forgeron` ci-dessus, revérifié et catalogué — [`framework/modules/extensions/milestone-reviews.md`](../framework/modules/extensions/milestone-reviews.md), `MANIFEST.md`. Recouvrement partiel assumé avec `heartbeat-log` (l'un journalise, l'autre vérifie activement à des jalons) ; non actif par défaut dans les presets v1.
- **« Session RH » (setup interactif guidé)** : `holarch-init` pose 7 questions en langue naturelle et produit `OBJECTIVE.md` + `CONFIG.md`, validés par `module-forge` — outil [`tools/holarch-init/`](../tools/holarch-init/) (11 tests), démonstration réelle du dialogue interactif [`docs/examples/holon-init-demo/`](examples/holon-init-demo/). Seuil « moins de 5 minutes » de l'objectif O6 non mesuré sur un vrai utilisateur non expert.
- **`git-branches`** : catalogué comme module `extensions` — une branche par instance, fusion `--no-ff` par le parent à `ON_CHILD_DONE` conditionnée à l'acceptation du livrable (le commit de fusion porte le verdict de revue), aucun `push`/pull request. Détail et arbitrage (catégorie, portée, ce qui reste hors périmètre) : §15, décision 12. Dogfoodé pour de vrai en itération 4 (deux niveaux de revue réels, un renvoi correctif réel) : verdict du dogfooding — principe à promouvoir, module pas prêt en l'état (règle de branche débordant sur des fichiers hors périmètre de l'enfant) — [`docs/archive/mission-holon-v2/shared/concepteur/v2/dogfooding-git-branches.md`](archive/mission-holon-v2/shared/concepteur/v2/dogfooding-git-branches.md).
- **Synchronisation du harnais depuis le framework public** (`origin/main`, dépôt `Movida/holon`, 2026-09-04) : lanceur/hooks/tests/presets/`MANIFEST.md` alignés sur la version publique la plus récente — retrait des overrides hiérarchiques (ci-dessus), ajout du garde-fou `wake-guard`, correctif d'un bug de ré-incarnation sur état périmé, défense en profondeur du refus d'écriture sous `framework/`, module `instance-budget` activé, nouvel outil [`tools/config-lint/`](../tools/config-lint/) (mécanise l'Étape 1 de `BOOTSTRAP.md`, branché `npm test`). Détail §16.4 et `mission/registry/DECISIONS.md`. `tools/holarch-init`/`tools/module-forge` ont évolué indépendamment sur le dépôt public (réécriture substantielle) — délibérément **non synchronisés** cette fois : hors périmètre du mandat en cours, à traiter séparément.
- Restent non traités : `role-personality` · `enterprise-full`.

---

## 15. Décisions actées (revue du 2026-09-01)

Les trois points restés ouverts en fin de conception ont été tranchés. Conformément à l'esprit d'auditabilité du framework lui-même (O4, §5.3.6), ils sont conservés ici en journal plutôt que supprimés :

1. **Premier objectif réel** — *"T3 comme premier objectif réel vous convient-il ?"* → **Validé.** Le test **T3** (§13 : *"conçois et documente un petit outil CLI"*, preset `solo-light`) sert de première mission réelle du framework, après le garde-fou T1 (bootstrap avec CONFIG invalide).
2. **`--permission-mode`** — *"Confortable, ou mode plus supervisé pour les premiers tests ?"* → **Rendu paramétrable** plutôt que fixé en dur. Nouveau paramètre `permission_mode` dans `CONFIG.md` (§9.1), réutilisé identiquement par toute invocation `claude -p` de la mission : lancement racine (§10) et incarnation des enfants (§7.3). Défaut `acceptEdits` dans les deux presets v1 (§9.2) ; l'utilisateur peut le durcir (`default`, `plan`) avant lancement pour des tests plus supervisés.
3. **Rapport final de la racine** — *"Simple markdown, ou format imposé (executive summary + annexes) ?"* → **Rendu paramétrable** plutôt que fixé. Nouveau paramètre `format_rapport_final` dans `CONFIG.md` (§9.1), deux valeurs v1 : `simple` (défaut `solo-light`) ou `executive-summary` (défaut `team-standard`). Comportement détaillé en §10, étape 5.

### Revue du 2026-09-02 — premiers pas v2

4. **T4/T6 exécutés, méthode manuelle plutôt qu'automatisée** — le plan prévoyait de vrais sous-processus `claude -p` tués/observés par script. Deux lacunes d'environnement l'en ont empêché : une règle de permission globale invalide (hors dépôt HOLARCH, corrigée) et un mode de défaillance silencieux nouvellement découvert (Bash non pré-autorisé ⇒ blocage sans erreur en session `-p` non interactive, désormais documenté §12 et `BOOTSTRAP.md` §0). Les deux tests ont été rejoués manuellement (crash simulé par écriture plutôt que `SIGKILL` réel) : validés sur le plan documentaire, réserve explicite assumée plutôt que masquée (§5.3.4). Détail : `docs/examples/t4-crash-recovery/`, `docs/examples/t6-budget-exhausted/`.
5. **`external-orchestrator` validé par une démonstration réelle** — pas seulement conçu sur le papier : trois vraies sessions `claude -p`, gain de temps mesuré (~33%) sur un graphe à deux branches indépendantes convergeant vers une troisième. Reste un outil externe au KERNEL (§4.3, cloisonnement `framework/`), pas une modification de `dependency-graph`.
6. **`context-budget` intégré au catalogue de modules, `config-override` délibérément non fusionné au KERNEL** — la distinction retenue : un module additif et optionnel (aucune instance existante n'est affectée tant qu'il n'est pas déclaré dans un `CONFIG.md`) peut être landé directement ; une modification du contrat KERNEL lui-même, même rétrocompatible par construction, attend une validation explicite (rejeu de T1) avant adoption — cohérent avec la distinction déjà faite par `CONTRIBUTING.md` entre « ajouter un module » et « modifier le KERNEL ».

### Revue du 2026-09-02 (suite) — harnais d'exécution v1.1

7. **Chaque instance est lancée par un lanceur, plus par un `claude -p` nu** — mesuré sur ce dépôt (Claude Code 2.1.257, §16.3) : sans `--model`, chaque enfant héritait du modèle et de l'effort des réglages utilisateur (`~/.claude/settings.json` : ici `claude-fable-5-1`, effort `max`) — le paramètre `modele_cli` de `CONFIG.md` n'était jamais transmis ; le contexte fixe d'une session (prompt système, 45 outils, 18 skills, 16 serveurs MCP) pesait ≈ 31 000 tokens par appel, contre ≈ 18 400 avec outils restreints, skills et MCP exclus (−41 %) ; la mémoire automatique de Claude Code était partagée par toutes les instances d'un même dépôt, hors Git, à rebours de O3/O4 et du cloisonnement §4.3. Décision : `direct-spawn` v1.1 délègue l'incarnation à `framework/bin/holarch-spawn.js` (§16), qui fixe modèle et effort par profil (politique de modèle par rôle, priorité 3.3 de la synthèse v2), réduit et stabilise le contexte fixe (prompt système partagé par toutes les instances d'une mission, donc cache de prompt partagé), coupe la mémoire automatique, borne chaque session (tours, dépense, contexte) et journalise son coût réel dans `registry/SESSIONS.md`. Le KERNEL n'est amendé qu'à deux endroits (§2 Réveil : ne pas relire ce que le lanceur a déjà fourni ; §5.3.8 : économie de contexte et hibernation volontaire) — amendements de clarification, sans nouvelle règle contradictoire avec les modules existants.
8. **Les invariants critiques du cycle de vie deviennent aussi mécaniques** — trois hooks Claude Code (§16.2) : fin de session refusée tant que `STATUS.md` reste `WORKING` sans note d'hibernation volontaire ou que `mission/` n'est pas committé (phase 9 inconditionnelle, §5.1) ; incarnation d'un enfant refusée si la mécanique de spawn est incomplète, si la cible n'est pas un enfant direct, si `profondeur_max` est dépassée ou si le budget d'instances est nul ou dépassé (réserve du test T6 levée mécaniquement) ; ordre d'hiberner injecté quand le contexte **réel** (usage lu dans la transcription) dépasse `seuil_contexte_tokens` — ce qui remplace, quand le lanceur est utilisé, l'heuristique auto-rapportée de `context-budget` et résout son « point non résolu » (la ré-incarnation est faite par le lanceur, `relances_max`). Vérifié : hook `Stop` honoré en mode `-p` (la session corrige puis termine) ; règles d'autorisation d'un fichier `--settings` appliquées sans confiance préalable du dossier ; refus d'une commande non autorisée immédiat, pas bloquant (§12).

### Revue du 2026-09-03 — itération 3 de `concepteur`, trois promotions arbitrées

9. **`module-forge` et `holarch-init` promus dans `tools/`, `milestone-reviews` promu dans `framework/modules/extensions/`, `config-override` délibérément laissé de côté** — itération 3 de `concepteur` (mandat `MSG-concepteur-2` clos, `docs/archive/mission-holon-v2/shared/concepteur/v2/RAPPORT-session-3.md`) a livré trois candidats à la promotion plus un rejeu réel de T4. Décision, par analogie avec le précédent `external-orchestrator` (§14) : les deux outils (validateur de module + setup guidé), zéro dépendance et déjà testés (10 + 11 tests), relogés vers `tools/module-forge/` et `tools/holarch-init/`, suites branchées sur `npm test`/CI ; `milestone-reviews`, conçu et démontré par un vrai enfant HOLARCH (`concepteur/forgeron`) puis revérifié par `concepteur` (KERNEL §5.2), catalogué comme premier module de la catégorie `extensions` — un défaut de forme (catégorie « extension » singulier, non détectable avant catalogage réel) corrigé au passage, confirmant en conditions réelles la limite que `module-forge` documentait déjà de lui-même. `config-override` (2.4, priorité §14) **n'a pas été fusionné** : c'est un amendement du KERNEL, pas un module additif, sa propre proposition signale un cas non vérifié (override de `memoire`/`registre` en cours de holarchie), et `CONTRIBUTING.md` exige un rejeu de T1 pour tout changement de KERNEL — aucun des deux n'a été fait. Les trois défauts de harnais trouvés par le T4 réel (§14) sont traités séparément — décision 10.

10. **Les trois défauts de harnais trouvés par le rejeu réel de T4 sont corrigés** — `docs/archive/mission-holon-v2/shared/concepteur/v2/tests/T4-reel-rapport.md` (promu [`docs/examples/t4-real-crash-recovery/`](../docs/examples/t4-real-crash-recovery/)) documentait trois trous, tous dans `framework/bin/holarch-spawn.js` (jamais dans le contrat KERNEL/modules lui-même). (1) `STATUS.md` d'un enfant fraîchement incarné restait `READY` jusqu'à son propre `ON_WAKE` — le signal « session plantée » (§12, STATUS resté `WORKING`) ne détectait donc rien pour un crash avant ce point : corrigé, le lanceur pose désormais `WORKING` avant l'appel CLI (`presetWorking`, no-op si déjà `WORKING` ou si le fichier n'existe pas encore — bootstrap). (2) une session tuée ne laissait aucune ligne dans `SESSIONS.md`, sous-estimant tout audit de coût fondé sur ce seul fichier : corrigé, une ligne « démarrée » y est ajoutée avant l'appel CLI (`appendStartedLine`) ; append-only oblige, elle n'est jamais réécrite, la ligne « terminée » s'ajoute séparément en fin de session normale — fenêtre résiduelle assumée en §16.4. (3) le critère de succès de T4 (§13) disait « reprend via `MEMORY.md` », alors que ce fichier est justement le plus périmé lors d'un crash (écrit seulement à `ON_SLEEP`) : reformulé en « reprend via ses fichiers **committés** », cohérent avec ce que le test a réellement observé. Deux tests ajoutés (`framework/tests/holarch.test.js`), `npm test` toujours vert (32 tests).
11. **Overrides hiérarchiques de `CONFIG.md` intégrés, sans amendement du KERNEL** — la proposition de la décision 6 (§15) était restée volontairement non fusionnée parce qu'elle amendait le KERNEL (§2, phase Réveil : l'instance résout elle-même ses overrides) sans rejeu de T1. Relecture à la lumière du lanceur v1.1 (décision 7) : ce raisonnement datait d'avant lui — depuis, ce n'est déjà plus l'instance mais le lanceur qui résout modules et paramètres pour toute instance, systématiquement (§16.1, point 1). Les overrides n'ajoutent donc qu'une entrée de plus à une résolution déjà entièrement mécanique côté lanceur, pas une nouvelle catégorie de changement — le KERNEL n'a besoin d'aucune modification, et la barre de `CONTRIBUTING.md` qui s'applique est celle du harnais (`npm test` vert), pas celle d'un changement de KERNEL. Implémenté dans `resolveOverrides` (`framework/bin/holarch-spawn.js`) : préfixe le plus long gagnant, remplacement (jamais fusion) entre préfixes de longueurs différentes, conflit de catégorie/paramètre pour un même préfixe refusé avant tout appel CLI. Restriction reprise **telle quelle** de la proposition d'origine — catégories `memoire`/`registre` refusées mécaniquement, exactement le cas que sa propre section « ce qui resterait à valider » signalait comme non vérifié. Cinq tests ajoutés ; `npm test` toujours vert (35 tests).

### Revue du 2026-09-03 (suite) — `git-branches`, dernier volet non traité de la synthèse v2

12. **`git-branches` catalogué comme module `extensions`, pas `registre`** — seul point de `SYNTHESE-HOLON-V2.md` §2-3 resté sans aucun travail (`RAPPORT-session-3.md` §3, décision 9 ci-dessus), volontairement laissé de côté par `concepteur` parce qu'il engage le mainteneur sur une convention Git du dépôt lui-même. Tranché ici, après un second avis sollicité auprès d'une autre session (Fable 5.1) sur la question ouverte — quel geste déclenche la fusion d'une branche d'instance. Principe retenu, plus général que les trois options initialement posées (fusion auto locale / fusion auto + push / PR humaine à chaque instance) : **une branche ne fusionne dans sa branche parente que sur le verdict du propriétaire de celle-ci.** Le parent est propriétaire de la branche de chacun de ses enfants directs — le devoir de supervision déjà universel (KERNEL §5.2) se matérialise en un commit de fusion `--no-ff`, sans rien bloquer de nouveau ; l'utilisateur humain est propriétaire de la branche racine, donc la fusion vers `main` (revue humaine, littéralement) reste un geste du mainteneur hors mission, jamais un gate qui suspend une session active. Ce principe absorbe la piste « PR humaine » exactement là où la profondeur ne peut pas servir de proxy à l'enjeu — inutile d'inventer un seuil. Catégorie `extensions` plutôt que `registre` (rangement du brouillon d'origine, `docs/archive/conception-initiale-holon-instance.md`) parce que `registre` impose exactement un module actif et que la politique de branches est orthogonale au format des fiches (`sharded-files` reste inchangé) — précédent direct : `milestone-reviews`, même catégorie, mêmes hooks. `--no-ff` est non négociable : l'orchestration séquentielle (`direct-spawn`) laisse la branche du parent immobile pendant tout le travail de l'enfant, donc toute fusion serait sinon un fast-forward silencieux, recréant l'historique plat qu'on cherche à dépasser. Aucun `push`, aucune pull request : décision distincte, délibérément non couplée (une dépendance réseau à chaque spawn n'est pas une condition de fusion). Fichier : [`framework/modules/extensions/git-branches.md`](../framework/modules/extensions/git-branches.md), catalogué au `MANIFEST.md`, non actif par défaut dans les presets v1 (opt-in). Allowlist Bash du harnais (`framework/claude/instance-settings.json`) étendue à `git switch`, `git branch`, `git merge` — pas `git checkout` (risque de restauration destructive d'un fichier non commité) ni aucun `--force` — appliquée à toute mission, y compris celles qui n'activent pas le module, le fichier de réglages n'étant pas généré par `CONFIG.md` (cohérent avec la décision 7). Validé mécaniquement (`tools/module-forge`, contrat de module conforme + composition dans un `CONFIG.md` de test rejouant T1) et `node --test framework/tests/*.test.js` (14 tests, harnais inchangé sur le fond). Non fait, et volontairement hors périmètre : toute automatisation du geste racine→`main` (aucune instance n'écrit `framework/`, et ce geste n'a par construction pas besoin d'automatisation, l'utilisateur restant seul propriétaire de `main`).
### Revue du 2026-09-09 — HOLARCH, base propre, contexte de réveil

13. **Le projet est renommé HOLARCH** — le nom HOLON était pris sur GitHub par [holon-run/holon](https://github.com/holon-run/holon) (établi local pour agents, décembre 2025, domaine holon.run). Les identifiants suivent (`holarch-spawn.js`, `holarch-hooks.js`, `HOLARCH_*`, `mission/.holarch/`, `tools/holarch-d`, `tools/holarch-init`, skills) ; le mot « holon » reste comme concept ; archives et traces figées gardent l'ancien nom. Détail : §0.
14. **Base propre** — la mission `holon-v2` (18 itérations, 72 sessions de `concepteur`, 130 sessions) est archivée en markdown sous `docs/archive/mission-holon-v2/`, arbre complet au tag `mission-holon-v2-final` ; les documents de conception antérieurs rejoignent `docs/archive/`, la conception v3 `docs/conception/demiurge/`. Nouveaux documents vivants : `docs/ROADMAP.md` (cinq chantiers, positionnement face à holon-run : « là où un runtime sait, HOLARCH prouve »), `docs/IMPLEMENTATION.md` (spécification d'implémentation, fichier par fichier), `docs/ENVIRONNEMENT.md` (où tourne une session). Nouvelle mission `holarch-fondations` (chantiers 1 et 2), `CONFIG.md` à 11 modules : `delegation-budget` et `role-personality` retirés du socle (17 000 et 7 000 caractères de prompt système, sans usage dans la mission).
15. **Cause mesurée des hibernations systématiques, option A appliquée, D rejetée** — 35 sessions consécutives de `concepteur` hibernaient au premier appel d'outil. Mesure sur transcriptions (`docs/diagnostics/2026-09-09-contexte-fixe-au-reveil.md`) : le prompt fixe du réveil pesait à lui seul 123 à 129k tokens (seuil 120k), parce que le lanceur bornait `JOURNAL.md` et `PROGRESS.md` en lignes alors que l'instance écrivait des paragraphes de plusieurs milliers de caractères par ligne ; ratio réel 2,1 caractères par token. Option **A** (bornes en caractères, paramètres `reveil_*`, colonne « Réveil » de `SESSIONS.md`) appliquée le jour même : prompt de réveil du corpus archivé ramené de 189 111 à 44 957 caractères. Option **E** (mémoire adressée) devient le chantier 1 ; option **D** (relever le seuil) rejetée : une compaction automatique de Claude Code a été observée à 148k tokens malgré `--autocompact 180000`, tout seuil au-dessus de 140k serait devancé par elle.
16. **Direction de synchronisation inversée** — ce dépôt est désormais la lignée canonique ; `origin` (`Movida/holon`, ancien nom, historique divergent) passe en lecture seule ; les push vont sur `Movida/holon-v2` ; seul `activity-log` reste à reprendre du dépôt public, avec `module-lint`. Le renommage GitHub est une décision du mainteneur, non prise à cette date.
17. **T8-ter gelé jusqu'au chantier 3** — le bac à sable (réseau, masquage des identifiants) construit dans `holon-v2` reste non promu ; ses acquis D30 à D40 restent valides ; le mandat de sécurité reprend quand chaque instance aura son worktree, qui change la donne de l'isolation. Conséquence à connaître : aujourd'hui une instance tourne avec tous les droits de l'utilisateur (`docs/ENVIRONNEMENT.md` §5).
18. **Profil `exploration`, effort jugé par instance, changement de régime entre deux sessions (2026-09-09)** — demande du mainteneur. Le projet savait *choisir* un modèle par profil, pas ce que le palier au-dessus d'`opus` apporte ni quand y monter ; Fable n'apparaissait qu'à §16.3, comme un héritage à corriger. Trois décisions, sans amendement du KERNEL : (i) un quatrième profil `exploration` (`fable`, effort `xhigh` par défaut) pour les tâches dont le chemin de solution est inconnu au moment du spawn ; (ii) l'effort n'est plus une propriété du profil mais de la tâche — le parent le juge à `ON_SPAWN` (nature de la tâche, difficulté du projet, rigueur attendue du résultat) et le pose dans la fiche registre, ligne `Effort`, optionnelle ; (iii) une instance peut changer de régime elle-même, mais seulement entre deux sessions, en modifiant sa propre fiche puis en hibernant volontairement — le lanceur relisait déjà la fiche à chaque ré-incarnation (§16.1, point 6), il ne fait plus qu'en signaler et décompter l'effet (`changements_regime_max`). Retenu contre l'aller-retour par message au parent (plus lent, séquentiel par construction, et sans autre effet qu'un veto après coup) ; un sous-agent `Agent` sur `fable` reste la voie économique pour une question bornée en cours de session. Le mot « escalade » reste réservé à §8 (conflits) ; ici, « changement de régime ». Coût : au tarif liste, `fable` vaut deux fois `opus` — sous forfait, c'est une mesure d'usage (§16.4) ; `budget_usd_par_session` reste global et tombe donc deux fois plus vite sur une session `exploration`, à ajuster d'après `SESSIONS.md` (mesure avant réglage). Non fait, volontairement : fenêtre de contexte de Fable dans le CLI non mesurée (le seuil de contexte reste celui de la mission) ; `tools/holarch-d` garde sa propre politique à trois profils ; aucune règle de descente automatique.
19. **Le framework est versionné et se déploie vers un modèle ; un projet le récupère, jamais automatiquement (2026-09-10)** — demande du mainteneur : « un système de déploiement vers le modèle (template) automatisé, et la récupération de la dernière image entre chaque itération ». Première moitié retenue telle quelle : `framework/VERSION` (semver, règle patch / mineure / majeure en tête de `framework/CHANGELOG.md`) et `tools/holarch-publish/` qui construit le modèle par liste blanche (jamais `docs/archive/` ni la mission vivante, `CONFIG.md` de départ dérivé de `solo-light`), exige `npm test` et `npm run lint` verts, refuse les remotes du dépôt canonique et une version déjà taguée. Seconde moitié transformée : l'analogie avec une image de conteneur ne tient pas, l'« image » est un contrat en markdown auquel `mission/` est couplé (templates, `MANIFEST.md`), et KERNEL §4 interdit d'écrire `framework/` pendant une mission. `tools/holarch-upgrade/` **rapporte** donc d'abord (version, niveau, fichiers, `CONFIG.md` revalidé contre le nouveau `MANIFEST.md` avec les validateurs de la source) et n'applique sur `--apply` que hors session de mission, sans jamais écrire `CONFIG.md` ni `claude/instance-settings.json`, sans committer. Le skill `holarch-iterate` se contente de signaler une version disponible avant une relance. Le dépôt modèle lui-même reste à créer par le mainteneur (`ENVIRONNEMENT.md` §3, §7).

### Revue du 2026-09-10 — mission `holarch-fondations` terminée, chantiers 1 et 2 promus

20. **Les deux chantiers de la mission sont promus dans `framework/` par le mainteneur, sans réécriture** — la mission `holarch-fondations` (5 sessions de `concepteur`, deux enfants séquentiels, 32,94 USD observables au tarif liste, rapport `docs/archive/mission-holarch-fondations/shared/concepteur/RAPPORT.md`) a livré le chantier 1 (mémoire adressée, §2 d'`IMPLEMENTATION.md`) et le chantier 2 (réveil par condition et lanceur détachable, §3), chacun vérifié de première main par `concepteur` puis promu dans `mission/shared/concepteur/chantier-<n>-*/` avec une note `PROMOTION.md`. Décisions du mainteneur à la promotion : (i) application par les `appliquer.js` livrés, après vérification que la base copiée par les instances n'avait pas dérivé (aucun des six fichiers remplacés par le chantier 1 n'avait changé entre la copie et la promotion) — l'ordre chantier 1 puis 2 est garanti par les ancres, pas par la prose ; (ii) versions `1.2.0` (chantier 1) puis `1.3.0` (chantier 2) : mineures, un `CONFIG.md` écrit en 1.1.x reste valide ; (iii) `PROPOSAL` MSG-concepteur-007 tranchée en option A — l'écart aux deux assertions `SESSIONS.md` de T-C4.2 (§3.8) est accepté, les assertions sont ajoutées à la promotion plutôt que par une ré-incarnation de l'enfant (1,5 à 3 USD pour aucun changement de comportement) ; (iv) les presets restent sur `monolithic` : le module `unites-indexees` n'a été mesuré que sur fixture (8 731 caractères) et corpus archivé (41 492), la bascule des presets attend la mesure sur une mission réelle (dogfooding §3.9 — mesure avant réglage) ; (v) les réserves des `PROMOTION.md` sont levées à la promotion (tests des livrables portés dans `framework/tests/`, mesures du §2.7 en non-régression). Trois leçons du rapport retenues comme règles de conduite : superviser, c'est lire les signaux du harnais (une mémoire tronquée à l'injection se corrige par `TASK` pendant le travail) ; le rapport d'un enfant n'est pas une source, seul un audit point par point contre la spec trouve les assertions qui manquent aux tests ; le trou d'observabilité de `SESSIONS.md` (bootstrap et fins anormales sans ligne) fausse le bilan de coût d'une mission — à combler côté lanceur (proposition n° 1 du rapport).
21. **Dogfooding réel du chantier 2 concluant, presets basculés sur la mémoire adressée, `sleep-guard` corrigé (2026-09-10, framework 1.4.0)** — la procédure du §3.9 a été jouée dans un clone jetable du dépôt (`docs/diagnostics/2026-09-10-dogfooding-reveil-par-condition.md`) : la racine a lancé son enfant en `--detach`, posé `enfant:redacteur:DELIVERED` et hiberné ; l'enfant a livré ; son lanceur a réveillé la racine (une ligne dans `REVEILS.md`), qui a vérifié, promu et clos — trois sessions, 6,28 USD, quatorze minutes, aucune intervention, aucune session parent vivante pendant l'attente, `SESSIONS.md` faisant foi. Mesure réelle du chantier 1 : prompt de réveil de la racine réveillée **11 160 caractères** (trois fiches d'unité, `INDEX.md`, INBOX filtrée, `<reveil>`) pour un prompt système de 62 587 — le contexte fixe tient dans ~35k tokens ; la condition « mesure avant réglage » posée en 20 (iv) est remplie : `solo-light` et `module-forge` passent à `unites-indexees`, `team-standard` garde `journal-synthesis`, `tools/holarch-init` reste à aligner. Constat corrigé : le `sleep-guard` du parent comptait les fichiers en vol de l'enfant détaché (même arbre de travail) et forçait deux commits « instantané de fin de session » de fichiers qui ne lui appartiennent pas — il ignore désormais ce qu'une autre instance vivante écrit (verrou de pid), la propreté finale restant exigée une fois l'enfant terminé. Le chantier 3 (un worktree par instance) reste la réponse structurelle.
22. **Mission `holarch-fondations` archivée, mission `holarch-isolation` ouverte (2026-09-10)** — règle « une mission par dépôt » (`ROADMAP.md` §5) : l'arbre suivi de `mission/` passe sous `docs/archive/mission-holarch-fondations/`, le tag `mission-holarch-fondations-final` fige l'arbre complet, les résidus non suivis (`mission/.holarch/`) sortent du dépôt (`ENVIRONNEMENT.md` §10). La mission suivante porte le chantier 3 (`IMPLEMENTATION.md` §4), sur le framework 1.4.0, avec la supervision par réveil (`--detach`, `Réveil`) désormais disponible ; la reprise de T8-ter reste une vague 2, ouverte par le mainteneur après acceptation du chantier 3 — le mandat de sécurité n'a pas de spécification écrite à ce jour.
23. **« Chantier coût », premier volet : continuation autonome et allowlist (2026-09-10, framework 1.5.0)** — question du mainteneur : « le fonctionnement est-il optimisé ? ». Réponse mesurée sur la journée : correct, observable, auto-réparable — mais pas efficace. Une session enfant sature son contexte en ~40 tours (relectures de sources), le bootstrap coûte 68–79 tours et 3,3–3,8 USD de cérémonie, une racine réveillée 30 tours pour vérifier 17 lignes, 3 à 5 tours par session partent en refus d'outils, et surtout la boucle de continuation exigeait un humain : `relances_max` par lancement laissait un enfant détaché en hibernation volontaire sans que rien ne le relance (aucune condition du parent vraie). Décisions : (i) la ré-incarnation est gouvernée par le **progrès** (fiche d'unité ou commit), bornée par `relances_max` sessions consécutives sans progrès et un plafond `sessions_max_par_instance` ; épuisée, elle escalade par `ALERT` au parent — c'est le parent, pas le mainteneur, qui décide ; (ii) allowlist élargie aux commandes de lecture et d'affichage ; (iii) reporté, à mener sur mesures de transcription (`tools/holarch-transcript`) : bootstrap mécanique (le lanceur crée registre et racine, la première session ne fait que s'orienter), régime par phase (supervision courante en `sonnet`, `opus`/`fable` réservés à l'acceptation et aux arbitrages), et ce qui sature vraiment une session enfant. Conséquence sur la feuille de route : le chantier 3 multiplie le débit de dépense (parallélisme) — optimiser la session d'abord ; le chantier 5 (banc) monte en priorité ; rien d'autre ne bouge.
24. **Chantier 3 « un worktree par instance » promu (2026-09-10, framework 1.6.0, mission `holarch-isolation`)** — Trois décisions actées à l'acceptation : (a) `wakeWaiters` lit l'état d'un enfant en worktree par `instancePath` (le worktree est le déploiement de sa branche et voit le non-committé), non par `git show` — arbitrage du `concepteur` tracé dans `docs/archive/mission-holarch-isolation/registry/DECISIONS.md`, entériné par le mainteneur et reporté dans `docs/IMPLEMENTATION.md` §4.2 ; (b) la limite de `wakeGuard` est acceptée telle quelle : le hook laisse passer une écriture par chemin absolu hors de la racine (voulu pour `--add-dir`), la barrière réelle est le bac à sable du CLI, et la durcir casserait `--add-dir` — le test la verrouille par une assertion dédiée au lieu de la masquer ; (c) `SESSIONS.md` et `REVEILS.md` restent écrits à la racine par le lanceur (journal du lanceur, pas fichiers d'instance) — sous isolation `worktree`, leur commit de clôture revient au parent ou au mainteneur, l'enfant ne les voyant plus dans son arbre. Le dogfooding réel est fait le même jour : décision 25.
25. **Chantier 3 dogfoodé, `git-branches` prêt sous `isolation = worktree` (2026-09-10, framework 1.7.0)** — Mesure : `docs/diagnostics/2026-09-10-dogfooding-worktree-par-instance.md` (deux enfants détachés en parallèle, deux worktrees, deux fusions `--no-ff` sans marqueur de conflit, nettoyage par le lanceur ; 8 sessions, 10,24 USD). Quatre endroits du harnais supposaient encore que les fichiers d'un enfant vivent dans l'arbre du parent — le chantier 3 avait rendu le lanceur worktree-aware (`instancePath`), pas ce qui *énumère* ou *vérifie* des enfants : le hook `spawn-guard` (refusait tout lancement), le module de réveil (`listChildren`/`listWaiters`, parent jamais réveillé), le bloc `<reveil>` du prompt, et la ré-incarnation post-bootstrap (rejouait `BOOTSTRAP.md`). Règle retenue : **toute lecture des fichiers d'une instance passe par « worktree → disque → branche »**, y compris dans les hooks et le module de réveil ; toute énumération d'enfants fait l'union de l'arbre, des worktrees et des branches. `git-branches` 1.1.1 ordonne le nettoyage (worktree, puis `git branch -d`). Non exercé après correctif : le réveil automatique par le lanceur de l'enfant (la mission a été réveillée par `--reveil` manuel, même `evalReveil`).
26. **Mission `holarch-isolation` archivée, mission `holarch-provenance` ouverte (2026-09-10)** — même geste que la décision 22 : l'arbre suivi de `mission/` passe sous `docs/archive/mission-holarch-isolation/` (15 sessions, 33,75 USD observables au tarif liste, rapport `shared/concepteur/RAPPORT.md`), le tag `mission-holarch-isolation-final` fige l'arbre complet, les résidus non suivis (`mission/.holarch/`) sortent du dépôt (`ENVIRONNEMENT.md` §10). La vague 2 (T8-ter) n'a pas été ouverte : le mainteneur a préféré le chantier 4 (`IMPLEMENTATION.md` §5, déjà spécifié) ; T8-ter reste dégelé pour une mission dédiée. `holarch-provenance` est la première mission réelle sous `git-branches`/`isolation = worktree` et `direct-spawn` détaché (1.7.0) : le harnais y est donc lui-même en observation.
27. **Chantier 4 « provenance vérifiée des entrées » promu (2026-09-10, framework 1.8.0, mission `holarch-provenance`)** — Livré par un implémenteur en worktree, revu de première main par la racine (deux renvois : `appliquer.js` non transactionnel et grammaire de découpage, puis rebase de la cible du lanceur sur un `main` qui avait bougé — le mainteneur avait publié 1.7.1 et 1.7.2 pendant le travail de l'enfant, dérive invisible aux ancres et révélée par la mesure `npm test` sur copie fraîche), puis vérifié par le mainteneur sur copie fraîche et promu depuis `docs/archive/mission-holarch-provenance/shared/concepteur/chantier-4-provenance-verifiee/`. Trois décisions : (a) le champ `origine` reste optionnel et le KERNEL §7 inchangé ; (b) l'origine est déduite de l'auteur du commit (`git blame`), jamais déclarée — l'origine `harnais` n'est donc pas vérifiable tant que le lanceur commit sous l'identité de l'instance (point ouvert, rapport final §7) ; (c) règle de conduite du mainteneur : ne pas modifier le harnais pendant qu'un enfant construit une cible du même fichier, ou lui signaler le sha par `TASK` — et un paquet promouvable devrait contrôler le sha de base de ses cibles. La mission a été la première conduite de bout en bout sans intervention sur la mécanique (trois réveils automatiques) ; ses 30 sessions et ~56 USD, dont 24 sessions d'enfant hachées par le seuil de contexte, sont l'échantillon de départ du chantier 5.
28. **Mission `holarch-provenance` archivée, mission `holarch-banc` ouverte (2026-09-10)** — même geste que les décisions 22 et 26 : arbre suivi sous `docs/archive/mission-holarch-provenance/` (30 sessions, 59,09 USD au tarif liste, rapport `shared/concepteur/RAPPORT.md`), tag `mission-holarch-provenance-final`, résidus hors dépôt (`ENVIRONNEMENT.md` §10). La mission suivante porte le chantier 5 (`IMPLEMENTATION.md` §6) : la mesure avant le réglage, principe de la feuille de route depuis la base propre, appliqué maintenant aux seuils du harnais eux-mêmes ; l'objectif exige en plus qu'`appliquer.js` contrôle le sha de base de ses cibles (décision 27 (c)). T8-ter reste dégelé, pour une mission dédiée.
29. **Chantier 5 « banc de mesure à deux étages » promu (2026-09-11, framework 1.8.2, mission `holarch-banc`)** — livré par un seul implémenteur en 18 sessions (19 avec la racine, 37,47 USD au tarif liste, dont 4,72 USD pour l'unique exécution réelle `--reel t3`), accepté par le concepteur après vérification indépendante (sous-agent en lecture seule, `npm test` de première main), appliqué par son `appliquer.js` (14 cibles, ancres et sha de base vérifiés avant toute écriture) sur copie fraîche puis sur `main` : 339 → 359 tests, 0 régression. Le §13 ci-dessus est le texte livré : T2, T5, T7 passent à « rejouable », T5 délibérément non exécuté (une seule exécution réelle autorisée, consommée par T3). Les seuils proposés par `--calibrer` (`docs/archive/mission-holarch-banc/shared/concepteur/RAPPORT.md` §5) sont des données, pas un réglage : la colonne de contexte agrège le cumul d'une session, non l'instantané que borne le hook `context-watch` — à corriger avant tout usage (`ROADMAP.md` §3, chantier 5). Écart de méthode consigné : le mainteneur a recadré l'implémenteur à sa 14ᵉ session (TASK `utilisateur` dans son INBOX, effort `xhigh` → `high` dans sa fiche registre, sans passer par `ON_PLAN`) après trois sessions sur cinq consommées à relire le lanceur sans écrire ; les quatre sessions suivantes ont clos deux unités chacune. Mesures : `docs/diagnostics/2026-09-11-contexte-orientation-implementeur-banc.md`.
30. **Mission `holarch-banc` archivée, aucune mission ouverte (2026-09-11)** — même geste que les décisions 22, 26 et 28 : arbre suivi sous `docs/archive/mission-holarch-banc/` (19 sessions, 37,47 USD au tarif liste, rapport `shared/concepteur/RAPPORT.md`), tag `mission-holarch-banc-final` sur le commit de clôture, résidus hors dépôt (`ENVIRONNEMENT.md` §10). Contrairement aux cycles précédents, la mission suivante n'est pas ouverte dans le même geste : les chantiers 1 à 5 sont promus, et le choix du prochain objectif revient au mainteneur — candidats consignés dans `ROADMAP.md` : corriger la colonne contexte de `bench.js --calibrer` (instantané plutôt que cumul) et en tirer les seuils ; un régime par phase (conception `xhigh`, écriture `high`) et une question sur le nombre de sessions attendu dans `self-assessment` ; T5 en réel ; T8-ter dans une mission dédiée.
31. **Mission `holarch-contexte` ouverte (2026-09-11), chantier 6 « contexte instantané, régime par phase, discipline d'orientation »** — choisi par la session de maintenance sur mandat du mainteneur (« fais le nécessaire pour démarrer la prochaine itération ») parmi les candidats de la décision 30, parce qu'il rend exploitables les deux échantillons réels que le banc ne sait pas lire (cumul ≠ instantané) et qu'il corrige la cause mesurée du coût de `holarch-banc` avant tout réglage de seuil ou réduction du prompt fixe. Spécification `IMPLEMENTATION.md` §8, feuille de route §3 (chantier 6) et §5 ; même CONFIG que `holarch-banc` (worktree par instance, `direct-spawn` détaché, 32 sessions) ; aucune exécution payante prévue. Le programme DEMIURGE (T10, T11) attend désormais les chantiers 1 à 6.
32. **Chantier 6 « contexte instantané, régime par phase, discipline d'orientation » promu (2026-09-11, framework 1.9.0, mission `holarch-contexte`)** — un implémenteur, 14 sessions d'enfant (17 avec la racine, 28,64 USD au tarif liste, aucune exécution payante), livré en une journée sous la discipline posée dans l'OBJECTIVE (`xhigh` pour la seule unité de conception puis `high`, dix sessions attendues, orientation minimale) ; accepté par le concepteur après vérification indépendante, appliqué par `appliquer.js` (14 cibles, sha de base contrôlé) sur copie fraîche puis sur `main` : 359 → 367 tests, 0 régression ; prompt système de 79 256 à 84 531 caractères (textes des trois modules). Mesure obtenue, concordante sur trois missions (`docs/diagnostics/2026-09-11-contexte-instantane-trois-missions.md`) : contexte de départ médian 67-69k tokens, maximum médian 137-142k, p90 ≈ 146k, part du prompt fixe 56-58 % du fusible. Arbitrages sur les propositions du rapport : (1) la ligne `contexte:` va dans l'entrée de `JOURNAL.md`, pas dans la fiche d'unité — choix de l'implémenteur entériné, spec §8.2 corrigée ; (2) `seuil_contexte_tokens` **reste à 120 000** : le maximum mesuré est endogène (seuil + ~25k de clôture d'hibernation), le porter à 150k déplacerait le maximum vers 175k contre un autocompact à 180k ; (3) `sessions_attendues_max` reste à 6 comme seuil de questionnement, l'observé (14 à 24 sessions par implémenteur) est consigné ; (4) le levier réel est le prompt fixe (56-58 % avant le premier geste) : candidat naturel du prochain chantier, sur ces mesures, avec le diagnostic du 2026-09-09 (options B à E) ; en même temps, le lanceur réveille désormais un parent après chaque session d'enfant (§16.1 point 11).
33. **Mission `holarch-contexte` archivée, aucune mission ouverte (2026-09-11)** — même geste que les décisions 22, 26, 28 et 30 : arbre suivi sous `docs/archive/mission-holarch-contexte/` (17 sessions, 28,64 USD au tarif liste, rapport `shared/concepteur/RAPPORT.md`), tag `mission-holarch-contexte-final` sur le commit de clôture, résidus hors dépôt (`ENVIRONNEMENT.md` §10). Le prochain objectif que les mesures désignent est la réduction du prompt fixe (56-58 % du fusible avant le premier geste ; diagnostic du 2026-09-09, options B à E, et `bench.js --calibrer --transcriptions` comme juge avant/après) ; son ouverture attend la décision du mainteneur, la validation d'une option de ce diagnostic étant explicitement réservée (§6 du diagnostic, `CLAUDE.md`).
34. **Chantier 7 validé et mission `holarch-delegation` ouverte (2026-09-11)** — le mainteneur a validé en bloc (« on part sur tout ça ; améliorons tout cela ») les pistes du diagnostic `docs/diagnostics/2026-09-11-pistes-contexte-de-session.md` : délégation intra-session à des sous-agents (mesuré : ~4k tokens de contexte de départ sans le contrat, hooks applicables), contrat réduit aux règles avec rappels de phase par les hooks, `autocompact_tokens` exposé et fusible relevé à 250k / 400k **pour cette mission seulement** (mesure préalable consignée, `ENVIRONNEMENT.md` §7 respecté ; les défauts du framework ne changent qu'après le banc), et `wake-guard` étendu à `framework/`, `docs/`, `tools/` puisque la forme relative de `--disallowedTools` n'a rien bloqué en test à sec. Spécification `IMPLEMENTATION.md` §9 ; la mission dogfoode la délégation dès la première session de son implémenteur (six sessions attendues), et ses transcriptions sont la mesure qui tranchera fusible et délégation.
35. **Chantier 7 promu (2026-09-11, framework 1.10.0 puis 1.11.0 le même jour, mission `holarch-delegation`)** — un implémenteur, 6 sessions (8 avec la racine, 30,94 USD au tarif liste, aucune exécution payante hors sous-agents), accepté par le concepteur après revue de première main (deux sous-agents en lecture seule), appliqué par `appliquer.js` (19 cibles, sha de base contrôlé) sur copie fraîche puis sur `main` : 367 → 387 tests, puis 394 avec la maintenance, 0 régression ; prompt système 84 565 → 51 775 caractères. Mesures de la mission : la délégation n'a été réellement appliquée qu'en dernière session (2 unités d'écriture sur 9, sur un constat erroné « sous-agent impossible sous `mission/` » tenu trois sessions sans BLOCKER), avec un coût par unité close passant de ~2,3 à ~1,36 USD ; sous fusible 250k le hook n'a jamais sonné (maximum 212k), c'est le budget de session qui arbitrait ; la colonne `Contexte` restait vide sous isolation (fichier live lu à la racine). Décisions : (1) défauts du harnais réglés **sur ces mesures** — budget 8 USD, seuil 180 000, autocompact 400 000, module de délégation dans le preset ; (2) les défauts d'instrumentation et de discipline relevés ce jour (double réveil, courrier lu une session trop tard, constat bloquant tacite, lanceur mort au redémarrage, journal non committé, contexte sous worktree) corrigés en 1.11.0 dans la même promotion, avec tests ; (3) la mesure de la délégation reste à refaire sur une mission entière sous le module promu — critère du prochain rapport de mission, pas d'un nouveau chantier.
36. **Mission `holarch-delegation` archivée, aucune mission ouverte (2026-09-11)** — même geste que les décisions 22, 26, 28, 30 et 33 : arbre suivi sous `docs/archive/mission-holarch-delegation/` (8 sessions, 30,94 USD au tarif liste, rapport `shared/concepteur/RAPPORT.md`), tag `mission-holarch-delegation-final` sur le commit de clôture, résidus hors dépôt (`ENVIRONNEMENT.md` §10). Sept chantiers promus (framework 1.11.0). Prochaine mission à décider par le mainteneur ; candidats : une mission entière sous le module de délégation promu et les nouveaux défauts (mesure attendue par la décision 35), puis le programme DEMIURGE (T10, T11) ou T8-ter.
37. **Mission `holarch-outillage` préparée, non lancée (2026-09-11)** — sur la recommandation de la session de maintenance validée par le mainteneur (« on suit ta recommandation ; prépare tout mais ne lance pas ») : chantier 8 « outillage du cycle de maintenance » (`IMPLEMENTATION.md` §10 — `promote.js`, `archive.js`, `open.js`, gabarit d'OBJECTIVE), conduit comme première mission sous le module `delegation-intra-session` promu et sous les défauts 180 000 / 400 000 / 8 USD, avec la table par session exigée à la revue : la mesure de délégation que la décision 35 laisse ouverte. `mission/OBJECTIVE.md` et `CONFIG.md` (nom, paramètres aux défauts, 13 modules) sont écrits et committés ; le lancement (`node framework/bin/holarch-spawn.js --bootstrap`) revient à la session de maintenance suivante, la présente ayant atteint la taille où un compactage menacerait son fil.
38. **Journée du 2026-09-11, après-midi (mission `holarch-outillage`)** — le mainteneur a fixé quatre choses : (a) les limites d'Anthropic ne doivent pas borner la solution, OpenRouter ou une plateforme comparable sera utilisable, et l'enjeu principal est que chaque instance spécialise son modèle selon sa tâche (chantier 9, `ROADMAP.md` §3, `IMPLEMENTATION.md` §11 ; non-objectif v1 §1.3 levé) ; (b) `Movida/holon-v2` reste privé (travaux en cours), le modèle `Movida/holarch` est la seule face publique ; (c) pas de routine cloud déclenchée par GitHub (limites refusées), la CI se vérifie localement après chaque push et publication (`ENVIRONNEMENT.md` §7) ; (d) « règles d'or » du dépôt : commits atomiques, arbre propre à chaque étape, relecture juste avant édition (garde des commits étrangers, `tools/holarch-session/garde.js`), aucun état rapporté sans vérification. Constat de mission acté : le rejeu empirique des outils de maintenance est un geste de la session de maintenance (une instance n'a pas `git clone`), validation humaine explicite en `IMPLEMENTATION.md` §10.5 ; le chantier 8 a été promu par `promote.js` et la mission archivée par `archive.js` (1.12.0).
39. **Seuil de contexte 240 000 et `git clone` pour les instances (2026-09-11, framework 1.13.0)** — sur la mesure de `holarch-outillage` (p90 198 602, `docs/diagnostics/2026-09-11-seuil-contexte-240k.md`), le mainteneur relève `seuil_contexte_tokens` à 240 000 (autocompact 400 000 et budget 8 USD inchangés ; la prochaine mission mesure le coût par unité close à seuil relevé) et autorise les instances à cloner et à agir dans un clone (`git clone`, `git -C <dir> checkout|config`) pour que le rejeu d'outils de maintenance ne dépende plus d'une session interactive — sans jamais changer de branche dans leur propre worktree. Il ouvre lui-même la mission `holarch-fournisseurs` (chantier 9) avec `open.js`, premier usage réel de l'outil.
40. **Chantier 9 promu (2026-09-11, framework 1.16.0, mission `holarch-fournisseurs`)** — quatre volets livrés par deux
    enfants en parallèle (`mode_attente = detache`, réveil par livraison), 15 sessions, 86,31 USD, 38 unités. Le mainteneur a
    suivi les recommandations de la session de maintenance : (a) l'écart de sévérité de la règle 2 du garde (transition
    de `STATUS.md` journalisée, jamais réécrite par le lanceur après la mort d'une instance) est **accepté** — le lanceur ne
    corrige pas un état qu'une instance a déclaré elle-même, `sleep-guard` reste la couche de correction quand
    l'exécuteur a des hooks ; (b) la vérification réelle par l'exécuteur `passerelle` (clé d'un fournisseur compatible API
    Messages, variables `HOLARCH_FOURNISSEUR_<NOM>_*`) est **reportée** au premier geste du chantier suivant, le reste du
    chantier n'en dépendant pas ; (c) des cinq propositions du rapport, P2 (réconciliation manifeste ↔ paquet dans
    `promote.js`) et P3 (le test du contrat réduit imprime sa marge) sont appliquées à la promotion, P1, P4 et P5 vont au
    carnet `docs/IDEES.md`. Mesure retenue pour le seuil de contexte : maximum observé 172 796 tokens sur 15 sessions,
    le seuil de 240 000 n'a jamais déclenché ; le facteur limitant d'une session est le budget de 8 USD.

## 16. Harnais d'exécution (v1.1 — 2026-09-02, synchronisé depuis le framework public le 2026-09-04)

Le harnais est la couche entre le contrat (fichiers markdown normatifs) et le CLI Claude Code. Il n'invente aucune règle : il applique mécaniquement des règles que le KERNEL et les modules énoncent déjà — `profondeur_max`, budget d'instances, mécanique de spawn (§9), phase 9 inconditionnelle, seuil de contexte, cloisonnement des écritures — et rien d'autre. **Limite connue** : cette application est aujourd'hui inconditionnelle ; les garde-fous ne vérifient pas que le module dont ils portent la règle est effectivement actif dans `CONFIG.md`. `instance-budget` est actif par défaut dans les deux presets et dans `CONFIG.md` de cette mission précisément pour cette raison — une configuration qui le désactiverait verrait sa règle continuer de s'appliquer quand même. Trois fichiers, en Node.js sans dépendance (Node est déjà requis par Claude Code), testés par `node --test framework/tests/*.test.js` :

| Fichier | Rôle |
|---|---|
| `framework/bin/holarch-spawn.js` | Lanceur : `node framework/bin/holarch-spawn.js <chemin>` (instance) ou `--bootstrap` (première session). Options : `--profil`, `--modele` (alias `--model`), `--effort`, `--budget-usd`, `--max-tours` (alias `--max-turns`), `--permission-mode`, `--timeout-min`, `--add-dir` (répétable), `--detach`, `--dry-run`, `--json`. Depuis 1.14.0, **aucun argument ni champ propre à Claude Code n'y subsiste** : le binaire, ses options, la forme de son JSON de résultat et la reconnaissance d'une limite 429 vivent sous `bin/executeurs/`. Les deux alias en anglais sont conservés pour les scripts existants — ce sont des noms d'options du lanceur, pas des options transmises telles quelles. |
| `framework/bin/executeurs/` | Un module par manière de faire tourner une session : `claude-code.js` (le CLI local, exécuteur par défaut), `fake.js` (le faux binaire des tests, `HOLARCH_FAKE_CLAUDE`), `passerelle.js` (le même CLI pointé sur l'URL et le jeton d'un fournisseur compatible API Messages), `index.js` (sélection par nom, vérification du contrat). Contrat : `{ nom, capacites, preparer, executer, normaliser, limite }`. |
| `framework/bin/catalogue.js` | Lecture des tables `## Fournisseurs` et `## Catalogue de modèles` de `CONFIG.md` : résolution d'un identifiant en modèle réel et en fournisseur, efforts permis, coût estimé d'une session à partir des tokens, fournisseur de secours et équivalent d'un modèle chez un autre fournisseur. Sans dépendance, tables facultatives. |
| `framework/claude/instance-settings.json` | Réglages Claude Code passés par `--settings` : mémoire automatique coupée, variables d'environnement d'économie (pas de mise à jour ni de trafic non essentiel, cache de prompt 1 h, sous-agents sur `sonnet`, sortie Bash bornée, timeouts Bash longs pour la supervision), allowlist Bash des instances (1.13.0 : `git clone`, `git -C <dir> checkout|config` pour rejouer des outils dans un clone ; jamais `checkout`/`switch` sans `-C`), `permissions.deny` (`framework/**`, `mission/OBJECTIVE.md`, en motifs relatifs — second niveau, redondant avec `--disallowedTools`), hooks. |
| `framework/hooks/holarch-hooks.js` | Garde-fous `sleep-guard` (Stop), `spawn-guard` (PreToolUse Bash), `wake-guard` et `framework-guard` (PreToolUse Write/Edit), `context-watch` (PostToolUse). Inertes hors lanceur, fail-open en cas d'erreur interne. |

### 16.1 Ce que fait le lanceur à chaque session

1. **Résolution** : profil de l'instance (fiche registre ; `conception` pour la racine, `execution` par défaut pour un enfant sans profil) → modèle et effort. Précédence : option de ligne de commande > lignes `Modèle` et `Effort` de la fiche registre (`Modèle` depuis 1.16.0 : un identifiant du catalogue, posé par le parent au spawn pour spécialiser un enfant hors de la politique de son profil ; `Effort` jugé pour la tâche, ou changé par l'instance elle-même) > table `## Politique de modèle` de `CONFIG.md` > `modele_cli`/`effort_cli` explicites de `CONFIG.md` > défauts de `direct-spawn`. Un identifiant absent du catalogue est transmis tel quel à l'exécuteur — le catalogue nomme ce qu'il connaît, il n'est pas une liste blanche.
2. **Prompt système** (`--append-system-prompt-file`) : KERNEL + CONFIG + modules actifs, identiques pour toutes les instances d'une mission → un seul préfixe à mettre en cache pour toute la mission ; `--exclude-dynamic-system-prompt-sections` sort les sections variables (répertoire, état Git) du prompt système. L'instance n'a plus rien à relire au réveil (KERNEL §2, §5.8).
3. **Prompt utilisateur** : ROLE, MEMORY, STATUS (intégraux), 8 derniers messages d'INBOX (au-delà, une note de rappel signale les plus anciens masqués — jamais supprimés du fichier, à relire à la demande), 40 dernières lignes du JOURNAL et lignes `PROGRESS.md` de l'instance, puis description du harnais (plafonds, commandes autorisées, garde-fous) — la session sait à quoi s'attendre au lieu de le découvrir par des refus. Troncature par message complet (bloc `---\nid: …` à `---\nid: …` suivant, KERNEL §7), jamais par ligne brute : un message ne peut pas être coupé en deux. **Module `unites-indexees` actif** (chantier 1, framework 1.2.0) : ROLE, MEMORY borné, STATUS, la raison du réveil (`<reveil>` : messages reçus et commits depuis la dernière hibernation, `describeWakeReason`), les seuls messages d'INBOX non traités (`selectInboxMessages`) et `memoire/INDEX.md` régénéré par le lanceur (une ligne par fiche d'unité, au plus 60) — ni JOURNAL ni PROGRESS : la mémoire est adressée par l'index, pas rechargée.
4. **Options CLI** : `--model`, `--effort`, `--permission-mode` (CONFIG), `--output-format json`, `--max-turns`, `--max-budget-usd`, `--autocompact`, `--tools` (8 outils : Read, Write, Edit, Bash, Glob, Grep, Agent, TodoWrite), `--disable-slash-commands`, `--strict-mcp-config` (aucun serveur MCP), `--disallowedTools` (`Edit` et `Write` sous `framework/` et sur `mission/OBJECTIVE.md`, en motifs **relatifs** à la racine du dépôt — un chemin absolu y est inerte, dupliqués en défense en profondeur dans `permissions.deny` d'`instance-settings.json`), `--settings`, `-n holon:<chemin>`, `--fallback-model` si `modele_repli` est défini, `--add-dir <dir>` répété pour chaque option `--add-dir` du lanceur (accès en plus de la racine HOLARCH à un dépôt externe). stdin fermé.
5. **Après la session** : lecture du résultat JSON (coût au tarif liste, tokens, tours, identifiant de session, refus d'outils) ; ligne ajoutée à `mission/registry/SESSIONS.md` (append-only, aucune instance n'y écrit) ; résultat brut et stderr dans `mission/.holarch/` (ignoré par Git) ; ligne de synthèse `HOLARCH ▸ <chemin> ▸ STATUS=… · tours · coût · durée` pour le parent. Code de sortie : 0 état terminal atteint, 2 `STATUS` resté `WORKING` (session plantée ou `ON_SLEEP` non exécuté), 3 hibernations volontaires épuisées, 1 erreur du lanceur.
6. **Hibernation volontaire** : si `STATUS.md` reste `WORKING` avec la note « hibernation volontaire (contexte) », le lanceur ré-incarne l'instance (jusqu'à `relances_max`) avec un contexte neuf. Le lancement (et donc les prompts, lus sur disque) est reconstruit à **chaque** tentative de la boucle de ré-incarnation — pas une seule fois avant la boucle — pour que MEMORY/STATUS/INBOX/JOURNAL, changés par la session qui vient de se terminer, soient bien relus avant la ré-incarnation suivante. C'est ce qui rend possible le **changement de régime** (`direct-spawn`, `ON_PLAN`) : une instance qui modifie la ligne `Profil` ou `Effort` de sa fiche puis hiberne volontairement est ré-incarnée sur le nouveau modèle/effort ; le lanceur détecte le changement en relisant la fiche, le signale sur stderr et dans la ligne de synthèse (`opus/high → fable/xhigh`), et le décompte à part (`changements_regime_max`, 1 par défaut) des ré-incarnations de contexte. **Depuis 1.5.0**, la ré-incarnation de contexte est gouvernée par le progrès : le lanceur compare avant/après chaque session les fiches d'unité (`memoire/U<n>-*.md`) et les commits `[<chemin>]` ; `relances_max` (2) borne les sessions consécutives sans progrès, `sessions_max_par_instance` (24) le total toutes invocations confondues ; épuisé, il dépose un `ALERT` de provenance `harnais` dans l'INBOX du parent (dont la condition `message:ALERT` le réveille) et sort en code 3 — le parent décide, plus d'humain dans la boucle.
7. **Identité Git de mission** (2026-09-09) : `GIT_AUTHOR_*` et `GIT_COMMITTER_*` posés à `HOLARCH <holarch@localhost>` dans l'environnement de la session s'ils ne sont pas déjà exportés — les commits `[<chemin>] …` ne sont jamais attribués au mainteneur, et la configuration Git du dépôt n'est pas touchée (BOOTSTRAP §0, point 3).
8. **Réveil par condition, lanceur détachable, arrêt propre** (chantier 2, framework 1.3.0, `IMPLEMENTATION.md` §3) : un parent qui attend n'est plus une session vivante bloquée sur un Bash — il hiberne en `WAITING_CHILDREN` avec une condition dans la ligne `Réveil` de `STATUS.md` (grammaire fermée, `bin/reveil.js`). `--detach` lance un enfant en tâche de fond (identifiant, `mission/.holarch/tasks/<id>.json`, verrou de pid `isLive`) ; à la fin de chaque session, le lanceur de l'enfant évalue les conditions des instances en attente (`listWaiters`, `evalReveil`) et relance en tâche détachée celles qui sont satisfaites (`wakeWaiters`, trace append-only dans `mission/registry/REVEILS.md`) : l'événement est le commit, aucun démon n'est nécessaire dans le cas séquentiel ; `tools/holarch-watch/` couvre en boucle les termes `date:` et `fichier:`. `--reveil` (évaluation ponctuelle) et `--arret <chemin>` (demande d'arrêt propre, fichier `mission/.holarch/stop/<instance>` lu par `context-watch`) sont réservés au harnais et à l'utilisateur ; `--taches` liste les tâches détachées. Une ligne `Réveil` invalide vaut « aucune condition » et est signalée dans la ligne de synthèse. Seam de test : `HOLARCH_FAKE_CLAUDE` (`tests/fake-claude.js`) remplace le binaire `claude` — T-C4.2 se rejoue sans LLM, `SESSIONS.md` faisant foi (une session du parent postérieure à celle de l'enfant, aucune ligne entre les deux).
9. **Un worktree par instance** (chantier 3, framework 1.6.0, `IMPLEMENTATION.md` §4) : si `git-branches` est actif avec `isolation=worktree` (défaut) et que l'instance n'est pas la racine, `resolveWorkspace` crée `mission/.holarch/worktrees/<chemin-tirets>` sur la branche `holarch/<chemin-tirets>` à la première incarnation (erreur explicite si la branche manque) et `claude` tourne avec ce `cwd` et `HOLARCH_ROOT` = `cwd` ; tous les accès du lanceur aux fichiers d'instance (STATUS, INBOX, mémoire, compteur de progrès, `ALERT` au parent) passent par `instancePath` ; `SESSIONS.md` et `REVEILS.md` restent à la racine ; `--nettoyer-worktree <chemin>` retire le worktree après fusion (refus si non-committé) ; `.gitattributes` met les fichiers append-only de `mission/` en `merge=union`. Depuis 1.7.0 (décision 25), la même règle « worktree → disque → branche » vaut pour le hook `spawn-guard`, le module de réveil (`listChildren` = arbre + worktrees + branches, `listWaiters` lit chaque worktree pour sa seule instance, `readStatusOf` retombe sur la branche) et le bloc `<reveil>` ; une ré-incarnation après `--bootstrap` repart comme instance racine ordinaire. Depuis 1.7.1, l'`INBOX.md` d'une instance est lue en union avec les copies que ses descendants en tiennent dans leurs worktrees (`readInboxOf`, messages non fusionnés marqués comme tels) — sans quoi les termes `message:` d'une condition de réveil ne voient jamais ce qu'un enfant écrit à son parent avant la fusion — et `--dry-run` n'écrit plus `memoire/INDEX.md`.
10. **Mesure instantanée du contexte** (chantier 6, framework 1.9.0, `IMPLEMENTATION.md` §8) : à chaque
    session, `context-watch` (§16.2) persiste `{session_id, depart, max, dernier, tours}` dans
    `mission/.holarch/live/<chemin-tirets>.contexte.json` — `depart` est le contexte du tout premier
    appel d'outil de la session, `max` le plus grand observé, `dernier` le plus récent. À la fin de la
    session, `appendSessionLine` lit ce fichier : si son `session_id` correspond bien à celui de la
    session qui vient de finir, il ajoute la douzième colonne `Contexte (départ / max)` à la ligne de
    `SESSIONS.md` puis supprime le fichier (`— / —` si absent ou périmé — une session suivante l'aurait
    déjà réécrit). `lastContexteDepart` relit ensuite la dernière ligne à 12 colonnes de l'instance dans
    `SESSIONS.md` : si elle existe, le paragraphe « Harnais de cette session » du prompt utilisateur
    (§16.1 point 3) se termine par une phrase rappelant le contexte de départ observé à la session
    précédente — pour que l'instance voie, avant d'agir, le poids réel de son propre réveil.
11. **Réveil du parent évalué après chaque session** (framework 1.9.0, geste de maintenance à la promotion du chantier 6) : jusqu'en 1.8.2, `wakeWaiters` n'était appelé qu'à la sortie de la boucle de ré-incarnation d'un enfant (`finishLaunch`) — un enfant qui posait une `CLARIFICATION` puis continuait d'hiberner et de se ré-incarner ne réveillait jamais son parent avant sa livraison (constaté sur `holarch-contexte`, le mainteneur a répondu à la place du parent). Le lanceur évalue désormais les guetteurs après chaque session ; l'appel est idempotent (parent vivant ou déjà réveillé ignoré ; « récent » = postérieur au dernier commit de `STATUS.md` du parent, donc pas de re-réveil sur le même message) et `finishLaunch` réévalue une dernière fois sur l'état final.
12. **Délégation intra-session, contrat réduit, fusible mesuré** (chantier 7, framework 1.10.0, `IMPLEMENTATION.md` §9) : quand le module `extensions/delegation-intra-session` est actif, le lanceur passe `--agents` avec la définition du sous-agent `holarch-unite` (prompt court depuis `framework/templates/SOUS-AGENT.template.md`, outils sans `Agent`, modèle `sous_agent_modele`) ; le prompt système ne porte plus, par module, que l'en-tête, la table `## Paramètres` et les `## Règles injectées` (84 565 → 51 775 caractères mesurés) ; `SessionStart` injecte le rappel d'orientation ; `autocompact_tokens` est un paramètre de `CONFIG.md`. **Maintenance 1.11.0, même jour** : verrou de vivacité posé dès le réveil (course `wakeWaiters`/`finishLaunch`, deux sessions concurrentes constatées) ; `--reprendre` après un lanceur mort ; horloge UTC, sessions jouées et coût cumulé dans le prompt de réveil ; journal du lanceur committé par le lanceur pour une racine ; fichier de contexte lu dans le worktree de l'instance ; `context-watch` signale le courrier arrivé en cours de session et un fait de contexte par palier de 50k ; `sleep-guard` refuse un constat « impossible » sans message. Défauts réglés sur mesure : budget 8 USD, seuil 180 000, autocompact 400 000.

13. **Indépendance du fournisseur de modèles** (chantier 9, framework 1.16.0,
    `IMPLEMENTATION.md` §11) : le lanceur ne sait plus lancer une session, il sait lancer un
    **exécuteur**. Trois conséquences visibles.

    - **Interface.** `bin/executeurs/index.js` résout un nom en module et vérifie son contrat
      (`verifierContrat`) : `capacites` (`sous_agents`, `hooks`, `prompt_systeme_fichier`,
      `transcription`, quatre booléens obligatoires) puis `preparer` (→ `{bin, args, env, cwd, stdin}`),
      `executer` (→ `{stdout, stderr, exitCode, signal, error, elapsedMs}`), `normaliser` (→ le
      `Resultat` commun : `session_id`, `tours`, `cout_usd` **ou `null`**, `tokens`, `modeles`, `fin`,
      `statut_http`) et `limite` (→ `{texte, repriseIso, attenteMs}` ou `null`). Le nom de l'exécuteur
      est choisi par `nomPour` : `fake` si `HOLARCH_FAKE_CLAUDE` est posé, sinon l'exécuteur du
      fournisseur du modèle résolu, sinon le paramètre `executeur` de `CONFIG.md`, sinon `claude-code`.
      Un nom inconnu **jette** : jamais de repli silencieux sur l'exécuteur par défaut, une session
      lancée sur le mauvais fournisseur étant indétectable après coup. `capacites` conditionne le
      reste du harnais plutôt que de le supposer : sans `sous_agents`, `--agents` n'est pas passé et
      `delegation-intra-session` dégrade proprement ; sans `hooks` ni `transcription`, `context-watch`
      n'a rien à lire et la mesure de contexte est absente, pas fausse.
    - **Catalogue et coût.** `bin/catalogue.js` lit deux tables **facultatives** de `CONFIG.md` —
      `## Fournisseurs` (nom, exécuteur, variables d'URL et de jeton, fournisseur de secours) et
      `## Catalogue de modèles` (identifiant, fournisseur, modèle réel, efforts permis, coût,
      aptitudes, équivalent chez un autre fournisseur). La colonne de coût accepte **deux ou quatre**
      valeurs en USD par million de tokens (`entrée / sortie`, ou `entrée / sortie / cache écrit /
      cache lu`) : la forme courte dérive le cache du tarif d'entrée (×0,1 en lecture, ×1,25 en
      écriture), la forme longue prime toujours sur cette dérivation — `claude-fable-5-1` facture la
      lecture de cache à 2,5 % de son entrée, soit quatre fois moins que la dérivation, sur le poste
      qui domine la facture d'une session longue. Quand l'exécuteur ne rapporte pas de coût
      (`cout_usd = null`, cas d'une passerelle), le lanceur le calcule depuis les tokens et le tarif,
      et marque la valeur d'un `≈` dans `SESSIONS.md`. **Un modèle sans tarif au catalogue est
      journalisé sans coût — cellule vide, jamais `0,00`** : une somme incomplète doit se voir comme
      telle dans un bilan de mission, et non passer pour une somme exacte. Treizième colonne de
      `SESSIONS.md`, en fin de ligne : `Fournisseur / modèle réel`.
    - **Repli sur limite (429).** Quand l'exécuteur reconnaît une limite de sessions de l'API et que
      le fournisseur quitté déclare un `Secours` chez qui le modèle courant a un `Équivalent`, le
      lanceur relance **immédiatement**, sans attente, sur le fournisseur de secours ; il l'écrit sur
      stderr et marque la ligne de session `repli depuis <fournisseur>` dans sa colonne `Fin`. Un seul
      repli par invocation : si le secours refuse à son tour, on retombe sur l'attente. Sans `Secours`
      ni `Équivalent` — donc pour toute mission qui n'a qu'un fournisseur, dont celle-ci —, le
      comportement est **exactement** l'attente d'avant (`repriseIso`, à défaut `HOLARCH_ATTENTE_429_MS`).

### 16.2 Garde-fous

| Hook | Événement | Effet |
|---|---|---|
| `sleep-guard` | `Stop` | Refuse la fin de session (au plus trois fois) tant que `STATUS.md` est `WORKING` sans note d'hibernation volontaire, ou que `mission/<instance>`, `mission/registry` ou `mission/shared/<instance>` contiennent des changements non committés — la phase 9 (§5.1) devient inconditionnelle de fait. Avec `unites-indexees` actif, refuse aussi tant que `MEMORY.md` dépasse `memoire_max_lignes` (60) ou qu'une de ses lignes dépasse `ligne_max_chars` (200). Refuse aussi un `WAITING_CHILDREN` ou `BLOCKED` sans ligne `Réveil` valide (chantier 2). Ignore les fichiers en vol d'une **autre instance vivante** (son sous-arbre, sa zone `shared/`, sa fiche registre — verrou de pid `mission/.holarch/live/`) : un parent ne committe pas ce que son enfant détaché est en train d'écrire (dogfooding du 2026-09-10, 1.4.0). |
| `spawn-guard` | `PreToolUse` (Bash) | Se déclenche sur un segment de commande qui **invoque** réellement le lanceur (`node … holarch-spawn.js`, en tête de segment), pas sur toute commande qui mentionne la sous-chaîne. `--dry-run` n'est soumis qu'au contrôle de forme (chemin présent, pas de `--bootstrap`), pas aux règles d'autorisation. Sinon, refuse si la cible n'est pas un enfant direct, si `ROLE.md`/`STATUS.md`/`MEMORY.md` ou la fiche registre manquent (§7.2), si la profondeur dépasse `profondeur_max`, si le budget alloué du parent est nul, ou si le nombre d'enfants réellement incarnés (sous-répertoires de `mission/<instance>/` avec leur propre `STATUS.md`, recompté sur le disque — pas la colonne « consommé » de la fiche, auto-déclarée) atteint ou dépasse l'alloué. Le bootstrap ne peut pas être relancé depuis une instance. `--detach` est soumis aux mêmes règles ; `--reveil` et `--arret` sont toujours refusés à une instance (chantier 2). |
| `wake-guard` | `PreToolUse` (Write, Edit) | Symétrique de `sleep-guard` côté réveil : refuse tout `Write`/`Edit` hors de l'arbre propre de l'instance (`mission/<chemin>/**`, sa ligne `registry/PROGRESS.md`, sa fiche registre) tant que son `STATUS.md` n'est pas passé à un état actif (`WORKING`, `WAITING_CHILDREN`, `BLOCKED`) et qu'elle n'a pas ajouté sa propre ligne `ON_ORIENT` à `registry/PROGRESS.md` **depuis le début de la session courante** — détecté par le contenu ajouté à `PROGRESS.md` depuis une baseline calculée par le **lanceur avant de démarrer la session** (`HOLARCH_PROGRESS_BASELINE`, pas au premier appel du hook côté session : une baseline posée trop tard refuserait systématiquement la toute première écriture d'une instance pourtant déjà conforme). Une fois la porte ouverte, elle reste ouverte pour le reste de la session (pas de re-vérification à chaque écriture). |
| `framework-guard` | `PreToolUse` (Write, Edit) | Refuse tout `Write`/`Edit` sous `framework/`, `docs/`, `tools/` ou sur `mission/OBJECTIVE.md` — hors de l'arbre propre de l'instance (`mission/<instance>/**`, `mission/shared/<instance>/**`) —, quel que soit l'état de `STATUS.md`. Différent de `wake-guard` par la portée : `wake-guard` porte sur l'arbre autorisé selon la phase de l'instance (gouverné par `ON_ORIENT`/l'état actif) et s'ouvre une fois la porte franchie ; `framework-guard` porte sur une liste fixe de répertoires qui ne sont jamais la production d'une mission (le produit et la documentation du harnais lui-même) et refuse inconditionnellement, indépendamment de `STATUS.md`/`PROGRESS.md`. Doublé, en défense en profondeur, par `permissions.deny` d'`instance-settings.json` (`framework/**`, `docs/**`, `tools/**`, `mission/OBJECTIVE.md`) — ceinture et bretelles, `--disallowedTools` du lanceur restant le troisième niveau pour `framework/**` et `mission/OBJECTIVE.md` (chantier 7 U2, `IMPLEMENTATION.md` §9.4). |
| `context-watch` | `PostToolUse` (tous outils) | Lit l'usage du dernier message assistant dans la transcription (entrée + cache lu + cache écrit = contexte réel) ; au-delà de `seuil_contexte_tokens`, injecte l'ordre d'hiberner volontairement (une fois par palier de 20 000 tokens ; ton renforcé au-delà de 125 % du seuil). Remplace, quand le lanceur est utilisé, l'heuristique auto-rapportée de `context-budget`. **Depuis 1.9.0**, persiste aussi la mesure instantanée (`{session_id, depart, max, dernier, tours}`) dans `mission/.holarch/live/<chemin-tirets>.contexte.json`, lue et consommée par `appendSessionLine` en fin de session (colonne 12 de `SESSIONS.md`, §16.1 point 10). Lit aussi la demande d'arrêt propre (`mission/.holarch/stop/<instance>`, posée par `--arret`) et injecte une seule fois par session l'ordre d'hiberner avec la note « hibernation volontaire (arrêt demandé) », que le lanceur ne ré-incarne jamais (chantier 2). |

### Gardes a posteriori : vérifier une session par le dépôt

Les hooks de `framework/hooks/holarch-hooks.js` sont **préventifs** : ils refusent une écriture ou un
spawn avant qu'il n'ait lieu. Ils dépendent du mécanisme de permissions de Claude Code et ne sont donc
pas disponibles chez tous les fournisseurs (`capacites.hooks` peut être faux). La garantie portable
est un **garde a posteriori**, fondé sur le seul dépôt Git, exécuté par le lanceur après chaque
session, quel que soit l'exécuteur :

```js
const { verifierSession } = require('./gardes/git.js');
const { ecarts } = verifierSession(root, chemin, avant, apres);
// ecarts : Array<{ regle: 1|2|3, chemin: string, detail: string }>
```

- `root` : racine du dépôt ; `chemin` : chemin d'instance depuis `mission/` ;
- `avant` / `apres` : shas bornant la session. Ils doivent borner **les seuls commits de l'instance**
  — sous `git-branches`, la HEAD de sa branche avant et après l'incarnation. Deux points d'une
  branche partagée imputeraient à l'instance des commits étrangers (faux positifs de règle 1 mesurés
  dans `EQUIVALENCE-GARDES.md` §4).

**Trois règles**, transposition directe du KERNEL :

1. **Écritures hors de l'arbre autorisé** (KERNEL §4). Diff `avant..apres` : sont autorisés
   `mission/<chemin>/`, `mission/shared/<chemin>/`, la fiche registre de l'instance et celles de ses
   descendants (créées au spawn), les flux partagés de `mission/registry/`, et l'`INBOX.md` du
   parent. Sont refusés `framework/`, `docs/`, `tools/`, `mission/OBJECTIVE.md`, la fiche registre
   d'une autre instance, et tout chemin hors de `mission/`. `mission/.holarch/` est ignoré (jamais
   committé).
2. **Transition de `STATUS.md`** (KERNEL §3 et règles de `sleep-guard`) : état final valide et
   **accessible** depuis l'état de départ dans la machine à états — le garde ne voit que les deux
   extrémités d'une session, pas les états traversés ; `WORKING` toléré seulement avec une note
   « hibernation volontaire » ; `WAITING_CHILDREN` et `BLOCKED` exigent une ligne `Réveil` valide ; un
   constat de blocage dans la dernière entrée de `JOURNAL.md` sans `BLOCKER`, `CLARIFICATION` ou
   `PROPOSAL` émis le même jour est un écart (KERNEL §6.3 : jamais de refus silencieux).
3. **Enfants créés hors budget** (`instance-budget`) : enfants comptés dans l'arbre de l'instance à
   `apres` **et** sur les branches d'enfants (sous `worktree`, le commit de spawn est posé sur la
   branche de l'enfant), comparés au budget alloué de la fiche registre.

**Propriétés garanties.** Le module est **pur** — il n'écrit aucun fichier, ne lance aucune session,
n'émet aucune `ALERT` : la conduite à tenir sur un écart est câblée par le lanceur (un écart de règle
1 ou 3 produit une `ALERT` dans l'`INBOX.md` du parent et met la session en `fin = erreur` ; un écart
de règle 2 est journalisé et corrigé comme le fait `sleep-guard`). Il est **fail-open** (§0.2),
règle par règle : dépôt absent, shas inconnus, `git` indisponible ou erreur interne ⇒ `{ ecarts: [] }`,
jamais d'exception. Il est **sans dépendance** npm et n'appelle Git qu'en lecture.

**Ce qu'il ne fait pas.** Il ne remplace pas les hooks : il constate là où ils empêchent. Une
tentative refusée par un hook ne laisse aucune trace committée — elle est donc, par construction,
invisible au garde. Chez un fournisseur sans hooks, une violation n'est pas bloquée mais signalée
après coup. Il ne voit pas non plus les états intermédiaires d'une session, les écritures compensées
avant le commit final, ni le travail non committé. La mesure complète de ce recouvrement, chiffrée
sur les sessions réelles de la mission `holarch-outillage`, est dans `EQUIVALENCE-GARDES.md`.

### 16.3 Mesures qui ont motivé ces choix (ce dépôt, Claude Code 2.1.257, 2026-09-02)

| Mesure | Résultat |
|---|---|
| Modèle réellement utilisé par un `claude -p` sans `--model` | `claude-fable-5-1`, effort `max` (hérités des réglages utilisateur) — `modele_cli` de `CONFIG.md` jamais transmis |
| Contexte fixe d'un appel, options par défaut | ≈ 31 000 tokens (45 outils, 18 skills, 16 serveurs MCP listés) |
| Contexte fixe, options du lanceur | ≈ 18 400 tokens (−41 %) |
| Commande Bash non autorisée en `-p` (stdin fermé) | refus immédiat, consigné dans `permission_denials` — pas de blocage |
| Règles `permissions.allow` d'un fichier `--settings`, dossier jamais approuvé, mode `-p` | appliquées |
| Hook `Stop` bloquant en mode `-p` | honoré : la session corrige puis termine |
| `additionalContext` d'un hook `PostToolUse` | vu par le modèle |
| Mémoire automatique de Claude Code | un seul répertoire `~/.claude/projects/<dépôt>/memory/` pour toutes les instances d'un dépôt, hors Git — coupée pour les instances (O3, O4, §4.3) |

### 16.4 Limites assumées
- Les hooks sont fail-open : une erreur interne laisse passer l'action ; ils renforcent le KERNEL, ils ne le remplacent pas.
- `changements_regime_max` ne borne que la ré-incarnation automatique au sein d'une même invocation du lanceur : une relance par le parent (ou à la main) relit la fiche telle qu'elle est. La règle « un changement de régime par instance » est contractuelle (`direct-spawn`, `ON_PLAN` et `ON_CHILD_DONE`), tracée par session dans `SESSIONS.md` (colonne modèle/effort), pas mécanique.
- `wake-guard` ne couvre que les outils `Write`/`Edit` de Claude Code, comme le refus d'écriture sous `framework/` (même limite, ci-dessous) : un script lancé par `Bash` qui écrit un fichier hors de l'arbre propre de l'instance n'est pas intercepté. Il ne couvre pas non plus le cas où la session est interrompue **avant même** son premier appel d'outil (fenêtre nulle par construction). Une session tuée avant tout résultat JSON exploitable ne laisse aujourd'hui aucune ligne d'ouverture dans `SESSIONS.md` — complément non implémenté.
- `spawn-guard` applique le fusible de budget d'instances (alloué nul, ou enfants recomptés ≥ alloué) **inconditionnellement**, qu'`instance-budget` soit ou non dans les modules actifs de `CONFIG.md` — contrairement à `max-depth` pour `profondeur_max`. Une mission qui composerait volontairement sa propre `CONFIG.md` sans ce module resterait donc, elle, soumise au fusible sans le savoir.
- Le refus d'écriture sous `framework/` couvre les outils de fichiers de Claude Code et les commandes de fichiers qu'il reconnaît, pas un script arbitraire lancé par Bash.
- La mesure instantanée (point 10 ci-dessus) est bornée par ce que `context-watch` observe réellement
  pendant la session : une session tuée avant tout appel d'outil, ou avant que `Stop` ne se déclenche,
  laisse le fichier `.contexte.json` orphelin (jamais lu ni supprimé) — `appendSessionLine` ne le
  consomme que si son `session_id` correspond exactement à celui de la session qui vient de se
  terminer normalement. Un fichier orphelin ne fausse rien (il est simplement ignoré à la session
  suivante, dont le `session_id` diffère), mais reste sur disque sous `mission/.holarch/live/` — non
  nettoyé automatiquement, hors périmètre du chantier 6.
- Le coût inscrit dans `SESSIONS.md` est l'estimation locale de Claude Code au tarif liste (celle de `/cost`), pas une facture ; sous abonnement, il mesure l'usage.
- Un parent bloqué sur le Bash d'un enfant long voit son propre cache de prompt expirer (TTL 1 h) : sa reprise après l'enfant recalcule une fois son contexte. `direct-spawn` reste séquentiel par conception ; le parallélisme réel passe par `tools/external-orchestrator/`, qui devrait appeler le lanceur plutôt qu'un `claude -p` nu (non fait ici).
- Une seule mission bout-en-bout a été rejouée avec le lanceur (voir §15, décision 7) ; les seuils (`budget_usd_par_session`, `max_tours_par_session`, `seuil_contexte_tokens`) sont des valeurs de départ à ajuster d'après `SESSIONS.md`.
- `--add-dir` donne accès en lecture/écriture aux outils de fichiers et à `Bash cd`/`ls` dans le répertoire ajouté, mais l'allowlist Bash de `instance-settings.json` (`git status *`, `git diff *`, …) ne couvre que des invocations `git` sans dépôt explicite : `git -C <dépôt-externe> status` reste soumis à approbation interactive (refusée en session non interactive). Contournement : l'instance doit `cd` dans le répertoire ajouté avant d'invoquer `git` sans `-C`.
- Délégation intra-session (`--agents`, module `extensions/delegation-intra-session` du chantier 7, `IMPLEMENTATION.md` §9.1) : quand ce module est actif, le lanceur construit la définition du sous-agent `holarch-unite` (description, prompt ≤ 2 000 caractères construit depuis `framework/templates/SOUS-AGENT.template.md`, outils Read/Write/Edit/Bash/Glob/Grep **sans** `Agent` — pas de cascade possible —, `model` = paramètre `sous_agent_modele` du module (défaut `sonnet`), effort = `sous_agent_effort` (défaut `medium`)) et le passe en option `--agents` de la session ; `--tools` de la session elle-même garde `Agent`. `context-watch` ignore la transcription d'un sous-agent, reconnue à son chemin `<sid>/subagents/*.jsonl` (distinct de `<sid>.jsonl`, la transcription de l'instance) : la mesure instantanée du contexte (point 10 de §16.1) et le fusible de `seuil_contexte_tokens` ne portent que sur l'instance, jamais sur ses sous-agents. `tools/holarch-bench/bench.js --transcriptions` lit aussi ce dossier `<sid>/subagents/` et publie séparément le contexte de l'instance (départ/max) et les tokens/coût des sous-agents par session. Limite assumée : la délégation ne couvre que les unités marquées `déléguée` dans la fiche de plan (écriture de fichiers, lecture large, exécution de tests) — jamais `ON_ORIENT` ni `ON_SLEEP`, jamais de sous-agent qui en lance un autre ; l'instance reste seule responsable de la vérification (`git diff --stat`, tests ciblés), de la correction et du commit au retour du sous-agent.

- L'exécuteur `passerelle` fait tourner le **même CLI Claude Code** contre l'URL et le jeton d'un
  autre fournisseur : il hérite donc de ses capacités (hooks, sous-agents, transcription) mais reste
  soumis à ce que ce fournisseur implémente réellement de l'API Messages. Un exécuteur `api-messages`
  qui parlerait directement le protocole HTTP est rendu possible par l'interface (c'est ce que
  `capacites.hooks = false` a pour rôle de faire dégrader proprement) ; il n'est pas écrit — décision
  D3 du chantier 9 : ne généraliser qu'au moment où une seconde implémentation réelle existe.
- **Ce que la passerelle préserve, mesuré et non plus supposé** (chantier 11, 2026-09-12 : première
  session d'instance réelle chez un fournisseur tiers — `openrouter`, modèle réel
  `anthropic/claude-sonnet-5`, 152 tours, lue sur sa transcription et sa ligne `SESSIONS.md`) : les
  hooks du fichier `--settings` sont chargés et actifs de bout en bout (18 `SessionStart`,
  827 `PreToolUse`, 493 `PostToolUse`) ; les refus de permission et de sandbox s'appliquent (11 refus
  comptés par le lanceur, `framework-guard` et `git-guard` visibles à l'œuvre) — le cloisonnement du
  KERNEL §4 tient donc aussi derrière la passerelle ; `context-watch` mesure et injecte (7 injections
  « HOLARCH · contexte ») ; `sleep-guard` garde la fin de session. Deux réserves à ne pas gommer : les
  plafonds de tours et de dépense n'ont pas été atteints (152 sur 200, 4,53 sur 8 USD), donc ne sont
  **pas** éprouvés en réel ; et la capacité déclarée `sous_agents` ne l'est pas davantage — l'instance
  avait l'outil `Agent` et le module de délégation, elle n'a lancé aucun sous-agent.
- **Ce que la passerelle ne préserve pas : le garde-fou de contexte** (même session, écart principal du
  chantier 11). Une compaction automatique du CLI est survenue à 166 985 tokens (`trigger: auto`,
  contexte ramené à 12 176) alors que `--autocompact 400000` était bien passé et que
  `seuil_contexte_tokens` valait 240 000. Conséquence : sur ce modèle par ce fournisseur,
  `context-watch` **ne peut jamais** déclencher l'hibernation volontaire — 154 809 tokens de contexte
  ont été résumés hors contrat, sans passage par `MEMORY.md`. Que la cause soit la fenêtre du modèle
  chez le fournisseur (≈ 200 k) ou l'option non honorée dans ce mode, le fait tient et n'est pas
  corrigé par ce chantier : tant que `seuil_contexte_tokens` n'est pas plafonné par la fenêtre du
  modèle réel déclaré au catalogue, une instance par passerelle perd son contexte en silence.
- Coût observé par la passerelle (même session) : **0,0298 USD par tour**, contre une médiane de
  0,0337 (p90 0,0540) pour les 118 sessions `sonnet` chez `anthropic` des missions archivées. Le tour
  n'y est donc pas plus cher ; c'est le nombre de tours qui fait la facture (152 ici contre un p90
  archivé de 72 — cette instance n'ayant délégué à aucun sous-agent). Comme partout dans
  `SESSIONS.md`, ce chiffre est un coût **rapporté** par l'exécuteur au tarif liste : chez un
  revendeur, rien ne garantit qu'il égale le montant facturé — aucune facture n'a été lue.
- Le coût calculé par le catalogue (`≈`) est une estimation à partir des tokens rapportés et du tarif
  liste de la table : il vaut ce que valent ces deux entrées. Un tarif périmé dans `CONFIG.md` produit
  un chiffre faux sans que rien ne le signale — le catalogue est une donnée tenue à la main, pas une
  source de vérité interrogée en ligne. `config-lint` vérifie la forme d'un tarif (et avertit d'une
  cellule vide), jamais sa valeur.
- La cohérence entre le modèle demandé et le catalogue est signalée sur stderr, jamais opposée en
  refus : un identifiant inconnu, un effort hors de la plage déclarée ou un fournisseur sans variable
  d'environnement renseignée laissent la session partir. Le harnais préfère ici une session qui tourne
  avec un avertissement à un lancement refusé sur une table mal tenue — choix inverse de celui fait
  pour un nom d'exécuteur inconnu, où l'erreur est silencieuse une fois la session partie.
**2026-09-04 — synchronisation du harnais depuis le framework public (`origin/main`, dépôt `Movida/holon`).** Cette section (§16 entière, plus la table T1-T7 en cas de recoupement futur et le format `CONFIG.md` §9.1) reflète désormais le lanceur/hooks du framework public plutôt qu'une version antérieure propre à cette mission : `resolveOverrides`/« Overrides hiérarchiques » (§9.1), jamais dogfoodable par la holarchie elle-même (§15, décision git-branches) et déjà signalé comme risqué par sa propre proposition, a été retiré plutôt que corrigé ; `presetWorking`/la ligne « démarrée » de `SESSIONS.md` ont été retirés avec lui (limite reformulée ci-dessus, pas résolue) ; `wake-guard` a été ajouté (garde-fou contre l'état périmé injecté à la ré-incarnation — la friction que `concepteur/holon-d2` avait elle-même diagnostiquée en itération 4, `docs/archive/mission-holon-v2/concepteur/JOURNAL.md`) ; le bug de `launchWithRelaunches` qui réutilisait un lancement figé d'une ré-incarnation à l'autre a été corrigé ; `--disallowedTools` (motifs relatifs, `Write` et `Edit`) et `permissions.deny` défendent maintenant en profondeur le refus d'écriture sous `framework/`, qui ne tenait plus que par la discipline de l'instance ; `--add-dir` a été ajouté à la surface CLI. Détail complet et arbitrage : `mission/registry/DECISIONS.md`, entrée du même jour.

### 16.5 Politique de modèle proposée (chantier 12, mesurée — **non appliquée**)

Ce qui suit est une **proposition** issue de la mission `holarch-modeles`, pas la politique en vigueur :
`framework/CONFIG.md` n'est pas modifié par ce chantier, et son application reste un geste du
mainteneur. Les chiffres viennent de `docs/bench/REGISTRE.md` (section « Mesure des modèles par unité
de travail ») : un lot unique de trois unités cadrées (U-A écriture d'outil testé, U-B extraction de
faits à schéma imposé, U-C correction d'un test rouge), confié à trois instances `execution` ne
différant que par leur modèle, toutes via la passerelle `openrouter`, effort `medium`.

| Modèle | Lot | Coût du lot | Conduite |
|---|---|---|---|
| `anthropic/claude-sonnet-5` | 3/3 | 2,1421 USD (tarif liste, coût réel non recalculé) | 65 tours, 2 sessions, aucun sous-agent |
| `deepseek/deepseek-v4.1-flash` | 3/3 | **0,1771 USD réels** | 79 tours, 2 sessions, sous-agents aux deux sessions |
| `openai/gpt-5-mini` | 0/3 | 1,2575 USD réels, sans livrable | 474 tours, 8 sessions, 94 refus de garde-fou |

**Proposition.**

1. Profil `execution` : `deepseek-flash@openrouter` en effort `medium` par défaut, sous deux conditions
   cumulatives — (a) l'unité est cadrée comme celles du lot de référence : critère de fin vérifiable,
   chemins explicites, preuve attendue nommée ; (b) le parent note sur pièces, sans jamais reprendre le
   compte rendu de l'enfant. À qualité égale sur les trois unités, l'écart de coût observé est d'un
   ordre de grandeur (facteur ≈ 12 entre le coût réel du moins cher et le tarif liste de `sonnet`).
2. Garder `sonnet@openrouter` en `execution` pour les unités dont l'énoncé reste ouvert, ou quand la
   conduite compte plus que le prix : c'est le seul des trois à avoir bouclé le lot sans déléguer, en
   un tiers de tours.
3. Ne pas retenir `gpt-5-mini` pour incarner une instance HOLARCH, à aucun profil. Son échec n'est pas
   un manque de capacité sur l'énoncé mais un défaut de conduite en boucle longue : contournements
   successifs après un refus d'allowlist plutôt qu'une correction, hibernation « contexte » invoquée à
   50 k tokens comme échappatoire, défauts jamais repris d'une session à l'autre.
4. Ne rien changer aux profils `conception`, `relecture` et `exploration` : **aucune mesure n'a été
   faite** sur eux. La mission n'a comparé que le profil `execution` à profondeur 2.

**Deux préalables avant toute application** (détail en `docs/IMPLEMENTATION.md` §13.6) : le coût des
modèles Anthropic passés par `openrouter` n'est pas recalculé au catalogue, et le plafond
`budget_usd_par_session` s'applique au tarif liste — il coupe donc d'autant plus tôt que le modèle est
bon marché (8,14 USD imputés pour ≈ 0,05 USD réels sur une session). Fonder une politique de coût sur
une mesure que le harnais biaise dans ce sens serait bâtir sur du sable.

**Portée de la mesure.** Un lot, trois unités, une session-type, un seul profil : c'est une mesure
utile, pas une loi. Elle vaut pour des unités cadrées et vérifiées, pas pour du travail ouvert, et elle
demande à être refaite quand les modèles ou leurs tarifs changent — `tools/holarch-modeles/` fournit
les deux outils pour la refaire (`lecture-openrouter.js` pour le catalogue, `jointure.js` pour croiser
fiches d'unité et `registry/SESSIONS.md`).

---

Ces décisions actées : **rédiger les fichiers dans l'ordre de dépendance** — KERNEL → templates → MANIFEST → les 11 modules → presets → BOOTSTRAP — puis dérouler T1, puis T3 comme première mission réelle. Chaque fichier est écrit en conformité stricte avec les sections ci-dessus, qui font foi.