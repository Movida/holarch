---
id: securite-applicative
kind: skill
version: 1.0.0
title: Sécuriser une application
---

# Sécuriser une application

## Capacité observable
Identifier et traiter les risques de sécurité d'un composant ou d'une architecture, avec des
correctifs vérifiables plutôt que des recommandations génériques.

## Quand l'utiliser
- Conception ou revue d'un composant qui traite des entrées externes, de l'authentification ou des
  données sensibles.
- Revue de code où une vulnérabilité classe OWASP est plausible (injection, XSS, contrôle d'accès,
  etc.).

## Entrées nécessaires
- Le composant ou l'architecture à examiner.
- Les données sensibles en jeu et leur classification, si connue.
- Les contraintes de conformité applicables, si identifiées.

## Méthode
1. Identifier les entrées non fiables et leur traitement.
2. Vérifier l'authentification et l'autorisation séparément — ne pas les confondre.
3. Rechercher les vulnérabilités classe OWASP applicables au périmètre examiné.
4. Proposer un correctif vérifiable pour chaque risque trouvé, pas seulement un signalement.
5. Vérifier qu'aucun secret n'apparaît dans le code, les exemples ou les journaux produits.

## Preuves attendues
- Liste des risques trouvés, avec leur sévérité et leur localisation précise.
- Correctif proposé ou appliqué pour chaque risque, vérifiable.

## Critères de qualité
- Authentification et autorisation sont traitées comme deux questions distinctes.
- Chaque risque signalé est accompagné d'un scénario d'exploitation concret, pas générique.
- Aucun secret ne figure dans un livrable produit.

## Échecs à éviter
- Signaler un risque sans scénario d'exploitation ni piste de correction.
- Confondre chiffrement en transit et protection des données au repos.
- Introduire une vulnérabilité en corrigeant une autre (ex. désactiver une validation pour un
  correctif rapide).

## Prérequis d'exécution
Accès au code ou à l'architecture réelle du composant examiné — pas d'analyse de sécurité sur la
seule base d'une description.
