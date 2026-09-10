# holarch-init — setup guidé d'une mission (« session RH »)

> Conçu par `concepteur` (mission `holon-v2`), priorité **3.4** de `docs/archive/mission-holon-v2/shared/concepteur/SYNTHESE-HOLON-V2.md` — itération 3.
> Promu dans `tools/` le 2026-09-03 (décision humaine — voir `docs/archive/mission-holon-v2/shared/concepteur/v2/RAPPORT-session-3.md`), depuis `docs/archive/mission-holon-v2/shared/concepteur/v2/session-rh/`.

## Le problème traité

L'objectif O6 du projet — « un utilisateur non expert démarre via un preset en moins de 5 minutes » — n'est aujourd'hui vrai que pour qui sait déjà quoi écrire dans un tableau markdown de `CONFIG.md` : quelles catégories sont obligatoires, lesquelles sont cumulables, quelles paires de modules sont incompatibles, quels paramètres existent. Un utilisateur non expert n'a aucune raison de savoir que `fork-join` et `dependency-graph` s'excluent, ni qu'oublier une catégorie obligatoire produit une configuration invalide.

`holarch-init.js` pose **7 questions en langue naturelle** et produit les deux fichiers de démarrage — `OBJECTIVE.md` et `CONFIG.md` — puis **les valide mécaniquement**. L'utilisateur ne nomme jamais un module ; il décrit son travail.

Node pur, aucune dépendance.

## Utilisation

```bash
# Dialogue interactif
node tools/holarch-init/holarch-init.js --out /tmp/ma-mission

# Non interactif (tests, CI, script)
node tools/holarch-init/holarch-init.js --reponses reponses.json --out /tmp/ma-mission
```

Options : `--force` (écraser des fichiers existants), `--sans-validation`, `--manifest <f>`, `--modules-dir <d>`, `-h`.
Codes de sortie : **0** succès · **1** configuration produite non conforme · **2** erreur d'usage.

L'outil écrit dans le répertoire `--out` **uniquement**, et refuse d'écraser un fichier existant sans `--force`. Il ne touche jamais `framework/` ni `mission/OBJECTIVE.md` : il affiche en fin de dialogue les deux copies à faire, qui restent un geste délibéré de l'utilisateur (cohérent avec KERNEL §4, où ces fichiers ne sont écrits par personne en cours de mission).

## Les 7 questions, et ce qu'elles décident

| Question | Ce qu'elle décide |
|---|---|
| Nom court de la mission | titre de `CONFIG.md` et de `OBJECTIVE.md` (kebab-case vérifié) |
| Que doit accomplir la mission ? | énoncé de `OBJECTIVE.md` (longueur minimale exigée) |
| À quoi verras-tu que c'est réussi ? | critères de réussite — **facultatif**, et s'il est vide c'est écrit noir sur blanc dans `OBJECTIVE.md`, avec renvoi au droit de `CLARIFICATION` (KERNEL §6.1) plutôt qu'un remplissage inventé |
| Tâche cadrée ou projet à plusieurs rôles ? | preset `solo-light` ou `team-standard` : budget d'instances (5/15), profondeur (2/3), plafonds de session, format du rapport final, `instance-budget` et `graveyard-handover` |
| Les tâches dépendent-elles les unes des autres ? | `dependency-graph` si oui, `fork-join` sinon |
| Besoin d'un audit fin a posteriori ? | `journal-synthesis` si oui, `unites-indexees` sinon (mémoire adressée, défaut des presets depuis le framework 1.4.0 ; `monolithic` reste au catalogue, à la main) |
| Suivre l'avancement en direct ? | `heartbeat-log` |

`direct-spawn`, `self-assessment`, `max-depth`, `context-budget`, `typed-escalation` et `sharded-files` sont posés sans question : ce sont soit le seul choix de leur catégorie, soit des garde-fous qu'il n'y a pas lieu de proposer de désactiver à un utilisateur qui découvre le système.

Le `CONFIG.md` produit contient une section **« Pourquoi ces modules (trace du setup guidé) »** : une ligne de justification par module. Le fichier reste un fichier markdown ordinaire, éditable à la main ensuite — l'outil est une rampe d'accès, pas une couche d'abstraction permanente.

## Vérification

**11 tests, tous passants** (branché sur `npm test`/CI) :

```bash
node --test tools/holarch-init/test-holarch-init.js
```

Ce qu'ils couvrent réellement : dérivation solo et équipe ; **exactement un module par catégorie obligatoire sur les 16 combinaisons de réponses** ; **aucune paire incompatible produite**, quelles que soient les réponses ; présence d'une justification par module ; signalement honnête d'un critère de réussite vide ; normalisation des saisies (défauts, choix hors liste refusé et non deviné, kebab-case) ; refus d'écrasement sans `--force` ; **bout en bout via le CLI** ; et les **8 configurations générées validées à 0 erreur par `module-forge`**. Un dernier test casse volontairement une config générée pour vérifier que le test précédent n'est pas vide — un test de validation qui ne sait pas échouer ne prouve rien.

**Dialogue interactif éprouvé pour de vrai** : trace complète dans [`docs/examples/holon-init-demo/`](../../docs/examples/holon-init-demo/) — `transcription-demo.txt` est la transcription d'une exécution réelle du mode interactif, avec deux erreurs de saisie volontaires (nom non kebab-case, puis choix hors liste) pour montrer les relances. Résultat : configuration solo-light à 9 modules, validée à 0 erreur, code de sortie 0. Exemples produits : `exemple-CONFIG.md` et `exemple-OBJECTIVE.md`.

Note de lecture de la transcription : les réponses tapées n'y apparaissent pas après les `>`, parce que l'entrée était redirigée (pas de terminal, donc pas d'écho des frappes). Les relances qui suivent prouvent que les saisies ont bien été reçues et évaluées. Les frappes exactes sont dans `docs/examples/holon-init-demo/demo-rh.js`.

## Ce que cet outil ne fait pas

- **Il ne lance pas la mission.** Il produit les deux fichiers de démarrage ; le bootstrap (`framework/BOOTSTRAP.md`) reste une étape distincte et explicite.
- **Il ne juge pas la qualité de l'objectif.** Il vérifie qu'une phrase a été écrite, pas qu'elle soit un bon objectif — c'est le travail de l'instance racine à `ON_ORIENT`, et de l'utilisateur.
- **Il ne couvre pas tout le catalogue.** Les questions ne donnent accès qu'aux compositions courantes ; une configuration exotique (ou un module d'`extensions`) s'écrit à la main, ou s'ajoute ici en une entrée de la fonction `deriver`.
- **Le seuil des 5 minutes n'est pas mesuré sur un vrai utilisateur non expert.** Sept questions sans jargon rendent l'affirmation plausible ; seul un test avec une personne réelle la démontrerait, et cela n'a pas été fait.

## Promotion

Fait le 2026-09-03 (décision humaine, `framework/` restant en lecture seule pour toute instance, KERNEL §4) : relogé de `docs/archive/mission-holon-v2/shared/concepteur/v2/session-rh/` vers `tools/holarch-init/`, suite branchée sur `npm test`/CI (`.github/workflows/test.yml`).
