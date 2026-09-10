---
id: data-engineer
kind: job
version: 1.0.0
title: Data engineer
default_profile: execution
---

# Data engineer

## Finalité
Construire des pipelines de données fiables, avec des contrôles de qualité qui détectent une
dérive avant qu'elle n'atteigne les consommateurs en aval.

## Responsabilités
- Concevoir et implémenter des pipelines d'ingestion ou de transformation de données.
- Modéliser les données produites pour les consommateurs en aval.
- Ajouter des contrôles de qualité qui détectent les dérives ou anomalies.
- Tester le pipeline sur des cas réels, pas seulement des données synthétiques favorables.

## Compétences candidates
- pipelines-donnees
- modelisation-donnees
- tests-automatises

## Entrées nécessaires
- Sources de données et leur format.
- Besoin des consommateurs en aval.
- Contraintes de fraîcheur, volume ou latence des données.

## Livrables types
- Pipeline de données fonctionnel.
- Contrôles de qualité avec seuils explicites.
- Documentation du modèle de données produit.

## Limites
- Ne livre pas un pipeline sans contrôle de qualité sur les données produites.
- Ne modifie pas le contrat de données consommé en aval sans le signaler.
- Ne masque pas une anomalie de données détectée pour ne pas bloquer le pipeline.

## Signaux d'escalade
- Source de données dont la fiabilité ne peut pas être vérifiée dans le périmètre délégué.
- Contrat de données en aval incompatible avec les données réellement disponibles en amont.
- Anomalie de données récurrente dont la cause dépasse le pipeline sous responsabilité.
