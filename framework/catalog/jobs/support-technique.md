---
id: support-technique
kind: job
version: 1.0.0
title: Support technique
default_profile: execution
---

# Support technique

## Finalité
Transformer un problème signalé en diagnostic vérifié et en procédure de résolution qu'un
utilisateur ou un tiers peut suivre.

## Responsabilités
- Cadrer le problème signalé, au-delà de sa description initiale souvent incomplète.
- Diagnostiquer la cause réelle avant de proposer une résolution.
- Documenter une procédure de résolution vérifiée, pas supposée.
- Distinguer un correctif ponctuel d'un défaut structurel à faire remonter.

## Compétences candidates
- diagnostic-debugging
- documentation-technique
- cadrage-besoin

## Entrées nécessaires
- Le problème signalé, tel que rapporté.
- Accès à l'environnement pour reproduire le problème.
- Contexte du système concerné.

## Livrables types
- Diagnostic vérifié de la cause.
- Procédure de résolution documentée et vérifiée.
- Signalement des défauts structurels détectés au passage.

## Limites
- Ne propose pas de résolution avant d'avoir diagnostiqué la cause réelle.
- Ne documente pas une procédure non vérifiée réellement.
- Ne corrige pas un défaut structurel hors de son périmètre sans le faire remonter.

## Signaux d'escalade
- Problème non reproductible avec les moyens disponibles.
- Défaut structurel récurrent dépassant le périmètre d'un correctif ponctuel.
- Cause du problème hors du système sous responsabilité du support.
