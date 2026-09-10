# module-forge — validateur mécanique d'extensions HOLARCH

> Conçu par `concepteur` (mission `holon-v2`), priorité 3.1 de `docs/archive/mission-holon-v2/shared/concepteur/SYNTHESE-HOLON-V2.md` — itération 3.
> Promu dans `tools/` le 2026-09-03 (décision humaine — voir `docs/archive/mission-holon-v2/shared/concepteur/v2/RAPPORT-session-3.md`), depuis `docs/archive/mission-holon-v2/shared/concepteur/v2/module-forge/`.

Un module HOLARCH est un fichier markdown normatif : rien n'empêche d'en écrire un qui référence un hook inexistant, oublie une section obligatoire, ou soit incompatible avec un module déjà actif. Ces erreurs ne se manifestent qu'au réveil d'une instance, sous forme de comportement incohérent — c'est-à-dire trop tard et sans message d'erreur. `validate-module.js` déplace ce contrôle avant l'exécution.

Node pur, **aucune dépendance**, aucun réseau.

## Les deux commandes

```bash
# 1. Contrat de module (spec §8.1) — un ou plusieurs fichiers
node tools/module-forge/validate-module.js module framework/modules/recursion/max-depth.md

# 2. Composition d'une configuration (= test d'acceptation T1, rejouable à la demande)
node tools/module-forge/validate-module.js config framework/CONFIG.md

# 2 bis. Composition incluant un module candidat pas encore catalogué au MANIFEST
node tools/module-forge/validate-module.js config /tmp/CONFIG-essai.md \
  --extra chemin/vers/module-candidat.md
```

Options : `--manifest <f>`, `--modules-dir <d>`, `--extra <module.md>`, `--json`, `--strict` (les avertissements deviennent des erreurs), `-h`.

Codes de sortie : **0** conforme · **1** erreur(s) de conformité · **2** erreur d'usage. Utilisable tel quel dans un hook Git ou une CI.

Tests : `node --test tools/module-forge/test-validate-module.js` (branché sur `npm test`/CI) → **10 tests, tous passants**. L'un d'eux valide le catalogue réel (désormais 14 modules, `milestone-reviews` inclus) et `framework/CONFIG.md` : toute régression du framework qui casserait la conformité fait échouer la suite.

## Ce qu'il vérifie mécaniquement

**En mode `module`** :

| Contrôle | Détail |
|---|---|
| Titre et nom | `# Module : <nom>`, kebab-case, identique au nom de fichier |
| En-tête | champs requis présents (`Catégorie`, `Version`, …) ; les champs indicatifs manquants ne sont qu'un avertissement |
| Catégorie | appartient à la liste des catégories connues |
| Version | semver strict `MAJEUR.MINEUR.CORRECTIF` |
| Sections | `## Paramètres` (colonnes exactement `Paramètre | Défaut | Description`) et `## Règles injectées` présentes |
| Hooks | au moins un `### ⚓ <HOOK>` ; chaque hook existe au KERNEL §2, n'est pas déclaré deux fois, et **n'est pas vide** (un hook sans instruction est une erreur, pas un oubli anodin) |
| Références | `Requiert` / `Incompatible avec` pointent des modules réellement catalogués |
| Symétrie | une incompatibilité déclarée d'un seul côté est une erreur (spec §8.1 règle d) — le cas le plus facile à introduire à la main |
| Cohérence MANIFEST | catégorie et version du module = celles du catalogue ; absence du MANIFEST = avertissement (le module est inutilisable tant qu'il n'y est pas, spec §8.4) |

**En mode `config`** (c'est la valeur ajoutée réelle : les erreurs de *composition* ne sont visibles dans aucun fichier de module pris isolément) : section `## Modules actifs` présente et non vide ; chaque module actif existe au MANIFEST dans la catégorie annoncée ; **exactement un** module par catégorie obligatoire (zéro et deux sont tous deux des erreurs) ; toute dépendance `Requiert` est elle-même active ; aucune paire de modules incompatibles simultanément active.

## Ce qu'il ne peut pas vérifier — et pourquoi le dire

C'est la limite structurante de l'outil, et elle est assumée : **la conformité de forme n'est pas la cohérence de fond**. Le validateur ne lit pas le sens des instructions.

- **Contradiction avec le KERNEL** : un module peut être parfaitement conforme et prescrire quelque chose que le KERNEL interdit. L'outil ne fait que **signaler pour relecture humaine** les formulations qui prétendent lever un invariant — un signalement, jamais un blocage (un test couvre exactement ce comportement). La revue de fond reste humaine, ou confiée à une instance de profil `relecture`.
- **Recouvrement fonctionnel entre deux modules** : rien ne détecte que deux modules actifs font, en pratique, le même travail. Cas réel rencontré dans cette itération : `milestone-reviews` recouvre partiellement `heartbeat-log` pour un enfant qui ne franchit aucun jalon. Signalé par `forgeron`, jugé acceptable et documenté — mais aucun contrôle mécanique ne l'aurait trouvé.
- **Pertinence des paramètres et des valeurs par défaut** : l'outil vérifie que la table existe et a les bonnes colonnes, pas qu'un défaut soit raisonnable ni qu'un paramètre déclaré serve à quelque chose.

**Un contrôle de style a été écrit puis retiré délibérément** : une vérification que les règles injectées soient rédigées à la deuxième personne. Elle criait à tort sur **8 hooks parfaitement légitimes** du catalogue réel. Un validateur qui produit une majorité de faux positifs sur son propre corpus de référence n'est pas un validateur strict, c'est un validateur qu'on apprend à ignorer — et un outil qu'on ignore ne protège rien. Retirer ce contrôle était le choix le plus coûteux à l'ego et le plus utile à la crédibilité de l'outil ; c'est pour cette raison qu'il est documenté ici plutôt que passé sous silence.

## Preuve d'usage réel

L'outil n'a pas été validé seulement contre le catalogue existant : un **vrai enfant HOLARCH** (`concepteur/forgeron`, profil `execution`) a conçu de zéro un module `milestone-reviews`, l'a fait valider, et l'a livré composé dans une copie de `CONFIG.md` — 0 erreur sur le module comme sur la composition, revérifié indépendamment par `concepteur` (producteur ≠ juge, KERNEL §5.2). Voir `docs/archive/mission-holon-v2/shared/concepteur/forgeron/RAPPORT.md` et `archive/mission-holon-v2/shared/concepteur/v2/RAPPORT-session-3.md`. Ce module a depuis été promu à son tour : `framework/modules/extensions/milestone-reviews.md`, catalogué au `MANIFEST.md`.

## Promotion

Fait le 2026-09-03 (décision humaine, `framework/` restant en lecture seule pour toute instance, KERNEL §4) : relogé de `docs/archive/mission-holon-v2/shared/concepteur/v2/module-forge/` vers `tools/module-forge/`, suite branchée sur `npm test`/CI (`.github/workflows/test.yml`).
