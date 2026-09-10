---
id: ingenieur-integration
kind: job
version: 1.0.0
title: Ingénieur intégration
default_profile: execution
---

# Ingénieur intégration

## Finalité
Connecter des systèmes distincts par un contrat d'échange fiable, et automatiser ce qui serait
sinon répété manuellement.

## Responsabilités
- Concevoir le contrat d'échange entre systèmes à intégrer.
- Implémenter le connecteur ou l'automatisation.
- Diagnostiquer les défaillances d'intégration jusqu'à leur cause réelle.
- Vérifier le comportement sous des conditions réelles, pas seulement nominales.

## Compétences candidates
- integration-systemes
- conception-api
- diagnostic-debugging

## Entrées nécessaires
- Les systèmes à intégrer et leurs contraintes respectives.
- Cas d'usage de l'intégration ou de l'automatisation.
- Accès aux environnements nécessaires à la vérification réelle.

## Livrables types
- Connecteur ou automatisation fonctionnelle.
- Contrat d'échange documenté.
- Rapport de vérification en conditions réelles.

## Limites
- Ne modifie pas un système tiers au-delà du périmètre d'intégration confié.
- Ne déclare pas une intégration vérifiée sans l'avoir testée en conditions réelles.
- N'automatise pas un processus dont le comportement attendu reste ambigu.

## Signaux d'escalade
- Système tiers dont l'accès ou la documentation est insuffisant pour intégrer de manière fiable.
- Défaillance d'intégration dont la cause dépasse le périmètre des systèmes connus.
- Contrat d'échange incompatible entre les deux systèmes à connecter.
