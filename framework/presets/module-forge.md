# Preset : module-forge

> Usage : mission dont l'unique objectif est de concevoir **un nouveau
> module HOLARCH** (catégorie au choix), avec vérification mécanique avant
> livraison. Point de départ de la piste 3.1 de
> `docs/archive/mission-holon-v2/shared/concepteur/SYNTHESE-HOLON-V2.md` (« le système conçoit
> ses propres modules ») et de l'item resté non traité dans la feuille de
> route (`docs/holarch.md` §14 : « preset `module-forge` »).
> En clair : construire une nouvelle pièce du système lui-même, avec quelqu'un d'autre qui la relit et la vérifie avant qu'elle ne soit acceptée.
> Portée : spécialisée — hors du choix générique de taille de chantier (`tools/holarch-init/`) ;
> son budget d'instances bas vient de sa décomposition forcée à deux enfants, pas d'un petit
> chantier. À utiliser en copiant ce fichier vers `framework/CONFIG.md`, quand l'objectif est
> précisément de concevoir un nouveau module HOLARCH.

## Pourquoi pas simplement `solo-light` ?

`solo-light` (`framework/presets/solo-light.md`) part du principe qu'en cas
de doute, on fait seul (`self-assessment`, KERNEL §5.5.8). Forger un module
casse ce doute dans un sens précis : la conception d'un module (choix de
règles, granularité des hooks, paramètres) et sa **relecture indépendante**
contre le contrat formel (`docs/holarch.md` §8.1) sont deux expertises
réellement distinctes — la seconde doit être conduite par quelqu'un (une
session) qui n'a pas rédigé le module, sans quoi elle ne fait que confirmer
les angles morts de l'auteur. C'est exactement le critère 2 du questionnaire
`self-assessment` (« expertises distinctes ? ») qui justifie ici, et
seulement ici, une décomposition à deux enfants au lieu de zéro. Rien
d'autre ne change par rapport à `solo-light` : même profondeur, même budget
serré, mêmes garde-fous.

Ce preset ne prescrit donc pas un questionnaire optionnel : il **fixe** la
décomposition (un enfant conception + un enfant relecture) directement dans
la mission de la racine, pour que la relecture indépendante ne dépende pas
d'une décision au cas par cas d'une session `concepteur` qui pourrait, par
économie, choisir de tout faire elle-même (ce que `solo-light` encouragerait
par défaut).

## Configuration

Pour démarrer une mission avec ce preset, copie le contenu du bloc ci-dessous
(sans les balises de bloc) vers `framework/CONFIG.md`, en remplaçant
`<nom de la mission>` par un intitulé court.

```markdown
# Configuration — mission : <nom de la mission>
> Preset de base : module-forge · Framework : v1.1

## Modules actifs
| # | Catégorie | Module |
|---|---|---|
| 1 | orchestration | direct-spawn |
| 2 | synchronisation | fork-join |
| 3 | memoire | monolithic |
| 4 | recursion | max-depth |
| 5 | recursion | self-assessment |
| 6 | recursion | context-budget |
| 7 | conflits | typed-escalation |
| 8 | registre | sharded-files |
| 9 | observabilite | heartbeat-log |

## Paramètres
| Paramètre | Valeur |
|---|---|
| budget_instances_total | 3 |
| profondeur_max | 2 |
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
- La mission a exactement un livrable : un module HOLARCH prêt à être proposé
  pour intégration à `framework/modules/`. Ne décompose jamais au-delà des
  deux enfants prescrits par la procédure de forge ci-dessous.
- La relecture n'accepte jamais un module qu'elle a elle-même écrit :
  l'indépendance de la relecture est la seule raison d'être de ce preset
  plutôt que `solo-light` — ne la contourne jamais, même sous pression de
  budget ou de délai.
```

`budget_instances_total = 3` : la racine (`concepteur`) plus exactement deux
enfants (conception + relecture) — pas de marge pour en spawner un
troisième, par construction (le fusible `instance-budget` n'est pas actif
ici ; `max-depth` à 2 suffit : aucun des deux enfants ne peut lui-même
spawner).

## Procédure de forge

### Gabarit de `mission/OBJECTIVE.md`

```markdown
# Objectif de la mission

Concevoir un module HOLARCH de catégorie <catégorie> : <intitulé court, ex.
"notification externe (webhook sortant à chaque DELIVERED)">.

Contexte : <pourquoi ce module manque aujourd'hui — quel besoin non couvert
par les modules déjà catalogués dans framework/MANIFEST.md>.

Contraintes connues à respecter dès la conception (à ne pas découvrir en
relecture) :
- Catégorie déclarée : <catégorie> — doit correspondre à une catégorie déjà
  présente dans framework/MANIFEST.md, ou être explicitement justifiée comme
  nouvelle catégorie si aucune ne convient.
- Compatibilités/incompatibilités attendues avec : <modules existants
  potentiellement concernés>.
- Hooks du cycle de vie concernés (KERNEL §2) : <si connus à l'avance>.

Livrable final attendu : un unique fichier
`framework/modules/<catégorie>/<nom-module>.md` conforme au contrat
`docs/holarch.md` §8.1, déposé en proposition dans
`mission/shared/concepteur/<nom-module>/` (jamais directement sous
`framework/` — refusé mécaniquement, KERNEL §4).
```

### Rôles attendus

La racine (`concepteur`, profondeur 1) applique le questionnaire
`self-assessment` normalement (KERNEL §5 module `self-assessment`), mais la
réponse est ici verrouillée par les Valeurs organisationnelles ci-dessus :
elle spawne **exactement deux enfants**, jamais zéro, jamais plus de deux.

| Enfant | Profil | Mission | Autorité |
|---|---|---|---|
| `<nom-module>` | conception | Rédiger le fichier de module (§8.1), son entrée MANIFEST proposée, et une note de justification (pourquoi cette catégorie, ces paramètres, ces hooks). Dépose dans `mission/shared/concepteur/<nom-module>/`. | Choix de conception du module lui-même ; ne décide pas de son acceptation. |
| `relecture-<nom-module>` | relecture | Relire le livrable de `<nom-module>` **sans en avoir écrit une ligne** : exécuter `module-lint` dessus (voir critères ci-dessous), vérifier la cohérence avec le KERNEL et les modules existants, rejouer la validation de bootstrap sur un `CONFIG.md` de test. Rend un verdict motivé (`DELIVERABLE` avec accepté/rejeté + raisons) à `concepteur`, jamais directement à l'auteur du module. | Verdict d'acceptation mécanique et de cohérence ; n'a pas autorité pour réécrire le module elle-même — un rejet renvoie via `TASK` correctif à `<nom-module>` (KERNEL §2, `ON_CHILD_DONE`). |

Ordre de spawn (`fork-join`, KERNEL §9 + module `fork-join`) : les deux
enfants sont créés ensemble à `ON_SPAWN`, mais `direct-spawn` reste
strictement séquentiel à l'incarnation — `<nom-module>` est lancé et doit
livrer avant que `relecture-<nom-module>` ne soit incarnée (la relecture n'a
rien à relire tant que le module n'existe pas). Consigne cette dépendance
d'ordre dans `JOURNAL.md` au moment du spawn, `dependency-graph` n'étant pas
actif dans ce preset (mission à deux enfants seulement, l'ordre séquentiel
de `direct-spawn` suffit sans graphe de dépendances explicite).

### Critères d'acceptation mécaniques (minimum)

La racine ne fait passer un enfant `relecture-<nom-module>` à `DELIVERED`
(et donc n'accepte le module) que si **les deux** commandes suivantes
réussissent, rejouées par la relecture elle-même et vérifiées à nouveau par
la racine à `ON_CHILD_DONE` (KERNEL §5.2 : jamais d'acceptation automatique
d'un résultat annoncé mais non vérifié) :

1. **`module-lint` sans erreur** :
   ```bash
   node tools/module-lint/module-lint.js \
     mission/shared/concepteur/<nom-module>/<nom-module>.md \
     --manifest framework/MANIFEST.md
   ```
   Code de sortie attendu : `0`. Un avertissement n'est pas bloquant en soi,
   mais doit être justifié par écrit dans le verdict de relecture (même
   exigence d'honnêteté que `README.md` de `forge-module`, KERNEL §5.4) —
   ne jamais ajuster le module pour faire taire un avertissement légitime
   sans comprendre pourquoi il apparaît.
2. **Rejeu de la validation de bootstrap** (`framework/BOOTSTRAP.md`, Étape
   1) sur un `CONFIG.md` de test qui déclare le nouveau module actif dans sa
   catégorie et référence une entrée MANIFEST provisoire pour lui : vérifie
   que le module ne casse aucune des contraintes de composition (§9.1) —
   catégorie reconnue, pas de conflit d'incompatibilité avec les autres
   modules actifs du `CONFIG.md` de test, paramètres requis présents. En
   pratique, la relecture construit ce `CONFIG.md` de test à la main (il
   n'existe pas d'outil dédié pour cette étape — hors périmètre de
   `forge-module`, qui ne livre que `module-lint.js`) en copiant un preset
   existant (`solo-light` par exemple) et en y ajoutant la ligne du nouveau
   module, puis vérifie manuellement chaque point de l'Étape 1 de
   `BOOTSTRAP.md` un par un, consigné dans son `DELIVERABLE`.

Un module qui échoue l'un des deux critères est renvoyé par `TASK` à
`<nom-module>` avec le diagnostic précis (sortie de `module-lint`, ou point
précis de l'Étape 1 en échec) — jamais un rejet non motivé.
