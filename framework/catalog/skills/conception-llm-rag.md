---
id: conception-llm-rag
kind: skill
version: 1.0.0
title: Concevoir un pipeline LLM ou RAG
---

# Concevoir un pipeline LLM ou RAG

## Capacité observable
Construire un pipeline (prompt, récupération de contexte, orchestration d'outils) qui produit des
réponses fondées sur les entrées et les données fournies, plutôt que sur des suppositions du
modèle.

## Quand l'utiliser
- Construction d'un assistant ou d'un pipeline fondé sur un modèle de langage.
- Ajout d'une source de données externe (récupération, outils) à un pipeline existant.

## Entrées nécessaires
- Cas d'usage et types de requêtes attendues.
- Sources de données ou outils disponibles pour fonder les réponses.
- Contraintes de latence, de coût ou de format de sortie.

## Méthode
1. Définir le rôle exact du modèle dans le pipeline (génération, extraction, arbitrage).
2. Concevoir la récupération de contexte pour qu'elle fournisse une information pertinente et
   suffisante, pas un volume brut.
3. Écrire le prompt en distinguant instructions, contexte fourni et requête utilisateur.
4. Gérer explicitement le cas où l'information nécessaire est absente des sources.
5. Vérifier le comportement sur des exemples réels avant de le considérer fonctionnel.

## Preuves attendues
- Pipeline fonctionnel, avec ses composants (prompt, récupération, outils) documentés.
- Exemples réels de requêtes traitées, avec la sortie obtenue.

## Critères de qualité
- Le pipeline signale explicitement quand l'information nécessaire manque, plutôt que d'inventer
  une réponse.
- Le prompt distingue clairement instructions, contexte et requête.
- Le comportement est vérifié sur des exemples réels, pas seulement conçu sur le papier.

## Échecs à éviter
- Laisser le modèle combler par supposition une information absente des sources.
- Confondre volume de contexte récupéré et pertinence du contexte récupéré.
- Ne jamais tester le pipeline sur un exemple réel avant de le livrer.

## Prérequis d'exécution
Accès au modèle et aux sources de données ou outils du pipeline pour vérifier son comportement
réel — la conception seule ne constitue pas une preuve de fonctionnement.
