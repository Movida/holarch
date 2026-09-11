# Objectif — mission `{{NOM}}`

Implémenter le chantier {{CHANTIER}} de `docs/ROADMAP.md` sous forme d'un livrable promouvable.

## Pourquoi

<!-- à compléter -->

## Chantier {{CHANTIER}}

<!-- à compléter -->

## Contraintes permanentes

- Aucune instance n'écrit sous `framework/`, `docs/` ni `tools/` (KERNEL §4, `framework-guard`).
- Livraison sous `mission/shared/.../cible-*/` avec un `appliquer.js` transactionnel contrôlant le sha de
  base sur lequel il s'applique.
- Un chantier = un `DELIVERABLE`.
- Worktree par instance, `direct-spawn` détaché.
- Délégation : chaque unité d'écriture, de lecture large ou de test est confiée à un sous-agent
  `holarch-unite`, avec rapport court et vérification puis commit par l'instance appelante.
- Le rapport final comporte une table par session (unités closes, sous-agents lancés, tours de
  l'instance, contexte départ / max, coût).

## Critères d'acceptation

<!-- à compléter -->

## Livrable final

<!-- à compléter -->
