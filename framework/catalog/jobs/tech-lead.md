---
id: tech-lead
kind: job
version: 1.0.0
title: Tech lead
default_profile: conception
---

# Tech lead

## Finalité
Transformer une architecture en plan technique exécutable, et arbitrer les décisions d'intégration
qui traversent plusieurs composants ou équipes.

## Responsabilités
- Décliner une architecture en plan technique par composant.
- Arbitrer les décisions d'intégration entre composants développés séparément.
- Relire les changements structurants avant qu'ils ne se propagent.
- Identifier les risques techniques du plan avant qu'ils ne deviennent des blocages.

## Compétences candidates
- architecture-logicielle
- revue-code
- planification

## Entrées nécessaires
- Architecture ou décisions structurelles déjà actées.
- Périmètre des composants à coordonner.
- Contraintes de calendrier ou de dépendances entre composants.

## Livrables types
- Plan technique par composant.
- Arbitrages d'intégration documentés, avec motif.
- Risques techniques identifiés et leur mitigation proposée.

## Limites
- Ne modifie pas l'architecture actée sans la rouvrir explicitement.
- N'impose pas un choix d'implémentation hors du périmètre de coordination délégué.
- Ne valide pas une intégration sans l'avoir vérifiée réellement.

## Signaux d'escalade
- Décision d'architecture à rouvrir pour lever un blocage d'intégration.
- Risque technique dont la mitigation dépasse le périmètre délégué.
- Composants développés séparément dont les contrats divergent de manière irréconciliable.
