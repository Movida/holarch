# holarch-upgrade — récupérer la dernière version du framework dans un projet

> Ajouté le 2026-09-10 (`docs/holarch.md` §15, décision 19). Copié dans le modèle par
> [`tools/holarch-publish/`](../holarch-publish/) ; c'est l'outil qu'un projet HOLARCH utilise entre
> deux itérations pour bénéficier des dernières fonctionnalités du framework.

## Pourquoi un rapport d'abord, jamais une récupération automatique

Une image de conteneur se remplace parce que le conteneur est sans état. Ici l'« image » est un
contrat en markdown, et l'état du projet (`mission/`) lui est étroitement couplé : les fichiers
d'instance ont été écrits selon les templates d'une version, `CONFIG.md` selon un `MANIFEST.md`.
KERNEL §4 interdit d'ailleurs à quiconque d'écrire `framework/` pendant une mission. D'où :

- le mode par défaut **rapporte** et ne touche à rien ;
- `--apply` est **refusé tant qu'une session de mission tourne** (même détection que
  `tools/holarch-session` : processus `holarch-spawn.js` / `claude -p`) et tant que `CONFIG.md`
  n'est pas valide contre la nouvelle version ;
- `framework/CONFIG.md` n'est **jamais** écrit (c'est la composition de la mission) ;
  `framework/claude/instance-settings.json` n'est jamais écrasé (allowlist possiblement élargie par
  le projet, BOOTSTRAP §0) — la différence est rapportée, la fusion reste manuelle ;
- rien n'est committé : le mainteneur relit `git diff`, puis committe.

## Utilisation

```bash
npm run upgrade                     # rapport complet (source : package.json → holarch.modele)
npm run upgrade -- --bref           # une ligne, pour le skill holarch-iterate
npm run upgrade -- --apply          # applique, hors session de mission
npm run upgrade -- --source <url|dir> [--ref v1.2.0]   # source explicite ; --ref : tag précis (défaut : plus grand tag v<semver>)
```

Options : `--json`, `--racine <dir>`. Variable `HOLARCH_GARDE_PS` : remplace la sortie de
`ps -eo pid,args` (tests).

Codes de sortie : **0** à jour ou appliqué · **1** mise à jour disponible (rapport) · **2** erreur
ou refus (mission en cours, source invalide) · **3** `CONFIG.md` invalide contre la nouvelle
version — à corriger à la main avant `--apply`.

## Ce que le rapport contient

- version locale et version de la source (`framework/VERSION`), niveau du changement
  (patch / mineure / majeure, règle en tête de `framework/CHANGELOG.md`) ; en majeure, un
  avertissement explicite : un fichier écrit sous l'ancienne version peut ne plus être valide ;
- fichiers ajoutés / modifiés / retirés dans le périmètre `framework/`, `tools/`, `.claude/`,
  `docs/holarch.md` (jamais `mission/`, jamais les autres `docs/`) ;
- validation du `CONFIG.md` local par le `config-lint` et le `module-forge` **de la source**,
  contre son `MANIFEST.md` et ses modules ;
- fichiers de `mission/` non committés (signe qu'une instance a écrit récemment).

Après `--apply`, `package.json → holarch.version` est aligné sur la version récupérée.

## Dans le dépôt canonique

`npm run upgrade` y répond « aucune source de modèle » (code 0) : la lignée canonique ne se met
pas à jour depuis le modèle, c'est elle qui le publie.

## Limites assumées

- Comparaison fichier par fichier, pas de fusion à trois voies : un fichier du périmètre modifié
  localement (hors les deux préservés) est écrasé par `--apply`, et le rapport le liste comme
  « modifié » sans dire qui l'a changé. Garder les adaptations locales hors de `framework/` et
  `tools/`, ou dans les deux fichiers préservés.
- La validation porte sur `CONFIG.md` seulement ; elle ne relit pas les fichiers d'instance contre
  les nouveaux templates — c'est ce que signale l'avertissement de version majeure.
- La détection de mission en cours repose sur `ps` : hors Linux, elle est vide.

## Tests

`node --test tools/holarch-upgrade/test-upgrade.js` (six tests : rapport, refus puis application
avec fichiers préservés, `CONFIG.md` invalide en majeure, à jour / plus récent / sans source, source
Git par tag sur un dépôt nu local, CLI). Aucun réseau. Branché sur `npm test`.
