# Politique de modèle — holarch-d
> Format identique à `framework/CONFIG.md` (§9.1 de `docs/holarch.md`), parsé par les mêmes
> fonctions (`framework/bin/holarch-spawn.js`, `parseConfig`) — voir `policy.js`. Fichier propre au
> démon plutôt que lecture de `framework/CONFIG.md` : ce dernier est couplé à l'état d'une
> mission. `holon policy import <CONFIG.md>` (non construit à l'Étape 1) recopiera au besoin la
> table d'un `CONFIG.md` existant — copie manuelle, pas de lien à l'exécution (dérive assumée).

## Politique de modèle
| Profil | Modèle | Effort |
|---|---|---|
| triage | haiku | low |
| conception | opus | high |
| execution | sonnet | medium |
| relecture | opus | medium |

## Paramètres
| Paramètre | Valeur |
|---|---|
| max_tours_niveau0 | 10 |
| budget_usd_niveau0 | 0.05 |
| timeout_s_niveau0 | 30 |
| max_tours_niveau1 | 3 |
| budget_usd_niveau1 | 1.0 |
| timeout_s_niveau1 | 180 |
| budget_usd_niveau2_par_specialiste | 1.0 |
| budget_usd_niveau2_arbitre | 1.5 |
| timeout_s_niveau2 | 600 |
| quota_usd_jour | 20 |
| concurrence_max | 2 |
| permission_mode | default |
| on_task_done | |

## Routage
> Non parsé mécaniquement à l'Étape 1 (pas de section reconnue par `parseConfig` au-delà de
> « Politique de modèle » et « Paramètres ») — reproduit tel quel dans le prompt de triage
> (`router.js`) pour guider la sortie JSON. Documentation humaine + contexte du modèle, pas une
> table consultée par du code.

| Complexité | Nature de la demande | Profil suggéré |
|---|---|---|
| basse | factuelle / exécution courte | execution |
| moyenne | factuelle / exécution courte | execution |
| haute | factuelle / exécution courte | conception |
| basse–moyenne | conception / arbitrage / analyse ouverte | conception |
| haute | conception / arbitrage / analyse ouverte | conception |
| toute | relecture / critique d'un artefact fourni | relecture |
