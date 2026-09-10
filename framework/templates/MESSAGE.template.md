<!--
Gabarit d'entrée MESSAGE — KERNEL §7 (protocole de messages). Chaque message est ajouté EN DOUBLE :
en append dans l'OUTBOX.md de l'émetteur (trace) et en append dans l'INBOX.md du destinataire
(notification). Jamais de suppression ni de modification d'un message déjà écrit.
type ∈ {TASK, DELIVERABLE, BLOCKER, CLARIFICATION, PROPOSAL, ALERT, RESPONSE} — voir KERNEL §7 pour
la sémantique et la réponse attendue de chacun.
-->
---
id: MSG-<chemin-abrégé>-<numéro-séquentiel>
from: <chemin instance émettrice>
to: <chemin instance destinataire>
type: <TASK | DELIVERABLE | BLOCKER | CLARIFICATION | PROPOSAL | ALERT | RESPONSE>
ref: <id du message auquel on répond, ou "—">
date: <ISO 8601>
---
<corps en markdown libre ; pour un DELIVERABLE : pointeur explicite vers shared/<chemin>/...>
