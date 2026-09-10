---
id: conception-interface
kind: skill
version: 1.0.0
title: Concevoir une interface
---

# Concevoir une interface

## Capacité observable
Produire une structure d'interface (parcours, maquette ou spécification) suffisamment précise
pour être implémentée sans arbitrage supplémentaire, cohérente avec le besoin utilisateur cadré.

## Quand l'utiliser
- Nouvelle fonctionnalité ou parcours nécessitant une interface.
- Évolution d'une interface existante sous contrainte de cohérence avec l'existant.

## Entrées nécessaires
- Besoin utilisateur cadré et contraintes produit.
- Contraintes techniques ou de plateforme.
- Conventions d'interface déjà en place, si évolution.

## Méthode
1. Identifier les actions que l'utilisateur doit pouvoir accomplir.
2. Structurer le parcours du plus fréquent au plus exceptionnel.
3. Produire la maquette ou spécification, avec les états d'erreur et de chargement inclus.
4. Vérifier la cohérence avec les conventions d'interface existantes.
5. Comparer au moins une alternative avant de figer un choix structurant.

## Preuves attendues
- Maquette ou spécification suffisamment précise pour être implémentée.
- États d'erreur et de chargement inclus, pas seulement l'état nominal.

## Critères de qualité
- La spécification couvre les cas d'erreur, pas seulement le chemin favorable.
- La cohérence avec les conventions existantes est vérifiée, pas supposée.
- Une alternative a été comparée avant de figer un choix structurant.

## Échecs à éviter
- Concevoir uniquement l'état nominal.
- Ignorer les conventions d'interface déjà en place sans le signaler.
- Figer un choix structurant sans alternative comparée.

## Prérequis d'exécution
Accès aux conventions d'interface existantes, si évolution plutôt que création.
