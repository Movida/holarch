---
id: accessibilite
kind: skill
version: 1.0.0
title: Vérifier l'accessibilité
---

# Vérifier l'accessibilité

## Capacité observable
Établir, par une vérification réelle, qu'une interface reste utilisable par des personnes en
situation de handicap — pas seulement conforme en apparence à une check-list.

## Quand l'utiliser
- Conception ou implémentation d'une interface destinée à un usage général.
- Revue d'une interface existante dont l'accessibilité n'a jamais été vérifiée.

## Entrées nécessaires
- L'interface à vérifier (maquette ou implémentation).
- Le référentiel d'accessibilité applicable, si connu (ex. WCAG).

## Méthode
1. Vérifier la navigation au clavier, sans dépendre de la souris.
2. Vérifier la structure sémantique pour un lecteur d'écran.
3. Vérifier les contrastes de couleur et la lisibilité du texte.
4. Vérifier que l'information n'est jamais portée par la seule couleur.
5. Documenter les écarts trouvés et leur correctif proposé.

## Preuves attendues
- Vérification réellement exécutée (navigation clavier, lecteur d'écran ou outil équivalent).
- Écarts trouvés, avec leur localisation précise et un correctif proposé.

## Critères de qualité
- La vérification porte sur l'interface réelle, pas sur sa seule description.
- Chaque écart trouvé a un correctif proposé, pas seulement un signalement.
- Le référentiel applicable, s'il est connu, sert de base de vérification explicite.

## Échecs à éviter
- Déclarer une interface accessible sans vérification réelle.
- Vérifier uniquement les contrastes de couleur en ignorant la navigation clavier.
- Corriger un écart d'accessibilité en dégradant une autre exigence (ex. supprimer un intitulé).

## Prérequis d'exécution
Accès à l'interface réelle et, si possible, à un outil de vérification (lecteur d'écran,
analyseur de contraste). En leur absence, la vérification est déclarée non exécutée.
