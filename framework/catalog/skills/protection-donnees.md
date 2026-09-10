---
id: protection-donnees
kind: skill
version: 1.0.0
title: Protéger les données
---

# Protéger les données

## Capacité observable
Identifier les données sensibles traversant un système et vérifier qu'elles sont traitées
conformément aux contraintes de confidentialité et de conformité applicables.

## Quand l'utiliser
- Conception ou revue d'un composant qui reçoit, stocke ou transmet des données personnelles ou
  sensibles.
- Pipeline LLM dont le contexte ou les journaux peuvent contenir des données sensibles.

## Entrées nécessaires
- Le flux de données à examiner (entrée, stockage, sortie, journaux).
- La classification de sensibilité des données en jeu, si connue.
- Les contraintes de conformité applicables.

## Méthode
1. Cartographier où les données sensibles entrent, transitent et sont stockées.
2. Vérifier qu'aucune donnée sensible ne fuit dans des journaux, exemples ou messages d'erreur.
3. Vérifier la minimisation : ne conserver ou transmettre que ce qui est nécessaire au besoin.
4. Vérifier les contrôles d'accès sur les données stockées.
5. Documenter les données sensibles restant exposées et leur justification, s'il y en a une.

## Preuves attendues
- Cartographie des flux de données sensibles.
- Vérification explicite de l'absence de fuite dans journaux, exemples, messages d'erreur.

## Critères de qualité
- Aucune donnée sensible réelle n'apparaît dans un exemple, un journal ou un livrable produit.
- La minimisation est appliquée, pas seulement recommandée.
- Toute exposition restante est documentée et justifiée, jamais silencieuse.

## Échecs à éviter
- Utiliser des données réelles sensibles dans des exemples ou des tests.
- Confondre chiffrement en transit et absence de fuite dans les journaux applicatifs.
- Considérer la conformité vérifiée sans avoir examiné les journaux réellement produits.

## Prérequis d'exécution
Accès au flux de données réel (code, configuration, journaux) — pas d'évaluation sur la seule
description du système.
