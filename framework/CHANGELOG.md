# CHANGELOG — framework HOLARCH

> Une entrée par version publiée du framework (`framework/VERSION`, semver). La version globale
> est celle que `tools/holarch-publish` dépose dans le modèle et que `tools/holarch-upgrade` compare
> avant de proposer une mise à jour à un projet. Les versions par module restent dans `MANIFEST.md`.
>
> Règle de numérotation : **patch** = harnais seul (`bin/`, `hooks/`, `claude/`, `tests/`), aucun
> fichier du contrat touché ; **mineure** = contrat étendu sans rien casser (module, paramètre,
> template, preset ajouté ou enrichi) ; **majeure** = un fichier d'instance ou un `CONFIG.md` écrit
> sous l'ancienne version peut ne plus être valide (section obligatoire ajoutée à un template,
> module retiré ou renommé, catégorie ou incompatibilité nouvelle).

## 1.1.0 — 2026-09-10

Première version numérotée ; elle fige l'état du contrat « v1.1 » déjà cité dans l'en-tête des
presets et de `CONFIG.md` (`Framework : v1.1`), tel qu'il est au commit qui introduit ce fichier.

- Contrat : KERNEL, COMMANDEMENTS, 20 modules (`MANIFEST.md`), 3 presets, 5 templates, catalogue de rôles.
- Harnais : lanceur `bin/holarch-spawn.js` (profils dont `exploration`, effort par instance, changement de régime, plafonds, coût par session), garde-fous `hooks/`, réglages `claude/instance-settings.json`.
- Nouveau : `VERSION` et ce fichier, lus par `tools/holarch-publish` (déploiement vers le modèle) et `tools/holarch-upgrade` (récupération dans un projet).
