# Module : typed-escalation
> Catégorie : conflits
> Version : 1.0.0
> Requiert : —
> Incompatible avec : —
> Complète bien : graveyard-handover, instance-budget

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|
| delai_reponse | 1 session | Délai maximal, exprimé en nombre de sessions du destinataire, avant qu'une absence de `RESPONSE` à un `BLOCKER` ou une `CLARIFICATION` soit elle-même traitée comme un blocage à remonter plus haut. |

## Règles injectées

### ⚓ ON_CONFLICT
Quand un conflit survient (entre toi et un enfant, entre deux de tes enfants, ou une alerte de cloisonnement) :

1. Qualifie-le selon le type de message pertinent (KERNEL §7) — `BLOCKER`, `ALERT`, `CLARIFICATION`, ou désaccord entre deux livrables d'enfants.
2. Vérifie si le conflit relève de ton périmètre d'autorité (défini dans ton `ROLE.md`, section Autorité). Si oui, arbitre toi-même et notifie les parties concernées par `RESPONSE`.
3. Si le conflit est **hors périmètre**, ou oppose deux instances sans toi comme parent commun direct, escalade selon les règles d'ancêtre commun du KERNEL (§8) : remonte jusqu'au premier ancêtre commun des deux branches en désaccord.
4. Si tu es la racine et que le conflit ne peut être arbitré en interne, termine ta session avec une question explicite dans `OUTBOX.md` à destination de l'utilisateur (KERNEL §8).
5. Si un `BLOCKER` ou une `CLARIFICATION` reste sans `RESPONSE` au-delà de `delai_reponse`, traite l'absence de réponse elle-même comme un blocage : émets une `ALERT` vers ton propre parent (ou, si tu es la racine, signale-le explicitement à l'utilisateur).

Un conflit qui révèle un `ROLE.md` mal calibré ne se résout pas en modifiant le `ROLE.md` en place — applique le recadrage invariant (KERNEL §10).
