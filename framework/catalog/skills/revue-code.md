---
id: revue-code
kind: skill
version: 1.0.0
title: Relire du code
---

# Relire du code

## Capacité observable
Examiner un changement de code pour des défauts de correction, de simplicité et de cohérence
qu'une exécution seule ne révèle pas nécessairement.

## Quand l'utiliser
- Avant d'accepter un livrable de code, propre ou d'un enfant.
- Revue d'un changement structurant avant fusion.

## Entrées nécessaires
- Le changement à relire (diff ou fichiers complets selon la taille).
- Le contexte du changement (pourquoi, contrat visé, critères d'acceptation).

## Méthode
1. Vérifier que le changement fait ce qu'il prétend faire, pas seulement qu'il compile ou passe
   des tests.
2. Rechercher les scénarios d'entrée que le changement gère mal.
3. Identifier les simplifications possibles sans changer le comportement.
4. Vérifier la cohérence avec les conventions déjà en place dans le code environnant.
5. Distinguer les défauts bloquants des améliorations optionnelles.

## Preuves attendues
- Liste des défauts trouvés, avec leur localisation précise et un scénario concret.
- Distinction explicite entre bloquant et optionnel.

## Critères de qualité
- Chaque défaut signalé est accompagné d'un scénario reproductible, pas d'une impression.
- La relecture porte sur le changement réel, pas sur une description qui en est faite.
- Les défauts bloquants sont séparés des préférences de style.

## Échecs à éviter
- Signaler un défaut sans scénario concret qui le déclenche.
- Approuver un changement sur la base du résumé qui l'accompagne, sans le lire.
- Mélanger défauts de correction et préférences stylistiques sans les distinguer.

## Prérequis d'exécution
Accès au code réel du changement — jamais une revue sur la seule description d'un `DELIVERABLE`.
