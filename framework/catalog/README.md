# Catalogue — métiers, compétences et recettes de rôle

> Active par le module [`role-composition`](../modules/extensions/role-composition.md) (catégorie
> `extensions`, opt-in). Sans ce module actif dans `CONFIG.md`, ce répertoire n'est lu par aucune
> instance.

Le catalogue compose du contenu réutilisable pour rédiger un `ROLE.md` — il ne remplace aucune
section du gabarit natif (`framework/templates/ROLE.template.md`) et ne crée aucune permission. Le
seul contrat opérationnel d'une instance reste son `ROLE.md`.

## Le modèle : métier + compétences → rôle contextualisé

| Élément | Question | Exemple |
|---|---|---|
| **Métier** (`jobs/`) | Quelle responsabilité exercer ? | Développeur back-end |
| **Compétence** (`skills/`) | Quelle méthode appliquer ? | Concevoir un contrat d'API |
| **Recette de rôle** (`roles/`) | Quelle combinaison réutilisable ? | Développeur d'API |
| **Personnalité** (module `role-personality`, si actif) | Quelle posture adopter ? | `rigoureux` |
| **Profil de modèle** (module `direct-spawn`) | Quel profil d'exécution HOLARCH ? | `execution` |

```
Métier principal
  + compétences nécessaires
  + contexte de la mission
  + contraintes et critères d'acceptation
  + personnalité éventuelle
  + profil de modèle
  ───────────────────────────────────────
  = ROLE.md contextualisé et immuable
```

Un rôle n'est pas un intitulé de CV : c'est un contrat de travail vérifiable.

## Structure

```
framework/catalog/
├── README.md          # ce fichier
├── SELECTION.md        # périmètre et critères d'inclusion/exclusion
├── JOBS.md              # index des métiers cataloguées
├── SKILLS.md            # index des compétences cataloguées
├── ROLES.md             # index des recettes de rôle
├── MATRIX.md            # croisement métiers × compétences
├── jobs/<id>.md          # une fiche métier par fichier
├── skills/<id>.md        # une fiche compétence par fichier
├── roles/<id>.md         # une recette par fichier
└── templates/            # gabarits pour ajouter une fiche
```

- **`jobs/`** décrit des responsabilités, sans imposer de stack technique.
- **`skills/`** décrit des méthodes et des preuves attendues, pas des connaissances déclaratives.
- **`roles/`** contient des combinaisons prêtes à l'emploi, pas une deuxième copie des métiers — le
  parent peut toujours composer directement un métier avec des compétences sans passer par une
  recette.

## Convention de fiche

Chaque fiche porte un en-tête YAML (`id`, `kind`, `version`, `title`) en semver. Une fiche publiée
est immuable : la faire évoluer est un changement de version, jamais une réécriture silencieuse du
contenu existant — les instances qui l'ont déjà citée dans un `ROLE.md` gardent une référence
horodatée par la révision Git consignée à `ON_SPAWN`.

Une compétence ne certifie jamais rien : elle décrit une méthode vérifiable et les preuves qu'elle
attend, pas une qualification acquise par l'instance qui la porte (voir `SELECTION.md`).

## Portée actuelle

Le catalogue retient **vingt métiers**, **vingt-huit compétences** et **dix recettes** — le
périmètre complet de la proposition d'origine. Voir `JOBS.md`, `SKILLS.md`, `ROLES.md` pour la
liste exacte et `MATRIX.md` pour le croisement métiers × compétences, `SELECTION.md` pour les
règles d'inclusion, d'exclusion et d'évolution au-delà de ce périmètre.
