---
id: modelisation-donnees
kind: skill
version: 1.0.0
title: Modéliser des données
---

# Modéliser des données

## Capacité observable
Produire un modèle de données cohérent avec les cas d'usage réels, leurs contraintes d'intégrité
et leur évolution prévisible.

## Quand l'utiliser
- Conception d'un nouveau composant qui persiste ou échange des données structurées.
- Évolution d'un modèle existant sous contrainte de compatibilité.

## Entrées nécessaires
- Cas d'usage et opérations attendues sur les données.
- Contraintes d'intégrité et de compatibilité connues.
- Volume et fréquence d'accès prévisibles, si pertinents.

## Méthode
1. Identifier les entités et leurs relations à partir des cas d'usage réels, pas de la commodité
   technique.
2. Définir les contraintes d'intégrité (unicité, obligation, cohérence référentielle).
3. Vérifier la compatibilité avec le modèle existant, si évolution.
4. Documenter les compromis de dénormalisation, s'il y en a, et leur motif.
5. Fournir des exemples de données valides et invalides.

## Preuves attendues
- Schéma ou modèle structuré (diagramme, DDL, ou équivalent adapté).
- Exemples de données valides et invalides.
- Contraintes d'intégrité explicitées.

## Critères de qualité
- Chaque entité correspond à un cas d'usage réel, pas à une anticipation non demandée.
- Les contraintes d'intégrité couvrent les cas d'erreur identifiés.
- Un changement incompatible avec l'existant est signalé, pas silencieux.

## Échecs à éviter
- Modéliser pour un besoin futur hypothétique non demandé.
- Omettre les contraintes d'intégrité au profit de la seule structure.
- Casser la compatibilité sans le signaler explicitement.

## Prérequis d'exécution
Accès au modèle de données existant, si évolution plutôt que création.
