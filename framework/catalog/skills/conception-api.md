---
id: conception-api
kind: skill
version: 1.0.0
title: Concevoir un contrat d'API
---

# Concevoir un contrat d'API

## Capacité observable
Produire un contrat d'interface explicite, cohérent et testable entre un fournisseur et ses
consommateurs.

## Quand l'utiliser
- Création d'une API.
- Modification d'un contrat existant.
- Intégration entre deux systèmes.

## Entrées nécessaires
- Cas d'usage.
- Modèle de données.
- Consommateurs.
- Contraintes de compatibilité et de sécurité.

## Méthode
1. Identifier les opérations et les données échangées.
2. Définir les schémas d'entrée et de sortie.
3. Décrire les validations et les erreurs.
4. Préciser authentification et autorisation si nécessaires.
5. Traiter pagination, idempotence et versionnement si applicables.
6. Préparer des exemples valides et invalides.
7. Vérifier la cohérence avec les consommateurs.

## Preuves attendues
- Contrat structuré : OpenAPI ou équivalent adapté.
- Exemples de requêtes et de réponses.
- Cas d'erreur documentés.
- Résultat des validations réellement exécutées.

## Critères de qualité
- Chaque opération a un objectif identifié.
- Les erreurs ont une sémantique explicite.
- Les changements incompatibles sont signalés.
- Aucun secret ne figure dans les exemples.

## Échecs à éviter
- Concevoir des opérations sans cas d'usage.
- Confondre authentification et autorisation.
- Oublier les entrées invalides.
- Annoncer une compatibilité non vérifiée.

## Prérequis d'exécution
Un validateur de contrat est nécessaire pour annoncer une validation automatique. S'il est absent,
déclarer la validation non exécutée.
