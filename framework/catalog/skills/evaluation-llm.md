---
id: evaluation-llm
kind: skill
version: 1.0.0
title: Évaluer un pipeline ou assistant LLM
---

# Évaluer un pipeline ou assistant LLM

## Capacité observable
Mesurer, sur un jeu de cas représentatif, la performance réelle d'un pipeline ou d'un assistant
fondé sur un modèle de langage — plutôt que juger sa qualité sur quelques exemples anecdotiques.

## Quand l'utiliser
- Avant de considérer un pipeline LLM prêt à livrer.
- Après une modification du prompt, du modèle ou des données de récupération.

## Entrées nécessaires
- Le pipeline ou l'assistant à évaluer.
- Des cas représentatifs du besoin réel, y compris des cas limites.
- Un critère de succès explicite pour chaque cas.

## Méthode
1. Construire un jeu de cas couvrant les usages fréquents et les cas limites connus.
2. Définir, pour chaque cas, un critère de succès vérifiable (pas seulement « ça semble bon »).
3. Exécuter réellement le pipeline sur chaque cas et consigner la sortie obtenue.
4. Comparer la sortie au critère de succès et consigner le résultat, échecs inclus.
5. Analyser les modes d'échec récurrents plutôt que les cas isolés.

## Preuves attendues
- Jeu de cas avec critères de succès explicites.
- Résultats réellement observés, y compris les échecs.
- Analyse des modes d'échec récurrents.

## Critères de qualité
- Le jeu de cas couvre des cas limites, pas seulement des cas favorables.
- Chaque résultat rapporté correspond à une exécution réelle, pas à une extrapolation.
- Les échecs sont rapportés avec la même rigueur que les succès.

## Échecs à éviter
- Évaluer sur un jeu de cas trop restreint ou trop favorable pour être représentatif.
- Ne rapporter que les cas de succès.
- Confondre une sortie plausible avec une sortie correcte, sans vérification du critère de succès.

## Prérequis d'exécution
Accès au pipeline réel et au modèle pour exécuter l'évaluation — une évaluation non exécutée est
déclarée non faite, jamais présumée.
