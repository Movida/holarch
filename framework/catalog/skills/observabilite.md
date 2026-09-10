---
id: observabilite
kind: skill
version: 1.0.0
title: Rendre un système observable
---

# Rendre un système observable

## Capacité observable
Instrumenter un système pour que son état et ses défaillances soient diagnosticables depuis
l'extérieur, sans devoir reproduire le problème pour le comprendre.

## Quand l'utiliser
- Mise en exploitation d'un système dont les défaillances doivent être diagnosticables à distance.
- Système existant dont les incidents passés ont été difficiles à diagnostiquer faute de signal.

## Entrées nécessaires
- Le système à instrumenter.
- Les scénarios de défaillance connus ou redoutés.
- Contraintes de confidentialité sur les données journalisées.

## Méthode
1. Identifier les signaux nécessaires pour diagnostiquer les défaillances connues ou redoutées.
2. Instrumenter journaux, métriques ou traces en conséquence, pas de façon exhaustive non ciblée.
3. Vérifier qu'aucune donnée sensible n'apparaît dans les signaux produits.
4. Vérifier que les signaux permettent réellement de diagnostiquer un incident simulé.
5. Documenter où et comment consulter ces signaux en situation réelle.

## Preuves attendues
- Instrumentation fonctionnelle, vérifiée sur un incident simulé.
- Vérification explicite de l'absence de donnée sensible dans les signaux produits.

## Critères de qualité
- Les signaux produits permettent de diagnostiquer les scénarios de défaillance identifiés.
- Aucune donnée sensible n'apparaît dans un journal, une métrique ou une trace produite.
- La documentation d'accès aux signaux est vérifiée, pas seulement rédigée.

## Échecs à éviter
- Instrumenter de façon exhaustive sans lien avec un scénario de défaillance réel.
- Journaliser une donnée sensible pour faciliter le diagnostic.
- Ne jamais vérifier que les signaux produits servent réellement à diagnostiquer un incident.

## Prérequis d'exécution
Accès au système réel pour instrumenter et vérifier — une instrumentation non vérifiée sur un
incident simulé est déclarée non vérifiée.
