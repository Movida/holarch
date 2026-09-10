# Module : context-budget
> Catégorie : recursion
> Version : 1.1.0
> Requiert : —
> Incompatible avec : —
> Complète bien : instance-budget, max-depth, self-assessment, direct-spawn

## Constat

`instance-budget` et `max-depth` bornent la prolifération d'**instances**. Rien ne borne l'accumulation de **contexte à l'intérieur d'une seule session** — relectures de fichiers, sorties d'outils volumineuses, sous-processus supervisés. L'anecdote de coût publiée dans le README l'illustre : 67 % de l'usage d'une session s'est produit au-delà de 150k tokens de contexte, sans qu'aucune règle du framework n'ait pu le prévoir ni le limiter. Même principe de fusible que `max-depth`, appliqué à un autre axe de croissance.

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|
| seuil_unites | 25 | Nombre d'« unités de travail significatives » (lecture de fichier non triviale, sortie d'outil volumineuse, sous-processus enfant supervisé) tolérées depuis le dernier `ON_ORIENT` avant déclenchement. |
| action_seuil | hibernation-volontaire | `hibernation-volontaire` : l'instance écrit immédiatement `MEMORY.md`/`JOURNAL.md` (comme à `ON_SLEEP`) puis se ré-incarne elle-même (même commande que son propre lancement) pour repartir avec un contexte neuf. `alerte-seule` : émet uniquement une `ALERT` informative au parent, ne force rien. |

## Règles injectées

### ⚓ ON_ORIENT
Initialise (ou relis, si tu reprends après une hibernation volontaire déclenchée par ce module) un compteur d'unités de travail pour la session courante. Consigne le compteur de départ dans `JOURNAL.md`.

### ⚓ ON_SUPERVISE
**Si ta session a été lancée par le lanceur (`framework/bin/holarch-spawn.js`, `direct-spawn` v1.1)**, le hook `context-watch` mesure ton contexte réel après chaque appel d'outil et t'injecte l'ordre d'hiberner au-delà de `seuil_contexte_tokens` (`CONFIG.md`) : cette mesure prévaut sur le compteur heuristique ci-dessous — tiens le compteur comme simple repère, et obéis à l'injection du hook comme au cas `action_seuil = hibernation-volontaire` (la ré-incarnation est alors assurée par le lanceur, paramètre `relances_max`, sans que tu aies rien à relancer toi-même).

Sinon, après chaque unité de travail significative (voir `seuil_unites`), incrémente ton compteur. Si le compteur atteint `seuil_unites` :
- Si `action_seuil = alerte-seule` : émets une `ALERT` à ton parent avec le compteur atteint, et continue le travail normalement.
- Si `action_seuil = hibernation-volontaire` : traite-toi immédiatement comme si tu atteignais `ON_SLEEP` (mets à jour `MEMORY.md`, `STATUS.md` reste à son état réel — ne le fais **pas** passer à `DELIVERED` si le travail n'est pas fini —, `JOURNAL.md` note explicitement qu'il s'agit d'une hibernation volontaire de budget de contexte, pas d'une fin de mission), committe, puis ré-incarne-toi (même `commande_cli` que celle utilisée pour te lancer, appliquée à ton propre chemin) pour reprendre avec un contexte neuf. C'est une application volontaire du même mécanisme de reprise que le test T4 (reprise après crash) vérifie de façon subie.

## Ce que ce module ne fait pas

Il ne mesure aucun compteur de tokens réel : un module HOLARCH est un fichier markdown normatif, il ne peut pas lire le compteur de tokens réel d'une session depuis l'intérieur du KERNEL. `seuil_unites` est une heuristique déclarative **auto-rapportée par l'instance**, pas une instrumentation fiable — un garde-fou volontaire, pas un plafond dur (devoir d'honnêteté, KERNEL §5.4). Il ne garantit donc pas qu'une session reste sous un budget de coût précis, seulement qu'elle ne dérive pas indéfiniment sans checkpoint. Il ne remplace pas `instance-budget`/`max-depth` (qui bornent le nombre et la profondeur d'instances, pas le contexte d'une session unique).

**Ré-incarnation** (point laissé non résolu en v1.0) : avec `direct-spawn` v1.1, l'instance ne se relance jamais elle-même — elle termine sa session après avoir écrit « hibernation volontaire (contexte) » dans la Note de `STATUS.md`, et le lanceur qui l'a incarnée la ré-incarne aussitôt avec un contexte neuf (jusqu'à `relances_max` fois par appel ; au-delà, le parent relance `commande_cli`). Le seuil heuristique par défaut (25 unités) ne sert plus qu'aux sessions lancées hors lanceur ; `registry/SESSIONS.md` (tokens réels par session) permet de le recalibrer.
