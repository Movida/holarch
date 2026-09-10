---
id: tests-automatises
kind: skill
version: 1.0.0
title: Écrire et exécuter des tests automatisés
---

# Écrire et exécuter des tests automatisés

## Capacité observable
Produire une suite de tests qui vérifie réellement, par exécution, qu'un comportement attendu est
respecté — et qui échoue quand il ne l'est pas.

## Quand l'utiliser
- Toute implémentation dont l'acceptation dépend d'un comportement vérifiable.
- Correction d'un défaut : un test qui reproduit le défaut avant le correctif.

## Entrées nécessaires
- Comportement attendu et cas d'acceptation.
- Environnement d'exécution des tests.
- Cas d'erreur ou limites à couvrir, en plus du chemin nominal.

## Méthode
1. Écrire un test pour chaque critère d'acceptation identifié.
2. Couvrir explicitement au moins un cas d'erreur ou d'entrée invalide.
3. Exécuter réellement la suite et consigner le résultat exact (commande, sortie).
4. Si un test échoue, ne pas l'ajuster pour qu'il passe sans corriger la cause.
5. Rejouer la suite après tout changement pertinent.

## Preuves attendues
- Suite de tests, avec la commande exacte pour la relancer.
- Résultat réellement observé de l'exécution (pas un résultat attendu présenté comme observé).

## Critères de qualité
- Chaque critère d'acceptation a au moins un test qui le couvre.
- Un test qui échoue produit un signal clair, pas un faux positif silencieux.
- La commande de lancement est reproductible par un tiers.

## Échecs à éviter
- Annoncer une suite « verte » sans l'avoir réellement exécutée.
- Adapter un test pour qu'il passe plutôt que corriger le défaut qu'il révèle.
- Ne couvrir que le chemin nominal.

## Prérequis d'exécution
Environnement capable de lancer la suite. En son absence, tout résultat de test est déclaré non
exécuté, jamais présumé.
