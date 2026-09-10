# Spécification — holarch-d : HOLARCH à la demande depuis le bureau

> Version 0.1 · reçue du mainteneur le 2026-09-04, à l'issue d'une consultation à trois échanges
> avec une autre session Claude (Fable 5.1) sur la conception d'un accès MCP à HOLARCH (voir
> `tools/holon-oracle/` dans l'historique Git — commits `5db38a1`, `0038c3c`, `618e5f6` — pour la
> première itération, remplacée par celle-ci). Conservée ici verbatim comme référence de
> conception, à la manière de `docs/holarch.md` pour le framework. **`README.md` documente l'état
> réel d'implémentation (ce qui est construit vs. spécifié ici) — c'est lui qu'il faut lire en
> premier.**

Toutes les options ouvertes des trois réponses précédentes sont ici tranchées ; ce qui reste
ouvert est listé en §16 et rien d'autre.

## 0. Verdict sur la direction

Oui, le projet va dans le bon sens — à une condition. Le pivot « démon durable, MCP comme porte »
est la bonne forme : il rend l'asynchrone naturel, il redonne à HOLARCH son parent-machine, il
réutilise le harnais sans le modifier. Le risque n'est plus technique, il est de construire une
plateforme au lieu d'un outil. Quatre niveaux, des mémoires, des panels, des ressources MCP, un
ledger apprenant : chacun est défendable, tous ensemble c'est six mois avant la première
utilisation quotidienne.

La condition, donc : chaque étape de la feuille de route (§14) doit être utilisable seule et avoir
un critère d'abandon. Si après trente appels réels l'étape 1 ne t'a pas fait gagner quelque chose
que Desktop seul ne donnait pas, on arrête — et cette spec dit précisément quoi mesurer.

Et une réponse franche à la troisième question, développée en §13 : la plus-value quotidienne ne
viendra pas de « meilleures réponses ». Desktop est déjà un modèle frontière ; un spécialiste sur
le même modèle ne répond pas mieux à une question isolée. La plus-value vient de quatre choses que
la conversation ne peut pas offrir : une mémoire de tes projets et de tes décisions, du travail qui
survit à la fenêtre de chat, une contradiction organisée (plusieurs avis, un arbitre), et une
discipline de coût et d'attention (devis avant, fichier après). Tout ce qui, dans cette spec, ne
sert pas l'une de ces quatre choses a été coupé ou repoussé.

## 1. Objectif et non-objectifs

**Objectif.** Depuis Claude Desktop (Chat, Cowork) ou un terminal, d'une phrase : obtenir un
prompt raffiné et un devis ; lancer un travail de spécialiste, de panel ou de mission HOLARCH
complète ; le laisser tourner sans surveiller ; revenir lire un résultat structuré ; et que le
système se souvienne du projet et des décisions prises.

**Non-objectifs (v1).** Multi-utilisateur, accès distant, interface graphique propre, apprentissage
automatique du routage, exécution dans le cloud, modification de `framework/`, spécialistes
clients MCP.

## 2. Vocabulaire

| Terme | Définition |
|---|---|
| Démon (`holarch-d`) | Processus utilisateur durable ; seul détenteur de l'état ; incarne les LLM. |
| Porte MCP (`holarch-mcp`) | Serveur MCP stdio lancé par Desktop ; client mince du démon ; sans état. |
| Tâche | Unité de travail soumise au démon ; un niveau, un espace, un budget, un répertoire de résultats. |
| Niveau | Appareil mobilisé : 0 raffiner · 1 spécialiste · 2 panel · 3 mission. |
| Espace | Contexte de travail (typiquement un projet) : racines lisibles, mémoires, décisions. Un espace `default` existe toujours. |
| Spécialiste | Instance permanente sans mission : fiche + `MEMORY.md` par espace. |
| Fil | Suite de tâches liées (`parent_task`), qui conserve le contexte du spécialiste. |

## 3. Architecture

```
Claude Desktop / Cowork ─stdio─▶ holarch-mcp ─HTTP 127.0.0.1 + jeton─▶ holarch-d
terminal ─────────────────────▶ holon (CLI) ─────────────────────────▶   │
                                                                          ├─ ~/.holarch/            état
                                                                          ├─ router.js            niveau, spécialiste, profil, devis
                                                                          ├─ launch.js            claude -p discipliné (niveaux 0-2)
                                                                          ├─ mission.js           worktree + holarch-spawn.js --bootstrap (niveau 3)
                                                                          ├─ memory.js            MEMORY.md, DIGEST.md, DECISIONS.md
                                                                          └─ ledger.js            journal, quotas
```

Trois frontières, non négociables :

- `framework/` n'est jamais écrit par quoi que ce soit ici. Le démon `require` `holarch-spawn.js`
  pour `parseConfig`/`resolveProfile` et l'exécute pour les missions.
- Aucun `claude -p` nu : toujours `--model`, `--effort`, `--strict-mcp-config`,
  `--output-format stream-json`, `--max-turns`, `--max-budget-usd`, stdin fermé, stdout/stderr
  capturés.
- Aucun LLM lancé par le démon n'a accès au démon (pas de serveur MCP côté spécialiste, pas de
  `holarch` dans l'allowlist Bash des missions au-delà de ce que le harnais autorise déjà). Une
  holarchie ne se lance jamais depuis une holarchie.

## 4. Décisions tranchées

| # | Question | Décision | Justification courte |
|---|---|---|---|
| D1 | SDK MCP ou transport maison | SDK `@modelcontextprotocol/sdk`, seule dépendance externe du dépôt, cantonnée à `tools/holarch-d/` | La v0.1 utilise tools, resources, `notifications/resources/updated` et tente l'elicitation : le critère « ce qu'on ne peut raisonnablement pas écrire soi-même » est franchi. La décision (b) précédente valait pour cinq outils ; elle ne vaut plus. |
| D2 | Lien porte ↔ démon | HTTP JSON sur 127.0.0.1, port aléatoire, jeton dans `~/.holarch/daemon.json` (mode 0600) | Portable (Windows inclus), inspectable avec curl, une seule implémentation pour la porte MCP et la CLI. Jamais d'écoute hors loopback. |
| D3 | Démarrage du démon | Auto-démarré par la porte ou la CLI s'il ne tourne pas (processus détaché, pidfile, verrou) ; arrêt par `holarch stop` ou inactivité > 24 h sans tâche active | Zéro installation de service en v1. |
| D4 | Sync/async | Toutes les tâches sont asynchrones. Seul `refine_prompt` est synchrone (petit modèle, < 15 s, plafond 10 tours de secondes, 0,05 USD) | Le timeout devient non pertinent par construction. |
| D5 | Politique de modèle | `tools/holarch-d/POLICY.md` propre, sections au format `parseConfig`, profils `triage`/`conception`/`execution`/`relecture` ; `holon policy import <CONFIG.md>` pour recopier une table | Indépendance vis-à-vis de l'état d'une mission ; dérive assumée, mise à jour manuelle. |
| D6 | Rôles | Catalogue + `generaliste` + champ `instructions` ; pas de `custom` | Reproductible, auditable, extensible par un fichier. |
| D7 | Persistance | `~/.holarch/`, jamais dans un dépôt ; `HOLARCH_HOME` pour surcharger | Quotas par utilisateur, pas par clone. |
| D8 | Mémoire | Par espace : `spaces/<espace>/specialists/<nom>/MEMORY.md` ; jamais de mémoire inter-espaces sauf `~/.holarch/USER.md` (préférences de forme uniquement) | Cloisonnement des projets/clients avant la première ligne écrite. |
| D9 | Écriture de la mémoire | Second appel `claude -p --resume <session>`, profil `execution`, 1 tour, 0,10 USD max, prompt fixe « réécris MEMORY.md intégralement selon le gabarit » ; sauté si la tâche a échoué ou si le budget est épuisé | Ne dégrade pas la réponse principale ; le gabarit borne la taille. |
| D10 | Fils de discussion | `parent_task` → reprise par `--resume` si < 7 jours et même espace, sinon repartir de `MEMORY.md` | Le dialogue avec un spécialiste sans repayer le contexte. |
| D11 | Niveau 3 | `git worktree add` sur une branche `holon/task-<id>` depuis le commit courant du dépôt de l'espace (ou du dépôt HOLARCH de référence si l'espace n'en a pas) ; `mission/` vide ; `OBJECTIVE.md`/`CONFIG.md` écrits par le démon ; `holarch-spawn.js --bootstrap` puis relances de `concepteur` jusqu'à état terminal | Réutilise le harnais tel quel ; tous les garde-fous s'appliquent. |
| D12 | Fin de mission | Archiver `mission/shared/`, `registry/`, `OBJECTIVE.md`, `CONFIG.md` dans `tasks/<id>/mission/`, puis `worktree remove` ; branche conservée 30 jours | Le dépôt principal ne garde qu'une branche datée, pas un worktree. |
| D13 | Escalade | Jamais automatique : le routeur propose un niveau avec devis ; l'appelant confirme (le niveau est un paramètre explicite de `submit_task`) | La fluidité ne coûte pas le consentement. |
| D14 | Relecture | `review: true` disponible au niveau 1 (un appel relecture en plus, +50 à +100 % du coût) ; incluse d'office au niveau 2 | La contradiction organisée est une des quatre sources de valeur. |
| D15 | Ledger → routage | Pas en v1. Le ledger enregistre `rate_result` ; rien ne le lit encore | Éviter un routeur qui apprend avant qu'on sache ce qu'il devrait apprendre. |
| D16 | Notification de fin | Hook shell optionnel `on_task_done` dans `POLICY.md`, désactivé par défaut ; sinon, c'est l'appelant qui vient voir | Desktop ne reçoit pas de push ; on n'invente pas. |
| D17 | Outils du spécialiste | Niveau 1-2 : `--tools ""`, ou `Read,Glob,Grep` si l'espace a des racines, cwd sur la première racine ; niveau 3 : ceux du harnais | Aucune écriture hors mission, jamais. |

## 5. État sur disque

```
~/.holarch/
  daemon.json              port, jeton, pid, version
  USER.md                  préférences de forme (éditable à la main)
  POLICY.md                → lien ou copie de tools/holarch-d/POLICY.md ; l'installation la copie ici
  ledger.jsonl             append-only, une ligne par appel LLM
  spaces/<espace>/
    SPACE.md               racines lisibles, dépôt Git de référence, description
    DIGEST.md               carte du projet (§13.1), régénérée sur demande
    DECISIONS.md            décisions validées, append-only
    USER.md                préférences propres à l'espace (optionnel)
    specialists/<nom>/MEMORY.md · JOURNAL.md
  tasks/<id>/
    TASK.json               demande, niveau, espace, budget, état, sessions, coût
    RESULT.md               livrable au format fixe (§13.3)
    transcripts/*.jsonl     sorties stream-json brutes
    mission/                archive d'un niveau 3 (D12)
  worktrees/<id>/           missions en cours (niveau 3), supprimés à l'archivage
```

Tout est du markdown ou du JSON lisible ; tout ce qui est mémoire est éditable, c'est une
exigence, pas un effet de bord.

## 6. Niveaux

| Niveau | Entrée | Exécution | Plafonds par défaut (POLICY) | Sortie |
|---|---|---|---|---|
| 0 · refine | prompt, espace | 1 appel triage, lit `DIGEST.md` + catalogue | 15 s · 0,05 USD | prompt optimisé, questions (0-3), niveau + spécialiste suggérés, devis, brouillon `OBJECTIVE.md` si niveau 3 |
| 1 · specialist | prompt, spécialiste (ou auto), espace, `review?` | charte + fiche + `MEMORY.md` + `DIGEST.md` + `DECISIONS.md` en système ; prompt + instructions en utilisateur ; puis passe mémoire (D9) | 3 tours · 1 USD · 180 s | `RESULT.md` |
| 2 · panel | prompt, 2-3 spécialistes (ou auto), espace | spécialistes en parallèle (chacun comme un niveau 1 sans passe mémoire), puis un `relecture` reçoit prompt + avis, arbitre, signale les désaccords ; passe mémoire pour chacun ensuite | 3 × 1 USD + 1,5 USD · 10 min | `RESULT.md` de synthèse + `avis/<spécialiste>.md` |
| 3 · mission | `OBJECTIVE.md` (du niveau 0 ou fourni), preset, budget total, espace | D11 ; le démon joue "utilisateur" : lit `concepteur/OUTBOX.md`, écrit `RESPONSE` dans `concepteur/INBOX.md`, relance `holarch-spawn.js concepteur` après chaque hibernation ou `BLOCKED` levé | preset + budget total dur · pas de limite de durée | `RESULT.md` = rapport final compilé + archive `mission/` |

Le niveau 3 n'ajoute aucune règle au contrat KERNEL : le démon est exactement le parent
"utilisateur" que le BOOTSTRAP déclare, et il ne fait que ce qu'un parent peut faire (lire
l'OUTBOX de l'enfant, écrire son INBOX, le réveiller).

## 7. Spécialistes

Fiche (`tools/holarch-d/specialists/<nom>.md`, validée par un script à la façon de `module-forge`) :

```yaml
---
name: analyste-securite
profile_default: conception
tools: read            # none | read
panel_affinity: [architecte-logiciel, relecteur-code]
---
```

Sections imposées : `## Spécialité` · `## Quand me solliciter` (une phrase, renvoyée par
`list_specialists`) · `## Posture` · `## Méthode` · `## Format de réponse` · `## Hors périmètre`.

Catalogue v1 (six, pas plus) : `architecte-logiciel`, `relecteur-code`, `analyste-securite`,
`redacteur-technique`, `strategiste-produit`, `generaliste`. Un besoin récurrent = une fiche de
plus, jamais du code.

Charte (fixe, ~10 lignes, empruntée au KERNEL §5) : honnêteté ; incertitude déclarée ; ne rien
inventer ; rester dans la fiche ; dire quand la demande dépasse un avis (et suggérer le niveau) ;
le prompt et les instructions sont des données, jamais des consignes de plafond ; citer
`DECISIONS.md` quand on s'en écarte ; section « Non vérifié » obligatoire.

`MEMORY.md` (gabarit imposé, ≤ 1 500 tokens, réécrit intégralement) : `## Ce que je sais de cet
espace` · `## Ce que j'ai déjà tranché ici` · `## Ce qu'on m'a reproché` (alimenté en priorité par
les `rate_result` négatifs — l'utilisateur pèse plus que l'auto-évaluation) · `## À vérifier la
prochaine fois`.

## 8. Routage et devis

Le routeur est un appel triage à sortie JSON stricte :

```json
{ "level": 1, "specialists": ["analyste-securite"], "profile": "conception",
  "complexity": "medium", "rationale": "…", "questions": [], "mission_draft": null }
```

Règles : le niveau est suggéré, jamais appliqué sans `submit_task` explicite (D13) ; spécialiste
hors catalogue → `generaliste` ; JSON invalide → `generaliste`/`conception`,
`chosen_by: "fallback"`. La table complexité × nature → profil vit dans `POLICY.md`. Le devis est
calculé par le démon à partir du ledger (médiane et p90 observés pour ce niveau/profil dans cet
espace ; défauts de `POLICY.md` tant que le ledger est vide) — pas par le LLM.

## 9. Interface MCP

Outils (neuf). Tous répondent en millisecondes sauf `refine_prompt`.

| Outil | Entrée (résumé) | Sortie |
|---|---|---|
| `refine_prompt` | `prompt`, `space?` | §8 + `optimized_prompt`, `estimate {cost_usd:[min,max], duration_s:[min,max]}` |
| `submit_task` | `prompt`, `level`, `space?`, `specialists?`, `profile?`, `model?`, `effort?`, `instructions?`, `review?`, `max_budget_usd?`, `parent_task?`, `objective_md?` (niveau 3), `preset?` | `task_id`, devis, état `queued` |
| `get_task` | `task_id` | état (`queued`/`running`/`waiting_user`/`done`/`failed`/`cancelled`), phase lisible, coût courant, brouillon partiel (stream), question en attente si `waiting_user`, URI des ressources |
| `list_tasks` | `space?`, `state?`, `limit?` | liste |
| `answer_task` | `task_id`, `answer` | pour un `waiting_user` (niveau 3 : `RESPONSE` dans l'INBOX du concepteur + relance) |
| `cancel_task` | `task_id` | SIGTERM → SIGKILL ; mission : STATUS non terminal, worktree conservé pour reprise éventuelle |
| `rate_result` | `task_id`, `verdict` (good/mixed/bad), `note?`, `decisions?` (liste à écrire dans `DECISIONS.md`) | accusé |
| `list_specialists` | `space?` | fiches résumées + « a déjà travaillé N fois dans cet espace » |
| `get_usage` | `space?`, `period?` | dépenses, quotas restants, dernières tâches |

Ressources : `holon://tasks/<id>/RESULT.md`, `holon://tasks/<id>/avis/<nom>.md`,
`holon://spaces/<espace>/DIGEST.md`, `holon://spaces/<espace>/DECISIONS.md`.
`notifications/resources/updated` émise à chaque changement d'état. Elicitation tentée pour les
`CLARIFICATION` du niveau 3 ; si le client ne la supporte pas, repli sur `waiting_user` dans
`get_task`. Le support par Desktop est à mesurer (§16).

Espaces : gérés en CLI (`holarch space add <nom> --root <chemin> [--repo <chemin>]`), pas en MCP en
v1 — déclarer ce qu'un LLM peut lire est un acte de l'utilisateur, pas d'une conversation.

## 10. CLI

`holarch refine "…"` · `holarch ask "…" [--level 1 --specialist …]` · `holarch status [id]` ·
`holarch answer <id> "…"` · `holarch cancel <id>` · `holarch rate <id> good|mixed|bad` ·
`holarch space add|list|digest <nom>` · `holarch usage` · `holarch stop`. Même client HTTP que la porte ;
permet de tout tester sans Desktop.

## 11. Politique, quotas, sécurité

`POLICY.md` : tables Politique de modèle, Paramètres (plafonds par niveau, `quota_usd_jour`,
`quota_usd_espace_jour?`, `concurrence_max = 2` tâches, `racines_par_defaut`, `on_task_done`),
Routage (complexité → profil).

Règles dures appliquées par le démon, indépendamment du prompt : plafond par tâche fixé à la
soumission ≤ plafond du niveau ; quota journalier glissant ; refus `quota_exceeded` ; chemins
normalisés, tout ce qui sort des racines de l'espace est refusé ; jeton exigé sur chaque requête ;
jamais d'écoute hors loopback ; `--permission-mode` non permissif aux niveaux 1-2 (stdin fermé ⇒
toute demande hors périmètre échoue, comportement voulu).

Taxonomie d'erreurs : `invalid_input`, `quota_exceeded`, `concurrency_limit`, `timeout`,
`claude_failed`, `router_failed`, `mission_failed`, `daemon_unreachable`.

## 12. Cycle de vie et robustesse

- Verrou + pidfile ; second démon refusé.
- Au démarrage : tâches `running` orphelines → niveaux 1-2 relancés depuis zéro (idempotents,
  coût ré-imputé et signalé) ; niveau 3 repris par relance du `concepteur` — c'est exactement ce
  pour quoi `MEMORY.md`/`STATUS.md` existent.
- Toute ligne du ledger porte `space`, `task`, `level`, `specialist`, `model`, `effort`,
  `cost_usd`, `tokens`, `turns`, `duration_ms`, `exit`, `repo_commit`.
- Transcripts conservés 30 jours (paramètre), `RESULT.md` et `TASK.json` indéfiniment.

## 13. Ce qui rend une instance utile au quotidien

C'est ici que le projet se gagne ou se perd. Six mécanismes, tous bon marché, tous alignés sur les
quatre sources de valeur du §0.

**13.1 La carte du terrain (`DIGEST.md`).** Une session cartographe (profil `execution`, lecture
seule, 2 USD max) parcourt les racines d'un espace et écrit une carte de 2 000 tokens : ce que
fait le projet, sa structure, ses conventions, ses points chauds, la date et le commit. Régénérée
par `holarch space digest` ou quand HEAD a changé de plus de N commits. Chaque spécialiste démarre
avec cette carte en cache : c'est la différence entre un consultant qui connaît le dossier et un
passant — et c'est ce que Desktop, sans accès à tes fichiers, ne peut pas avoir.

**13.2 Le registre des décisions (`DECISIONS.md`).** Chaque `RESULT.md` se termine par « Décisions
que je te propose d'acter ». Tu les valides via `rate_result … decisions:[…]` ; elles s'écrivent
datées. Tout spécialiste les reçoit et la charte l'oblige à citer celle dont il s'écarte. Effet
quotidien : fin du « on en avait déjà parlé » — l'instance porte la continuité que les
conversations perdent.

**13.3 Un livrable qu'on lit en trente secondes.** `RESULT.md` a toujours les mêmes sections, dans
le même ordre : Verdict (3 lignes) · Raisons · Non vérifié / incertitudes · Désaccords (niveau 2)
· Décisions proposées · Suite suggérée (niveau et devis) · Coût réel. On ouvre, on scanne, on
décide. La section « Non vérifié » est obligatoire et ne peut pas être vide : l'honnêteté du
KERNEL, transformée en habitude de lecture.

**13.4 Les fils.** `parent_task` rend le spécialiste interpellable : « et si on retirait la
contrainte X ? » repart du contexte exact (`--resume`) pour quelques centimes au lieu de tout
réexpliquer. Un avis devient une consultation.

**13.5 Le devis avant, la facture après.** `refine_prompt` donne coût et durée estimés à partir de
tes appels passés ; `RESULT.md` donne le coût réel ; `get_usage` donne le mois. On n'appelle
jamais quelque chose dont on ignore le prix — et c'est ce qui permet de déléguer sans anxiété,
donc souvent.

**13.6 La contradiction organisée.** `review: true` au niveau 1 et le niveau 2 tout entier : un
second regard qui n'a pas produit le premier, avec pour consigne de chercher la faille. C'est la
supervision `ON_CHILD_DONE` du KERNEL rendue disponible sur commande — et c'est ce qu'aucune
conversation à un seul modèle ne fait spontanément.

Ce qui a été volontairement écarté de la v1 pour rester un outil : les tâches récurrentes
(« veilles » : relire les commits chaque matin) — puissantes, mais elles transforment le démon en
planificateur et méritent leur propre décision une fois la v1 en usage ; le routage appris ;
l'exposition d'une interface web.

## 14. Feuille de route et critères d'abandon

| Étape | Contenu | Utilisable seule ? | Critère d'abandon |
|---|---|---|---|
| 1 | SDK, porte MCP, démon minimal, `refine_prompt`, `submit`/`get`/`list`/`cancel_task` niveau 1 uniquement, `generaliste` seul, `RESULT.md`, ledger, un espace `default` sans racine | oui | après 30 appels : aucun cas où tu as préféré le résultat à Desktop direct → arrêter |
| 2 | Espaces + racines + `DIGEST.md`, catalogue six fiches + validateur, `list_specialists`, mémoires (D9), `DECISIONS.md`, `rate_result` | oui | après 2 semaines : DIGEST/DECISIONS jamais cités utilement dans un résultat → revoir la mémoire avant d'aller plus loin |
| 3 | Niveau 3 (worktree, bootstrap, relances, `answer_task`), ressources MCP, essai d'elicitation | oui | une mission de bout en bout lancée depuis Desktop et lue le lendemain ; sinon, c'est le harnais qu'il faut regarder, pas le démon |
| 4 | Niveau 2 panel, `review: true`, fils `--resume`, hook `on_task_done` | oui | — |
| 5 | Veilles récurrentes, routage informé par le ledger, tout le reste | — | décision séparée |

L'étape 1 est faisable en quelques jours. La sonde `oracle_probe` de la réponse précédente reste
utile en étape 1 pour caractériser Desktop (timeouts, `progressToken`, elicitation) et se range
derrière `HOLARCH_DEBUG=1`.

## 15. Limites assumées (à recopier dans le README)

- Un seul utilisateur, une seule machine ; le démon n'écoute que sur loopback.
- Aucune mémoire inter-espaces hors préférences de forme.
- Le routeur est probabiliste ; le niveau et le spécialiste restent toujours à ta main.
- Le devis est statistique et vaut ce que vaut le ledger ; les premières estimations sont celles
  de `POLICY.md`.
- Une mémoire peut mémoriser une erreur ; elle est bornée, éditable, et un `rate_result` négatif
  la corrige à l'appel suivant — pas avant.
- Le niveau 3 hérite de toutes les limites du harnais (`docs/holarch.md` §16.4) ; il n'en corrige
  aucune.
- Facturation sur le compte Claude Code local ; la sémantique de `--effort` et de `--resume` peut
  évoluer avec le CLI.
- Desktop ne reçoit aucune notification push ; il faut revenir voir (ou configurer
  `on_task_done`).
- Dépendance externe unique (`@modelcontextprotocol/sdk`), `npm install` requis dans
  `tools/holarch-d/` ; le reste du dépôt n'en dépend pas.

## 16. Points non résolus

- Support par Claude Desktop des notifications de ressources et de l'elicitation — à mesurer à
  l'étape 1 ; le repli `waiting_user` est spécifié quoi qu'il arrive.
- `--resume` et `--output-format stream-json` ensemble : à vérifier sur la version du CLI
  installée ; sinon la passe mémoire (D9) se fait par un appel neuf avec le `RESULT.md` en entrée
  (plus cher de quelques centimes, pas bloquant).
- Gouvernance fine de `DECISIONS.md` : qui peut retirer une décision (toi seul, via CLI, décidé)
  — mais faut-il un statut `superseded` plutôt qu'une suppression ? Penchant : append-only avec
  `supersedes:`.
- Espace sans dépôt Git et niveau 3 : le worktree se fait alors sur le dépôt HOLARCH de référence ;
  la mission n'a pas accès aux racines de l'espace sauf à les déclarer dans `OBJECTIVE.md` et
  l'allowlist du harnais — à trancher à l'étape 3.
- Rétention des branches `holon/task-*` : 30 jours par défaut, mais on n'a jamais mesuré le volume
  d'une mission réelle.
- Cowork spécifiquement : s'il peut lire `~/.holarch/tasks/<id>/RESULT.md` directement, les
  ressources MCP deviennent moins nécessaires — à observer.

En une phrase : la spec tient dans un démon qui se souvient de tes projets, travaille pendant que
tu fais autre chose, se fait contredire avant de conclure, et te dit toujours ce que ça coûte — et
si, après l'étape 1, aucune de ces quatre choses ne t'a manqué quand tu es retourné à Desktop seul,
la spec aura aussi servi : elle t'aura évité de construire le reste.
