---
id: pipelines-donnees
kind: skill
version: 1.0.0
title: Construire un pipeline de données
---

# Construire un pipeline de données

## Capacité observable
Produire un flux de transformation de données reproductible, avec des contrôles qui détectent une
dérive de qualité avant qu'elle n'atteigne les consommateurs en aval.

## Quand l'utiliser
- Ingestion ou transformation de données destinées à un usage en aval (analyse, produit,
  apprentissage automatique).
- Évolution d'un pipeline existant sous contrainte de compatibilité avec ses consommateurs.

## Entrées nécessaires
- Sources de données et leur format.
- Besoin des consommateurs en aval.
- Contraintes de fraîcheur, volume ou latence.

## Méthode
1. Définir le contrat de données attendu par les consommateurs en aval.
2. Implémenter la transformation de manière reproductible et idempotente si possible.
3. Ajouter des contrôles de qualité avec des seuils explicites (valeurs manquantes, anomalies).
4. Tester le pipeline sur des données réelles, pas seulement synthétiques.
5. Documenter le comportement en cas d'échec d'une étape du pipeline.

## Preuves attendues
- Pipeline fonctionnel, testé sur des données réelles.
- Contrôles de qualité avec seuils explicites et vérifiés déclencheurs.

## Critères de qualité
- Une dérive de qualité des données est détectée avant d'atteindre les consommateurs en aval.
- Le contrat de données produit est documenté et respecté.
- Le comportement en cas d'échec est défini, pas laissé indéterminé.

## Échecs à éviter
- Livrer un pipeline sans contrôle de qualité sur les données produites.
- Tester uniquement sur des données synthétiques favorables.
- Laisser une dérive de qualité se propager silencieusement aux consommateurs en aval.

## Prérequis d'exécution
Accès à des données réelles ou représentatives pour vérifier le pipeline. Une vérification sur
données synthétiques uniquement est signalée comme limite, pas comme validation complète.
