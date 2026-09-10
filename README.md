# Projet HOLARCH

Ce dépôt a été créé depuis le modèle HOLARCH — un framework d'organisations hiérarchiques
récursives d'agents IA, où chaque instance est un contrat en markdown et où l'état est prouvé
parce qu'il est committé. Version du framework : voir `framework/VERSION` ; provenance exacte :
`HOLARCH-PROVENANCE.json` ; spécification complète : [`docs/holarch.md`](docs/holarch.md).

## Démarrer une mission (une seule par dépôt)

1. Rédiger [`mission/OBJECTIVE.md`](mission/OBJECTIVE.md) et [`framework/CONFIG.md`](framework/CONFIG.md), soit à la main depuis un preset ([`framework/presets/`](framework/presets/)), soit avec le setup guidé :
   ```bash
   node tools/holarch-init/holarch-init.js --out /tmp/ma-mission   # puis copier les deux fichiers produits
   ```
2. Vérifier : `npm run lint` (composition valide) puis `npm run dry-run` (le lanceur se résout sans rien lancer).
3. Lancer : `npm run bootstrap`. Ensuite, chaque itération se relance avec `node framework/bin/holarch-spawn.js <chemin-instance>` (skill `holarch-iterate` dans une session Claude Code).

## Rester à jour avec le framework

```bash
npm run upgrade              # rapport : version locale vs dernière version publiée, fichiers touchés, CONFIG.md toujours valide ?
npm run upgrade -- --apply   # applique, hors session de mission, sans toucher framework/CONFIG.md
```

`framework/CHANGELOG.md` explique chaque version ; une version **majeure** signale qu'un fichier
écrit sous l'ancienne version peut ne plus être valide — lire l'entrée avant d'appliquer.

## Ce qui est dans ce dépôt

```
framework/   ← le contrat (KERNEL, modules, presets, templates, catalogue) et le harnais (bin/, hooks/, claude/, tests/) — invariant pendant une mission
mission/     ← la mission : OBJECTIVE.md à rédiger, le reste est créé par le bootstrap
tools/       ← outils hors KERNEL : holarch-init, config-lint, module-forge, holarch-session, holarch-upgrade, …
docs/        ← holarch.md, la spécification qui fait foi
```

Tests : `npm test` (aucun appel réseau).
