<!--
Gabarit STATUS.md — posé par le parent à INIT (spawn), puis tenu à jour par l'instance elle-même
(KERNEL §3). DOIT refléter l'état réel à chaque ON_WAKE et avant chaque ON_SLEEP. Ne jamais laisser
un état WORKING après la fin réelle d'une session : c'est le signal utilisé par le parent pour détecter
une session enfant plantée (spec §12).
États valides : INIT → READY → WORKING → {WAITING_CHILDREN | BLOCKED} → WORKING → DELIVERED → ARCHIVED
                                                                      ↘ FAILED
-->
# Statut — <chemin instance>

| Champ | Valeur |
|---|---|
| État | INIT |
| Depuis | <ISO 8601> |
| Posé par | <chemin parent, ou "soi"> |
| Note | <libre, optionnel — ex. motif si BLOCKED ou FAILED> |
| Réveil | — |
<!-- Condition de réveil pour WAITING_CHILDREN/BLOCKED : grammaire « Réveil par condition »,
     framework/modules/orchestration/direct-spawn.md. "—" = aucune condition (pas d'attente). -->
