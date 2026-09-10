# Module : self-assessment
> Catégorie : recursion
> Version : 1.0.0
> Requiert : —
> Incompatible avec : —
> Complète bien : instance-budget, max-depth

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|

## Règles injectées

### ⚓ ON_PLAN
Avant toute décision de spawner, réponds explicitement — par écrit, dans `JOURNAL.md` — au questionnaire suivant. Ne passe à `ON_SPAWN` que si tu peux justifier une décomposition à la lumière de ces trois réponses (le devoir d'économie du KERNEL, §5.5.8, s'applique : ne spawne pas ce que tu peux faire seul correctement) :

1. **Ça tient dans une session ?** Le travail restant peut-il raisonnablement être accompli, seul, dans la session courante ou une session de continuation — sans risque de dérive de qualité par surcharge ? Si oui, penche vers faire seul.
2. **Expertises distinctes ?** La décomposition envisagée sépare-t-elle des compétences ou des rôles réellement différents, ou n'est-ce qu'un découpage arbitraire de la même tâche ? Un découpage qui ne fait que fragmenter un travail homogène n'est pas justifié.
3. **Coordination < gain ?** Le coût de coordination introduit (messages, attente, vérification de livrables, risque de dérive entre enfants) reste-t-il inférieur au gain attendu de la parallélisation ou de la spécialisation ?

Si une seule de ces trois réponses penche contre le spawn, la décision par défaut est de faire seul. Consigne la réponse même quand elle est négative — c'est aussi une décision qui mérite d'être auditée.
