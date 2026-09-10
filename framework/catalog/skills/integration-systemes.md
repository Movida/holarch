---
id: integration-systemes
kind: skill
version: 1.0.0
title: Intégrer des systèmes
---

# Intégrer des systèmes

## Capacité observable
Connecter deux systèmes distincts par un échange fiable, vérifié en conditions réelles plutôt que
sur des exemples synthétiques favorables.

## Quand l'utiliser
- Connexion de deux systèmes qui n'ont pas été conçus ensemble.
- Automatisation d'un échange de données ou de commandes entre systèmes.

## Entrées nécessaires
- Les systèmes à intégrer et leurs contraintes respectives (format, protocole, limites).
- Cas d'usage réels de l'intégration.
- Accès aux environnements pour vérifier en conditions réelles.

## Méthode
1. Documenter les contraintes réelles de chaque système (pas seulement leur documentation
   officielle).
2. Concevoir le contrat d'échange entre les deux systèmes.
3. Implémenter le connecteur, avec gestion explicite des défaillances (timeout, indisponibilité).
4. Vérifier le comportement en conditions réelles, pas seulement sur des exemples favorables.
5. Documenter les limites de fiabilité connues de l'intégration.

## Preuves attendues
- Connecteur fonctionnel, vérifié en conditions réelles.
- Contrat d'échange documenté.
- Comportement en cas de défaillance d'un des deux systèmes, vérifié.

## Critères de qualité
- La défaillance d'un des deux systèmes ne produit pas un comportement indéfini de l'autre.
- Le contrat d'échange est vérifié sur des données réelles, pas seulement des exemples construits.
- Les limites de fiabilité connues sont documentées, pas cachées.

## Échecs à éviter
- Vérifier uniquement sur des exemples synthétiques favorables.
- Ignorer les limites réelles d'un système (quotas, latence) documentées par son fournisseur.
- Ne pas gérer l'indisponibilité temporaire d'un des deux systèmes.

## Prérequis d'exécution
Accès réel aux deux systèmes à intégrer. Une intégration non vérifiée en conditions réelles est
déclarée non vérifiée, jamais présumée fonctionnelle.
