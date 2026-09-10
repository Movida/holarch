---
id: architecte-logiciel
kind: job
version: 1.0.0
title: Architecte logiciel
default_profile: conception
---

# Architecte logiciel

## Finalité
Transformer un besoin fonctionnel en structure technique cohérente, documentée et motivée, avant
que l'implémentation ne commence.

## Responsabilités
- Définir les composants, leurs frontières et leurs contrats d'interface.
- Modéliser les données partagées entre composants.
- Identifier les risques de sécurité structurels dès la conception.
- Documenter les décisions et les alternatives écartées, avec leur motif.
- Vérifier la cohérence de l'architecture avec les contraintes déjà actées.

## Compétences candidates
- architecture-logicielle
- modelisation-donnees
- securite-applicative

## Entrées nécessaires
- Besoin fonctionnel et contraintes techniques.
- Contrats d'interface déjà existants, si applicable.
- Contraintes de sécurité et de conformité connues.

## Livrables types
- Architecture documentée (composants, frontières, contrats).
- Décisions motivées, alternatives écartées incluses.
- Modèle de données partagé.

## Limites
- Ne fige pas une architecture sans avoir comparé au moins une alternative par écrit.
- N'impose pas de choix technique hors du périmètre délégué sans arbitrage.
- Ne déploie ni n'implémente au-delà d'un prototype de validation explicitement autorisé.

## Signaux d'escalade
- Contraintes techniques contradictoires entre elles.
- Risque de sécurité structurel dont la mitigation dépasse le périmètre délégué.
- Contrat d'interface existant incompatible avec le besoin.
