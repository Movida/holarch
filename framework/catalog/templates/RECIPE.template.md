<!--
Gabarit de recette de rôle — framework/catalog/roles/<id>.md
Une recette est un raccourci vers une combinaison métier + compétences déjà éprouvée, pas une
liste fermée : le parent peut toujours composer directement un métier avec des compétences pour
une mission particulière (module role-composition, ON_PLAN). Fiche immuable une fois publiée.
-->
---
id: <identifiant-kebab-case, identique au nom de fichier>
kind: role-recipe
version: 1.0.0
job: <id de métier, depuis jobs/>
skills:
  - <id de compétence, depuis skills/>
profile: <conception | execution | relecture>
personality: <valeur de role-personality, si ce module est actif — sinon omettre>
---

# <Intitulé de la recette>

## Usage
<Dans quel type de mandat cette recette convient telle quelle.>

## Informations à obtenir
- <ce que le parent doit préciser avant de composer le ROLE.md>

## Livrables par défaut
- <livrable>

## Critères à contextualiser
- <critère générique à traduire en critère précis pour la mission>

## Limites d'autorité
- <ce que cette recette n'autorise jamais implicitement>

## Adaptations possibles
- <compétence à ajouter ou retirer selon le périmètre réel>
