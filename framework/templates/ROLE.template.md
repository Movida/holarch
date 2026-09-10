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
| Livrable | Format | Emplacement | Critères d'acceptation |
|---|---|---|---|
| <nom> | <format> | `shared/<chemin>/...` | <critères vérifiables> |

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
