<!--
Gabarit d'entrée MESSAGE — KERNEL §7 (protocole de messages). Chaque message est ajouté EN DOUBLE :
en append dans l'OUTBOX.md de l'émetteur (trace) et en append dans l'INBOX.md du destinataire
(notification). Jamais de suppression ni de modification d'un message déjà écrit.
type ∈ {TASK, DELIVERABLE, BLOCKER, CLARIFICATION, PROPOSAL, ALERT, RESPONSE} — voir KERNEL §7 pour
la sémantique et la réponse attendue de chacun.
origine (optionnel) ∈ {parent, enfant, utilisateur, harnais, externe} — déclarée par l'émetteur ou
déduite par `tools/message-lint/message-lint.js --blame` (chantier 4, `docs/IMPLEMENTATION.md` §5).
N'étend pas le KERNEL §7 : ce champ reste facultatif, les sept types de messages restent inchangés.
porte (optionnel, chantier 15 §16.3) : `V<n>` — sur une CLARIFICATION, demande la porte nommée (section
« Validations requises » de ROLE.md/OBJECTIVE.md) ; sur une RESPONSE, la franchit (garde-fou
gate-guard). N'ajoute aucun type de message : `porte` reste un champ optionnel de l'enveloppe.
-->
---
id: MSG-<chemin-abrégé>-<numéro-séquentiel>
from: <chemin instance émettrice>
to: <chemin instance destinataire>
type: <TASK | DELIVERABLE | BLOCKER | CLARIFICATION | PROPOSAL | ALERT | RESPONSE>
ref: <id du message auquel on répond, ou "—">
date: <ISO 8601>
porte: <V<n> — optionnel : CLARIFICATION qui demande la porte, RESPONSE qui la franchit>
origine: <parent | enfant | utilisateur | harnais | externe — optionnel>
---
<corps en markdown libre ; pour un DELIVERABLE : pointeur explicite vers shared/<chemin>/...>

## Contrôles
| Livrable | Commande | Code | Rapport |
|---|---|---|---|
| <nom de la table Livrables> | `<commande de la colonne Contrôle, telle quelle>` | <code de retour réel> | <chemin du rapport, ou sa première ligne> |

Livrables couverts : <optionnel — noms des livrables couverts par ce message (jalon J<n>) ; absent = tous>

Regardé : <ce qui a été inspecté à l'œil ou à l'oreille, et comment — planche, extraits, écoute, relecture>

Une commande n'est citée qu'après avoir été lancée (code réel, jamais supposé) ; un livrable dont la
colonne Contrôle vaut `—` n'a pas de ligne de commande mais est couvert par « Regardé : » ; un
`DELIVERABLE` référençant un jalon `J<n>` (champ `ref: J<n>` ou ligne « Livrables couverts ») est soumis
à la même règle pour les livrables qu'il couvre.
