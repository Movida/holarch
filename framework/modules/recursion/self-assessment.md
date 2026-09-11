# Module : self-assessment
> Catégorie : recursion
> Version : 1.1.0
> Requiert : —
> Incompatible avec : —
> Complète bien : instance-budget, max-depth

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|
| sessions_attendues_max | 6 | Nombre de sessions au-delà duquel une instance qui découpe encore son travail en une unité par session devrait se demander si son régime (profil/effort) est adapté à la tâche, plutôt que continuer à absorber le dépassement par des unités toujours plus petites — repère pour la question 4 ci-dessous, pas un plafond dur (`instance-budget`/`max-depth` restent les seuls plafonds durs). |

## Règles injectées

### ⚓ ON_PLAN
Avant toute décision de spawner, réponds explicitement — par écrit, dans `JOURNAL.md` — au questionnaire suivant. Ne passe à `ON_SPAWN` que si tu peux justifier une décomposition à la lumière de ces quatre réponses (le devoir d'économie du KERNEL, §5.5.8, s'applique : ne spawne pas ce que tu peux faire seul correctement) :

1. **Ça tient dans une session ?** Le travail restant peut-il raisonnablement être accompli, seul, dans la session courante ou une session de continuation — sans risque de dérive de qualité par surcharge ? Si oui, penche vers faire seul.
2. **Expertises distinctes ?** La décomposition envisagée sépare-t-elle des compétences ou des rôles réellement différents, ou n'est-ce qu'un découpage arbitraire de la même tâche ? Un découpage qui ne fait que fragmenter un travail homogène n'est pas justifié.
3. **Coordination < gain ?** Le coût de coordination introduit (messages, attente, vérification de livrables, risque de dérive entre enfants) reste-t-il inférieur au gain attendu de la parallélisation ou de la spécialisation ?
4. **Combien de sessions ?** À combien de sessions estimes-tu le travail restant si tu le fais seul ? Si cette estimation dépasse `sessions_attendues_max`, demande-toi si c'est parce que la tâche se prête réellement à une décomposition (réponses 2 et 3 favorables), ou si c'est ton régime courant (profil, modèle, effort) qui ne suffit pas à la tâche — auquel cas la réponse n'est pas de spawner mais un changement de régime (module d'orchestration actif, `ON_PLAN`), voire un `BLOCKER` si le `ROLE.md` lui-même est en cause.

Si une seule de ces quatre réponses penche contre le spawn, la décision par défaut est de faire seul. Consigne la réponse même quand elle est négative — c'est aussi une décision qui mérite d'être auditée.
