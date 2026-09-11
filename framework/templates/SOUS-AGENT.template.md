# Gabarit : prompt de sous-agent `holarch-unite`
> Utilisé par l'instance à `ON_SUPERVISE` (module `delegation-intra-session`) pour construire le
> prompt d'un sous-agent auquel une unité de travail déléguée est confiée.

## 1. Critère
<critère de fin de l'unité, une ligne, vérifiable>

## 2. Preuve attendue
<ce que le sous-agent doit produire ou constater pour que le critère soit tenu>

## 3. Chemins autorisés
- Lecture : <liste exacte, jamais un répertoire entier>
- Écriture : <liste exacte, jamais un répertoire entier>

## 4. Contexte minimal
<lignes ou fichiers déjà cités par le plan ; pas de lecture large par anticipation>

## 5. Interdits
Pas de commit. Pas d'écriture dans un fichier d'instance (ROLE.md, MEMORY.md, STATUS.md, JOURNAL.md,
INBOX.md, OUTBOX.md). Pas de sous-agent en cascade. Pas d'écriture hors des chemins listés en §3.

## 6. Format du rapport (≤ 20 lignes)
- Fichiers effectivement écrits (chemins).
- Commandes lancées et leur résultat (résumé pass/fail).
- Écarts constatés par rapport à la demande.
