# external-orchestrator

Prototype d'orchestrateur externe pour HOLARCH — feuille de route v2 (`docs/holarch.md` §14 : *parallélisme réel* + *`external-orchestrator`*).

## Pourquoi

`dependency-graph` ordonnance déjà les enfants d'une mission par dépendances, mais son paramètre `max_parallel` (défaut 1, `framework/modules/synchronisation/dependency-graph.md`) n'est interprété par aucun mécanisme d'exécution simultanée réel : `direct-spawn` lance chaque enfant via CLI et attend sa fin avant de passer au suivant — « strictement séquentiel et synchrone » par construction (`framework/modules/orchestration/direct-spawn.md`, ON_SUPERVISE).

Ce script vit délibérément hors de `framework/` : aucune instance HOLARCH ne peut le lire ni l'exécuter comme un module (cloisonnement `docs/holarch.md` §4.3, « `framework/` | tous | personne »). Il remplace, depuis l'extérieur, la boucle `ON_SUPERVISE` d'un parent par un ordonnanceur qui respecte le même graphe de dépendances (lu directement dans `registry/instances/*.md`, colonne « Dépend de » — aucun nouveau format de fichier) mais lance plusieurs enfants à la fois, dans la limite d'un `max_parallel` réellement appliqué.

## Utilisation

```bash
python3 external_orchestrator.py <racine-bac-à-sable> <max_parallel>
```

`<racine-bac-à-sable>` doit contenir `framework/` et `mission/` côte à côte (mêmes chemins relatifs que ceux écrits dans les `ROLE.md`/`CONFIG.md` de la mission) ; `mission/registry/instances/*.md` doit déjà exister (échafaudage manuel des instances racines, comme documenté dans `mission/registry/DECISIONS.md` d'une mission bac-à-sable — précédent : `docs/examples/external-orchestrator-demo/`).

## Tests

```bash
python3 test_external_orchestrator.py
```

6 tests, mode simulé (aucun sous-processus réel, coût nul) : respect des dépendances, parallélisme effectif, plafond `max_parallel` jamais dépassé, propagation d'échec aux dépendants, dépendance inconnue détectée. Écrits sans `unittest`/`pytest` (absents de certains environnements minimaux) — runner à base d'`assert` simples, zéro dépendance externe.

## Limites assumées

Prototype, pas une intégration : `dependency-graph` lui-même n'est pas modifié. Bookkeeping registre (`ORG.md`, `PROGRESS.md`) non automatisé — à faire manuellement ou par un appelant. Pas de logique de relance automatique sur `FAILED` (contrairement à `direct-spawn`, ON_SUPERVISE, règle 4). Voir le rapport complet de la démonstration réelle pour le détail : [`docs/archive/mission-holon-v2/shared/concepteur/v2/orchestrator/RAPPORT.md`](../../docs/archive/mission-holon-v2/shared/concepteur/v2/orchestrator/RAPPORT.md) et sa trace, [`docs/examples/external-orchestrator-demo/`](../../docs/examples/external-orchestrator-demo/).
