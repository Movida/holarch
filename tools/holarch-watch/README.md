# holarch-watch

Boucle sans LLM qui évalue périodiquement les conditions de réveil (champ `Réveil` de `STATUS.md`,
grammaire documentée dans `framework/modules/orchestration/direct-spawn.md`, section « Réveil par
condition ») et relance en tâche détachée toute instance dont la condition est satisfaite, via
`wakeWaiters(root, 'holarch-watch')` (exporté par `framework/bin/holarch-spawn.js`).

## Pourquoi

Un enfant qui se termine (`finishLaunch`) réveille déjà son parent quand la condition de celui-ci
devient satisfaite. Mais deux termes de la grammaire ne dépendent d'aucun lancement d'enfant :
`date:ISO8601` (une échéance) et `fichier:CHEMIN` (un fichier apparu par un moyen externe, ex. déposé
par le mainteneur). Sans ce watcher, une instance en attente sur l'un de ces termes ne serait jamais
réveillée tant qu'aucun enfant ne termine par ailleurs.

## Usage

```sh
node tools/holarch-watch/watch.js                    # boucle, intervalle par défaut 30 s
node tools/holarch-watch/watch.js --intervalle 10     # boucle toutes les 10 s
node tools/holarch-watch/watch.js --une-fois           # une seule passe, puis sort (tests)
```

Arrêt de la boucle : `Ctrl-C` (SIGINT), traité proprement (pas de fichier ni processus laissé
derrière).

## Sortie

Une ligne par passe sur stdout, horodatée : la liste des instances réveillées (chemin, id de tâche,
condition canonique), ou `aucun réveil` si rien n'était satisfait. Chaque réveil est aussi journalisé
par le lanceur dans `mission/registry/REVEILS.md` (append-only), indépendamment de ce watcher.

## Ce que cet outil ne fait pas

Il ne lance aucune session lui-même : il délègue entièrement à `wakeWaiters`/`detachLaunch` du
lanceur, qui appliquent les mêmes garde-fous (verrou `isLive`, budgets, profondeur) qu'un lancement
normal. Il ne remplace pas `--reveil` (évaluation ponctuelle, un coup) ni `--reveil --dry-run`
(inspection sans effet) : c'est la version en boucle du même mécanisme, à faire tourner en tâche de
fond par le mainteneur (ex. `nohup node tools/holarch-watch/watch.js &`), pas par une instance.
