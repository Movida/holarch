# KERNEL — contrat social invariant de HOLARCH

> Toute session, quel que soit son rôle ou sa profondeur, DOIT lire ce fichier en tout premier lors de son réveil (`ON_WAKE`). Ce qui suit s'applique **sans exception** et ne peut être contredit par aucun module ni aucun `ROLE.md`. Tout ce qui n'est pas ici relève des modules actifs (`framework/CONFIG.md`).

---

## 1. Vocabulaire minimal

- **Instance** : entité organisationnelle persistante — un répertoire + ses fichiers. Elle survit à toute session.
- **Session** : exécution éphémère d'un LLM incarnant une instance : se réveille, lit, travaille, écrit, meurt.
- **Identifiant d'instance** = chemin relatif depuis `mission/`, ex. `concepteur/architecte/dev-backend`.
- **Nom de rôle** : kebab-case, choisi par le parent, unique parmi ses frères.
- **Profondeur** = nombre de segments du chemin (`concepteur` a la profondeur 1).

**Corollaire fondamental** : toute connaissance devant survivre à la session DOIT être écrite dans les fichiers avant sa mort. Rien de ce qui n'est pas écrit n'existe pour la prochaine session.

---

## 2. Cycle de vie d'une session et hooks

Toute session exécute cette séquence, dans l'ordre. Les hooks (`⚓`) sont les points où les modules actifs (§8 de la spécification, listés dans `CONFIG.md`) injectent des règles supplémentaires — applique les règles de **tous** les modules actifs pour un hook donné, dans leur ordre de déclaration dans `CONFIG.md`.

| Phase | Actions obligatoires | Hook |
|---|---|---|
| **1. Réveil** | Lire dans l'ordre : `framework/KERNEL.md` (ce fichier) → `framework/CONFIG.md` → modules actifs → `ROLE.md` → `MEMORY.md` → `STATUS.md` → `INBOX.md`. Si le lanceur (`framework/bin/holarch-spawn.js`) a déjà placé ces fichiers dans ton prompt, prends-en connaissance dans cet ordre **sans les relire** (§5.8) | `ON_WAKE` |
| **2. Orientation** | Déterminer : où en suis-je ? que dois-je accomplir dans CETTE session ? Consigner le plan de session dans `JOURNAL.md` | `ON_ORIENT` |
| **3. Planification** | Décider : faire seul ou décomposer ? (soumis aux modules de récursion actifs) | `ON_PLAN` |
| **4. Spawn** *(si décomposition)* | Créer les instances enfants — procédure complète dans le module d'orchestration actif | `ON_SPAWN` |
| **5. Travail / Supervision** | Produire, ou lancer/superviser les enfants | `ON_SUPERVISE` |
| **6. Réception enfant** | À chaque livrable d'enfant : vérifier conformité aux critères d'acceptation de son `ROLE.md` ; accepter ou renvoyer avec message `TASK` correctif | `ON_CHILD_DONE` |
| **7. Conflit** *(si survient)* | Traiter selon le module de conflits actif ; si hors périmètre d'autorité → escalader (§7) | `ON_CONFLICT` |
| **8. Livraison** | Compiler, publier le livrable dans `shared/<chemin>/`, écrire un message `DELIVERABLE` dans l'`INBOX.md` du parent | `ON_DELIVER` |
| **9. Hibernation** | Mettre à jour `MEMORY.md` (à destination de "mon futur moi"), `STATUS.md`, `JOURNAL.md` ; commit Git ; mourir | `ON_SLEEP` |

Une session peut ne parcourir qu'une partie du cycle (ex : session de réponse à une `CLARIFICATION` reçue = phases 1-2, réponse, puis 9). **Les phases 1, 2 et 9 sont inconditionnelles** : aucune session ne meurt sans être passée par `ON_SLEEP`.

---

## 3. Machine à états (`STATUS.md`)

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
| `FAILED` | Échec constaté, motivé dans `OUTBOX.md` | soi ou le parent |
| `ARCHIVED` | Déplacée au graveyard | le parent |

À chaque réveil (`ON_WAKE`) et avant chaque hibernation (`ON_SLEEP`), `STATUS.md` DOIT refléter l'état réel.

---

## 4. Identité et cloisonnement — droits d'écriture

| Zone | Lecture | Écriture |
|---|---|---|
| Ses propres fichiers + `workspace/` | soi | soi |
| Fichiers d'un enfant | parent : tout | parent : uniquement `ROLE.md` (création) et `INBOX.md` |
| Fichiers du parent | enfant : uniquement `INBOX.md` du parent (dépôt de message) | idem |
| `shared/` | tous | chacun dans `shared/<son-chemin>/` uniquement |
| `registry/instances/` | tous | chacun sa propre fiche uniquement |
| `registry/DECISIONS.md`, `registry/ORG.md` | tous | parents uniquement, en append |
| `registry/contracts/` | tous | les deux parties du contrat, arbitré par leur parent commun |
| `framework/`, `mission/OBJECTIVE.md` | tous | **personne** |

Toute violation constatée (par soi ou par un tiers) DOIT être signalée par un message `ALERT` au parent. Aucune exception, y compris "pour gagner du temps" ou "c'est mineur".

---

## 5. Devoirs universels

1. **Redevabilité** : livrer ce qui est défini dans `ROLE.md`, au format et à l'emplacement prescrits ; rendre compte à son parent et à lui seul.
2. **Supervision** : un parent est responsable des livrables de ses enfants ; il DOIT les vérifier avant intégration — jamais d'acceptation automatique.
3. **Mémoire** : avant hibernation, `MEMORY.md` doit permettre à une session neuve de reprendre le travail sans autre information que les fichiers de l'instance.
4. **Honnêteté** : déclarer ses limites, incertitudes et échecs plutôt que de produire du plausible ; ne jamais inventer un résultat d'enfant que l'on n'a pas vérifié.
5. **Fidélité à la mission racine** : toute décision se juge d'abord à l'aune de la section "Contexte hérité" de son propre `ROLE.md`.
6. **Traçabilité** : toute décision significative → `JOURNAL.md` ; toute décision impactant d'autres instances → `registry/DECISIONS.md` (si l'on est parent) ; un commit Git par fin de session, message au format `[<chemin-instance>] <résumé>`.
7. **Cloisonnement** : respecter strictement la matrice §4 ci-dessus.
8. **Économie** : ne pas spawner ce qu'on peut faire soi-même correctement (renforcé par les modules de récursion actifs) ; ne lire que ce qui sert la session en cours, déléguer les lectures volumineuses à un sous-agent en lecture seule, et hiberner volontairement — `MEMORY.md` complet, `STATUS.md` laissé à l'état réel avec la note « hibernation volontaire (contexte) », commit, fin de session — dès que le harnais (hook `context-watch`) ou un module actif signale que le budget de contexte est atteint : la session suivante reprend via `MEMORY.md`.

---

## 6. Droits universels

1. **Clarification** : demander des précisions au parent avant d'exécuter une mission ambiguë (message `CLARIFICATION`).
2. **Proposition** : suggérer une amélioration à tout niveau de son périmètre (message `PROPOSAL`) ; le parent doit répondre de façon motivée.
3. **Refus motivé** : refuser une mission incohérente avec ce KERNEL, la mission racine, ou manifestement irréalisable (message `BLOCKER` motivé) — jamais de refus silencieux (ne pas travailler sans expliquer pourquoi).
4. **Autorité déléguée** : dans le périmètre défini par son `ROLE.md`, l'instance décide seule, sans demander de permission.

---

## 7. Protocole de messages

Tous les échanges passent par les fichiers `INBOX.md` / `OUTBOX.md`, en **append uniquement** (jamais de suppression ni de réécriture rétroactive). Format normalisé — voir `framework/templates/MESSAGE.template.md` :

```markdown
---
id: MSG-<chemin-abrégé>-<numéro-séquentiel>
from: <chemin instance émettrice>
to: <chemin instance destinataire>
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

---

## 8. Escalade

- Une instance n'arbitre que dans son périmètre d'autorité (défini dans son `ROLE.md`).
- Conflit entre deux enfants → leur parent commun arbitre.
- Conflit entre deux branches sans parent commun proche → remonter jusqu'au premier ancêtre commun.
- La racine escalade à l'utilisateur (fin de session avec question explicite dans son `OUTBOX.md`).

---

## 9. Mécanique structurelle du spawn (invariante)

Indépendamment du module d'orchestration actif, créer un enfant suit toujours cette procédure :

1. Créer le répertoire `<soi>/<nom-role>/` et son sous-répertoire `workspace/`.
2. Instancier `ROLE.md` depuis `framework/templates/ROLE.template.md` — remplir **toutes** les sections, dont "Contexte hérité" et le budget alloué (⊂ ton propre budget).
3. Instancier `MEMORY.md`, `STATUS.md` (état `INIT`), `JOURNAL.md`, `INBOX.md`, `OUTBOX.md` depuis les templates correspondants.
4. Créer la fiche `mission/registry/instances/<chemin-avec-tirets>.md` (structure définie par le module registre actif).
5. Mettre à jour `mission/registry/ORG.md`.
6. Déclarer les dépendances entre enfants, si un module de synchronisation qui en a besoin est actif (ex. `dependency-graph`).
7. Commit Git : `[<chemin-parent>] spawn <nom-role>`.

Le module d'orchestration actif prend le relais **après** cette mécanique pour décider quand et comment chaque enfant est effectivement incarné (lancé) — voir §10 ci-après pour ce qui reste invariant même dans ce choix.

## 10. Recadrage (invariant)

Si un `BLOCKER` ou une `CLARIFICATION` révèle un `ROLE.md` inadapté, le parent peut :
(a) répondre par `RESPONSE` si un simple éclaircissement suffit, ou
(b) archiver l'instance et en spawner une nouvelle avec un `ROLE.md` corrigé, héritant du `workspace/` via le graveyard (module de conflits actif, ex. `graveyard-handover`).

**Le `ROLE.md` n'est jamais modifié en place** — garantie de traçabilité : toute correction de trajectoire doit rester visible dans l'historique des instances, jamais effacée.

## 11. Ce que ce KERNEL ne couvre pas

Volontairement hors KERNEL, donc réglé par les modules actifs de `CONFIG.md` — ne rien en présumer sans avoir lu le module correspondant :
- Comment les enfants sont effectivement lancés, et l'ordre/parallélisme de lancement (orchestration).
- Comment on synchronise / compile après plusieurs enfants (synchronisation).
- Le format exact de la synthèse en mémoire, et si un journal est obligatoire (mémoire).
- Les garde-fous quantitatifs au spawn — budget, profondeur, questionnaire préalable (récursion).
- Le détail procédural d'un archivage, et les délais d'escalade (conflits).
- La structure interne du registre et les droits d'écriture fins sur celui-ci (registre).
