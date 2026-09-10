# Module : dependency-graph
> Catégorie : synchronisation
> Version : 1.0.0
> Requiert : —
> Incompatible avec : fork-join
> Complète bien : direct-spawn, journal-synthesis, instance-budget

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|
| max_parallel | 1 | Nombre maximal d'enfants lancés simultanément. En v1, `direct-spawn` étant strictement synchrone, seule la valeur `1` est réellement exploitable — ce paramètre existe pour rester compatible avec un futur module d'orchestration parallèle (v2). |

## Règles injectées

### ⚓ ON_SPAWN
Pour chaque enfant, déclare explicitement ses dépendances (liste des chemins d'instances sœurs dont il a besoin des livrables) dans sa fiche `registry/instances/<chemin>.md`, champ "Dépend de". Avant de finaliser le spawn d'un lot d'enfants, calcule le tri topologique du graphe de dépendances déclaré.

**Détection de cycle** : si le graphe contient un cycle, c'est une erreur de conception — n'effectue **aucun** spawn du lot concerné. Consigne l'erreur dans `JOURNAL.md`, corrige le découpage (rôles ou dépendances) avant de retenter `ON_SPAWN`.

### ⚓ ON_CHILD_DONE
Ne fais passer un enfant à `READY` (et donc éligible à un lancement par le module d'orchestration actif) que lorsque **toutes** les instances dont il dépend sont à `DELIVERED`. Un enfant sans dépendance est `READY` dès sa création. Respecte `max_parallel` : ne considère jamais plus de `max_parallel` enfants comme `READY`-et-non-encore-lancés en simultané — les enfants supplémentaires prêts restent en attente explicite.
