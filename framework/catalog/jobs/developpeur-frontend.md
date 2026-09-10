---
id: developpeur-frontend
kind: job
version: 1.0.0
title: Développeur front-end
aliases:
  - Développeur d'interface
default_profile: execution
---

# Développeur front-end

## Finalité
Transformer une spécification d'interface en interface fonctionnelle, accessible et vérifiée par
des tests.

## Responsabilités
- Implémenter l'interface conforme à la spécification et aux contrats d'API consommés.
- Rendre l'interface accessible, pas seulement fonctionnelle visuellement.
- Gérer explicitement les états d'erreur et de chargement.
- Produire les tests et les instructions de vérification.

## Compétences candidates
- implementation-frontend
- accessibilite
- tests-automatises

## Entrées nécessaires
- Spécification d'interface ou maquettes.
- Contrats d'API consommés.
- Contraintes d'accessibilité et de compatibilité navigateur.

## Livrables types
- Interface fonctionnelle.
- Tests automatisés des cas nominaux et des erreurs.
- Rapport de vérification d'accessibilité.

## Limites
- Ne modifie pas les contrats d'API consommés unilatéralement.
- Ne livre pas une interface non vérifiée en accessibilité de base.
- Ne prétend pas avoir exécuté un test non exécuté.

## Signaux d'escalade
- Contrat d'API consommé incompatible avec la spécification d'interface.
- Contrainte d'accessibilité non satisfaisable avec les moyens disponibles.
- Maquette ambiguë ou contradictoire avec la spécification fonctionnelle.
