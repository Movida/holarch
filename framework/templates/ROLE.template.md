<!--
Gabarit ROLE.md — instancié par le PARENT au spawn (KERNEL §5, procédure de spawn de la spec §7.2).
Règle : ROLE.md est immuable une fois écrit, sauf recadrage formel (spec §7.5 — jamais modifié en place,
l'instance est archivée et remplacée). Le parent DOIT remplir toutes les sections ci-dessous, sans en
laisser aucune vide : une section vide est un ROLE.md invalide.
-->
# Rôle : <intitulé du rôle>
> Instance : <chemin> · Créée par : <chemin parent> · Date : <ISO 8601> · Profondeur : <n>

## Mission
<Quoi et pourquoi. 3-10 lignes. Doit être auto-suffisant : une session qui ne lirait que cette section
doit comprendre ce qu'on attend d'elle.>

## Contexte hérité
<!-- OBLIGATOIRE — c'est le garde-fou anti-dérive (devoir de fidélité, KERNEL §5.5) -->
- Objectif racine de la mission : <copie/synthèse fidèle de mission/OBJECTIVE.md>
- Contraintes transverses : <héritées de CONFIG.md + décisions actées en amont>
- Décisions déjà actées en amont : <liste, ou référence à des entrées de registry/DECISIONS.md>

## Livrables
<!--
Colonne « Contrôle » remplie par le PARENT à ON_SPAWN (module direct-spawn) : le hook deliver-guard
exige qu'un DELIVERABLE cite chaque commande avec son code réel. Une table sans cette colonne reste
valide (garde-fou inerte) ; config-lint avertit.
-->
| Livrable | Format | Emplacement | Critères d'acceptation | Contrôle |
|---|---|---|---|---|
| <nom> | <format> | `shared/<chemin>/...` | <critères vérifiables> | <commande exécutable depuis la racine de travail de l'instance, chemins relatifs, code 0 = conforme, sortie = rapport ; ou « — » avec le motif dans Critères (ex. lecture sur pièces par le parent)> |

## Validations requises
<!--
Chantier 15, §16.3 — garde-fou gate-guard. Une porte protège un ou plusieurs chemins (préfixes
relatifs à la racine de travail de l'instance, ex. `shared/<chemin>/final/`) et/ou des livrables
nommés (première colonne de la table Livrables ci-dessus, écrits `DELIVERABLE « nom »`), séparés par
` ; ` dans la colonne Protège. Franchir une porte = recevoir une RESPONSE dont l'en-tête porte
`porte: V<n>` ; la demander = envoyer une CLARIFICATION ordinaire avec `porte: V<n>` dans son en-tête.
La préparation (échantillon, plan, règles du métier) reste permise hors des chemins protégés. Laisser
vide ou « — » si aucune porte.
-->
| Porte | Quoi | Par qui | Protège |
|---|---|---|---|
| <V1> | <ce qui doit être validé> | <qui valide> | `<chemin protégé>` ; DELIVERABLE « <livrable> » |

## Autorité
- Décisions autonomes : <périmètre précis>
- Budget d'instances alloué : <n> (⊂ budget du parent)
- Hors périmètre (escalader) : <liste>

## Redevabilité
- Rend compte à : <chemin parent>
- Rythme/conditions de reporting : <ex. à la livraison ; en cas de blocage sous 1 session>

## Interfaces
- Dépend des livrables de : <instances sœurs + référence à registry/contracts/ si applicable>
- Fournit à : <instances sœurs>
