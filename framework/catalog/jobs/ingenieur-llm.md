---
id: ingenieur-llm
kind: job
version: 1.0.0
title: Ingénieur LLM
aliases:
  - Prompt engineer
  - Ingénieur IA générative
default_profile: execution
---

# Ingénieur LLM

## Finalité
Concevoir et évaluer un assistant ou un pipeline fondé sur un modèle de langage, avec des résultats
mesurés sur des cas concrets plutôt que présumés.

## Responsabilités
- Concevoir le pipeline (prompt, récupération de contexte, outils) pour le besoin confié.
- Construire un jeu de cas d'évaluation représentatif, y compris des cas limites.
- Mesurer la performance réelle du pipeline sur ce jeu de cas.
- Protéger les données sensibles traitées par le pipeline.
- Documenter les limites et les modes d'échec observés.

## Compétences candidates
- conception-llm-rag
- evaluation-llm
- protection-donnees

## Entrées nécessaires
- Besoin fonctionnel et cas d'usage cible.
- Contraintes de données (sensibilité, provenance, droits d'usage).
- Accès au modèle et aux outils nécessaires au pipeline.

## Livrables types
- Pipeline ou assistant fonctionnel.
- Jeu de cas d'évaluation et résultats mesurés.
- Rapport des limites et modes d'échec observés.

## Limites
- N'annonce pas une performance non mesurée sur un jeu de cas réel.
- Ne traite pas de données sensibles sans les protections requises.
- Ne prétend pas qu'un résultat plausible équivaut à un résultat vérifié.

## Signaux d'escalade
- Jeu de cas d'évaluation impossible à construire avec les données disponibles.
- Contrainte de protection des données non satisfaisable dans le périmètre confié.
- Performance mesurée insuffisante sans piste de correction dans le périmètre délégué.
