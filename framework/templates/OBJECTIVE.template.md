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
- Un chantier = un `DELIVERABLE`, sous `mission/shared/<racine>/` avec `MANIFEST.json` (`shaBase`, `cibles[]`) et
  `appliquer.js` : c'est le contrat de `npm run promote` (`tools/holarch-maintenance/promote.js`) — un manifeste
  sous un autre nom ou un autre format oblige à promouvoir à la main.
- Secrets : la valeur d'un jeton (`HOLARCH_FOURNISSEUR_*_JETON`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`) n'est
  jamais affichée, écrite, committée ni transmise à un sous-agent ; avant `DELIVERED`, la racine la cherche par
  son préfixe dans les fichiers suivis. L'URL d'un service est publique et documentée : elle n'est pas un secret.
- Worktree par instance, `direct-spawn` détaché.
- Délégation : chaque unité d'écriture, de lecture large ou de test est confiée à un sous-agent
  `holarch-unite`, avec rapport court et vérification puis commit par l'instance appelante.
- Le rapport final comporte une table par session (unités closes, sous-agents lancés, tours de
  l'instance, contexte départ / max, coût).

## Critères d'acceptation

<!-- à compléter -->

## Livrable final

<!-- à compléter -->
