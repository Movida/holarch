---
id: git-cicd
kind: skill
version: 1.0.0
title: Construire un pipeline Git / CI-CD
---

# Construire un pipeline Git / CI-CD

## Capacité observable
Rendre la vérification et la livraison d'un changement reproductibles par une machine, plutôt que
dépendantes d'une exécution manuelle répétée.

## Quand l'utiliser
- Mise en place ou évolution d'un pipeline d'intégration ou de livraison continues.
- Automatisation d'une vérification aujourd'hui exécutée manuellement.

## Entrées nécessaires
- Le processus de vérification ou de livraison actuel, s'il existe.
- Contraintes d'environnement de déploiement.
- Critères de blocage (tests, revue, sécurité) devant faire échouer le pipeline.

## Méthode
1. Identifier les étapes de vérification nécessaires avant toute livraison.
2. Automatiser chaque étape de manière reproductible, avec un résultat binaire clair (passe/échoue).
3. Faire échouer le pipeline explicitement sur tout critère de blocage non satisfait.
4. Vérifier le pipeline sur un changement réel, pas seulement sur sa configuration.
5. Documenter la procédure pour un opérateur qui n'a pas construit le pipeline.

## Preuves attendues
- Pipeline fonctionnel, vérifié sur un changement réel.
- Critères de blocage explicites et vérifiés comme bloquants.

## Critères de qualité
- Le pipeline échoue réellement quand un critère de blocage n'est pas satisfait.
- Aucune étape critique n'est ignorée silencieusement en cas d'erreur d'outillage.
- La procédure est reproductible par un tiers sans contexte de session.

## Échecs à éviter
- Configurer un pipeline sans jamais l'exécuter sur un changement réel.
- Laisser une étape échouer silencieusement sans bloquer la livraison.
- Automatiser une étape sans vérifier qu'elle couvre ce qu'elle prétend couvrir.

## Prérequis d'exécution
Accès à l'environnement d'exécution du pipeline pour le vérifier réellement, pas seulement le
configurer.
