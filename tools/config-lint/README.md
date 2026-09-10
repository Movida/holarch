# config-lint — validation mécanique de `framework/CONFIG.md`

> Livrable original de l'instance `concepteur`, mandat `MSG-concepteur-9`
> (piste B1 de l'audit indépendant du 2026-09-03 : « aucune validation
> mécanique des incompatibilités de modules dans CONFIG.md, seulement une
> vérification manuelle documentée sous couvert de "T1 ✅" »), déposé en
> proposition dans `docs/archive/mission-holon-v2/shared/concepteur/v2/tests-proposes/` puis promu
> ici par l'utilisateur (KERNEL §4 : aucune instance n'écrit sous `tools/`) —
> précédent : `tools/module-lint/`. Rapport complet, y compris le tableau des
> six contrôles et leur origine dans `BOOTSTRAP.md` : voir
> `docs/archive/mission-holon-v2/shared/concepteur/v2/RAPPORT-session-7.md` §5.

## Ce que c'est

`config-lint.js` est un CLI Node.js sans dépendance externe qui mécanise
l'Étape 1.3 de `framework/BOOTSTRAP.md` (test d'acceptation T1) : il vérifie
qu'un `CONFIG.md` de mission est cohérent avec `framework/MANIFEST.md` et
avec les modules qu'il déclare actifs, sans laisser cette vérification à
l'attention d'une session de bootstrap sur une tâche de tableur.

Contrôles appliqués (chacun cite la ligne de `BOOTSTRAP.md` ou le module dont
il découle) :

- chaque module actif existe dans le MANIFEST, catégorie cohérente, aucun
  doublon (1.3.a) ;
- exactement un module actif par catégorie obligatoire (1.3.b) ;
- aucune paire de modules actifs mutuellement incompatible, colonne
  « Requiert » du MANIFEST satisfaite (1.3.c) ;
- paramètres requis par les modules actifs présents dans `CONFIG.md`, y
  compris les paramètres hérités (1.3.d) ;
- `permission_mode` et `format_rapport_final` présents et de valeur reconnue
  (1.3.e) ;
- politique de modèle (profil/modèle/effort) valide, paramètres du harnais
  entiers positifs, `haiku` jamais utilisé pour une instance quand
  `direct-spawn` est actif (1.3.f) ;
- étapes 1.1/1.2 (fichiers présents, mission déjà en cours), en option
  (`--bootstrap-check`), car elles échouent par construction dans un dépôt
  qui porte déjà une mission.

Deux niveaux de diagnostic : **erreur** (le code de sortie devient `1`) et
**avertissement** (paramètre orphelin, profil non couvert par la politique de
modèle — n'affecte pas le code de sortie).

## Comment l'exécuter

```bash
node tools/config-lint/config-lint.js [framework/CONFIG.md] [--manifest <chemin>] [--modules-dir <chemin>] [--bootstrap-check] [--json]
node --test tools/config-lint/config-lint.test.js
```

Sans argument positionnel, `framework/CONFIG.md` est lu depuis le
répertoire courant ; `--manifest` et `--modules-dir` sont dérivés du même
répertoire si non fournis.

## Résultat réel sur le `CONFIG.md` de cette mission

```
$ node tools/config-lint/config-lint.js framework/CONFIG.md
config-lint · framework/CONFIG.md contre framework/MANIFEST.md
  → 0 erreur(s), 0 avertissement(s)
```

39/39 tests passent (`config-lint.test.js`) ; vérifié par mutation
(`tools/mutation-check/`, jeu `mutations-B1.json`) : 18/18 mutations tuées,
0 survivante.

## Limites assumées

- **Détection des paramètres requis : heuristique.** Un paramètre de module
  est tenu pour requis si sa cellule « Défaut » est vide, ou de la forme
  *(hérité de `CONFIG.md` → `X`)*. Un module qui exprimerait autrement une
  obligation ne serait pas vu — c'est une lecture de tableau markdown, pas
  une déclaration formelle.
- **L'outil applique les six règles de `BOOTSTRAP.md` et rien d'autre.** Il
  ne vérifie pas la cohérence interne d'un module (c'est `module-lint`), ni
  les versions.
- **`--bootstrap-check` est opt-in** parce qu'il échoue par construction dans
  un dépôt qui porte déjà une mission (étape 1.2) — bon comportement au
  bootstrap, faux positif partout ailleurs.
- **Ne prouve rien sur le comportement d'une session réelle**, seulement sur
  la conformité d'un fichier.

## Intégration dans `BOOTSTRAP.md`

Étape 1.3 appelle désormais cet outil, **sans retirer la liste des six
contrôles manuels** : elle reste la spécification, l'outil n'en est que
l'exécutant.
