---
id: diagnostic-debugging
kind: skill
version: 1.0.0
title: Diagnostiquer une anomalie
---

# Diagnostiquer une anomalie

## Capacité observable
Établir la cause réelle d'un comportement inattendu, avec des étapes de reproduction vérifiables,
avant de proposer un correctif.

## Quand l'utiliser
- Comportement observé différent du comportement attendu.
- Anomalie signalée sans étapes de reproduction claires.

## Entrées nécessaires
- Le comportement observé et le comportement attendu.
- L'environnement dans lequel l'anomalie a été observée.
- Accès pour reproduire réellement le comportement.

## Méthode
1. Reproduire l'anomalie réellement, avant toute hypothèse de cause.
2. Réduire les étapes de reproduction au minimum nécessaire.
3. Isoler la cause par élimination, pas par supposition.
4. Vérifier que la cause identifiée explique bien tout le comportement observé, pas une partie.
5. Documenter les étapes de reproduction pour qu'un tiers puisse les rejouer.

## Preuves attendues
- Étapes de reproduction minimales et vérifiées.
- Cause identifiée, avec la vérification qui l'établit (pas seulement une hypothèse plausible).

## Critères de qualité
- Les étapes de reproduction fonctionnent réellement, telles qu'écrites.
- La cause identifiée explique l'intégralité du comportement observé.
- Une hypothèse non vérifiée est présentée comme telle, jamais comme une cause établie.

## Échecs à éviter
- Proposer un correctif avant d'avoir établi la cause réelle.
- Présenter une hypothèse plausible comme une cause vérifiée.
- Réduire les étapes de reproduction au point de perdre le déclencheur réel.

## Prérequis d'exécution
Accès à un environnement où l'anomalie peut être reproduite. En son absence, le diagnostic est
déclaré non vérifié, pas résolu.
