---
id: implementation-frontend
kind: skill
version: 1.0.0
title: Implémenter une interface
---

# Implémenter une interface

## Capacité observable
Transformer une spécification ou une maquette d'interface en interface fonctionnelle, qui gère
explicitement ses états d'erreur et de chargement.

## Quand l'utiliser
- Développement d'une interface à partir d'une spécification ou de maquettes définies.
- Correction d'un défaut dans une interface existante.

## Entrées nécessaires
- Spécification ou maquettes d'interface.
- Contrats d'API consommés.
- Contraintes de compatibilité (navigateurs, appareils).

## Méthode
1. Vérifier la cohérence entre la maquette et les contrats d'API disponibles avant d'implémenter.
2. Implémenter l'état nominal, puis les états de chargement et d'erreur.
3. Gérer les entrées utilisateur invalides sans comportement indéfini.
4. Écrire les tests couvrant les interactions principales.
5. Vérifier le rendu sur les contraintes de compatibilité demandées.

## Preuves attendues
- Interface fonctionnelle conforme à la spécification.
- États d'erreur et de chargement gérés explicitement.
- Tests exécutés avec leur résultat.

## Critères de qualité
- Chaque état (nominal, chargement, erreur) est géré, pas seulement le chemin favorable.
- L'interface reste utilisable en cas d'échec d'un appel réseau.
- Les tests exécutés couvrent au moins les interactions principales spécifiées.

## Échecs à éviter
- Implémenter uniquement le chemin nominal.
- Ignorer une incohérence entre maquette et contrat d'API plutôt que la signaler.
- Annoncer un test comme exécuté sans l'avoir réellement lancé.

## Prérequis d'exécution
Environnement d'exécution et de test disponible. En son absence, une vérification est déclarée non
exécutée.
