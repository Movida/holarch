---
id: planification
kind: skill
version: 1.0.0
title: Planifier un lot de travail
---

# Planifier un lot de travail

## Capacité observable
Découper un besoin cadré en lots de travail ordonnés, avec leurs dépendances explicites.

## Quand l'utiliser
- Après cadrage d'un besoin dont la taille dépasse une session ou une instance.
- Avant toute décision de délégation (spawn), pour savoir ce qui doit être décomposé.

## Entrées nécessaires
- Besoin cadré et critères d'acceptation (voir `cadrage-besoin`).
- Contraintes de budget d'instances et de profondeur disponibles.

## Méthode
1. Découper le besoin en lots dont chacun produit un livrable vérifiable seul.
2. Identifier les dépendances réelles entre lots (pas toutes les dépendances imaginables).
3. Ordonner les lots selon ces dépendances.
4. Vérifier que le découpage tient dans le budget d'instances et la profondeur disponibles.
5. Documenter les hypothèses de planification qui pourraient invalider l'ordre choisi.

## Preuves attendues
- Liste de lots avec leurs dépendances explicites.
- Ordre d'exécution motivé par les dépendances, pas par une préférence arbitraire.

## Critères de qualité
- Chaque lot a un livrable vérifiable propre.
- Aucune dépendance circulaire non résolue.
- Le plan reste cohérent avec le budget et la profondeur réellement disponibles.

## Échecs à éviter
- Découper plus finement que ce que la coordination réelle justifie.
- Ignorer une dépendance connue pour paraître plus avancé.
- Planifier sans vérifier le budget d'instances restant.

## Prérequis d'exécution
Connaissance du budget d'instances et de la profondeur maximale en vigueur (`CONFIG.md`).
