<!--
Gabarit d'entrée MESSAGE — KERNEL §7 (protocole de messages). Chaque message est ajouté EN DOUBLE :
en append dans l'OUTBOX.md de l'émetteur (trace) et en append dans l'INBOX.md du destinataire
(notification). Jamais de suppression ni de modification d'un message déjà écrit.
type ∈ {TASK, DELIVERABLE, BLOCKER, CLARIFICATION, PROPOSAL, ALERT, RESPONSE} — voir KERNEL §7 pour
la sémantique et la réponse attendue de chacun.
origine (optionnel) ∈ {parent, enfant, utilisateur, harnais, externe} — déclarée par l'émetteur ou
déduite par `tools/message-lint/message-lint.js --blame` (chantier 4, `docs/IMPLEMENTATION.md` §5).
N'étend pas le KERNEL §7 : ce champ reste facultatif, les sept types de messages restent inchangés.
-->
---
id: MSG-<chemin-abrégé>-<numéro-séquentiel>
from: <chemin instance émettrice>
to: <chemin instance destinataire>
type: <TASK | DELIVERABLE | BLOCKER | CLARIFICATION | PROPOSAL | ALERT | RESPONSE>
ref: <id du message auquel on répond, ou "—">
date: <ISO 8601>
origine: <parent | enfant | utilisateur | harnais | externe — optionnel>
---
<corps en markdown libre ; pour un DELIVERABLE : pointeur explicite vers shared/<chemin>/...>
