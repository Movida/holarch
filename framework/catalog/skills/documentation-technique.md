---
id: documentation-technique
kind: skill
version: 1.0.0
title: Documenter techniquement
---

# Documenter techniquement

## Capacité observable
Produire une documentation que quelqu'un sans le contexte de la session peut suivre et vérifier
pas à pas, sur le système réel.

## Quand l'utiliser
- Nouveau composant, procédure ou décision technique à rendre accessible à d'autres.
- Documentation existante devenue incohérente avec l'état réel du système.

## Entrées nécessaires
- Le système, la procédure ou la décision à documenter.
- Le public visé et son niveau de contexte présumé.
- Accès pour vérifier réellement chaque instruction documentée.

## Méthode
1. Identifier ce que le lecteur visé doit pouvoir faire après lecture.
2. Suivre réellement chaque instruction avant de la documenter, pas de mémoire.
3. Définir les termes qui ne sont pas d'usage courant pour le public visé.
4. Structurer du général vers le détail, pas dans l'ordre où le travail a été fait.
5. Vérifier la cohérence avec l'état réel du système au moment de la publication.

## Preuves attendues
- Documentation dont chaque instruction a été suivie et vérifiée réellement.
- Mention explicite des points non vérifiés ou incertains, s'il y en a.

## Critères de qualité
- Une instruction documentée fonctionne réellement, telle qu'écrite.
- Le texte ne suppose pas un contexte que le lecteur visé n'a pas.
- Aucun renvoi à un raisonnement non reconstituable depuis les seuls fichiers écrits.

## Échecs à éviter
- Documenter une instruction non vérifiée comme si elle avait été suivie.
- Écrire pour le rédacteur lui-même plutôt que pour le lecteur visé.
- Laisser la documentation diverger silencieusement de l'état réel du système.

## Prérequis d'exécution
Accès au système réel pour vérifier chaque instruction avant de la documenter.
