---
id: architecture-logicielle
kind: skill
version: 1.0.0
title: Concevoir une architecture logicielle
---

# Concevoir une architecture logicielle

## Capacité observable
Définir la structure d'un système — ses composants, leurs frontières et leurs contrats — de
manière à ce que l'implémentation puisse procéder sans redécouvrir les décisions structurelles en
cours de route.

## Quand l'utiliser
- Avant l'implémentation d'un système nouveau ou d'une évolution structurelle.
- Quand plusieurs composants doivent s'accorder sur des frontières et des contrats communs.

## Entrées nécessaires
- Besoin fonctionnel cadré et critères d'acceptation.
- Contraintes techniques et d'environnement.
- Architecture existante, si évolution plutôt que création.

## Méthode
1. Identifier les composants et les responsabilités qu'ils se partagent.
2. Définir les frontières et les contrats d'interface entre composants.
3. Comparer au moins une alternative structurelle avant de trancher.
4. Documenter la décision retenue et le motif du rejet des alternatives.
5. Vérifier la cohérence avec les contraintes techniques et de sécurité connues.

## Preuves attendues
- Description des composants, frontières et contrats.
- Alternatives comparées et motif de la décision retenue.

## Critères de qualité
- Chaque frontière de composant a une justification, pas seulement une forme.
- Les contrats d'interface sont suffisamment précis pour être implémentés sans arbitrage
  supplémentaire.
- Les alternatives écartées sont documentées, pas seulement la décision finale.

## Échecs à éviter
- Figer une architecture sans alternative comparée par écrit.
- Confondre décision d'architecture et préférence d'implémentation.
- Ignorer une contrainte technique déjà connue au moment de la conception.

## Prérequis d'exécution
Aucun outil requis au-delà de la documentation existante du système et de ses contraintes.
